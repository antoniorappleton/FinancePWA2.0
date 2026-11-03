// ============================================================
// ANALISE.JS — VERSÃO ANOTADA (estrutura por secções, sem alterar lógica)
// ------------------------------------------------------------
// Objetivo:
//  - Isolar e documentar as PARTES do algoritmo para afinar parâmetros
//  - NÃO muda comportamento: apenas adiciona comentários e marcadores
//
// Índice de Secções (procura por estes marcadores):
//  [S1] Imports & Dependências Dinâmicas
//  [S2] Helpers de Aparência / Formatação / Utils
//  [S3] Configurável (CFG) — Pesos/Limites do algoritmo
//  [S4] Estado & Cache em Memória (ALL_ROWS, filtros, seleção)
//  [S5] Firestore — Carregamento e Normalização dos Dados
//  [S6] Filtros & Ordenação — Construção da tabela base
//  [S7] Gráficos — Setor, Mercado, Top Yield
//  [S8] Calendário de Dividendos (Heatmap 12 meses)
//  [S9] Tabela — Renderização e Interação (seleção, ordenação)
// [S10] Simulação (selecionados) — Preparação & Distribuição
// [S11] Relatório (PDF) — Geração a partir da seleção
// [S12] Interações de UI (event listeners) & Init
// ============================================================

// [S1] Imports & Dependências Dinâmicas

// screens/analise.js
import { db } from "../firebase-config.js";
import {
  calculateLucroMaximoScore,
  annualizeRate,
  anualPreferido,
  dividendoPorPagamento,
  pagamentosPorAno,
  parseSma,
  cleanTicker,
  getAssetType,
} from "../utils/scoring.js";
import { technicalSignal } from "../engines/technical-signal.js";
import { INDICATOR_INFO } from "../utils/indicator-info.js";
import { repairFirestoreData } from "../utils/maintenance.js";
import { subscribeMarketData } from "../utils/marketDataStore.js";

const BASE_SECTOR_OPTIONS = [
  "Tecnologia",
  "Comunicações",
  "Consumo Defensivo",
  "Finanças",
  "Defesa",
  "Automóvel",
  "Energia",
  "Saúde",
  "ETF Mercado Asiatico",
  "Industriais",
  "Utilidades",
  "Consumo Cíclico",
  "ETF iTech",
  "ETF Países Emergentes",
  "ETF Energia",
  "ETF Saúde",
  "ETF Finanças",
  "Mineração (Ouro)",
  "Imobiliário",
  "ETF Setor Comunicações",
  "ETF Consumo Ciclico",
  "ETF Mercado Europeu",
  "ETF Consumo Defensivo",
  "ETF Materiais",
  "ETF Tecnologia",
  "ETF Mundial",
  "Commodities",
  "Ouro",
];

const BASE_MARKET_OPTIONS = [
  "Americano SP500",
  "Europeu",
  "Portugal",
  "Americano",
  "Asiático",
  "Australiana",
  "Mundial",
  "Canadá",
];

/* =========================================================
Carregamento "on-demand" de libs (Chart.js, html2canvas, jsPDF)
========================================================= */
async function ensureScript(src) {
  if ([...document.scripts].some((s) => s.src === src)) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
async function ensureChartJS() {
  if (window.Chart) return;
  await ensureScript(
    "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js",
  );
}
/* =========================================================
Aparência / helpers
========================================================= */
const isDark = () =>
  document.documentElement.getAttribute("data-theme") === "dark";
// Os modais ficam sempre claros (também no modo escuro) — um gráfico lá dentro usa a paleta clara.
const chartColors = (el) => {
  const dark = isDark() && !el?.closest?.(".modal-dialog, .modal-content");
  return {
    grid: dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
    ticks: dark ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.75)",
    tooltipBg: dark ? "rgba(17,17,17,.95)" : "rgba(255,255,255,.95)",
    tooltipFg: dark ? "#fff" : "#111",
  };
};
const PALETTE = [
  "#4F46E5",
  "#22C55E",
  "#EAB308",
  "#EF4444",
  "#06B6D4",
  "#F59E0B",
  "#A855F7",
  "#10B981",
  "#3B82F6",
  "#F472B6",
  "#84CC16",
  "#14B8A6",
];
const mesesPT = [
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
const canon = (s) =>
  String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// cleanTicker removido (importado de scoring.js)

/* =========================================================
   Config ajustável — pesos/limites do algoritmo (visível)
   ========================================================= */
const CFG = {
  // Teto realista de projeção (stocks best-in-class raramente sustentam >30%/ano; S&P ~10%)
  MAX_ANNUAL_RETURN: 0.30,
  MIN_ANNUAL_RETURN: -0.30,

  // teto duro por ticker (usado em frações e inteiros)
  CAP_PCT_POR_TICKER: 0.15,

  // blend das taxas conforme período escolhido no simulador
  BLEND_WEIGHTS: {
    "1s": { w: 0.75, m: 0.15, y: 0.1 },
    "1m": { w: 0.1, m: 0.75, y: 0.15 },
    "1a": { w: 0.1, m: 0.15, y: 0.75 },
  },
};

window.ANL_CFG = CFG; // podes ajustar via consola se quiseres

/* =========================================================
   Cálculos de dividendos / yield
   - Sheet "Firebase" grava:
     • dividendoMedio24m = ANUAL (média 24m)
     • dividendo         = ANUAL (coluna H)
     • periodicidade + mes (distribuição mensal)
   ========================================================= */
function perPayment(doc) {
  if (!pagamentosPorAno(doc.periodicidade)) return 0;
  return dividendoPorPagamento(anualPreferido(doc), doc.periodicidade);
}
function computeYieldPct(annualDividend, valorStock) {
  if (
    !Number.isFinite(annualDividend) ||
    !Number.isFinite(valorStock) ||
    valorStock <= 0
  )
    return 0;
  return (annualDividend / valorStock) * 100;
}

/* =========================================================
   Ordenação / Tabela
   ========================================================= */
let sortKey = null;
let sortDir = "desc";
let cardAssetFilter = "stock";
let cardSectorFilter = "all";
let lastCardRows = [];

/* =========================================================
   Header Filters (column-level quick filters)
   ========================================================= */
const headerFilterState = new Map(); // key -> filter string


/** Parse numeric filter expression like >10, <5, =3, 10-20 */
function parseNumericFilter(expr) {
  if (!expr) return null;
  const s = expr.replace(/\s/g, "").replace(/,/g, ".");
  // Range: 10-20 or 10:20
  const range = s.match(/^(-?\d+\.?\d*)[-:](-?\d+\.?\d*)$/);
  if (range) {
    const min = Number(range[1]), max = Number(range[2]);
    return (v) => Number.isFinite(v) && v >= min && v <= max;
  }
  // Operators
  const op = s.match(/^(>=|<=|>|<|=)?(-?\d+\.?\d*)$/);
  if (op) {
    const operator = op[1] || "=";
    const n = Number(op[2]);
    switch (operator) {
      case ">": return (v) => Number.isFinite(v) && v > n;
      case ">=": return (v) => Number.isFinite(v) && v >= n;
      case "<": return (v) => Number.isFinite(v) && v < n;
      case "<=": return (v) => Number.isFinite(v) && v <= n;
      case "=": return (v) => Number.isFinite(v) && Math.abs(v - n) < 1e-9;
    }
  }
  // Fallback: simple numeric contains
  const n2 = Number(s);
  if (Number.isFinite(n2)) {
    return (v) => Number.isFinite(v) && Math.abs(v - n2) < 1e-9;
  }
  return null;
}

/** Apply header column filters on top of existing rows */
function applyHeaderFilters(rows) {
  if (!headerFilterState.size) return rows;
  return rows.filter((r) => {
    for (const [key, expr] of headerFilterState.entries()) {
      const accessor = SORT_ACCESSORS[key] || ((row) => row[key]);
      const rawVal = accessor(r);

      // Categorical (select)
      if (["setor", "mercado", "periodicidade", "mes", "buyZone"].includes(key)) {
        const val = String(r[key] || "").toLowerCase();
        if (!val.includes(String(expr).toLowerCase())) return false;
        continue;
      }

      // Text
      if (["ticker", "nome", "observacao"].includes(key)) {
        const val = String(rawVal || "").toLowerCase();
        if (!val.includes(String(expr).toLowerCase())) return false;
        continue;
      }

      // Numeric
      const fn = parseNumericFilter(expr);
      if (fn && !fn(rawVal)) return false;
    }
    return true;
  });
}
const SORT_ACCESSORS = {
  ticker: (r) => r.ticker,
  nome: (r) => r.nome || "",
  setor: (r) => r.setor || "",
  mercado: (r) => r.mercado || "",
  yield: (r) => (Number.isFinite(r.yield) ? r.yield : -Infinity),
  preco: (r) => r.precoAtual || 0,
  minus35: (r) => r.minus35pct || 0,
  minus5: (r) => r.minus5pct || 0,
  buyZone: (r) => (Number.isFinite(r.technicalScore) ? r.technicalScore : -Infinity),
  yield24: (r) => (Number.isFinite(r.yield24) ? r.yield24 : -Infinity),
  divPer: (r) => (Number.isFinite(r.divPer) ? r.divPer : -Infinity),
  divAnual: (r) => (Number.isFinite(r.divAnual) ? r.divAnual : -Infinity),
  pe: (r) => (Number.isFinite(r.pe) ? r.pe : Infinity),
  pe_f: (r) => (Number.isFinite(r.forward_p_e) ? r.forward_p_e : Infinity),
  peg: (r) => (Number.isFinite(r.peg) ? r.peg : Infinity),
  roic: (r) => (Number.isFinite(r.roic) ? r.roic : -Infinity),
  roe: (r) => (Number.isFinite(r.roe) ? r.roe : -Infinity),
  eps_yoy: (r) => (Number.isFinite(r.eps_yoy) ? r.eps_yoy : -Infinity),
  eps_next_y: (r) => (Number.isFinite(r.eps_next_y) ? r.eps_next_y : -Infinity),
  sales_yoy: (r) => (Number.isFinite(r.sales_yoy) ? r.sales_yoy : -Infinity),
  current_ratio: (r) =>
    Number.isFinite(r.current_ratio) ? r.current_ratio : -Infinity,
  debt_eq: (r) => (Number.isFinite(r.debt_eq) ? r.debt_eq : Infinity),
  rsi: (r) => (Number.isFinite(r.rsi_14) ? r.rsi_14 : Infinity),
  preco: (r) => r.precoAtual || 0,
  minus35: (r) => r.minus35pct || 0,
  minus5: (r) => r.minus5pct || 0,
  buyZone: (r) => (Number.isFinite(r.technicalScore) ? r.technicalScore : -Infinity),
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
    const va = acc(a),
      vb = acc(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}
/* =========================================================
   Charts (gerais) — sem tremer (animation: false)
   ========================================================= */
let charts = { setor: null, mercado: null, topYield: null };
function destroyCharts() {
  charts.setor?.destroy();
  charts.mercado?.destroy();
  charts.topYield?.destroy();
  charts = { setor: null, mercado: null, topYield: null };
}
function renderDonut(elId, dataMap) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const labels = Array.from(dataMap.keys());
  const data = Array.from(dataMap.values());
  if (!data.length) {
    el.parentElement?.classList.add("muted");
    return null;
  }
  const sectorColors = {
    "Tecnologia": "#4F46E5",
    "Finanças": "#3B82F6",
    "Saúde": "#EF4444",
    "Energia": "#22C55E",
    "Consumo": "#F59E0B",
    "Commodities": "#d97706",
    "Materiais": "#84CC16",
    "Imobiliário": "#EC4899",
    "Utilities": "#06B6D4"
  };

  return new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map((label, i) => sectorColors[label] || PALETTE[i % PALETTE.length]),
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      animation: false,
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
              return ` ${ctx.label}: ${v} (${pct}%)`;
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
    .map((r) => ({ tk: r.ticker, y: Number.isFinite(r.yield) ? r.yield : 0 }))
    .filter((x) => x.y > 0)
    .sort((a, b) => b.y - a.y)
    .slice(0, 8);
  if (!top.length) return null;
  return new Chart(el, {
    type: "bar",
    data: {
      labels: top.map((x) => x.tk),
      datasets: [
        {
          label: "Yield (%)",
          data: top.map((x) => x.y),
          backgroundColor: "#22C55E",
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
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

function renderCharts(rows) {
  const groupBy = (key) => {
    const map = new Map();
    rows.forEach((r) => {
      const k = canon(r[key] || "—");
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  };
  destroyCharts();
  charts.setor = renderDonut("anlChartSetor", groupBy("setor"));
  charts.mercado = renderDonut("anlChartMercado", groupBy("mercado"));
  charts.topYield = renderTopYield("anlChartTopYield", rows);
}

/* =========================================================
   Calendário (12 meses) — por pagamento (média 24m)
   ========================================================= */
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
function renderHeatmap(rows) {
  const container = document.getElementById("anlHeatmapScroll");
  const grid = document.getElementById("anlHeatmapGrid");
  const summary = document.getElementById("anlHeatmapSummary");
  if (!container || !grid) return;

  const paymentRows = rows.filter((r) => perPayment(r) > 0);
  const monthBuckets = Array.from({ length: 12 }, () => []);

  const perPayments = paymentRows
    .map((r) => perPayment(r))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const q1 = percentile(perPayments, 0.25) || 0.01;
  const q2 = percentile(perPayments, 0.5) || 0.02;
  const q3 = percentile(perPayments, 0.75) || 0.03;

  paymentRows.forEach((r) => {
    const per = String(r.periodicidade || "n/A");
    const idxMes = mesToIdx.get(String(r.mes || "")) ?? NaN;
    const meses = mesesPagamento(per, idxMes);
    const perPay = perPayment(r);

    let klass = "";
    if (perPay > 0) {
      if (perPay <= q1) klass = "pay-1";
      else if (perPay <= q2) klass = "pay-2";
      else if (perPay <= q3) klass = "pay-3";
      else klass = "pay-4";
    }

    let sizeClass = "size-sm";
    if (perPay > q3) sizeClass = "size-xl";
    else if (perPay > q2) sizeClass = "size-lg";
    else if (perPay > q1) sizeClass = "size-md";

    const amountLabel = perPay ? fmtEUR(perPay) : "—";
    const allMonths = meses.map((m) => mesesPT[m]).join(", ");
    const titleLines = [
      r.ticker,
      r.nome ? `${r.nome}` : null,
      `Frequência: ${per}`,
      perPay ? `Pagamento típico: ${amountLabel}` : null,
      allMonths ? `Meses típicos: ${allMonths}` : null,
    ]
      .filter(Boolean)
      .join(" • ");

    meses.forEach((mes) => {
      monthBuckets[mes].push({
        ticker: r.ticker,
        nome: r.nome,
        per,
        perPay,
        klass,
        sizeClass,
        title: titleLines,
      });
    });
  });

  if (summary) {
    if (!paymentRows.length) {
      summary.textContent = "Nenhum ativo com dividendos definidos para os próximos 12 meses.";
    } else {
      const avgPay =
        paymentRows.reduce((acc, r) => acc + perPayment(r), 0) /
        paymentRows.length;
      const monthCounts = monthBuckets.map((bucket) => bucket.length);
      const minCount = Math.min(...monthCounts);
      const maxCount = Math.max(...monthCounts);

      summary.innerHTML = `
        <span><strong>${paymentRows.length}</strong> ativos com pagamento típico</span>
        <span>Média por pagamento: <strong>${fmtEUR(avgPay)}</strong></span>
        <span>Pagamentos/mês: <strong>${minCount}</strong>–<strong>${maxCount}</strong></span>
      `;
    }
  }

  const rowsHtml = monthBuckets
    .map((bucket, monthIndex) => {
      const bubbles = bucket
        .sort((a, b) => b.perPay - a.perPay)
        .map(
          (item) =>
            `<div class="dividend-bubble ${item.klass} ${item.sizeClass}" title="${item.title}"><span class="ticker">${item.ticker}</span></div>`,
        )
        .join("");

      return `
        <div class="month-row">
          <div class="month-label">${mesesPT[monthIndex]}</div>
          <div class="month-bubbles">
            ${bubbles || '<span class="month-empty">Nenhum pagamento previsto</span>'}
          </div>
        </div>`;
    })
    .join("");

  grid.innerHTML = rowsHtml;
  container.scrollTop = 0;
}

/* =========================================================
   Tabela principal
   ========================================================= */
function renderPortfolioCards(rows) {
  const grid = document.getElementById('portfolioCardsGrid');
  const countEl = document.getElementById('cardsCount');
  if (!grid || !countEl) return;
  lastCardRows = rows;
  wireCardFilterButtons();

  const filteredRows = rows.filter((r) => {
    if (cardAssetFilter === "etf") return r.assetType === "etf";
    return r.assetType === "stock";
  });
  renderCardSectorFilters(filteredRows);

  const sectorRows = cardSectorFilter === "all"
    ? filteredRows
    : filteredRows.filter((r) => String(r.setor || "—") === cardSectorFilter);

  // Top 12 by portfolioScore
  const top12 = [...sectorRows]
    .filter(r => r.portfolioScore > 0)
    .sort((a, b) => b.portfolioScore - a.portfolioScore)
    .slice(0, 12);

  if (!top12.length) {
    const label = cardAssetFilter === "etf" ? "ETFs" : "acoes";
    const sectorLabel = cardSectorFilter === "all" ? "" : ` no setor ${cardSectorFilter}`;
    grid.innerHTML = `
      <div class="cards-empty">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
        </svg>
        <p>Sem Top 12 de ${label}${sectorLabel} para os filtros atuais.</p>
      </div>`;
    countEl.textContent = '0 cards';
    return;
  }

  const displayRows = top12;

  const suffix = cardSectorFilter === "all" ? "" : ` · ${cardSectorFilter}`;
  countEl.textContent = `${displayRows.length} ${cardAssetFilter === "etf" ? "ETFs" : "acoes"}${suffix}`;

  grid.innerHTML = displayRows.map(r => renderSingleCard(r)).join('');

  // Open Asset Deep Panel on card click (fallback: filter table)
  grid.querySelectorAll('.portfolio-card').forEach(card => {
    card.style.cursor = "pointer";
    card.addEventListener('click', () => {
      const ticker = card.dataset.ticker;
      if (typeof window.openAssetPanel === "function") {
        window.openAssetPanel(ticker);
      } else {
        document.getElementById('anlSearch').value = ticker;
        applyFilters();
      }
    });
  });
}

function wireCardFilterButtons() {
  document.querySelectorAll("[data-card-filter]").forEach((btn) => {
    const filter = btn.getAttribute("data-card-filter");
    btn.classList.toggle("active", filter === cardAssetFilter);
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      cardAssetFilter = filter || "stock";
      renderPortfolioCards(lastCardRows);
    });
  });
}

function resetAnalysisFilters() {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  setValue("anlSearch", "");
  setValue("anlSetor", "");
  setValue("anlMercado", "");
  setValue("anlPeriodo", "");
  headerFilterState.clear();
  cardAssetFilter = "stock";
  cardSectorFilter = "all";
  sortKey = null;
  sortDir = "desc";
  applyFilters();
}

function renderCardSectorFilters(rows) {
  const panel = document.getElementById("portfolioSectorFilters");
  if (!panel) return;
  const esc = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const counts = new Map();
  rows.forEach((r) => {
    const setor = String(r.setor || "—").trim() || "—";
    counts.set(setor, (counts.get(setor) || 0) + 1);
  });

  const sectors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt"))
    .slice(0, 14);

  if (cardSectorFilter !== "all" && !counts.has(cardSectorFilter)) {
    cardSectorFilter = "all";
  }

  panel.innerHTML = `
    <div class="sector-filter-title">Setores</div>
    <button type="button" class="${cardSectorFilter === "all" ? "active" : ""}" data-card-sector="all">
      Todos <span>${rows.length}</span>
    </button>
    ${sectors.map(([sector, count]) => `
      <button type="button" class="${cardSectorFilter === sector ? "active" : ""}" data-card-sector="${encodeURIComponent(sector)}">
        ${esc(sector)} <span>${count}</span>
      </button>
    `).join("")}
  `;

  panel.querySelectorAll("[data-card-sector]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = btn.getAttribute("data-card-sector") || "all";
      cardSectorFilter = raw === "all" ? "all" : decodeURIComponent(raw);
      renderPortfolioCards(lastCardRows);
    });
  });
}

function renderSingleCard(r) {
  const { ticker, nome, setor, precoAtual, rsi_14, yield: yld, divAnual, portfolioScore, avgPrice = null, qty = null } = r;
  const technical = r.technical || technicalSignal(r);
  
  const p35 = technical.support1 || precoAtual * 0.965;
  const p5 = technical.support2 || precoAtual * 0.95;
  
  // Recovery Simulator (user example style)
  let recoveryHTML = '';
  if (avgPrice && qty) {
    const totalInvested = qty * avgPrice;
    const currentValue = qty * precoAtual;
    const loss = totalInvested - currentValue;
    const lossPct = ((loss / totalInvested) * 100).toFixed(1);
    const breakeven = avgPrice; // simple breakeven
    const tp1pct = 5; // +5% TP1
    const tp1 = avgPrice * 1.05;
    const tp2pct = 12; // +12% TP2
    const tp2 = avgPrice * 1.12;
    const recoveryProb = rsi_14 < 40 ? '🟢 85%' : rsi_14 < 60 ? '🟡 65%' : '🔴 45%';
    
    recoveryHTML = `
      <div class="recovery-sim">
        <div class="sim-header"><strong>💰 Recovery Simulator</strong></div>
        <div style="font-size:0.8rem; line-height:1.3;">
          <div>Posição: <strong>${qty} @ €${avgPrice.toFixed(2)}</strong></div>
          <div>Loss: <span class="down">€${loss.toFixed(2)} (${lossPct}%)</span></div>
          <div>Breakeven: <strong>€${breakeven.toFixed(2)}</strong></div>
          <div>TP1 (+5%): €${tp1.toFixed(2)}</div>
          <div>TP2 (+12%): €${tp2.toFixed(2)}</div>
          <div>Prob Recuperação: <strong>${recoveryProb}</strong></div>
        </div>
      </div>`;
  }

  const signalBorderColor = {
    breakout: "#22c55e",
    bullish: "#22c55e",
    pullback: "#3b82f6",
    neutral: "#64748b",
    weak: "#f59e0b",
    downtrend: "#ef4444",
  }[technical.key] || "#64748b";

  return `
    <div class="portfolio-card" data-ticker="${ticker}" style="border-top: 3px solid ${signalBorderColor};">
      <div class="card-top-row">
        <div class="card-id-box">
          <div class="card-ticker">${ticker}</div>
          <div class="card-name">${nome || ''} <span class="muted">(${setor})</span></div>
        </div>
        <div class="card-price">${fmtEUR(precoAtual)}</div>
      </div>

      <div class="card-signal-badge card-signal-badge--${technical.key}" title="${technical.tooltip || ''}">
        <span class="card-signal-action">${technical.action}</span>
        <span class="card-signal-score">${technical.score}</span>
      </div>

      <div class="card-metrics">
        <div class="metric-row">
          <span class="metric-label">Score Portfolio:</span>
          <span class="metric-value">${(portfolioScore * 100).toFixed(0)}%</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Yield:</span>
          <span class="metric-value">${yld ? yld.toFixed(1) + '%' : '—'}</span>
        </div>
      </div>

      <div class="drop-levels">
        <div style="font-weight:600; margin-bottom:4px;">📉 Reforço Levels</div>
        <div style="display:flex; gap:12px; font-size:0.85rem;">
          <span>• –3.5%: ${fmtEUR(p35)}</span>
          <span>• –5.0%: ${fmtEUR(p5)}</span>
        </div>
      </div>

      ${recoveryHTML}
    </div>`;
}

function renderTable(rows) {
    renderPortfolioCards(rows); // 🔥 Portfolio cards: top 12 by score w/ QDVF example
}

/* =========================================================
   Firestore (fetch)
   ========================================================= */
let ALL_ROWS = [];
let unsubAcoes = null;

function fetchAcoes() {
  if (unsubAcoes) unsubAcoes();

  unsubAcoes = subscribeMarketData((allAssetsMap, snap) => {
    if (!snap) return;

    const rows = [];
    snap.forEach((doc) => {
      const tickerRaw = String(doc.data().ticker || "").toUpperCase();
      if (!tickerRaw) return;
      const d = allAssetsMap.get(tickerRaw) || doc.data();
      const ticker = cleanTicker(tickerRaw);

      const valor = toNum(d.valorStock);
      const annual = toNum(d.dividendoMedio24m) || anualPreferido(d);
      let rawYield = Number(
        d["Dividend Yield"] || d.yield || computeYieldPct(annual, valor),
      );
      let yFinal =
        Math.abs(rawYield) > 0 && Math.abs(rawYield) < 1
          ? rawYield * 100
          : rawYield;

      let rY24 = Number(d.yield24 || 0);
      let y24Final =
        Math.abs(rY24) > 0 && Math.abs(rY24) < 1 ? rY24 * 100 : rY24;

      // PORTFOLIO CARDS - Add score for sorting
      const scoreResult = calculateLucroMaximoScore(d, '1m');
      const score = scoreResult.score || 0;

      const row = {
        ticker,
        nome: d.nome || ticker,
        setor: (() => {
          const sRaw = d.setor || d.sector || d.Setor || d.Sector || d.industry || d.Industry || d.indústria || d.Indústria || d.segmento || d.segment || "";
          let s = canon(sRaw);
          if (!s && String(d.ticker).includes(":")) {
            const p = String(d.ticker).split(":")[0].trim();
            if (p.length > 2) s = canon(p);
          }
          return s || "—";
        })(),
        mercado: canon(d.mercado || d.market || d.Market || "") || "—",
        valorStock: valor,
        dividendo: toNum(d.dividendo),
        // External Links - NEW
        dividendoMedio24m: toNum(d.divMedio24m || d.dividendoMedio24m),
        periodicidade: d.periodicidade || "",
        mes: d.mes || "",
        observacao: d.observacoes || d.observacao || d["Observação"] || "",

        divPer: perPayment(d),
        divAnual: annual,
        yield: Number.isFinite(yFinal) ? yFinal : null,
        portfolioScore: score,

        g1w:
          Number(d.priceChange_1w || d.taxaCrescimento_1semana || d.g1w) || 0,
        g1m: Number(d.priceChange_1m || d.taxaCrescimento_1mes || d.g1m) || 0,
        g1y: Number(d.priceChange_1y || d.taxaCrescimento_1ano || d.g1y) || 0,

        roic: Number(d.roic || d.ROIC || 0),
        eps_yoy: Number(d.epsYoY || d.eps_yoy || d.EPS_YoY || 0),
        eps_next_y: Number(d.epsNextY || d.eps_next_y || d["EPS next Y"] || 0),
        market_cap: Number(d.marketCap || d.market_cap || d["Market Cap"] || 0),

        evEbitda:
          Number(d.ev_ebitda) ||
          Number(d.evEbitda) ||
          Number(d["EV/Ebitda"]) ||
          (() => {
            const ev = Number(d.EV) || Number(d.ev);
            const ebt = Number(d.Ebitda) || Number(d.ebitda);
            return Number.isFinite(ev) && Number.isFinite(ebt) && ebt > 0
              ? ev / ebt
              : null;
          })(),

        yield24: y24Final || null,

        // Drop Price Levels - ENHANCED (tooltip-ready)
        precoAtual: valor,
        minus35pct: valor > 0 ? valor * 0.965 : 0,
        minus5pct: valor > 0 ? valor * 0.95 : 0,


        pe:
          Number(d.pe) ||
          Number(d.peRatio) ||
          Number(d["P/E ratio (Preço/Lucro)"]) ||
          null,
        sma50: parseSma(d.sma50 || d.SMA50, valor),
        sma200: parseSma(d.sma200 || d.SMA200, valor),

        delta50: (() => {
          const raw = Number(d.delta50);
          if (Number.isFinite(raw)) return Math.abs(raw) > 1 ? raw / 100 : raw;
          const p = valor,
            s = parseSma(d.sma50 || d.SMA50, p);
          return Number.isFinite(p) && Number.isFinite(s) && s > 0
            ? (p - s) / s
            : null;
        })(),

        delta200: (() => {
          const raw = Number(d.delta200);
          if (Number.isFinite(raw)) return Math.abs(raw) > 1 ? raw / 100 : raw;
          const p = valor,
            s = parseSma(d.sma200 || d.SMA200, p);
          return Number.isFinite(p) && Number.isFinite(s) && s > 0
            ? (p - s) / s
            : null;
        })(),

        // Novos Indicadores
        peg: Number(d.peg || 0),
        roe: Number(d.roe || 0),
        p_fcf: Number(d.p_fcf || 0),
        current_ratio: Number(d.current_ratio || 0),
        debt_eq: Number(d.debt_eq || 0),
        rsi_14: Number(d.rsi_14 || 0),
        buyZone: "",
        forward_p_e: Number(d.forward_p_e || 0),
        gross_margin: Number(d.gross_margin || 0),
        oper_margin: Number(d.oper_margin || 0),
        profit_margin: Number(d.profit_margin || 0),
        sales_yoy: Number(d.sales_y_y_ttm || 0),

        // Drop Price Levels - NEW
        precoAtual: valor,
        minus35pct: valor > 0 ? (valor * 0.965).toFixed(2) : 0,
        minus5pct: valor > 0 ? (valor * 0.95).toFixed(2) : 0,

        // Novos campos numéricos (processados pelo upload_to_firestore)
        high_52w_dist: Number(d.high_52w_dist || 0),
        low_52w_dist: Number(d.low_52w_dist || 0),
        div_grow_5y: Number(d.div_grow_5y || 0),
        eps_grow_5y: Number(d.eps_grow_5y || 0),
        vol_week: Number(d.vol_week || 0),
        vol_month: Number(d.vol_month || 0),
      };

      row.assetType = getAssetType(row.ticker, row);
      row.technical = technicalSignal({ ...d, ...row });
      row.technicalScore = row.technical.score;
      row.buyZone = row.technical.label;
      row.minus35pct = row.technical.support1;
      row.minus5pct = row.technical.support2;

      rows.push(row);
    });
    ALL_ROWS = rows;

  // Atualizar UI automaticamente se já estivermos inicializados
    if (document.getElementById("anlSearch")) {
      populateFilters();
      applyFilters();
    }
  });
}

/* =========================================================
   Filtros
   ========================================================= */
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
      (r) => keyStr(r.ticker).includes(term) || keyStr(r.nome).includes(term),
    );
  if (setor) rows = rows.filter((r) => r.setor === setor);
  if (mercado) rows = rows.filter((r) => r.mercado === mercado);
  if (periodo) rows = rows.filter((r) => (r.periodicidade || "") === periodo);

  // Apply column header filters on top of toolbar filters
  rows = applyHeaderFilters(rows);

  rows = sortRows(rows);
  renderCharts(rows);
  renderHeatmap(rows);
  hookHeatmapScrollSync();
  renderTable(rows);
}
function populateFilters() {
  const setorSel = document.getElementById("anlSetor");
  const mercadoSel = document.getElementById("anlMercado");
  const setSet = new Set(),
    merSet = new Set();
  ALL_ROWS.forEach((r) => {
    if (r.setor) setSet.add(r.setor);
    if (r.mercado) merSet.add(r.mercado);
  });
  BASE_SECTOR_OPTIONS.forEach((sector) => setSet.add(sector));
  BASE_MARKET_OPTIONS.forEach((market) => merSet.add(market));
  const addOpts = (sel, values) => {
    const cur = sel.value;
    sel.innerHTML =
      `<option value="">Todos</option>` +
      [...values]
        .sort()
        .map((v) => `<option>${v}</option>`)
        .join("");
    sel.value = cur || "";
  };
  if (setorSel) addOpts(setorSel, setSet);
  if (mercadoSel) addOpts(mercadoSel, merSet);
}

/* =========================================================
   === LUCRO MÁXIMO — versão otimizada, prudente e realista ===
   ========================================================= */

/* ---------------------------------------------
   Helpers de taxa / estatística / utilitários
----------------------------------------------*/

/** Percentil com interpolação linear (0..1). */
function percentile(arr, p) {
  const a = (arr || [])
    .filter(Number.isFinite)
    .slice()
    .sort((x, y) => x - y);
  if (!a.length) return 0;
  if (p <= 0) return a[0];
  if (p >= 1) return a[a.length - 1];
  const index = (a.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return a[lower] * (1 - weight) + a[upper] * weight;
}

// === Explicação do Algoritmo (abrir/fechar) ===
function openAlgoModal() {
  const el = document.getElementById("anlAlgoModal");
  el?.classList.remove("hidden");
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}
function closeAlgoModal() {
  const el = document.getElementById("anlAlgoModal");
  el?.classList.add("hidden");
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
}


/* =========================================================
   Heatmap scroll header sync (extra)
   ========================================================= */
function hookHeatmapScrollSync() {
  const body = document.getElementById("anlHeatmapBody");
  const head = document.getElementById("anlHeatmapHeaderScroll");
  if (!body || !head) return;
  body.addEventListener(
    "scroll",
    () => {
      head.scrollLeft = body.scrollLeft;
    },
    { passive: true },
  );
}

/* =========================================================
   PAINEL DE RISCO — lazy-load ao clicar no tab
   ========================================================= */
let _riscoPanelLoaded = false;
async function _loadRiscoPanelOnce() {
  if (_riscoPanelLoaded) return;
  _riscoPanelLoaded = true;
  try {
    const { initRiscoPanel } = await import('./risco-panel.js');
    initRiscoPanel(document.getElementById('riscoPanelMount'));
  } catch (e) {
    console.error('Erro ao carregar painel de risco:', e);
  }
}

/* =========================================================
   INIT
   ========================================================= */
export async function initScreen() {
  // Tab switching: Análise de Ações / Risco de Mercado
  const tabs = document.querySelectorAll('.anlTab');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabs.forEach(b => {
        const active = b === btn;
        b.classList.toggle('outline', !active);
        b.style.background = active ? 'var(--primary)' : '';
        b.style.color = active ? 'var(--primary-foreground)' : '';
        b.style.borderColor = active ? 'var(--primary)' : '';
      });
      document.getElementById('anlTabAcoes').style.display = tab === 'acoes' ? '' : 'none';
      document.getElementById('anlTabRisco').style.display = tab === 'risco' ? '' : 'none';
      if (tab === 'risco') _loadRiscoPanelOnce();
    });
  });

  await ensureChartJS();
  if (!db) {
    console.error("Firebase DB não inicializado!");
    return;
  }

  // Botão de reparação de dados (manutenção)
  const btnRepair = document.getElementById("btnRepairData");
  if (btnRepair) {
    btnRepair.addEventListener("click", async () => {
      if (
        !confirm(
          "Deseja reparar os dados antigos no Firestore? Isso converterá strings complexas em números. Pode demorar alguns segundos.",
        )
      )
        return;
      btnRepair.disabled = true;
      btnRepair.innerText = "Reparando...";
      try {
        await repairFirestoreData();
        alert("Dados reparados com sucesso! A tabela será atualizada.");
        location.reload();
      } catch (err) {
        console.error(err);
        alert("Erro ao reparar dados. Verifique a consola.");
      } finally {
        btnRepair.disabled = false;
        btnRepair.innerText = "Reparar Base de Dados";
      }
    });
  }

  fetchAcoes();

  // Filtros
  document.getElementById("anlSearch")?.addEventListener("input", applyFilters);
  document.getElementById("anlSetor")?.addEventListener("change", applyFilters);
  document
    .getElementById("anlMercado")
    ?.addEventListener("change", applyFilters);
  document
    .getElementById("anlPeriodo")
    ?.addEventListener("change", applyFilters);
  document.getElementById("anlReset")?.addEventListener("click", resetAnalysisFilters);
  document.getElementById("cardsClearFilters")?.addEventListener("click", resetAnalysisFilters);

  // === Fechar Modal (Algoritmo) ===

  // util para saber se um modal está aberto
  const _isOpen = (el) => el && !el.classList.contains("hidden");

  // ALGORITMO — botões + clique no backdrop
  document
    .getElementById("anlAlgoHelp")
    ?.addEventListener("click", openAlgoModal);
  document
    .getElementById("anlAlgoClose")
    ?.addEventListener("click", closeAlgoModal);
  document
    .getElementById("anlAlgoOk")
    ?.addEventListener("click", closeAlgoModal);
  document.getElementById("anlAlgoModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeAlgoModal();
  });

  // Mostrar aviso de algoritmo uma vez por sessão
  if (!sessionStorage.getItem("anl_algo_seen")) {
    setTimeout(openAlgoModal, 1000);
    sessionStorage.setItem("anl_algo_seen", "true");
  }

  // ESC fecha o modal do algoritmo, se estiver aberto
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const algo = document.getElementById("anlAlgoModal");
    if (_isOpen(algo)) closeAlgoModal();
  });

  // Render inicial
  applyFilters();
}

/* Auto-init seguro */
if (!window.__ANL_AUTO_INIT__) {
  window.__ANL_AUTO_INIT__ = true;
  initScreen().catch((e) => {
    console.error("[analise] init error", e);
  });
}
