// js/screens/dashboard.js
import { db } from "../firebase-config.js";
import {
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
  addDoc,
  serverTimestamp,
  getDocs,
  doc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  calculateLucroMaximoScore,
  getUserWeights,
  SCORING_CFG,
} from "../utils/scoring.js";
import { Treemap } from "../components/treemap.js";
import * as CapitalManager from "../utils/capitalManager.js";

let lastAtivosSnap = null;
let lastAcoesSnap = null;
let treemapInstance = null;
let unsubAtivos = null;
let unsubAcoes = null;
let unsubConfig = null;
let lastConfigData = null;
let histFltState = { ticker: "", tipo: "", periodo: "" };

function toNumStrict(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function canon(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTicker(t) {
  const s = String(t || "");
  if (s.includes(":")) return s.split(":").pop().toUpperCase();
  return s.toUpperCase();
}

export async function initScreen() {
  console.log("✅ dashboard.js iniciado");

  // Limpar listeners antigos se existirem (evita leaks ao navegar entre screens)
  if (unsubAtivos) unsubAtivos();
  if (unsubAcoes) unsubAcoes();
  if (unsubConfig) unsubConfig();

  // --- ELEMENTOS DA UI ---
  const valorTotalEl = document.getElementById("valorTotal");
  const retornoEl = document.getElementById("retornoTotal");
  const lucroTotalEl = document.getElementById("lucroTotal");
  const posicoesEl = document.getElementById("posicoesAtivas");
  const objetivosEl = document.getElementById("objetivosFinanceiros");
  const taxaSucessoEl = document.getElementById("taxaSucesso");
  const objectiveTotalEl = document.getElementById("objetivoTotal");
  const valorCarteiraEl = document.getElementById("valorCarteira");

  // Função interna para atualizar KPIs baseada nos snapshots guardados
  const atualizarKPIs = () => {
    if (!lastAtivosSnap || !lastAcoesSnap) return;

    let totalInvestido = 0;
    let lucroNaoRealizadoTotal = 0;
    let lucroRealizadoTotal = 0;
    let objetivoFinanceiroTotal = 0;
    let objetivosAtingidos = 0;

    // Mapa de preços atuais por TICKER
    const valorAtualMap = new Map();
    lastAcoesSnap.forEach((doc) => {
      const d = doc.data();
      if (d.ticker && d.valorStock !== undefined && d.valorStock !== null) {
        const preco = Number(d.valorStock);
        if (!isNaN(preco)) {
          valorAtualMap.set(String(d.ticker).toUpperCase(), preco);
        }
      }
    });

    // Agrupar ativos por TICKER — Seguindo a lógica de Média Ponderada
    const agrupadoPorTicker = new Map();

    // Processar cronologicamente para calcular o lucro realizado corretamente
    const movimentosArr = [];
    lastAtivosSnap.forEach((doc) => {
      const d = doc.data();
      const dt =
        d.dataCompra && typeof d.dataCompra.toDate === "function"
          ? d.dataCompra.toDate()
          : new Date(0);
      movimentosArr.push({ ...d, id: doc.id, date: dt });
    });
    movimentosArr.sort((a, b) => a.date - b.date);

    movimentosArr.forEach((a) => {
      const ticker = (a.ticker || "").toUpperCase();
      if (!ticker) return;

      const g = agrupadoPorTicker.get(ticker) || {
        quantidade: 0,
        custoMedio: 0,
        investimento: 0,
        realizado: 0,
        objetivoFinanceiro: 0,
        objetivoDefinido: false,
      };

      const q = parseFloat(a.quantidade || 0);
      const p = parseFloat(a.precoCompra || 0);
      const obj = parseFloat(a.objetivoFinanceiro || 0);

      if (q > 0) {
        // Compra: atualiza custo médio
        const totalAntes = g.quantidade * g.custoMedio;
        const totalCompra = q * p;
        const novaQtd = g.quantidade + q;
        g.custoMedio = novaQtd > 0 ? (totalAntes + totalCompra) / novaQtd : 0;
        g.quantidade = novaQtd;
      } else if (q < 0) {
        // Venda: realiza lucro com base no custo médio
        const sellQtd = Math.abs(q);
        const lucroVenda = (p - g.custoMedio) * sellQtd;
        g.realizado += lucroVenda;
        g.quantidade -= sellQtd;
        if (g.quantidade <= 0) {
          g.quantidade = 0;
          g.custoMedio = 0;
        }
      }

      g.investimento = g.quantidade * g.custoMedio;

      if (!g.objetivoDefinido && obj > 0) {
        g.objetivoFinanceiro = obj;
        g.objetivoDefinido = true;
      }
      agrupadoPorTicker.set(ticker, g);
    });

    let totalObjetivos = 0;
    agrupadoPorTicker.forEach((g, ticker) => {
      const precoAtual = valorAtualMap.get(ticker) || 0;
      const valorMercadoAtual = g.quantidade * precoAtual;
      const lucroNaoRealizado = valorMercadoAtual - g.investimento;

      totalInvestido += g.investimento;
      lucroNaoRealizadoTotal += lucroNaoRealizado;
      lucroRealizadoTotal += g.realizado;

      if (g.objetivoDefinido && g.quantidade > 0) {
        totalObjetivos++;
        objetivoFinanceiroTotal += g.objetivoFinanceiro;
        if (lucroNaoRealizado + g.realizado >= g.objetivoFinanceiro)
          objetivosAtingidos++;
      }
    });

    const totalLucroAcumulado = lucroNaoRealizadoTotal + lucroRealizadoTotal;
    const retorno =
      totalInvestido > 0 ? (totalLucroAcumulado / totalInvestido) * 100 : 0;

    // Progresso para Objetivo (anterior Taxa de Sucesso):
    // Main (Atual): Lucro Aberto / Objetivo Total (Capado a 0% se negativo para evitar confusões de -1000%)
    // Sub (Acumulada): Lucro Acumulado / Objetivo Total
    let taxaSucessoAtual =
      objetivoFinanceiroTotal > 0
        ? (lucroNaoRealizadoTotal / objetivoFinanceiroTotal) * 100
        : 0;

    // Se o progresso for negativo (prejuízo), mostramos 0% para o indicador de "sucesso"
    // mas mantemos o valor real se o usuário quiser ver o quão longe está (opcional).
    // Conforme o plano: "Limitar o valor mínimo a 0%"
    if (taxaSucessoAtual < 0) taxaSucessoAtual = 0;

    const taxaSucessoAcumulada =
      objetivoFinanceiroTotal > 0
        ? (totalLucroAcumulado / objetivoFinanceiroTotal) * 100
        : 0;

    const valorCarteira = totalInvestido + lucroNaoRealizadoTotal;

    const fmtEUR = new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "EUR",
    });
    const lucroAcumuladoEl = document.getElementById("lucroAcumulado");
    const taxaSucessoAcumEl = document.getElementById("taxaSucessoAcumulada");

    if (valorTotalEl) valorTotalEl.textContent = fmtEUR.format(totalInvestido);
    if (lucroTotalEl)
      lucroTotalEl.textContent = fmtEUR.format(lucroNaoRealizadoTotal);
    if (lucroAcumuladoEl)
      lucroAcumuladoEl.textContent = `Total acumulado: ${fmtEUR.format(totalLucroAcumulado)}`;
    if (retornoEl)
      retornoEl.textContent =
        totalInvestido > 0 ? `${retorno.toFixed(1)}%` : "---";
    if (posicoesEl)
      posicoesEl.textContent = Array.from(agrupadoPorTicker.values()).filter(
        (g) => g.quantidade > 0,
      ).length;
    if (objetivosEl)
      objetivosEl.textContent = `${objetivosAtingidos}/${totalObjetivos}`;
    if (objectiveTotalEl)
      objectiveTotalEl.textContent = fmtEUR.format(objetivoFinanceiroTotal);
    if (taxaSucessoEl)
      taxaSucessoEl.textContent = `${taxaSucessoAtual.toFixed(1)}%`;
    if (taxaSucessoAcumEl)
      taxaSucessoAcumEl.textContent = `Total acumulado: ${taxaSucessoAcumulada.toFixed(1)}%`;
    if (valorCarteiraEl)
      valorCarteiraEl.textContent = `${fmtEUR.format(valorCarteira)} valor em carteira`;

    // --- NOVA LÓGICA: Capital Manager ---
    renderCapitalStrategy(agrupadoPorTicker, valorAtualMap);
  };

  // Se já tivermos dados de uma navegação anterior, mostramos logo
  if (lastAtivosSnap && lastAcoesSnap) {
    console.log("⚡ Usando snapshots em cache para renderização imediata");
    atualizarKPIs();
    const contAtividade = document.getElementById("atividadeRecente");
    if (contAtividade) carregarAtividadeRecenteSimplificada(lastAtivosSnap);
  }

  // Listeners em tempo real
  unsubAtivos = onSnapshot(
    query(collection(db, "ativos"), orderBy("dataCompra", "desc")),
    (snap) => {
      lastAtivosSnap = snap;
      atualizarKPIs();
      const contAtividade = document.getElementById("atividadeRecente");
      if (contAtividade) carregarAtividadeRecenteSimplificada(snap);
    },
  );

  // Wire History filters
  const hTicker = document.getElementById("histFltTicker");
  const hTipo = document.getElementById("histFltTipo");
  const hPeriodo = document.getElementById("histFltPeriodo");

  hTicker?.addEventListener("input", () => {
    histFltState.ticker = hTicker.value.trim().toUpperCase();
    handleUpdateHistory();
  });
  [hTipo, hPeriodo].forEach((el) => {
    el?.addEventListener("change", () => {
      histFltState.tipo = hTipo?.value || "";
      histFltState.periodo = hPeriodo?.value || "";
      handleUpdateHistory();
    });
  });

  const handleUpdateHistory = () => {
    if (lastAtivosSnap) carregarAtividadeRecenteSimplificada(lastAtivosSnap);
  };

  unsubAcoes = onSnapshot(collection(db, "acoesDividendos"), (snap) => {
    lastAcoesSnap = snap;
    atualizarKPIs();
    // Se o modal de oportunidades estiver aberto, atualizamos o treemap em tempo real
    const modal = document.getElementById("opModal");
    if (modal && !modal.classList.contains("hidden")) {
      carregarTop10Crescimento(opPeriodoAtual);
    }
  });

  unsubConfig = onSnapshot(doc(db, "config", "strategy"), (snap) => {
    if (snap.exists()) {
      lastConfigData = snap.data();
      atualizarKPIs(); // Re-calcula e renderiza a estratégia
    }
  });

  // 3) Botões
  document
    .getElementById("btnOportunidades")
    ?.addEventListener("click", openOportunidades);
  document
    .getElementById("opClose")
    ?.addEventListener("click", closeOportunidades);
  document.getElementById("opModal")?.addEventListener("click", (e) => {
    if (e.target.id === "opModal") closeOportunidades();
  });

  // Chips do período no popup
  document.querySelectorAll("#opModal .chip").forEach((btn) => {
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
    if (labelPreco)
      labelPreco.firstChild.textContent = "Preço da transação (€)";
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

    const tipoAcao = (
      document.getElementById("tipoAcao")?.value || "compra"
    ).toLowerCase();
    const nome = (document.getElementById("nomeAtivo")?.value || "").trim();
    const ticker = (document.getElementById("tickerAtivo")?.value || "")
      .trim()
      .toUpperCase();
    const setor = (document.getElementById("setorAtivo")?.value || "").trim();
    const mercado = (
      document.getElementById("mercadoAtivo")?.value || ""
    ).trim();
    const qtdRaw = Number(
      document.getElementById("quantidadeAtivo")?.value || 0,
    );
    const preco = Number(document.getElementById("precoAtivo")?.value || 0);
    const objetivo = Number(
      document.getElementById("objetivoAtivo")?.value || 0,
    );

    if (!nome || !ticker || !qtdRaw || !preco) {
      alert("Preenche pelo menos: Tipo, Nome, Ticker, Quantidade e Preço.");
      return;
    }

    // ── regra simples: vendas entram como quantidade negativa e usam o mesmo campo 'precoCompra'
    const quantidade =
      tipoAcao === "venda" ? -Math.abs(qtdRaw) : Math.abs(qtdRaw);

    const payload = {
      tipoAcao, // "compra" ou "venda" (útil para auditoria)
      nome,
      ticker,
      setor,
      mercado,
      quantidade, // negativo na venda
      precoCompra: preco, // mantém a compatibilidade com os teus cálculos atuais
      objetivoFinanceiro: isNaN(objetivo) ? 0 : objetivo,
      dataCompra: serverTimestamp(), // data/hora automática
    };

    try {
      await addDoc(collection(db, "ativos"), payload);
      closeAddModal();
      // Removido window.location.reload() - a atualização é agora em tempo real via onSnapshot
    } catch (err) {
      console.error("❌ Erro ao guardar ativo:", err);
      alert("Não foi possível guardar. Tenta novamente.");
    }
  });
  wireDashBuy();
}

/**
 * Renderiza a secção de Estratégia de Capital e War Chest
 */
function renderCapitalStrategy(agrupadoPorTicker, valorAtualMap) {
  const container = document.getElementById("capitalStrategyContainer");
  if (!container) return;

  const positions = Array.from(agrupadoPorTicker.entries()).map(([ticker, data]) => ({
    ticker,
    ...data
  }));

  // Converter snapshots em Map de objetos para o CapitalManager
  const acoesDataMap = new Map();
  lastAcoesSnap?.forEach(doc => {
    acoesDataMap.set(String(doc.data().ticker).toUpperCase(), doc.data());
  });

  const state = CapitalManager.calculatePortfolioState(positions, acoesDataMap);
  
  // Valores do utilizador vindos do Firestore
  const availableCash = lastConfigData?.availableCash || 0;
  const monthlyBase = lastConfigData?.monthlyBase || 0;

  const recommendation = CapitalManager.getWarChestRecommendation(state, availableCash);
  const smartDca = CapitalManager.getSmartDCA(monthlyBase, state);

  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

  container.innerHTML = `
    <div class="card" style="border-top: 4px solid ${state.color}; background: rgba(255,255,255,0.05); backdrop-filter: blur(10px);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 20px;">
        <div style="flex: 1; min-width: 280px;">
          <h3 style="margin: 0 0 8px 0; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-shield-halved" style="color: ${state.color}"></i>
            Estado da Carteira: <span style="color: ${state.color}">${state.label}</span>
          </h3>
          <p class="muted" style="font-size: 0.9rem; margin-bottom: 16px;">${state.message}</p>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="report-kpi" style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
              <span class="kpi-label" style="font-size: 0.7rem; opacity: 0.7; text-transform: uppercase;">Reserva Recomendada</span>
              <span class="kpi-value" style="font-size: 1.1rem; font-weight: 800;">${recommendation.percentage.toFixed(0)}%</span>
            </div>
            <div class="report-kpi" style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
              <span class="kpi-label" style="font-size: 0.7rem; opacity: 0.7; text-transform: uppercase;">DCA Inteligente</span>
              <span class="kpi-value" style="font-size: 1.1rem; font-weight: 800;">${fmtEUR.format(smartDca.adjusted)}</span>
            </div>
          </div>
        </div>

        <div style="flex: 1; min-width: 280px; border-left: 1px solid var(--border); padding-left: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 0.9rem; text-transform: uppercase; color: #888;">Gestão de "War Chest"</h4>
          
          <div style="margin-bottom: 16px; background: rgba(var(--primary-rgb), 0.1); border-radius: 12px; padding: 12px; border: 1px solid rgba(var(--primary-rgb), 0.2);">
             <div style="font-size: 0.75rem; color: var(--muted-foreground); margin-bottom: 8px;">🛒 Ação para este Mês (DCA):</div>
             <div style="font-size: 1.2rem; font-weight: 800; color: var(--success);">
               Investir ${fmtEUR.format(smartDca.adjusted)}
             </div>
             <div style="font-size: 0.75rem; margin-top: 4px; opacity: 0.8;">
               ${smartDca.fromReserve > 0 
                 ? `Inclui ${fmtEUR.format(smartDca.fromReserve)} extra vindo da tua reserva (Mercado em Saldos).` 
                 : `Plano padrão de ${fmtEUR.format(smartDca.original)}.`}
             </div>
          </div>

          <div style="background: #111; height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 8px; border: 1px solid #333;">
            <div style="width: ${recommendation.percentage}%; height: 100%; background: ${state.color}; transition: width 1s;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 12px;">
            <span class="muted">Em Reserva: <strong>${fmtEUR.format(recommendation.amount)}</strong></span>
            <span class="muted">Fundo de Investimento: <strong>${fmtEUR.format(recommendation.totalInvestable)}</strong></span>
          </div>

          <div style="border-top: 1px dashed var(--border); padding-top: 10px; font-size: 0.75rem; color: var(--muted-foreground);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Liquidez Total:</span>
              <strong>${fmtEUR.format(availableCash)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Autonomia Estimada:</span>
              <strong>${smartDca.adjusted > 0 ? (availableCash / smartDca.adjusted).toFixed(1) : 0} meses</strong>
            </div>
          </div>
          
          <div style="margin-top: 16px; font-size: 0.8rem; padding: 10px; background: rgba(239, 68, 68, 0.05); border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.1);">
             <i class="fas fa-fire" style="color: #ef4444; margin-right: 6px;"></i>
             <strong>Plano de Crise:</strong> Se o mercado cair 10%, mobiliza <strong>${fmtEUR.format(CapitalManager.getCrisisDeployment(0.1, recommendation.amount).amountToDeploy)}</strong> da reserva.
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =========================
   ATIVIDADE RECENTE (FILTRADA) + EXPAND/COLAPSE
   ========================= */
let atividadesCache = []; // guarda todos os objetos processados
let atividadesExpandido = false; // estado de expansão

async function carregarAtividadeRecenteSimplificada(snapAtivos) {
  const cont = document.getElementById("atividadeRecente");
  if (!cont) return;

  try {
    if (snapAtivos.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      return;
    }

    const movimentos = [];
    const periodosSet = new Set();

    snapAtivos.forEach((doc) => {
      const d = doc.data();
      const dt = d.dataCompra && typeof d.dataCompra.toDate === "function" ? d.dataCompra.toDate() : null;
      
      let periodoStr = "Sem data";
      if (dt) {
        const m = dt.getMonth() + 1;
        const y = dt.getFullYear();
        periodoStr = `${y}-${String(m).padStart(2, "0")}`;
        periodosSet.add(periodoStr);
      }

      movimentos.push({
        id: doc.id,
        ticker: String(d.ticker || "").toUpperCase(),
        nome: d.nome || d.ticker || "Ativo",
        tipo: (d.tipoAcao || "compra").toLowerCase(),
        quantidade: toNumStrict(d.quantidade),
        preco: d.precoCompra || 0,
        data: dt,
        periodo: periodoStr,
      });
    });

    // Popular dropdown de períodos se estiver vazio
    const hPeriodo = document.getElementById("histFltPeriodo");
    if (hPeriodo && hPeriodo.options.length <= 1) {
      const sortedPeriods = [...periodosSet].sort((a, b) => b.localeCompare(a));
      sortedPeriods.forEach((p) => {
        const [y, m] = p.split("-");
        const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        const label = `${months[parseInt(m) - 1]} ${y}`;
        hPeriodo.add(new Option(label, p));
      });
    }

    // Aplicar Filtros
    let filtered = movimentos;
    if (histFltState.ticker) {
      filtered = filtered.filter((m) => m.ticker.includes(histFltState.ticker));
    }
    if (histFltState.tipo) {
      filtered = filtered.filter((m) => m.tipo === histFltState.tipo);
    }
    if (histFltState.periodo) {
      filtered = filtered.filter((m) => m.periodo === histFltState.periodo);
    }

    atividadesCache = filtered;
    
    // Render: 2 ou tudo
    renderAtividades(cont, atividadesExpandido ? filtered.length : 2);

  } catch (e) {
    console.error("Erro ao carregar atividade recente:", e);
    cont.innerHTML = `<p class="error">Erro ao carregar atividade.</p>`;
  }
}

function renderAtividades(cont, limitItems) {
  const list = atividadesCache;
  if (list.length === 0) {
    cont.innerHTML = `<p class="muted" style="text-align: center; padding: 12px;">Nenhum movimento encontrado.</p>`;
    return;
  }

  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  const fmtDate = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const itemsToShow = list.slice(0, limitItems);
  const html = itemsToShow.map((m) => {
    const isVenda = m.tipo === "venda";
    const badgeClass = isVenda ? "tag venda" : "tag compra";
    const icon = isVenda ? "📉" : "🛒";
    const dateStr = m.data ? fmtDate.format(m.data) : "N/A";

    return `
      <div class="activity-item" style="border-bottom: 1px solid var(--border); padding: 10px 0; background: transparent; border-left: 0; border-right: 0; border-top: 0; border-radius: 0; margin-bottom: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.1rem;">${icon}</span>
            <div>
              <p style="margin: 0; font-size: 0.9rem; font-weight: 600;">
                <span class="${badgeClass}" style="font-size: 0.65rem;">${m.tipo.toUpperCase()}</span> 
                ${m.ticker}
              </p>
              <p class="muted" style="margin: 0; font-size: 0.7rem;">${dateStr}</p>
            </div>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 0.9rem; font-weight: 700; color: ${isVenda ? "var(--error)" : "var(--success)"};">
              ${m.quantidade > 0 ? "+" : ""}${m.quantidade.toFixed(2).replace(/\.?0+$/, "")}
            </p>
            <p class="muted" style="margin: 0; font-size: 0.7rem;">${fmtEUR.format(m.preco)}</p>
          </div>
        </div>
      </div>
    `;
  }).join("");

  cont.innerHTML = html;

  // Botão de expandir/recolher
  if (limitItems < list.length) {
    const btn = document.createElement("button");
    btn.className = "btn ghost full";
    btn.style.marginTop = "8px";
    btn.style.fontSize = "0.8rem";
    btn.innerHTML = `Mostrar tudo (${list.length})`;
    btn.onclick = () => {
      atividadesExpandido = true;
      renderAtividades(cont, list.length);
    };
    cont.appendChild(btn);
  } else if (atividadesExpandido && list.length > 2) {
    const btn = document.createElement("button");
    btn.className = "btn ghost full";
    btn.style.marginTop = "8px";
    btn.style.fontSize = "0.8rem";
    btn.textContent = "Recolher";
    btn.onclick = () => {
      atividadesExpandido = false;
      renderAtividades(cont, 2);
    };
    cont.appendChild(btn);
  }
}

/* =========================
   POPUP: TOP 10 OPORTUNIDADES
   ========================= */
let opInterval = null;
let opPeriodoAtual = "1m";

async function carregarTop10Crescimento(periodo = "1m") {
  const container = document.getElementById("treemapContainer");
  if (!container) return;

  if (!treemapInstance) {
    treemapInstance = new Treemap("treemapContainer", {
      groupHeaderHeight: 22,
    });
  }

  try {
    // OPTIMIZAÇÃO: Usa o snapshot já carregado em vez de fazer getDocs lento
    let snap = lastAcoesSnap;
    if (!snap) {
      console.log("⏳ Fetching acoesDividendos for Treemap...");
      snap = await getDocs(collection(db, "acoesDividendos"));
      lastAcoesSnap = snap;
    }

    const allCands = [];

    snap.forEach((doc) => {
      const d = doc.data();
      const result = calculateLucroMaximoScore(d, periodo);
      if (d.ticker && result.score > 0) {
        let rawYield = Number(d["Dividend Yield"] || d.yield || 0);
        let yPct =
          Math.abs(rawYield) > 0 && Math.abs(rawYield) < 1
            ? rawYield * 100
            : rawYield;

        const tickerLimpo = cleanTicker(d.ticker);
        
        // Busca exaustiva por campos de setor/indústria
        const sRaw = d.setor || d.sector || d.Setor || d.Sector || 
                     d.industry || d.Industry || d.indústria || d.Indústria ||
                     d.segmento || d.segment || "";
        
        let setorNormalizado = canon(sRaw);
        
        // Fallback: se o setor estiver vazio mas o ticker original tiver um prefixo (ex: "Tecnologia:AAPL"),
        // usamos o prefixo como setor temporário.
        if (!setorNormalizado && String(d.ticker).includes(":")) {
          const parts = String(d.ticker).split(":");
          if (parts.length > 1 && parts[0].length > 2) {
            setorNormalizado = canon(parts[0]);
          }
        }
        
        if (!setorNormalizado) setorNormalizado = "Outros";

        allCands.push({
          ticker: tickerLimpo,
          nome: d.nome || tickerLimpo,
          setor: setorNormalizado,
          score: result.score,
          rAnnual: result.rAnnual,
          yieldPct: yPct,
          raw: d,
        });
      }
    });

    if (!allCands.length) {
      container.innerHTML =
        "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#666;'>😕 Nenhuma oportunidade encontrada.</div>";
      return;
    }

    // --- CÁLCULO DE ALOCAÇÃO COM CAPS (Simulação de 1000€ para definir área visual) ---
    const investimentoSimulado = 1000;
    const somaScore = allCands.reduce((s, c) => s + c.score, 0) || 1;
    const allocMap = new Map();

    // 1) Proporção inicial
    allCands.forEach((c) => {
      allocMap.set(c.ticker, (c.score / somaScore) * investimentoSimulado);
    });

    // 2) Aplicar caps (15% ticker, 30% setor)
    const capTicker = 0.15 * investimentoSimulado;
    const capSetor = 0.3 * investimentoSimulado;

    // Cap Ticker
    let excedente = 0;
    for (const [t, v] of allocMap) {
      if (v > capTicker) {
        excedente += v - capTicker;
        allocMap.set(t, capTicker);
      }
    }

    // Redistribuição simples respeitando cap setorial (max 10 iterações)
    let safety = 0;
    while (excedente > 0.01 && safety++ < 10) {
      const porSetor = new Map();
      allCands.forEach((c) => {
        const v = allocMap.get(c.ticker) || 0;
        porSetor.set(c.setor, (porSetor.get(c.setor) || 0) + v);
      });

      const elegiveis = allCands.filter((c) => {
        const v = allocMap.get(c.ticker) || 0;
        const sV = porSetor.get(c.setor) || 0;
        return v < capTicker - 0.01 && sV < capSetor - 0.01;
      });

      if (!elegiveis.length) break;

      const somaScoreEleg = elegiveis.reduce((s, c) => s + c.score, 0) || 1;
      let redistribuidoNestaRonda = 0;

      for (const c of elegiveis) {
        const share = (c.score / somaScoreEleg) * excedente;
        const margemTicker = capTicker - allocMap.get(c.ticker);
        const margemSetor = capSetor - porSetor.get(c.setor);
        const add = Math.min(share, margemTicker, margemSetor);
        if (add > 0) {
          allocMap.set(c.ticker, allocMap.get(c.ticker) + add);
          redistribuidoNestaRonda += add;
        }
      }
      excedente -= redistribuidoNestaRonda;
      if (redistribuidoNestaRonda < 0.01) break;
    }

    // --- PREPARAR DADOS PARA O TREEMAP ---
    const dataBySector = new Map();
    allCands.forEach((c) => {
      if (!dataBySector.has(c.setor)) {
        dataBySector.set(c.setor, { name: c.setor, value: 0, children: [] });
      }
      const group = dataBySector.get(c.setor);
      const allocation = allocMap.get(c.ticker) || 0;

      // A área visual (value) agora é a alocação calculada
      // Mas garantimos um mínimo para não desaparecerem os pequenos
      const visualArea = Math.max(1, allocation);

      group.value += visualArea;
      group.children.push({
        name: c.ticker,
        fullName: c.nome,
        value: visualArea,
        colorValue: c.score, // Cor continua a ser o score (qualidade)
        growth: c.rAnnual,
        yield: c.yieldPct,
        meta: {
          valorStock: Number(c.raw.valorStock || 0),
          pe: c.raw["P/E ratio (Preço/Lucro)"] || c.raw.pe || "—",
          evebitda: c.raw["EV/Ebitda"] || c.raw.evEbitda || "—",
          marketCap: Number(c.raw["Market Cap"] || c.raw.marketCap || 0),
          setor: c.setor,
          mercado: c.raw.mercado,
          periodo: c.raw.periodicidade,
          divMedio: c.raw.dividendoMedio24m,
          epsNextY: c.raw.epsNextY || c.raw.eps_next_year || 0,
          netDebt: c.raw.dividaLiquida || c.raw.netDebt || 0,
          ebitda: c.raw.ebitda || 0,
        },
      });
    });

    const finalData = Array.from(dataBySector.values());
    const totalAssets = allCands.length;

    if (totalAssets === 0) {
      container.innerHTML =
        "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#666;'>😕 Nenhuma oportunidade encontrada.</div>";
      return;
    }

    const dynamicHeight = Math.max(700, Math.min(3000, totalAssets * 15));
    treemapInstance.render(finalData, dynamicHeight);
  } catch (err) {
    console.error("Erro ao carregar Treemap:", err);
    container.innerHTML =
      "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#f88;'>Erro ao carregar dados.</div>";
  }
}

function openOportunidades() {
  const modal = document.getElementById("opModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  atualizarLegendaPesos();
  setActiveChip(opPeriodoAtual);
  carregarTop10Crescimento(opPeriodoAtual);

  clearInterval(opInterval);
  opInterval = setInterval(() => {
    carregarTop10Crescimento("1m");
  }, 30000);
}

function closeOportunidades() {
  const modal = document.getElementById("opModal");
  if (!modal) return;

  modal.classList.add("hidden");
  clearInterval(opInterval);
  opInterval = null;
}

// =========================
// ATUALIZA LEGENDA DE PESOS DINAMICAMENTE
// =========================
function atualizarLegendaPesos() {
  const W = getUserWeights() || SCORING_CFG.WEIGHTS;

  const mapping = {
    "w-R": W.R,
    "w-T": W.T,
    "w-V": W.V,
    "w-D": W.D,
    "w-E": W.E,
    "w-Rsk": W.Rsk || 0.05,
  };

  for (const [id, val] of Object.entries(mapping)) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = `${Math.round(val * 100)}%`;
    }
  }
}

function setActiveChip(periodo) {
  // Chips removed from HTML
}

// =========================
// Simulador Botão Definir Objetivo (versão wizard + dropdowns)
// =========================

// ---------- Helpers comuns ----------

function keyStr(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // requer JS moderno
    .trim()
    .toLowerCase();
}

function euro(v) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(v || 0);
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dividirPeriodicidade(dividendo, periodicidade) {
  const p = String(periodicidade || "").toLowerCase();
  if (p === "mensal") return dividendo * 12;
  if (p === "trimestral") return dividendo * 4;
  if (p === "semestral") return dividendo * 2;
  return dividendo; // anual ou n/a
}
function campoCrescimento(periodoSel) {
  if (periodoSel === "1s") return "taxaCrescimento_1semana";
  if (periodoSel === "1m") return "taxaCrescimento_1mes";
  return "taxaCrescimento_1ano";
}
function melhorTaxaDisponivel(acao, prefer) {
  const ordem = [
    prefer,
    "taxaCrescimento_1mes",
    "taxaCrescimento_1semana",
    "taxaCrescimento_1ano",
  ];
  for (const k of ordem) {
    const v = Number(acao[k] || 0);
    if (v !== 0) return v;
  }
  return 0;
}
function calcularMetricasAcao(acao, periodoSel, horizonte) {
  const prefer = campoCrescimento(periodoSel);
  const taxaPct = melhorTaxaDisponivel(acao, prefer);
  const preco = Number(acao.valorStock || 0);
  const dividendo = Number(acao.dividendo || 0);
  const per = acao.periodicidade || "Anual";
  if (!(preco > 0)) return null;

  const r = clamp(taxaPct / 100, -0.95, 5);
  const h = Math.max(1, Number(horizonte || 1));

  const mult = Math.pow(1 + r, h);
  const valorizacao = preco * (mult - 1);
  const totalDividendos = dividirPeriodicidade(dividendo, per) * h;

  const lucroUnidade = totalDividendos + valorizacao;
  const retornoPorEuro = lucroUnidade / preco;

  return {
    preco,
    dividendoAnual: dividirPeriodicidade(dividendo, per),
    taxaPct,
    lucroUnidade,
    retornoPorEuro,
  };
}

function distribuirFracoes(acoes, investimento) {
  const somaRetorno = acoes.reduce((s, a) => s + a.metrics.retornoPorEuro, 0);
  if (somaRetorno <= 0)
    return { linhas: [], totalLucro: 0, totalGasto: 0, restante: investimento };

  const linhas = acoes.map((a) => {
    const propor = a.metrics.retornoPorEuro / somaRetorno;
    const investido = investimento * propor;
    const qtd = investido / a.metrics.preco;
    const lucro = qtd * a.metrics.lucroUnidade;
    return {
      nome: a.nome,
      ticker: a.ticker,
      preco: a.metrics.preco,
      quantidade: qtd,
      investido,
      lucro,
      taxaPct: a.metrics.taxaPct,
      dividendoAnual: a.metrics.dividendoAnual,
    };
  });
  const totalLucro = linhas.reduce((s, l) => s + l.lucro, 0);
  const totalGasto = linhas.reduce((s, l) => s + l.investido, 0);
  return {
    linhas,
    totalLucro,
    totalGasto,
    restante: Math.max(0, investimento - totalGasto),
  };
}

function distribuirInteiras(acoes, investimento) {
  const ordenadas = [...acoes].sort(
    (a, b) => b.metrics.retornoPorEuro - a.metrics.retornoPorEuro,
  );
  const linhasMap = new Map();
  let restante = investimento;

  const precoMin = Math.min(...ordenadas.map((a) => a.metrics.preco));
  while (restante >= precoMin - 1e-9) {
    let best = null;
    for (const a of ordenadas) {
      if (a.metrics.preco <= restante + 1e-9) {
        best = a;
        break;
      }
    }
    if (!best) break;

    const key = best.ticker;
    const linha = linhasMap.get(key) || {
      nome: best.nome,
      ticker: best.ticker,
      preco: best.metrics.preco,
      quantidade: 0,
      investido: 0,
      lucro: 0,
      taxaPct: best.metrics.taxaPct,
      dividendoAnual: best.metrics.dividendoAnual,
    };
    linha.quantidade += 1;
    linha.investido += best.metrics.preco;
    linha.lucro += best.metrics.lucroUnidade;
    linhasMap.set(key, linha);
    restante -= best.metrics.preco;
  }
  const linhas = Array.from(linhasMap.values());
  const totalLucro = linhas.reduce((s, l) => s + l.lucro, 0);
  const totalGasto = linhas.reduce((s, l) => s + l.investido, 0);
  return { linhas, totalLucro, totalGasto, restante };
}

function renderResultado(destEl, resultado, opts) {
  const { linhas, totalLucro, totalGasto, restante = 0 } = resultado;
  if (!linhas || linhas.length === 0) {
    destEl.innerHTML = `<div class="card"><p class="muted">Nenhuma ação selecionada com retorno positivo.</p></div>`;
    return;
  }
  const rows = linhas
    .map(
      (l) => `
    <tr>
      <td>${l.nome} <span class="muted">(${l.ticker})</span></td>
      <td>${euro(l.preco)}</td>
      <td>${l.quantidade.toFixed(opts.inteiras ? 0 : 4)}</td>
      <td>${euro(l.investido)}</td>
      <td>${euro(l.lucro)}</td>
      <td>${(l.taxaPct || 0).toFixed(2)}%</td>
      <td>${euro(l.dividendoAnual || 0)}/ano</td>
    </tr>
  `,
    )
    .join("");
  destEl.innerHTML = `
    <div class="card">
      <div class="tabela-scroll-wrapper">
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr>
              <th>Ativo</th><th>Preço</th><th>Qtd</th><th>Investido</th><th>Lucro Estim.</th><th>Tx ${opts.periodo}</th><th>Dividendo</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="margin-top:.6rem">
        <strong>Total investido:</strong> ${euro(totalGasto)}
        ${opts.inteiras && restante > 0 ? `• <strong>Resto:</strong> ${euro(restante)}` : ``}
        <br/>
        <strong>Lucro total estimado (${opts.horizonte} ${opts.horizonte > 1 ? "períodos" : "período"}):</strong> ${euro(totalLucro)}
      </p>
    </div>
  `;
}

// --- opções dropdowns
const OPT_SETORES = [
  "",
  "ETF iTech",
  "ETF Finance",
  "ETF Energia",
  "ETF Materiais",
  "ETF Múltiplos Setores",
  "Alimentação",
  "Automóvel",
  "Bens Consumidor",
  "Consumo Cíclico",
  "Consumo Defensivo",
  "Criptomoedas",
  "Defesa",
  "Energia",
  "Finanças",
  "Imobiliário",
  "Indústria",
  "Infraestruturas / Energia",
  "Materiais",
  "Mineração (Ouro)",
  "Restauração",
  "Saúde",
  "Tecnologia",
  "Telecomunicações",
];
const OPT_MERCADOS = [
  "",
  "Mundial",
  "Asiático",
  "Português",
  "Europeu",
  "Americano",
  "Americano SP500",
];
const OPT_MESES = [
  "",
  "n/A",
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const OPT_PERIODICIDADE = [
  "",
  "n/A",
  "Anual",
  "Semestral",
  "Trimestral",
  "Mensal",
];

function fillSelect(id, opts, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = opts
    .map((v) => {
      const label = v || placeholder || "Todos";
      return `<option value="${v}">${label}</option>`;
    })
    .join("");
}

// ---------- Estado do modal ----------
let GOAL_CACHE = [];
const GOAL_SELECTED = new Map();

// fetch acoesDividendos (inclui setor/mercado/mes/periodicidade)
async function fetchAcoesGoal() {
  const snap = await getDocs(collection(db, "acoesDividendos"));
  const out = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d?.ticker) return;
    out.push({
      nome: d.nome || d.ticker,
      ticker: String(d.ticker).toUpperCase(),
      valorStock: Number(d.valorStock || 0),
      dividendo: Number(d.dividendo || 0),
      mes: d.mes || "",
      periodicidade: d.periodicidade || "Anual",
      taxaCrescimento_1semana: Number(d.taxaCrescimento_1semana || 0),
      taxaCrescimento_1mes: Number(d.taxaCrescimento_1mes || 0),
      taxaCrescimento_1ano: Number(d.taxaCrescimento_1ano || 0),
      raw: { setor: d.setor || "", mercado: d.mercado || "" },
    });
  });
  return out;
}

// ----- Wizard helpers -----
function showGoalStep(n) {
  document.querySelectorAll("#goalModal .goal-step").forEach((sec) => {
    sec.hidden = sec.dataset.step !== String(n);
  });
}
function ensureListVisible() {
  const evt = new Event("click");
  document.getElementById("goalBtnFiltrar")?.dispatchEvent(evt);
}

// ----- Abrir/fechar -----
const btnObjetivo = document.getElementById("btnObjetivo");
const goalModal = document.getElementById("goalModal");
const goalClose = document.getElementById("goalClose");

btnObjetivo?.addEventListener("click", async () => {
  // always open at step 1
  showGoalStep(1);

  // preencher dropdowns
  fillSelect("goalFiltroSetor", OPT_SETORES, "Setor");
  fillSelect("goalFiltroMercado", OPT_MERCADOS, "Mercado");
  fillSelect("goalFiltroMes", OPT_MESES, "Mês do dividendo");
  fillSelect("goalFiltroPeriodicidade", OPT_PERIODICIDADE, "Periodicidade");

  goalModal?.classList.remove("hidden");

  if (GOAL_CACHE.length === 0) GOAL_CACHE = await fetchAcoesGoal();
  renderGoalList(GOAL_CACHE);
  renderGoalSelected();

  syncGoalCheckboxes();
});

goalClose?.addEventListener("click", closeGoalModal);
goalModal?.addEventListener("click", (e) => {
  if (e.target.id === "goalModal") closeGoalModal();
});

function closeGoalModal() {
  goalModal?.classList.add("hidden");
  goalModal?.classList.remove("goal-show-results");
  GOAL_SELECTED.clear();
  const box = document.getElementById("goalResultado");
  if (box) box.innerHTML = "";
  const bar = document.getElementById("goalResultsBar");
  if (bar) bar.remove();
  showGoalStep(1);
}

// ----- Passos -----
document.getElementById("goalNext1")?.addEventListener("click", () => {
  showGoalStep(2);
  ensureListVisible();
});
document.getElementById("goalNext2")?.addEventListener("click", () => {
  if (GOAL_SELECTED.size === 0) {
    alert("Seleciona pelo menos uma ação.");
    return;
  }
  showGoalStep(3);
});
document
  .getElementById("goalBack2")
  ?.addEventListener("click", () => showGoalStep(1));
document
  .getElementById("goalBack3")
  ?.addEventListener("click", () => showGoalStep(2));
document
  .getElementById("goalBackToEdit")
  ?.addEventListener("click", () => showGoalStep(3));

// ----- Filtrar/Limpar -----
document.getElementById("goalBtnFiltrar")?.addEventListener("click", () => {
  const t = (document.getElementById("goalFiltroTicker")?.value || "")
    .trim()
    .toLowerCase();
  const n = (document.getElementById("goalFiltroNome")?.value || "")
    .trim()
    .toLowerCase();
  const s = (document.getElementById("goalFiltroSetor")?.value || "")
    .trim()
    .toLowerCase();
  const m = (document.getElementById("goalFiltroMercado")?.value || "")
    .trim()
    .toLowerCase();
  const mes = (document.getElementById("goalFiltroMes")?.value || "")
    .trim()
    .toLowerCase();
  const per = (document.getElementById("goalFiltroPeriodicidade")?.value || "")
    .trim()
    .toLowerCase();

  const res = GOAL_CACHE.filter((a) => {
    const hitT = !t || a.ticker.toLowerCase().includes(t);
    const hitN = !n || a.nome.toLowerCase().includes(n);
    const hitS = !s || String(a.raw?.setor || "").toLowerCase() === s;
    const hitM = !m || String(a.raw?.mercado || "").toLowerCase() === m;
    const hitMes = !mes || String(a.mes || "").toLowerCase() === mes;
    const hitPer = !per || String(a.periodicidade || "").toLowerCase() === per;
    return hitT && hitN && hitS && hitM && hitMes && hitPer;
  });

  renderGoalList(res);
});

document.getElementById("goalBtnLimpar")?.addEventListener("click", () => {
  [
    "goalFiltroTicker",
    "goalFiltroNome",
    "goalFiltroSetor",
    "goalFiltroMercado",
    "goalFiltroMes",
    "goalFiltroPeriodicidade",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderGoalList(GOAL_CACHE);
});

// ----- Lista (toggle por botão “＋/✓”) -----
function renderGoalList(arr) {
  const ul = document.getElementById("goalListaAcoes");
  if (!ul) return;
  if (!arr || arr.length === 0) {
    ul.innerHTML = `<li><span class="meta">Sem resultados.</span></li>`;
    return;
  }

  ul.innerHTML = arr
    .map((a) => {
      const selected = GOAL_SELECTED.has(a.ticker);
      const setor = a.raw?.setor || "-";
      const mercado = a.raw?.mercado || "-";
      const preco = Number(a.valorStock || 0).toFixed(2);
      return `
      <li>
        <div style="display:flex;align-items:center;gap:10px;flex:1;">
          <div>
            <div><strong>${a.nome}</strong> <span class="meta">(${a.ticker})</span></div>
            <div class="meta">${setor} • ${mercado} • Preço: €${preco}</div>
          </div>
        </div>
        <button class="icon-btn goal-toggle" data-ticker="${a.ticker}" title="${selected ? "Remover" : "Adicionar"}">
          ${selected ? "✓" : "＋"}
        </button>
      </li>
    `;
    })
    .join("");

  ul.querySelectorAll(".goal-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.ticker;
      const obj =
        arr.find((x) => x.ticker === t) ||
        GOAL_CACHE.find((x) => x.ticker === t);
      if (!obj) return;
      if (GOAL_SELECTED.has(t)) {
        GOAL_SELECTED.delete(t);
        btn.textContent = "＋";
        btn.title = "Adicionar";
      } else {
        GOAL_SELECTED.set(t, obj);
        btn.textContent = "✓";
        btn.title = "Remover";
      }
      renderGoalSelected();
    });
  });
}

// ----- Selecionadas (tags) -----
function renderGoalSelected() {
  const wrap = document.getElementById("goalSelecionadas");
  if (!wrap) return;

  const list = Array.from(GOAL_SELECTED.values());
  if (list.length === 0) {
    wrap.innerHTML = `<span class="muted">Nenhuma ação selecionada.</span>`;
    return;
  }

  wrap.innerHTML = list
    .map(
      (a) => `
    <span class="goal-tag">
      ${a.ticker}
      <button title="Remover" data-del="${a.ticker}">x</button>
    </span>
  `,
    )
    .join("");

  wrap.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.del;
      GOAL_SELECTED.delete(t);
      renderGoalSelected();
      const b = document.querySelector(
        `#goalListaAcoes .goal-toggle[data-ticker="${t}"]`,
      );
      if (b) {
        b.textContent = "＋";
        b.title = "Adicionar";
      }
    });
  });
}

// ----- Exclusividade das duas checkboxes -----
function syncGoalCheckboxes() {
  const chkInt = document.getElementById("goalAcoesCompletas");
  const chkTot = document.getElementById("goalUsarTotal");
  if (!chkInt || !chkTot) return;

  function onChange(e) {
    if (e.target === chkInt && chkInt.checked) chkTot.checked = false;
    if (e.target === chkTot && chkTot.checked) chkInt.checked = false;
  }
  chkInt.onchange = onChange;
  chkTot.onchange = onChange;
  onChange({ target: chkInt.checked ? chkInt : chkTot });
}

// ----- Simular -----
document
  .getElementById("goalBtnSimular")
  ?.addEventListener("click", async () => {
    const invest = Number(document.getElementById("goalInvest")?.value || 0);
    const periodo = document.getElementById("goalPeriodo")?.value || "1ano";
    const horizonte = Math.max(
      1,
      Number(document.getElementById("goalHorizonte")?.value || 1),
    );
    const inteiras = !!document.getElementById("goalAcoesCompletas")?.checked;
    const usarTot = !!document.getElementById("goalUsarTotal")?.checked;
    const box = document.getElementById("goalResultado");

    if (box) box.innerHTML = `<div class="card">A simular…</div>`;

    const baseSelecionada = Array.from(GOAL_SELECTED.values());
    if (baseSelecionada.length === 0) {
      box.innerHTML = `<div class="card"><p class="muted">Seleciona pelo menos uma ação.</p></div>`;
      return;
    }
    if (invest <= 0) {
      box.innerHTML = `<div class="card"><p class="muted">Indica o montante a investir.</p></div>`;
      return;
    }

    try {
      const comMetricas = baseSelecionada
        .map((a) => {
          const m = calcularMetricasAcao(a, periodo, horizonte);
          return m ? { ...a, metrics: m } : null;
        })
        .filter(Boolean)
        .filter((a) => a.metrics.retornoPorEuro > 0);

      if (comMetricas.length === 0) {
        box.innerHTML = `<div class="card"><p class="muted">As ações selecionadas não têm retorno positivo para o período escolhido.</p></div>`;
        return;
      }

      const resultado = inteiras
        ? distribuirInteiras(comMetricas, invest)
        : distribuirFracoes(comMetricas, invest);

      renderResultado(box, resultado, {
        periodo,
        horizonte,
        inteiras,
        usarTot,
      });
      goalEnterResultsMode(); // mostra modo resultado
    } catch (err) {
      console.error(err);
      box.innerHTML = `<div class="card"><p class="muted">Ocorreu um erro na simulação.</p></div>`;
    }
  });

// === UI: modo resultado ===
function goalEnterResultsMode() {
  const modal = document.getElementById("goalModal");
  if (!modal) return;
  showGoalStep(4); // step 4 = resultados
  modal.classList.add("goal-show-results");

  if (!document.getElementById("goalResultsBar")) {
    const bar = document.createElement("div");
    bar.id = "goalResultsBar";
    bar.className = "goal-results-bar";
    bar.innerHTML = `
      <button id="goalBackToEdit" class="icon-btn close" title="Voltar">×</button>
      <span class="title">Resultado da simulação</span>
    `;
    const res = document.getElementById("goalResultado");
    if (res && res.parentNode) res.parentNode.insertBefore(bar, res);
    document
      .getElementById("goalBackToEdit")
      ?.addEventListener("click", goalExitResultsMode);
  }
}
function goalExitResultsMode() {
  const modal = document.getElementById("goalModal");
  if (!modal) return;
  modal.classList.remove("goal-show-results");
  showGoalStep(3); // regressa ao passo 3
}

//Compra acoes dashboard.js
// Abre o modal "Adicionar Ação" já em modo COMPRA e limpa os campos
function wireDashBuy() {
  const btn = document.getElementById("btnDashBuy");
  const modal = document.getElementById("addModal");
  const form = document.getElementById("addForm");
  const tipoAcao = document.getElementById("tipoAcao");
  const labelPreco = document.getElementById("labelPreco");

  const open = () => {
    if (!modal) return;
    modal.classList.remove("hidden");

    // força COMPRA
    if (tipoAcao) tipoAcao.value = "compra";
    if (labelPreco) labelPreco.firstChild.textContent = "Preço de compra (€)";

    // limpa campos do formulário
    [
      "nomeAtivo",
      "tickerAtivo",
      "setorAtivo",
      "mercadoAtivo",
      "quantidadeAtivo",
      "precoAtivo",
      "objetivoAtivo",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  };

  const close = () => {
    if (!modal) return;
    modal.classList.add("hidden");
    form?.reset();
    if (labelPreco)
      labelPreco.firstChild.textContent = "Preço da transação (€)";
  };

  // abrir via botão principal
  btn?.addEventListener("click", open);

  // fechos já existentes do modal "Adicionar Ação"
  document.getElementById("addClose")?.addEventListener("click", close);
  document.getElementById("addCancel")?.addEventListener("click", close);
  modal?.addEventListener("click", (e) => {
    if (e.target.id === "addModal") close();
  });

  // se o utilizador mudar entre compra/venda, atualiza o label
  tipoAcao?.addEventListener("change", () => {
    if (!labelPreco) return;
    labelPreco.firstChild.textContent =
      tipoAcao.value === "venda" ? "Preço de venda (€)" : "Preço de compra (€)";
  });
}
