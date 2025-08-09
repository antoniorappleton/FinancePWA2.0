// js/screens/dashboard.js
import { db } from "../firebase-config.js";
import {
  getDocs, collection, query, orderBy, limit, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function initScreen() {
  console.log("✅ dashboard.js iniciado");

  // --- ELEMENTOS DA UI ---
  const valorTotalEl    = document.getElementById("valorTotal");
  const retornoEl       = document.getElementById("retornoTotal");
  const lucroTotalEl    = document.getElementById("lucroTotal");
  const posicoesEl      = document.getElementById("posicoesAtivas");
  const objetivosEl     = document.getElementById("objetivosFinanceiros");
  const taxaSucessoEl   = document.getElementById("taxaSucesso");
  const objetivoTotalEl = document.getElementById("objetivoTotal");
  const valorCarteiraEl = document.getElementById("valorCarteira");

  // --- ACUMULADORES ---
  let totalInvestido = 0;
  let totalLucro = 0;
  let objetivoFinanceiroTotal = 0;
  let objetivosAtingidos = 0;

  try {
    // 1) Buscar ativos e preços atuais
    const [ativosSnapshot, acoesSnapshot] = await Promise.all([
      getDocs(collection(db, "ativos")),
      getDocs(collection(db, "acoesDividendos")),
    ]);

    // Mapa de preços atuais por TICKER
    const valorAtualMap = new Map();
    acoesSnapshot.forEach((doc) => {
      const d = doc.data();
      if (d.ticker && typeof d.valorStock === "number") {
        valorAtualMap.set(String(d.ticker).toUpperCase(), d.valorStock);
      }
    });

    // Agrupar ativos por TICKER
    const agrupadoPorTicker = new Map();

    ativosSnapshot.forEach((doc) => {
      const a = doc.data();
      const ticker = (a.ticker || "").toUpperCase();
      if (!ticker) return;

      const grupo = agrupadoPorTicker.get(ticker) || {
        quantidade: 0,
        investimento: 0,
        objetivoFinanceiro: 0,
        objetivoDefinido: false,
      };

      const quantidade   = parseFloat(a.quantidade || 0);
      const precoCompra  = parseFloat(a.precoCompra || 0);
      const objetivo     = parseFloat(a.objetivoFinanceiro || 0);

      grupo.quantidade   += quantidade;
      grupo.investimento += precoCompra * quantidade;

      // objetivo conta uma única vez por ticker
      if (!grupo.objetivoDefinido && objetivo > 0) {
        grupo.objetivoFinanceiro = objetivo;
        grupo.objetivoDefinido   = true;
      }

      agrupadoPorTicker.set(ticker, grupo);
    });

    let totalObjetivos = 0;

    // Calcular KPIs globais
    agrupadoPorTicker.forEach((g, ticker) => {
      const precoAtual = valorAtualMap.get(ticker) || 0;
      const atual      = g.quantidade * precoAtual;
      const lucro      = atual - g.investimento;

      totalInvestido += g.investimento;
      totalLucro     += lucro;

      if (g.objetivoDefinido) {
        totalObjetivos++;
        objetivoFinanceiroTotal += g.objetivoFinanceiro;
        if (lucro >= g.objetivoFinanceiro) objetivosAtingidos++;
      }
    });

    const retorno     = totalInvestido > 0 ? (totalLucro / totalInvestido) * 100 : 0;
    const taxaSucesso = objetivoFinanceiroTotal > 0 ? (totalLucro / objetivoFinanceiroTotal) * 100 : 0;
    const valorCarteira = totalInvestido + totalLucro; // 💰 investido + lucro/prejuízo

    // Atualizar UI
    if (valorTotalEl)     valorTotalEl.textContent     = `€${totalInvestido.toFixed(2)}`;
    if (lucroTotalEl)     lucroTotalEl.textContent     = `€${totalLucro.toFixed(2)}`;
    if (retornoEl)        retornoEl.textContent        = `${retorno.toFixed(1)}%`;
    if (posicoesEl)       posicoesEl.textContent       = agrupadoPorTicker.size;
    if (objetivosEl)      objetivosEl.textContent      = `${objetivosAtingidos}/${totalObjetivos}`;
    if (objetivoTotalEl)  objetivoTotalEl.textContent  = `€${objetivoFinanceiroTotal.toFixed(2)}`;
    if (taxaSucessoEl)    taxaSucessoEl.textContent    = `${taxaSucesso.toFixed(1)}%`;
    if (valorCarteiraEl)  valorCarteiraEl.textContent  = `€${valorCarteira.toFixed(2)} valor em carteira`;

  } catch (err) {
    console.error("❌ Erro nos KPIs:", err);
  }

  // 2) Atividades recentes (apenas campos solicitados, sem barras) — com expand/colapse
  await carregarAtividadeRecenteSimplificada();

  // 3) Botões
  document.getElementById("btnNovaSimulacao")?.addEventListener("click", () => {
    import("../main.js").then(({ navigateTo }) => navigateTo("simulador"));
  });

  document.getElementById("btnOportunidades")?.addEventListener("click", openOportunidades);
  document.getElementById("opClose")?.addEventListener("click", closeOportunidades);
  document.getElementById("opModal")?.addEventListener("click", (e) => {
    if (e.target.id === "opModal") closeOportunidades();
  });

  // Chips do período no popup
  document.querySelectorAll("#opModal .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-periodo");
      opPeriodoAtual = p || "1s";
      setActiveChip(opPeriodoAtual);
      carregarTop10Crescimento(opPeriodoAtual);
    });
  });

    // --- Modal: Adicionar Ação ---
  const btnAdd = document.getElementById("btnAddAcao");
  const addModal = document.getElementById("addModal");
  const addClose = document.getElementById("addClose");
  const addCancel = document.getElementById("addCancel");
  const addForm = document.getElementById("addForm");
  const tipoAcaoSel = document.getElementById("tipoAcao");
  const labelPreco = document.getElementById("labelPreco");

  // abre
  btnAdd?.addEventListener("click", () => {
    addModal?.classList.remove("hidden");
  });

  // fecha
  function closeAddModal() {
    addModal?.classList.add("hidden");
    addForm?.reset();
    // repõe o label (caso tenha mudado para Venda)
    if (labelPreco) labelPreco.firstChild.textContent = "Preço da transação (€)";
  }
  addClose?.addEventListener("click", closeAddModal);
  addCancel?.addEventListener("click", closeAddModal);
  addModal?.addEventListener("click", (e) => {
    if (e.target.id === "addModal") closeAddModal();
  });

  // muda o label conforme compra/venda (puramente visual)
  tipoAcaoSel?.addEventListener("change", () => {
    if (!labelPreco) return;
    if (tipoAcaoSel.value === "venda") {
      labelPreco.firstChild.textContent = "Preço de venda (€)";
    } else {
      labelPreco.firstChild.textContent = "Preço de compra (€)";
    }
  });

  // submit
  addForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tipoAcao = (document.getElementById("tipoAcao")?.value || "compra").toLowerCase();
    const nome     = (document.getElementById("nomeAtivo")?.value || "").trim();
    const ticker   = (document.getElementById("tickerAtivo")?.value || "").trim().toUpperCase();
    const setor    = (document.getElementById("setorAtivo")?.value || "").trim();
    const mercado  = (document.getElementById("mercadoAtivo")?.value || "").trim();
    const qtdRaw   = Number(document.getElementById("quantidadeAtivo")?.value || 0);
    const preco    = Number(document.getElementById("precoAtivo")?.value || 0);
    const objetivo = Number(document.getElementById("objetivoAtivo")?.value || 0);

    if (!nome || !ticker || !qtdRaw || !preco) {
      alert("Preenche pelo menos: Tipo, Nome, Ticker, Quantidade e Preço.");
      return;
    }

    // ── regra simples: vendas entram como quantidade negativa e usam o mesmo campo 'precoCompra'
    const quantidade = tipoAcao === "venda" ? -Math.abs(qtdRaw) : Math.abs(qtdRaw);

    const payload = {
      tipoAcao,              // "compra" ou "venda" (útil para auditoria)
      nome,
      ticker,
      setor,
      mercado,
      quantidade,            // negativo na venda
      precoCompra: preco,    // mantém a compatibilidade com os teus cálculos atuais
      objetivoFinanceiro: isNaN(objetivo) ? 0 : objetivo,
      dataCompra: serverTimestamp(), // data/hora automática
    };

    try {
      await addDoc(collection(db, "ativos"), payload);
      closeAddModal();

      // Atualiza o painel rapidamente. Para máxima simplicidade, recarrega:
      // (se preferires sem refresh, dá para chamar as funções de KPI e atividade novamente)
      window.location.reload();
    } catch (err) {
      console.error("❌ Erro ao guardar ativo:", err);
      alert("Não foi possível guardar. Tenta novamente.");
    }
  });

}

/* =========================
   ATIVIDADE RECENTE (SIMPLIFICADA) + EXPAND/COLAPSE
   ========================= */
let atividadesCache = [];     // guarda todos os docs formatados
let atividadesExpandido = false; // estado de expansão

async function carregarAtividadeRecenteSimplificada() {
  const cont = document.getElementById("atividadeRecente");
  if (!cont) return;

  try {
    // Trazemos MAIS do que 4 para já termos tudo em cache
    const q = query(collection(db, "ativos"), orderBy("dataCompra", "desc"), limit(50));
    const snapAtivos = await getDocs(q);

    if (snapAtivos.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      return;
    }

    const fmtEUR   = new Intl.NumberFormat("pt-PT",{ style:"currency", currency:"EUR" });
    const fmtDateL = new Intl.DateTimeFormat("pt-PT", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZoneName: "short"
    });

    atividadesCache = []; // reset cache

    snapAtivos.forEach(doc => {
        const d = doc.data();

        const nome        = d.nome || d.ticker || "Ativo";
        const ticker      = String(d.ticker || "").toUpperCase();
        const setor       = d.setor || "-";
        const mercado     = d.mercado || "-";
        const precoCompra = Number(d.precoCompra || 0);
        const quantidade  = Number(d.quantidade || 0);

        // NOVO → badge COMPRA/VENDA
        const tipo  = (d.tipoAcao || "compra").toLowerCase();
        const badge = tipo === "venda"
          ? '<span class="tag venda">VENDA</span>'
          : '<span class="tag compra">COMPRA</span>';

        let dataTxt = "sem data";
        if (d.dataCompra && typeof d.dataCompra.toDate === "function") {
          dataTxt = fmtDateL.format(d.dataCompra.toDate());
        }

      atividadesCache.push(`
        <div class="activity-item">
          <div class="activity-left">
            <span class="activity-icon">🛒</span>
            <div>
              <p>${badge} <strong>${nome}</strong> <span class="muted">(${ticker})</span></p>
              <p class="muted">${setor} • ${mercado}</p>
              <p class="muted">${quantidade} ${quantidade === 1 ? "ação" : "ações"} @ ${fmtEUR.format(precoCompra)}</p>
              <p class="muted">Data: ${dataTxt}</p>
            </div>
          </div>
        </div>
      `);
    });

    // Render inicial: só 2
    renderAtividades(cont, 2);
    atividadesExpandido = false;

    // Ligar o botão "Ver Toda Atividade" (sem mexer no HTML: apanha o primeiro .btn.outline.full nessa card)
    const btnVerTodos = document.querySelector(".dashboard .card.glass .btn.outline.full");
    if (btnVerTodos) {
      btnVerTodos.textContent = "Ver Toda Atividade";
      btnVerTodos.onclick = () => {
        atividadesExpandido = !atividadesExpandido;
        if (atividadesExpandido) {
          renderAtividades(cont, atividadesCache.length);
          btnVerTodos.textContent = "Mostrar menos";
        } else {
          renderAtividades(cont, 4);
          btnVerTodos.textContent = "Ver Toda Atividade";
        }
      };
    }

  } catch (e) {
    console.error("Erro ao carregar atividade:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
  }
}

function renderAtividades(container, howMany) {
  const slice = atividadesCache.slice(0, howMany);
  container.innerHTML = slice.join("");
}

/* =========================
   POPUP: TOP 10 OPORTUNIDADES
   ========================= */
let opInterval = null;
let opPeriodoAtual = "1s";

async function carregarTop10Crescimento(periodo = "1s") {
  const lista = document.getElementById("listaTop10");
  if (!lista) return;

  lista.innerHTML = "🔄 A carregar...";

  const campos = {
    "1s":  "taxaCrescimento_1semana",
    "1m":  "taxaCrescimento_1mes",
    "1ano":"taxaCrescimento_1ano",
  };
  const campo = campos[periodo] || campos["1s"];

  try {
    const snap = await getDocs(collection(db, "acoesDividendos"));
    const arr = [];

    snap.forEach(doc => {
      const d = doc.data();
      const crescimento = Number(d[campo] ?? 0);
      if (Number.isFinite(crescimento) && d.ticker) {
        arr.push({
          nome: d.nome || d.ticker,
          ticker: String(d.ticker).toUpperCase(),
          crescimento
        });
      }
    });

    const top10 = arr.sort((a,b) => b.crescimento - a.crescimento).slice(0, 10);

    if (top10.length === 0) {
      lista.innerHTML = "<li>😕 Nenhuma ação com crescimento positivo.</li>";
      return;
    }

    lista.innerHTML = top10.map(item => `
      <li>
        <div class="left">
          <strong>${item.nome}</strong>
          <span class="ticker">(${item.ticker})</span>
        </div>
        <span class="${item.crescimento >= 0 ? "gain" : "loss"}">
          ${item.crescimento >= 0 ? "+" : ""}${item.crescimento.toFixed(2)}%
        </span>
      </li>
    `).join("");
  } catch (err) {
    console.error("Erro ao carregar Top 10:", err);
    lista.innerHTML = "<li style='color:#f88;'>Erro ao carregar dados.</li>";
  }
}

function openOportunidades() {
  const modal = document.getElementById("opModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  setActiveChip(opPeriodoAtual);
  carregarTop10Crescimento(opPeriodoAtual);

  clearInterval(opInterval);
  opInterval = setInterval(() => {
    carregarTop10Crescimento(opPeriodoAtual);
  }, 30000);
}

function closeOportunidades() {
  const modal = document.getElementById("opModal");
  if (!modal) return;

  modal.classList.add("hidden");
  clearInterval(opInterval);
  opInterval = null;
}

function setActiveChip(periodo) {
  document.querySelectorAll("#opModal .chip").forEach(ch => {
    const p = ch.getAttribute("data-periodo");
    ch.classList.toggle("active", p === periodo);
  });
}
