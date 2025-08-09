// js/screens/atividade.js
import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, orderBy, where,
  addDoc, serverTimestamp, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function initScreen() {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  cont.innerHTML = "A carregar…";

  try {
    // 1) Buscar movimentos e agrupar por ticker
    const q = query(collection(db, "ativos"), orderBy("dataCompra", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      return;
    }

    const grupos = new Map();
    snap.forEach(docu => {
      const d = docu.data();
      const ticker = String(d.ticker || "").toUpperCase();
      if (!ticker) return;

      const qtd = toNum(d.quantidade);
      const preco = toNum(d.precoCompra);
      const invest = qtd * preco;

      const g = grupos.get(ticker) || {
        ticker,
        nome: d.nome || ticker,
        setor: d.setor || "-",
        mercado: d.mercado || "-",
        qtd: 0,
        investido: 0,
        objetivo: 0,
        anyObjSet: false,
        lastDate: null,
      };

      g.qtd += qtd;
      g.investido += invest;

      const obj = toNum(d.objetivoFinanceiro);
      if (!g.anyObjSet && obj > 0) {
        g.objetivo = obj;
        g.anyObjSet = true;
      }

      const dt = (d.dataCompra && typeof d.dataCompra.toDate === "function")
        ? d.dataCompra.toDate()
        : null;
      if (!g.lastDate || (dt && dt > g.lastDate)) g.lastDate = dt;

      g.nome = d.nome || g.nome;
      g.setor = d.setor || g.setor;
      g.mercado = d.mercado || g.mercado;

      grupos.set(ticker, g);
    });

    const gruposArr = Array.from(grupos.values());

    // 2) Preços atuais
    const tickers = gruposArr.map(g => g.ticker);
    const infoMap = await fetchDividendInfoByTickers(tickers);

    const fmtEUR  = new Intl.NumberFormat("pt-PT",{ style:"currency", currency:"EUR" });
    const fmtDate = new Intl.DateTimeFormat("pt-PT",{ year:"numeric", month:"short", day:"2-digit" });

    // 3) Render
    const html = gruposArr
      .filter(g => g.qtd > 0) // não mostra posições encerradas
      .map(g => {
        const info = infoMap.get(g.ticker) || {};
        const precoAtual = isFiniteNum(info.valorStock) ? Number(info.valorStock) : null;

        const precoMedio = g.qtd > 0 ? (g.investido / g.qtd) : 0;
        const lucroAtual = (precoAtual !== null)
          ? (precoAtual - precoMedio) * g.qtd
          : 0;

        // barra zero ao centro (–100..+100 → 0..50% de cada lado)
        let pctText = "—";
        let barHTML = "";
        const objetivo = g.objetivo > 0 ? g.objetivo : 0;
        if (objetivo > 0) {
          const progresso = (lucroAtual / objetivo) * 100;
          const clamped = Math.max(-100, Math.min(100, progresso));
          const sideWidthPct = (Math.abs(clamped) / 2).toFixed(1);
          const positive = clamped >= 0;
          pctText = `${clamped.toFixed(0)}%`;
          barHTML = `
            <div class="progress-dual">
              <div class="track">
                <div class="fill ${positive ? "positive" : "negative"}" style="width:${sideWidthPct}%"></div>
                <div class="zero"></div>
              </div>
            </div>
          `;
        }

        const tp2Necessario = (objetivo > 0 && g.qtd > 0)
          ? (precoMedio + (objetivo / g.qtd))
          : null;

        const { taxa, periodLabel } = pickBestRate(info);
        const estimativa = (tp2Necessario && precoAtual)
          ? estimateTime(precoAtual, tp2Necessario, taxa, periodLabel)
          : "—";

        const dataTxt = g.lastDate ? fmtDate.format(g.lastDate) : "sem data";

        // ⚡️ Botões Compra/Venda (prefill do modal)
        const actions = `
          <div class="actions-row" style="margin-top:.5rem">
            <button class="btn outline" data-buy="${g.ticker}">Comprar</button>
            <button class="btn ghost"  data-sell="${g.ticker}">Vender</button>
          </div>
        `;

        return `
          <div class="activity-item">
            <div class="activity-left">
              <span class="activity-icon">📦</span>
              <div>
                <p><strong>${g.nome}</strong> <span class="muted">(${g.ticker})</span></p>
                <p class="muted">${g.setor} • ${g.mercado}</p>
                <p class="muted">Última compra: ${dataTxt}</p>
                <p class="muted">
                  Qtd: <strong>${formatNum(g.qtd)}</strong> ·
                  Preço médio: <strong>${fmtEUR.format(precoMedio || 0)}</strong> ·
                  Preço atual: <strong>${precoAtual !== null ? fmtEUR.format(precoAtual) : "—"}</strong>
                </p>
                <p class="muted">
                  Investido: <strong>${fmtEUR.format(g.investido || 0)}</strong> ·
                  Lucro atual: <strong>${fmtEUR.format(lucroAtual)}</strong>
                </p>

                ${objetivo > 0 ? `
                  <div class="activity-meta">
                    <span>Objetivo (lucro): <strong>${fmtEUR.format(objetivo)}</strong></span>
                    <span>${pctText}</span>
                  </div>
                  ${barHTML}
                  <p class="muted">
                    TP2 necessário: <strong>${tp2Necessario ? fmtEUR.format(tp2Necessario) : "—"}</strong>
                    ${taxa !== null ? `· Estimativa: <strong>${estimativa}</strong>` : ``}
                  </p>
                ` : `
                  <p class="muted">Sem objetivo definido para este ticker.</p>
                `}

                ${actions}
              </div>
            </div>
          </div>
        `;
      });

    cont.innerHTML = html.join("");

    // 4) Ligações dos botões de ação rápida
    wireQuickActions(gruposArr);

  } catch (e) {
    console.error("Erro ao carregar atividades:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
  }
}

/* ===== Quick Actions (modal deste screen) ===== */
function wireQuickActions(gruposArr){
  const byTicker = new Map(gruposArr.map(g => [g.ticker, g]));
  const $ = s => document.querySelector(s);

  const modal   = $("#pfAddModal");
  const title   = $("#pfAddTitle");
  const form    = $("#pfAddForm");
  const close   = $("#pfAddClose");
  const cancel  = $("#pfAddCancel");

  const tipoSel = $("#pfTipoAcao");
  const labelP  = $("#pfLabelPreco");
  const vendaTotWrap = $("#pfVendaTotalWrap");
  const vendaTot = $("#pfVendaTotal");

  const fTicker = $("#pfTicker");
  const fNome   = $("#pfNome");
  const fSetor  = $("#pfSetor");
  const fMerc   = $("#pfMercado");
  const fQtd    = $("#pfQuantidade");
  const fPreco  = $("#pfPreco");
  const fObj    = $("#pfObjetivo");

  // abrir modal com prefill
  function open(kind, ticker){
    const g = byTicker.get(ticker);
    if (!g) return;

    modal.classList.remove("hidden");
    title.textContent = kind === "compra" ? "Comprar ativo" : "Vender ativo";

    tipoSel.value = kind;
    fTicker.value = g.ticker;
    fNome.value   = g.nome;
    fSetor.value  = g.setor;
    fMerc.value   = g.mercado;
    fQtd.value    = "";
    fPreco.value  = "";
    fObj.value    = g.objetivo || "";

    vendaTot.checked = false;
    vendaTotWrap.style.display = kind === "venda" ? "block" : "none";
    labelP.firstChild.textContent = kind === "venda" ? "Preço de venda (€)" : "Preço de compra (€)";
  }
  function closeModal(){
    modal.classList.add("hidden");
    form.reset();
    vendaTot.checked = false;
    vendaTotWrap.style.display = "none";
    labelP.firstChild.textContent = "Preço de compra (€)";
  }
  close?.addEventListener("click", closeModal);
  cancel?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e)=>{ if (e.target.id === "pfAddModal") closeModal(); });

  // delegação clicks
  document.getElementById("listaAtividades")?.addEventListener("click", (e)=>{
    const buy = e.target.closest("[data-buy]");
    const sell = e.target.closest("[data-sell]");
    if (buy)  open("compra", buy.getAttribute("data-buy"));
    if (sell) open("venda",  sell.getAttribute("data-sell"));
  });

  // mudar label por tipo (se o user alternar)
  tipoSel?.addEventListener("change", () => {
    const isVenda = tipoSel.value === "venda";
    labelP.firstChild.textContent = isVenda ? "Preço de venda (€)" : "Preço de compra (€)";
    vendaTotWrap.style.display = isVenda ? "block" : "none";
  });

  // submit
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tipo  = (tipoSel.value || "compra").toLowerCase();
    const nome  = fNome.value.trim();
    const ticker= fTicker.value.trim().toUpperCase();
    const setor = fSetor.value.trim();
    const merc  = fMerc.value.trim();
    const qtd   = Number(fQtd.value || 0);
    const preco = Number(fPreco.value || 0);
    const obj   = Number(fObj.value || 0);
    const vendaTotal = vendaTot.checked;

    if (!ticker || !nome || !qtd || !preco) {
      alert("Preenche Ticker, Nome, Quantidade e Preço.");
      return;
    }

    const quantidade = tipo === "venda" ? -Math.abs(qtd) : Math.abs(qtd);

    const payload = {
      tipoAcao: tipo,
      nome, ticker, setor, mercado: merc,
      quantidade,
      precoCompra: preco,
      objetivoFinanceiro: isNaN(obj) ? 0 : obj,
      dataCompra: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, "ativos"), payload);

      // Se for VENDA TOTAL: remove todos os docs do ticker (após registar a venda)
      if (tipo === "venda" && vendaTotal) {
        const toDelQ = query(collection(db, "ativos"), where("ticker", "==", ticker));
        const snapDel = await getDocs(toDelQ);
        const promises = [];
        snapDel.forEach(d => promises.push(deleteDoc(doc(db, "ativos", d.id))));
        await Promise.all(promises);
      }

      closeModal();
      // Recarrega o ecrã de portfólio
      location.reload();
    } catch (err) {
      console.error("❌ Erro ao guardar movimento:", err);
      alert("Não foi possível guardar. Tenta novamente.");
    }
  });
}

/* =========================
   Helpers
   ========================= */
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isFiniteNum(v){ return Number.isFinite(Number(v)); }
function formatNum(n){ return Number(n || 0).toLocaleString("pt-PT"); }

// busca info em acoesDividendos por lotes de 10
async function fetchDividendInfoByTickers(tickers){
  const out = new Map();
  const chunks = [];
  for (let i=0; i<tickers.length; i+=10) chunks.push(tickers.slice(i, i+10));
  for (const chunk of chunks){
    const q = query(collection(db, "acoesDividendos"), where("ticker", "in", chunk));
    const snap = await getDocs(q);
    snap.forEach(docu => {
      const d = docu.data();
      if (d.ticker) out.set(String(d.ticker).toUpperCase(), d);
    });
  }
  return out;
}

// melhor taxa disponível: 1m > 1s > 1ano
function pickBestRate(info){
  if (typeof info?.taxaCrescimento_1mes === "number") return { taxa: info.taxaCrescimento_1mes, periodLabel: "mês" };
  if (typeof info?.taxaCrescimento_1semana === "number") return { taxa: info.taxaCrescimento_1semana, periodLabel: "semana" };
  if (typeof info?.taxaCrescimento_1ano === "number") return { taxa: info.taxaCrescimento_1ano, periodLabel: "ano" };
  return { taxa: null, periodLabel: null };
}

// estima nº de períodos até atingir targetPrice
function estimateTime(currentPrice, targetPrice, growthPct, periodLabel){
  const r = Number(growthPct || 0) / 100;
  if (r <= 0 || !isFiniteNum(currentPrice) || !isFiniteNum(targetPrice) || currentPrice <= 0 || targetPrice <= 0) return "—";
  const n = Math.log(targetPrice / currentPrice) / Math.log(1 + r);
  if (!isFinite(n) || n < 0) return "—";
  if (periodLabel === "semana") return `${n.toFixed(1)} semanas`;
  if (periodLabel === "mês")    return `${n.toFixed(1)} meses`;
  return `${n.toFixed(1)} anos`;
}