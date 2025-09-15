// screens/analise.js
import { db } from "../firebase-config.js";
import {
  collection,
  getDocs,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ===============================
   Chart.js on-demand
   =============================== */
async function ensureChartJS() {
  if (window.Chart) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
const isDark = () =>
  document.documentElement.getAttribute("data-theme") === "dark";
const chartColors = () => ({
  grid: isDark() ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
  ticks: isDark() ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.7)",
  tooltipBg: isDark() ? "rgba(17,17,17,.95)" : "rgba(255,255,255,.95)",
  tooltipFg: isDark() ? "#fff" : "#111",
});
const PALETTE = [
  "#4F46E5", "#22C55E", "#EAB308", "#EF4444",
  "#06B6D4", "#F59E0B", "#A855F7", "#10B981",
  "#3B82F6", "#F472B6", "#84CC16", "#14B8A6",
];

/* ===============================
   BLOCO DE CONFIG DO ALGORITMO
   (mexe aqui à vontade)
   =============================== */
export const ANALISE_CFG = {
  // pesos do score final
  pesos: {
    retornoEuro: 0.55,
    tendenciaSMA: 0.25,
    valoracaoPE: 0.15,
    risco: 0.05,
  },

  // ANUALIZAÇÃO + LIMITES (conservadores)
  annualCaps: { min: -0.80, max: 0.60 }, // -80% .. +60% por ano (após anualizar)

  // mistura de taxas p/ reduzir ruído (antes de anualizar)
  blend: {
    use: true,
    pesos: { prefer: 0.6, aux1: 0.25, aux2: 0.15 },
  },

  // limites de concentração
  maxPctPorTicker: 0.35,           // 0 = sem limite
  fallbackUsarRestoNoMelhor: true, // investe o resto no melhor (se sobrar)
  usarInteirosPorDefeito: false,   // se UI não tiver checkboxes

  // sinais técnicos
  smaSignal: { peso50: 1.0, peso200: 1.0, bonus: +0.02, malus: -0.02 },
  peBands: { barato: 15, justo: 25 },

  debug: { logSelecao: false, logScore: false },
};
window.ANALISE_CFG = ANALISE_CFG;

/* ===============================
   Helpers (dividendos e formato)
   =============================== */
const mesesPT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];
const mesToIdx = new Map(mesesPT.map((m, i) => [m, i]));
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmtEUR = (n) =>
  Number(n || 0).toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
  });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function pagamentosAno(periodicidade) {
  const p = String(periodicidade || "");
  if (p === "Mensal") return 12;
  if (p === "Trimestral") return 4;
  if (p === "Semestral") return 2;
  if (p === "Anual") return 1;
  return 0;
}
function mesesPagamento(periodicidade, mesTipicoIdx) {
  if (!Number.isFinite(mesTipicoIdx)) return [];
  if (periodicidade === "Mensal")
    return Array.from({ length: 12 }, (_, i) => i);
  if (periodicidade === "Trimestral")
    return [0, 3, 6, 9].map((k) => (mesTipicoIdx + k) % 12);
  if (periodicidade === "Semestral")
    return [0, 6].map((k) => (mesTipicoIdx + k) % 12);
  if (periodicidade === "Anual") return [mesTipicoIdx];
  return [];
}

/* ======== Dividendos robustos ======== */
function anualPreferido(doc) {
  const anualAlpha = toNum(doc.dividendoMedio24m);
  if (anualAlpha > 0) return anualAlpha;

  const total24 = toNum(doc.totalDiv24m);
  if (total24 > 0) return total24 / 2;

  const pAno = pagamentosAno(String(doc.periodicidade || ""));
  const d = toNum(doc.dividendo);
  if (pAno > 0 && d > 0) return d * pAno;

  return d > 0 ? d : 0;
}
function perPayment(doc) {
  const total24 = toNum(doc.totalDiv24m);
  const pagos24 = toNum(doc.dividendosPagos24m);
  if (total24 > 0 && pagos24 > 0) return total24 / pagos24;

  const anual = anualPreferido(doc);
  const pAno = pagamentosAno(String(doc.periodicidade || ""));
  if (anual > 0 && pAno > 0) return anual / pAno;

  return toNum(doc.dividendo);
}

/* ===============================
   Seleção
   =============================== */
const selectedTickers = new Set();
const updateSelCount = () => {
  const el = document.getElementById("anlSelCount");
  if (el) el.textContent = String(selectedTickers.size);
};

/* ===============================
   Ordenação
   =============================== */
let sortKey = null;
let sortDir = "desc";
const SORT_ACCESSORS = {
  ticker: (r) => r.ticker,
  nome: (r) => r.nome || "",
  setor: (r) => r.setor || "",
  mercado: (r) => r.mercado || "",
  yield: (r) => (Number.isFinite(r.yield) ? r.yield : -Infinity),
  yield24: (r) => (Number.isFinite(r.yield24) ? r.yield24 : -Infinity),
  divPer: (r) => (Number.isFinite(r.divPer) ? r.divPer : -Infinity),
  divAnual: (r) => (Number.isFinite(r.divAnual) ? r.divAnual : -Infinity),
  pe: (r) => (Number.isFinite(r.pe) ? r.pe : Infinity),
  delta50: (r) => (Number.isFinite(r.delta50) ? r.delta50 : -Infinity),
  delta200: (r) => (Number.isFinite(r.delta200) ? r.delta200 : -Infinity),
  g1w: (r) => (Number.isFinite(r.g1w) ? r.g1w : -Infinity),
  g1m: (r) => (Number.isFinite(r.g1m) ? r.g1m : -Infinity),
  g1y: (r) => (Number.isFinite(r.g1y) ? r.g1y : -Infinity),
  periodicidade: (r) => r.periodicidade || "",
  mes: (r) => r.mes || "",
  observacao: (r) => r.observacao || "",
};
function sortRows(rows) {
  if (!sortKey) return rows;
  const acc = SORT_ACCESSORS[sortKey] || ((r) => r[sortKey]);
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = acc(a), vb = acc(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}
function markSortedHeader() {
  document.querySelectorAll("#anlTable thead th.sortable").forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
  });
  if (sortKey) {
    const th = document.querySelector(
      `#anlTable thead th[data-sort="${sortKey}"]`
    );
    if (th) th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
  }
}

/* ===============================
   Charts (gerais)
   =============================== */
function renderDonut(elId, dataMap) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const labels = Array.from(dataMap.keys());
  const data = Array.from(dataMap.values());
  return new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: chartColors().ticks } },
        tooltip: {
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
          callbacks: {
            label: (ctx) => {
              const total = data.reduce((a, b) => a + b, 0) || 1;
              const v = Number(ctx.parsed);
              const pct = ((v / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${pct}%`;
            },
          },
        },
      },
    },
  });
}
function renderTopYield(elId, rows) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const top = [...rows]
    .filter((r) => Number.isFinite(r.yield) && r.yield > 0)
    .sort((a, b) => b.yield - a.yield)
    .slice(0, 5);
  return new Chart(el, {
    type: "bar",
    data: {
      labels: top.map((r) => r.ticker),
      datasets: [
        {
          label: "Yield (%)",
          data: top.map((r) => r.yield),
          backgroundColor: "#22C55E",
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
        y: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
      },
      plugins: {
        legend: { labels: { color: chartColors().ticks } },
        tooltip: {
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
          callbacks: {
            label: (ctx) =>
              ` ${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}%`,
          },
        },
      },
    },
  });
}
const charts = { setor: null, mercado: null, topYield: null };
function renderCharts(rows) {
  const groupBy = (key) => {
    const map = new Map();
    rows.forEach((r) => {
      const k = r[key] || "—";
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  };
  charts.setor?.destroy();
  charts.mercado?.destroy();
  charts.topYield?.destroy();
  charts.setor = renderDonut("anlChartSetor", groupBy("setor"));
  charts.mercado = renderDonut("anlChartMercado", groupBy("mercado"));
  charts.topYield = renderTopYield("anlChartTopYield", rows);
}

/* ===============================
   Heatmap (dividendo por pagamento)
   =============================== */
function renderHeatmap(rows) {
  const body = document.getElementById("anlHeatmapBody");
  const headMonths = document.getElementById("anlHeatmapHeaderMonths"); // opcional
  if (!body) return;

  const values = rows
    .map((r) => perPayment(r))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const q1 = values.length ? values[Math.floor(values.length * 0.33)] : 0.01;
  const q2 = values.length ? values[Math.floor(values.length * 0.66)] : 0.02;

  body.innerHTML = rows
    .map((r) => {
      const per = String(r.periodicidade || "n/A");
      const idxMes = mesToIdx.get(String(r.mes || ""));
      const meses = mesesPagamento(per, idxMes);
      const porPagamento = perPayment(r);
      const klass =
        porPagamento > 0
          ? porPagamento <= q1
            ? "pay-weak"
            : porPagamento <= q2
            ? "pay-med"
            : "pay-strong"
          : "";
      const cells = Array.from({ length: 12 }, (_, m) => {
        if (!meses.includes(m)) return `<div class="cell"></div>`;
        const tt = `${r.ticker} • ${mesesPT[m]} • ~${fmtEUR(
          porPagamento
        )} por pagamento`;
        return `<div class="cell tt ${klass}" data-tt="${tt}">${
          porPagamento ? fmtEUR(porPagamento) : ""
        }</div>`;
      }).join("");
      const nome = r.nome ? ` <span class="muted">— ${r.nome}</span>` : "";
      return `
      <div class="row">
        <div class="cell sticky-col"><strong>${r.ticker}</strong>${nome}</div>
        <div class="months">${cells}</div>
      </div>
    `;
    })
    .join("");

  if (headMonths) {
    const onScroll = (e) => { headMonths.scrollLeft = e.target.scrollLeft; };
    body.removeEventListener("scroll", onScroll);
    body.addEventListener("scroll", onScroll, { passive: true });
  }
}

/* ===============================
   Tabela
   =============================== */
function renderTable(rows) {
  const tb = document.getElementById("anlTableBody");
  if (!tb) return;
  const badgePE = (pe) => {
    const p = Number(pe);
    if (!Number.isFinite(p) || p <= 0)
      return `<span class="badge muted">—</span>`;
    if (p < 15) return `<span class="badge ok">${p.toFixed(2)} Barato</span>`;
    if (p <= 25)
      return `<span class="badge warn">${p.toFixed(2)} Justo</span>`;
    return `<span class="badge danger">${p.toFixed(2)} Caro</span>`;
  };
  const badgeYield = (y, y24) => {
    if (!Number.isFinite(y)) return `<span class="badge muted">—</span>`;
    let base = "muted";
    if (y >= 6) base = "warn";
    else if (y >= 2) base = "ok";
    const curr = `<span class="badge ${base}">${y.toFixed(2)}%</span>`;
    if (Number.isFinite(y24)) {
      const comp =
        y - y24 >= 0
          ? `<span class="badge up">↑ acima da média</span>`
          : `<span class="badge down">↓ abaixo da média</span>`;
      return `${curr} ${comp}`;
    }
    return curr;
  };
  const pct = (v) => {
    if (!Number.isFinite(v)) return `—`;
    const cls = v >= 0 ? "up" : "down";
    const sign = v >= 0 ? "+" : "";
    return `<span class="${cls}">${sign}${v.toFixed(2)}%</span>`;
  };

  tb.innerHTML = rows
    .map((r) => {
      const checked = selectedTickers.has(r.ticker) ? "checked" : "";
      const y = Number.isFinite(r.yield) ? r.yield : null;
      const y24 = Number.isFinite(r.yield24) ? r.yield24 : null;
      const divPerTxt = r.divPer > 0 ? fmtEUR(r.divPer) : "—";
      const divAnualTxt = r.divAnual > 0 ? fmtEUR(r.divAnual) : "—";
      return `
      <tr>
        <td class="sticky-col">
          <input type="checkbox" class="anlRowSel" data-ticker="${r.ticker}" ${checked} />
        </td>
        <td class="sticky-col"><strong>${r.ticker}</strong></td>
        <td>${r.nome || "—"}</td>
        <td>${r.setor || "—"}</td>
        <td>${r.mercado || "—"}</td>
        <td>${badgeYield(y, y24)}</td>
        <td>${Number.isFinite(r.yield24) ? `${r.yield24.toFixed(2)}%` : "—"}</td>
        <td>${divPerTxt}</td>
        <td>${divAnualTxt}</td>
        <td>${badgePE(r.pe)}</td>
        <td>${pct(r.delta50)}</td>
        <td>${pct(r.delta200)}</td>
        <td>${pct(r.g1w)}</td>
        <td>${pct(r.g1m)}</td>
        <td>${pct(r.g1y)}</td>
        <td>${r.periodicidade || "—"}</td>
        <td>${r.mes || "—"}</td>
        <td>${r.observacao || "—"}</td>
      </tr>
    `;
    })
    .join("");

  tb.querySelectorAll(".anlRowSel").forEach((ch) => {
    ch.addEventListener("change", (e) => {
      const t = e.target.getAttribute("data-ticker");
      if (!t) return;
      if (e.target.checked) selectedTickers.add(t);
      else selectedTickers.delete(t);
      updateSelCount();
    });
  });
}

/* ===============================
   Dados (Firestore)
   =============================== */
let ALL_ROWS = [];
async function fetchAcoes() {
  const snap = await getDocs(query(collection(db, "acoesDividendos")));
  const rows = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const ticker = String(d.ticker || "").toUpperCase();
    if (!ticker) return;
    const valor = toNum(d.valorStock);

    const anual = anualPreferido(d);
    const porPag = perPayment(d);
    const y = (Number.isFinite(anual) && valor > 0) ? (anual / valor) * 100 : null;

    const peField = Number.isFinite(d.pe) ? Number(d.pe) :
                    Number.isFinite(d.peRatio) ? Number(d.peRatio) : null;

    rows.push({
      ticker,
      nome: d.nome || "",
      setor: d.setor || "",
      mercado: d.mercado || "",
      valorStock: valor,

      dividendo: toNum(d.dividendo),
      dividendoMedio24m: toNum(d.dividendoMedio24m),
      totalDiv24m: toNum(d.totalDiv24m),
      dividendosPagos24m: toNum(d.dividendosPagos24m),
      periodicidade: d.periodicidade || "",
      mes: d.mes || "",
      observacao: d.observacao || "",

      divPer: porPag,
      divAnual: anual,
      yield: Number.isFinite(y) ? y : null,
      yield24: Number.isFinite(d.yield24) ? Number(d.yield24) : null,

      pe: peField,
      peRatio: peField,
      sma50: Number.isFinite(d.sma50) ? Number(d.sma50) : null,
      sma200: Number.isFinite(d.sma200) ? Number(d.sma200) : null,

      delta50: Number.isFinite(d.delta50) ? Number(d.delta50) : null,
      delta200: Number.isFinite(d.delta200) ? Number(d.delta200) : null,
      g1w: Number.isFinite(d.taxaCrescimento_1semana) ? Number(d.taxaCrescimento_1semana) : null,
      g1m: Number.isFinite(d.taxaCrescimento_1mes) ? Number(d.taxaCrescimento_1mes) : null,
      g1y: Number.isFinite(d.taxaCrescimento_1ano) ? Number(d.taxaCrescimento_1ano) : null,
    });
  });
  ALL_ROWS = rows;
}

/* ===============================
   Filtros
   =============================== */
const keyStr = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
function applyFilters() {
  const term = keyStr(document.getElementById("anlSearch")?.value || "");
  const setor = document.getElementById("anlSetor")?.value || "";
  const mercado = document.getElementById("anlMercado")?.value || "";
  const periodo = document.getElementById("anlPeriodo")?.value || "";

  let rows = [...ALL_ROWS];
  if (term)
    rows = rows.filter(
      (r) => keyStr(r.ticker).includes(term) || keyStr(r.nome).includes(term)
    );
  if (setor) rows = rows.filter((r) => r.setor === setor);
  if (mercado) rows = rows.filter((r) => r.mercado === mercado);
  if (periodo) rows = rows.filter((r) => (r.periodicidade || "") === periodo);

  rows = sortRows(rows);
  renderCharts(rows);
  renderHeatmap(rows);
  renderTable(rows);

  const selAll = document.getElementById("anlSelectAll");
  if (selAll)
    selAll.checked =
      rows.length > 0 && rows.every((r) => selectedTickers.has(r.ticker));
}
function populateFilters() {
  const setorSel = document.getElementById("anlSetor");
  const mercadoSel = document.getElementById("anlMercado");
  const setSet = new Set(), merSet = new Set();
  ALL_ROWS.forEach((r) => {
    if (r.setor) setSet.add(r.setor);
    if (r.mercado) merSet.add(r.mercado);
  });
  const addOpts = (sel, values) => {
    const cur = sel.value;
    sel.innerHTML =
      `<option value="">Todos</option>` +
      [...values].sort().map((v) => `<option>${v}</option>`).join("");
    sel.value = cur || "";
  };
  if (setorSel) addOpts(setorSel, setSet);
  if (mercadoSel) addOpts(mercadoSel, merSet);
}

/* ============================================================
   ===  ALGORITMO DE SIMULAÇÃO — SECÇÃO EDITÁVEL            ===
   ============================================================ */

/**
 * Mistura g1w/g1m/g1y consoante período escolhido (sem converter para fração).
 */
function _campoPrefer(periodo){
  if (periodo==="1s") return "g1w";
  if (periodo==="1m") return "g1m";
  return "g1y";
}
function _blendPct(row, periodo){
  if (!ANALISE_CFG.blend.use){
    return Number(row[_campoPrefer(periodo)] || 0);
  }
  const all = { g1w:Number(row.g1w||0), g1m:Number(row.g1m||0), g1y:Number(row.g1y||0) };
  const order = periodo==="1s" ? ["g1w","g1m","g1y"] : periodo==="1m" ? ["g1m","g1w","g1y"] : ["g1y","g1m","g1w"];
  const { prefer, aux1, aux2 } = ANALISE_CFG.blend.pesos;
  return prefer*all[order[0]] + aux1*all[order[1]] + aux2*all[order[2]];
}

/**
 * Annualiza de forma conservadora e aplica "hard cap" anual.
 * - 1s → r_annual = (1 + r_w)^52 - 1
 * - 1m → r_annual = (1 + r_m)^12 - 1
 * - 1a → r_annual = r_y
 * Onde r_* são frações (ex.: 0.0614).
 */
function _estimateAnnualRate(row, periodo){
  const pct = _blendPct(row, periodo); // ex.: 6.14 (%)
  const r = Number(pct||0) / 100;      // fração
  let rAnnual;
  if (periodo === "1s") rAnnual = Math.pow(1 + r, 52) - 1;
  else if (periodo === "1m") rAnnual = Math.pow(1 + r, 12) - 1;
  else rAnnual = r; // 1a

  // Hard-cap anual conservador
  rAnnual = clamp(rAnnual, ANALISE_CFG.annualCaps.min, ANALISE_CFG.annualCaps.max);
  return rAnnual; // fração anual
}

/**
 * Métricas por ação (por unidade).
 * Composição ANUAL por número de anos (horizonte).
 */
function calcularMetricasBase(acao, { periodo="1m", horizonte=1, incluirDiv=true }={}){
  const preco = toNum(acao.valorStock);
  if (!(preco>0)) return null;

  const anualDiv = toNum(acao.divAnual ?? anualPreferido(acao));

  const rAnnual = _estimateAnnualRate(acao, periodo); // fração anual já limitada
  const anos = Math.max(1, Number(horizonte||1));
  const mult = Math.pow(1 + rAnnual, anos);

  const valorizacao = preco * (mult - 1);
  const divHorizonte = incluirDiv ? anualDiv * anos : 0;

  const lucroUnidade   = divHorizonte + valorizacao;
  const retornoPorEuro = preco>0 ? (lucroUnidade / preco) : 0;

  return {
    preco,
    dividendoAnual: anualDiv,
    taxaPct: rAnnual * 100, // guarda como % anual equivalente (já limitada)
    totalDividendos: divHorizonte,
    valorizacao,
    lucroUnidade,
    retornoPorEuro,
  };
}

function scoreAcao(acaoComMetrics){
  const { pesos, smaSignal, peBands } = ANALISE_CFG;
  const m = acaoComMetrics.metrics;
  const rE = m.retornoPorEuro;

  let bonus = 0;
  if (Number.isFinite(acaoComMetrics.sma50) && acaoComMetrics.valorStock > acaoComMetrics.sma50) bonus += smaSignal.bonus * smaSignal.peso50;
  if (Number.isFinite(acaoComMetrics.sma200) && acaoComMetrics.valorStock > acaoComMetrics.sma200) bonus += smaSignal.bonus * smaSignal.peso200;
  if (Number.isFinite(acaoComMetrics.sma50) && acaoComMetrics.valorStock < acaoComMetrics.sma50) bonus += smaSignal.malus * smaSignal.peso50;
  if (Number.isFinite(acaoComMetrics.sma200) && acaoComMetrics.valorStock < acaoComMetrics.sma200) bonus += smaSignal.malus * smaSignal.peso200;

  const pe = Number(acaoComMetrics.pe ?? acaoComMetrics.peRatio ?? NaN);
  let val = 0;
  if (Number.isFinite(pe)){
    if (pe < peBands.barato) val = +0.03;
    else if (pe > peBands.justo) val = -0.02;
  }

  const risco = (Number(acaoComMetrics.g1m||0) < 0) ? -0.01 : 0;

  return pesos.retornoEuro*rE + pesos.tendenciaSMA*bonus + pesos.valoracaoPE*val + pesos.risco*risco;
}

/* ===== Distribuição: frações ===== */
function distribuirFracoes_porScore(cands, investimento){
  const capPct = Math.max(0, Number(ANALISE_CFG.maxPctPorTicker||0));
  const capValor = capPct > 0 ? investimento * capPct : Infinity;

  const scores = cands.map(c => Math.max(0, c.score));
  const soma = scores.reduce((a,b)=>a+b,0);

  let linhas = cands.map((c, i) => {
    const share = soma>0 ? (scores[i] / soma) : (1 / cands.length);
    let investido = investimento * share;
    investido = Math.min(investido, capValor);
    const qtd = investido / c.metrics.preco;

    return {
      nome: c.nome, ticker: c.ticker, preco: c.metrics.preco,
      quantidade: qtd, investido,
      lucro: qtd * c.metrics.lucroUnidade,
      taxaPct: c.metrics.taxaPct,
      dividendoAnual: c.metrics.dividendoAnual,
      divAnualAlloc: qtd * c.metrics.dividendoAnual,
      divPeriodoAlloc: qtd * c.metrics.totalDividendos,
      valorizAlloc: qtd * c.metrics.valorizacao,
    };
  });

  // recorte por teto (se algum excedeu por arredondamentos)
  linhas = linhas.map(l => {
    if (l.investido > capValor) {
      const fator = capValor / l.investido;
      l.investido = capValor;
      l.quantidade *= fator;
      l.lucro *= fator;
      l.divAnualAlloc *= fator;
      l.divPeriodoAlloc *= fator;
      l.valorizAlloc *= fator;
    }
    return l;
  });

  let totalGasto = linhas.reduce((s,l)=>s+l.investido,0);
  let restante = Math.max(0, investimento - totalGasto);

  if (ANALISE_CFG.fallbackUsarRestoNoMelhor && restante > 0 && cands.length){
    const best = cands[0]; // já ordenados
    const qtd = restante / best.metrics.preco;
    const idx = linhas.findIndex(l => l.ticker === best.ticker);
    if (idx >= 0){
      const l = linhas[idx];
      l.investido += restante;
      l.quantidade += qtd;
      l.lucro += qtd * best.metrics.lucroUnidade;
      l.divAnualAlloc += qtd * best.metrics.dividendoAnual;
      l.divPeriodoAlloc += qtd * best.metrics.totalDividendos;
      l.valorizAlloc += qtd * best.metrics.valorizacao;
    } else {
      linhas.push({
        nome: best.nome, ticker: best.ticker, preco: best.metrics.preco,
        quantidade: qtd, investido: restante,
        lucro: qtd * best.metrics.lucroUnidade,
        taxaPct: best.metrics.taxaPct,
        dividendoAnual: best.metrics.dividendoAnual,
        divAnualAlloc: qtd * best.metrics.dividendoAnual,
        divPeriodoAlloc: qtd * best.metrics.totalDividendos,
        valorizAlloc: qtd * best.metrics.valorizacao,
      });
    }
    totalGasto += restante;
    restante = 0;
  }

  const totalLucro = linhas.reduce((s,l)=>s+l.lucro,0);
  const totalDivAnual = linhas.reduce((s,l)=>s+l.divAnualAlloc,0);
  const totalDivPeriodo = linhas.reduce((s,l)=>s+l.divPeriodoAlloc,0);
  const totalValoriz = linhas.reduce((s,l)=>s+l.valorizAlloc,0);

  return { linhas, totalLucro, totalGasto, totalDivAnual, totalDivPeriodo, totalValoriz, restante };
}

/* ===== Distribuição: inteiros (greedy) ===== */
function distribuirInteiros_greedy(cands, investimento){
  const capPct = Math.max(0, Number(ANALISE_CFG.maxPctPorTicker||0));
  const capValor = capPct > 0 ? investimento * capPct : Infinity;

  const linhasMap = new Map();
  let restante = investimento;
  const MAX_ITERS = 5000;
  let it = 0;

  while (restante > 0 && it < MAX_ITERS){
    it++;
    let comprou = false;
    for (const c of cands){
      const preco = c.metrics.preco;
      if (preco <= 0 || restante < preco) continue;

      const atual = linhasMap.get(c.ticker);
      const investidoAtual = atual ? atual.investido : 0;
      if (investidoAtual + preco > capValor) continue;

      const qtd = 1;
      const lucroAdd = c.metrics.lucroUnidade;
      const divAnAdd = c.metrics.dividendoAnual;
      const divPerAdd = c.metrics.totalDividendos;
      const valAdd = c.metrics.valorizacao;

      if (!atual){
        linhasMap.set(c.ticker, {
          nome: c.nome, ticker: c.ticker, preco,
          quantidade: qtd, investido: preco,
          lucro: lucroAdd,
          taxaPct: c.metrics.taxaPct,
          dividendoAnual: c.metrics.dividendoAnual,
          divAnualAlloc: divAnAdd,
          divPeriodoAlloc: divPerAdd,
          valorizAlloc: valAdd,
        });
      } else {
        atual.quantidade += qtd;
        atual.investido += preco;
        atual.lucro += lucroAdd;
        atual.divAnualAlloc += divAnAdd;
        atual.divPeriodoAlloc += divPerAdd;
        atual.valorizAlloc += valAdd;
      }
      restante -= preco;
      comprou = true;
      if (restante <= 0) break;
    }
    if (!comprou) break;
  }

  const linhas = Array.from(linhasMap.values());
  const totalGasto = linhas.reduce((s,l)=>s+l.investido,0);
  const totalLucro = linhas.reduce((s,l)=>s+l.lucro,0);
  const totalDivAnual = linhas.reduce((s,l)=>s+l.divAnualAlloc,0);
  const totalDivPeriodo = linhas.reduce((s,l)=>s+l.divPeriodoAlloc,0);
  const totalValoriz = linhas.reduce((s,l)=>s+l.valorizAlloc,0);

  return { linhas, totalLucro, totalGasto, totalDivAnual, totalDivPeriodo, totalValoriz, restante };
}

/* ===== Pipeline principal de simulação ===== */
function simularInvestimento(rowsSelecionadas, investimento, { periodo="1m", horizonte=1, incluirDiv=true, usarInteiros=false }={}){
  const comMetrics = rowsSelecionadas.map(a => {
    const metrics = calcularMetricasBase(a, { periodo, horizonte, incluirDiv });
    return metrics ? { ...a, metrics } : null;
  }).filter(Boolean);

  comMetrics.forEach(a => a.score = scoreAcao(a));
  comMetrics.sort((a,b)=> b.score - a.score);

  if (ANALISE_CFG.debug.logScore) {
    console.table(
      comMetrics.map(a => ({
        t: a.ticker,
        score: Number(a.score).toFixed(2),
        r_per_eur: Number(a.metrics.retornoPorEuro).toFixed(2),
        r_annual_pct: Number(a.metrics.taxaPct).toFixed(2),
      }))
    );
  }

  if (usarInteiros) {
    return distribuirInteiros_greedy(comMetrics, investimento);
  }
  return distribuirFracoes_porScore(comMetrics, investimento);
}

/* ===============================
   UI: Simulador (modal)
   =============================== */
function openSimModal() {
  document.getElementById("anlSimModal")?.classList.remove("hidden");
}
function closeSimModal() {
  document.getElementById("anlSimModal")?.classList.add("hidden");
}

function renderResultadoSimulacao(res, meta) {
  const cont = document.getElementById("anlSimResultado");
  if (!cont) return;

  if (!res || !res.linhas || res.linhas.length === 0) {
    cont.innerHTML = `<p class="muted">Sem resultados. Verifica o investimento e a seleção.</p>`;
    return;
  }

  const retornoPct = res.totalGasto > 0 ? (res.totalLucro / res.totalGasto) * 100 : 0;
  const header =
    `<p><strong>Horizonte:</strong> ${meta.horizonte} ${meta.horizonte>1?"anos":"ano"}<br/>
      <strong>Período de crescimento:</strong> ${meta.periodo==="1s"?"1 semana":meta.periodo==="1m"?"1 mês":"1 ano"}<br/>
      <strong>Dividendos:</strong> ${meta.incluirDiv ? "incluídos" : "excluídos"}</p>`;

  const rows = res.linhas.map(l => `
    <tr>
      <td><strong>${l.ticker}</strong></td>
      <td>${l.nome || "—"}</td>
      <td>${fmtEUR(l.preco)}</td>
      <td>${l.quantidade.toFixed(2)}</td>
      <td>${fmtEUR(l.investido)}</td>
      <td>${fmtEUR(l.lucro)}</td>
      <td>${fmtEUR(l.divAnualAlloc)}</td>
      <td>${fmtEUR(l.divPeriodoAlloc)}</td>
      <td>${fmtEUR(l.valorizAlloc)}</td>
    </tr>
  `).join("");

  cont.innerHTML = `
    ${header}
    <div class="tabela-scroll-wrapper">
      <table class="fine-table" style="width:100%">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Nome</th>
            <th>Preço</th>
            <th>Qtd.</th>
            <th>Investido</th>
            <th>Lucro estimado</th>
            <th>Dividendo anual (aloc.)</th>
            <th>Dividendos no horizonte</th>
            <th>Valorização no horizonte</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th colspan="4" style="text-align:right;">Totais</th>
            <th>${fmtEUR(res.totalGasto)}</th>
            <th>${fmtEUR(res.totalLucro)}</th>
            <th>${fmtEUR(res.totalDivAnual)}</th>
            <th>${fmtEUR(res.totalDivPeriodo)}</th>
            <th>${fmtEUR(res.totalValoriz)}</th>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="card" style="margin-top:10px;">
      <div class="card-content" style="display:flex; gap:16px; flex-wrap:wrap;">
        <div><strong>Retorno total (€):</strong> ${fmtEUR(res.totalLucro)}</div>
        <div><strong>Retorno total (%):</strong> ${retornoPct.toFixed(2)}%</div>
        <div><strong>Dividendos anuais (soma aloc.):</strong> ${fmtEUR(res.totalDivAnual)}</div>
        <div><strong>Dividendos no horizonte:</strong> ${fmtEUR(res.totalDivPeriodo)}</div>
        <div><strong>Valorização no horizonte:</strong> ${fmtEUR(res.totalValoriz)}</div>
      </div>
    </div>
  `;
}

/* === Pizza: distribuição por setor (selecionados) === */
let chartSelSetor = null;
async function renderSelectedSectorChart(rowsSelecionadas){
  await ensureChartJS();
  const wrap = document.getElementById("anlSelSectorChartWrap");
  const el = document.getElementById("anlSelSectorChart");
  if (!wrap || !el) return;
  chartSelSetor?.destroy();

  const map = new Map();
  rowsSelecionadas.forEach(r=>{
    const k = r.setor || "—";
    map.set(k, (map.get(k)||0) + 1);
  });
  const labels = Array.from(map.keys());
  const data   = Array.from(map.values());
  const colors = labels.map((_,i)=> PALETTE[i % PALETTE.length]);

  chartSelSetor = new Chart(el, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "62%",
      plugins:{
        legend: { position: "bottom", labels: { color: chartColors().ticks } },
        tooltip:{
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
          callbacks:{
            label: (ctx)=>{
              const total = data.reduce((a,b)=>a+b,0) || 1;
              const v = Number(ctx.parsed);
              const pct = ((v/total)*100).toFixed(1);
              return ` ${ctx.label}: ${v} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

/* ===============================
   INIT
   =============================== */
export async function initScreen() {
  await ensureChartJS();
  await fetchAcoes();
  populateFilters();

  // Ordenação por cabeçalho
  document.querySelectorAll("#anlTable thead th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (!key) return;
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDir = key === "pe" ? "asc" : "desc";
      }
      markSortedHeader();
      applyFilters();
    });
  });

  // Filtros
  document.getElementById("anlSearch")?.addEventListener("input", applyFilters);
  document.getElementById("anlSetor")?.addEventListener("change", applyFilters);
  document.getElementById("anlMercado")?.addEventListener("change", applyFilters);
  document.getElementById("anlPeriodo")?.addEventListener("change", applyFilters);
  document.getElementById("anlReset")?.addEventListener("click", () => {
    document.getElementById("anlSearch").value = "";
    document.getElementById("anlSetor").value = "";
    document.getElementById("anlMercado").value = "";
    document.getElementById("anlPeriodo").value = "";
    applyFilters();
  });

  // Selecionar todos (na lista filtrada)
  document.getElementById("anlSelectAll")?.addEventListener("change", (e) => {
    const check = e.target.checked;
    const term = keyStr(document.getElementById("anlSearch")?.value || "");
    const setor = document.getElementById("anlSetor")?.value || "";
    const mercado = document.getElementById("anlMercado")?.value || "";
    const periodo = document.getElementById("anlPeriodo")?.value || "";
    let rows = [...ALL_ROWS];
    if (term)
      rows = rows.filter(
        (r) => keyStr(r.ticker).includes(term) || keyStr(r.nome).includes(term)
      );
    if (setor) rows = rows.filter((r) => r.setor === setor);
    if (mercado) rows = rows.filter((r) => r.mercado === mercado);
    if (periodo) rows = rows.filter((r) => (r.periodicidade || "") === periodo);

    rows.forEach((r) => {
      if (check) selectedTickers.add(r.ticker);
      else selectedTickers.delete(r.ticker);
    });
    updateSelCount();
    renderTable(sortRows(rows));
  });

  document.getElementById("anlClearSel")?.addEventListener("click", () => {
    selectedTickers.clear();
    updateSelCount();
    applyFilters();
  });

  // Abrir modal simulação
  document.getElementById("anlSimular")?.addEventListener("click", () => {
    const selecionadas = ALL_ROWS.filter(r => selectedTickers.has(r.ticker));
    renderSelectedSectorChart(selecionadas);
    openSimModal();

    // Torna as checkboxes mutuamente exclusivas
    const chkTotal = document.getElementById("anlSimInvestirTotal");
    const chkInteiros = document.getElementById("anlSimInteiros");
    if (chkTotal && chkInteiros) {
      const sync = (src) => {
        if (src === chkTotal && chkTotal.checked) chkInteiros.checked = false;
        if (src === chkInteiros && chkInteiros.checked) chkTotal.checked = false;
        // Default: se nenhuma marcada, assume Total (frações)
        if (!chkTotal.checked && !chkInteiros.checked) chkTotal.checked = true;
      };
      chkTotal.addEventListener("change", () => sync(chkTotal));
      chkInteiros.addEventListener("change", () => sync(chkInteiros));
      // estado inicial seguro
      if (!chkTotal.checked && !chkInteiros.checked) chkTotal.checked = true;
      if (chkTotal.checked && chkInteiros.checked) chkInteiros.checked = false;
    }
  });

  // Fechar modal simulação
  document.getElementById("anlSimClose")?.addEventListener("click", closeSimModal);
  document.getElementById("anlSimModal")?.addEventListener("click", (e) => {
    if (e.target.id === "anlSimModal") closeSimModal();
  });

  // Calcular simulação
  document.getElementById("anlSimCalcular")?.addEventListener("click", () => {
    const investimento = Number(document.getElementById("anlSimInvest")?.value || 0);
    const horizonte = Number(document.getElementById("anlSimHoriz")?.value || 1);
    const periodoSel = document.getElementById("anlSimPeriodo")?.value || "1m";
    const incluirDiv = !!document.getElementById("anlSimIncluiDiv")?.checked;

    const chkTotal = document.getElementById("anlSimInvestirTotal");
    const chkInteiros = document.getElementById("anlSimInteiros");
    // lógica: se "Inteiros" está checked, então usarInteiros=true; caso contrário, frações
    const usarInteiros = !!(chkInteiros && chkInteiros.checked);

    if (!(investimento > 0)) {
      alert("Indica um investimento total válido.");
      return;
    }

    const selecionadas = ALL_ROWS.filter((r) => selectedTickers.has(r.ticker));
    if (!selecionadas.length) {
      alert("Seleciona pelo menos um ticker.");
      return;
    }

    const res = simularInvestimento(selecionadas, investimento, {
      periodo: periodoSel, horizonte, incluirDiv, usarInteiros
    });
    renderResultadoSimulacao(res, { periodo: periodoSel, horizonte, incluirDiv });
    renderSelectedSectorChart(selecionadas);
  });

  // Exportar para simulador
  document.getElementById("anlSimExportar")?.addEventListener("click", () => {
    const selecionadas = ALL_ROWS.filter((r) =>
      selectedTickers.has(r.ticker)
    ).map((r) => ({
      ticker: r.ticker,
      nome: r.nome,
      preco: r.valorStock,
      divPer: r.divPer,
      divAnual: r.divAnual,
      periodicidade: r.periodicidade,
      mes: r.mes,
      yield: r.yield,
    }));
    localStorage.setItem("simulacaoSelecionados", JSON.stringify(selecionadas));
    alert(`Exportado ${selecionadas.length} tickers. Podes abrir o ecrã do simulador.`);
    closeSimModal();
  });

  // Primeira renderização
  markSortedHeader();
  applyFilters();
}

/* Auto-init seguro (se o router não chamar initScreen) */
if (!window.__ANL_AUTO_INIT__) {
  window.__ANL_AUTO_INIT__ = true;
  initScreen().catch(console.error);
}