// ===== Hard error guard =====
window.addEventListener("error", (e) =>
  console.error("ATIVIDADE HARD ERROR:", e.error || e.message),
);

// ===== Firebase =====
import { db } from "../firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  deleteField,
  deleteDoc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { parseSma, getAssetType, canon, cleanTicker, normalizeSector } from "../utils/scoring.js";
import * as CapitalManager from "../utils/capitalManager.js";
import { Treemap } from "../components/treemap.js";
import { aggregatePortfolioPositions } from "../utils/portfolioPositions.js";
import { subscribeMarketData, getMarketDataSnapshot, getLastUpdatedAt } from "../utils/marketDataStore.js";
import { checkAlerts, notifyAlert } from "../utils/alerts.js";

// ===============================
// Carregar Chart.js on-demand
// ===============================
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

// ===============================
// Carregar ECharts on-demand
// ===============================
async function ensureECharts() {
  if (window.echarts) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ===============================
// Tema
// ===============================
function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}
function chartColors() {
  const dark = isDark();
  return {
    grid: dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
    ticks: dark ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.7)",
    tooltipBg: dark ? "rgba(17,17,17,.95)" : "rgba(255,255,255,.95)",
    tooltipFg: dark ? "#fff" : "#111",
  };
}
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


const CRISES_HISTORY = [
  { id: "tension_lim", name: "📉 Tensão Limitada (-3% a -8%)", drop: 5.5 },
  { id: "geo_mod", name: "📉 Crise Geopolítica Moderada (-8% a -15%)", drop: 11.5 },
  { id: "energy_shock", name: "⚡ Choque Energético (-10% a -20%)", drop: 15 },
  { id: "energy_severe", name: "🔥 Choque Energético Severo (-15% a -25%)", drop: 20 },
  { id: "likely_now", name: "⚠️ Cenário Provável Atual (-8% a -18%)", drop: 13 },
  { id: "global_recession", name: "💀 Crise Económica Global (-25% a -40%)", drop: 32.5 },
  
  { id: "gulf_war", name: "⚔️ Guerra do Golfo (1990) [-19%]", drop: 19 },
  { id: "yom_kippur", name: "⚔️ Guerra Yom Kippur (1973) [-17%]", drop: 17 },
  { id: "rus_ukraine", name: "⚔️ Invasão da Ucrânia (2022) [-24%]", drop: 24 },
  { id: "covid_crash", name: "🦠 Crash COVID-19 (2020) [-34%]", drop: 34 },
  { id: "dotcom", name: "📉 Bolha Dot-com (2000) [-50%]", drop: 50 },
  { id: "subprime", name: "📉 Crise Financeira (2008) [-56%]", drop: 56 }
];


// ===============================
// Estratégia de Portfolio (Core/Satellite)
// ===============================
const STRATEGY_CFG = {
  CORE: {
    targetTotal: 0.65,
    items: [
      { id: "STOXX", label: "STOXX Europe 600", target: 0.35, keywords: ["STOXX", "600"] },
      { id: "JAPAN", label: "MSCI Japan", target: 0.20, keywords: ["JAPAN", "JAPÃO"] },
      { id: "FINANCIALS", label: "MSCI World Financials", target: 0.10, keywords: ["FINANCIALS", "FINANCEIRAS"] },
    ]
  },
  SATELLITE: {
    targetTotal: 0.35,
    items: [
      { id: "URANIUM", label: "Uranium", target: 0.10, keywords: ["URANIUM", "URÂNIO"] },
      { id: "TECH", label: "Info Tech", target: 0.10, keywords: ["TECH", "TECNOLOGIA", "IT"] },
      { id: "RARE", label: "Rare Earth", target: 0.05, keywords: ["RARE", "TERRAS RARAS"] },
      { id: "CLEAN", label: "Clean Energy", target: 0.05, keywords: ["CLEAN", "LIMPA"] },
      { id: "OIL", label: "Oil & Gas", target: 0.05, keywords: ["OIL", "GAS", "PETRÓLEO"] },
    ]
  }
};

function getStrategicInfo(ticker, nome) {
  const t = (ticker || "").toUpperCase();
  const n = (nome || "").toUpperCase();
  for (const cat in STRATEGY_CFG) {
    for (const item of STRATEGY_CFG[cat].items) {
      if (item.keywords.some(k => t.includes(k) || n.includes(k))) {
        return { category: cat, ...item };
      }
    }
  }
  return null;
}

function getDynStrat(tk, nm) {
  const dynTickers = window._dynamicStrategyTickers || {};
  if (dynTickers[tk]) {
    if (dynTickers[tk].category === "NONE" || dynTickers[tk].category === null) return null;
    return { category: dynTickers[tk].category, target: (dynTickers[tk].target || 0) / 100 };
  }
  return getStrategicInfo(tk, nm);
}

// ===============================
// Helpers
// ===============================
function toNumStrict(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  let s = String(v).replace(/\s/g, "").replace(",", ".");
  let n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function isFiniteNum(v) {
  return typeof v === "number" && isFinite(v);
}

// ===============================
// Simulador de recuperação (Posições Fechadas)
// Dado o prejuízo realizado e um crescimento esperado (%),
// calcula quanto seria preciso investir agora (ao preço atual)
// e o TP2 (preço-alvo) correspondente para recuperar essa perda.
// ===============================
function calcRecSimHtml(precoAtual, loss, growthPct) {
  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  if (!isFiniteNum(precoAtual) || precoAtual <= 0) {
    return `<span style="color: var(--muted-foreground);">Sem preço atual disponível para simular.</span>`;
  }
  const g = Number(growthPct);
  if (!isFiniteNum(g) || g <= 0) {
    return `<span style="color: var(--muted-foreground);">Indica um crescimento (%) válido.</span>`;
  }
  const growthFrac = g / 100;
  const investimento = loss / growthFrac;
  const tp2 = precoAtual * (1 + growthFrac);
  return `💶 Investir agora: <strong>${fmtEUR.format(investimento)}</strong> &nbsp;|&nbsp; 🎯 TP2 necessário: <strong>${fmtEUR.format(tp2)}</strong>`;
}
window.calcRecSim = function (simId, precoAtual, loss) {
  const input = document.getElementById(`${simId}_g`);
  const out = document.getElementById(`${simId}_out`);
  if (out) out.innerHTML = calcRecSimHtml(precoAtual, loss, input?.value);
};
window.toggleRecSim = function (simId) {
  document.getElementById(simId)?.classList.toggle("hidden");
};
function formatNum(n) {
  return Number(n || 0).toLocaleString("pt-PT");
}

// Dividend data helpers
async function fetchDividendInfoByTickers(tickers) {
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < tickers.length; i += 10)
    chunks.push(tickers.slice(i, i + 10));
  for (const chunk of chunks) {
    const q2 = query(
      collection(db, "acoesDividendos"),
      where("ticker", "in", chunk),
    );
    const snap = await getDocs(q2);
    snap.forEach((d) => {
      const x = d.data();
      if (x.ticker) out.set(cleanTicker(x.ticker), x);
    });
  }
  return out;
}
function pickBestRate(info) {
  const m = info?.priceChange_1m ?? info?.taxaCrescimento_1mes;
  if (m !== undefined && m !== null)
    return { taxa: m, periodLabel: "mês" };
    
  const w = info?.priceChange_1w ?? info?.taxaCrescimento_1semana;
  if (w !== undefined && w !== null)
    return { taxa: w, periodLabel: "semana" };
    
  const y = info?.priceChange_1y ?? info?.taxaCrescimento_1ano;
  if (y !== undefined && y !== null)
    return { taxa: y, periodLabel: "ano" };
    
  return { taxa: null, periodLabel: null };
}
function estimateTime(currentPrice, targetPrice, growthPct, label) {
  if (growthPct === null || growthPct === undefined) return "—";
  let nVal = Number(growthPct);
  if (isNaN(nVal)) return "—";

  // Normalização similar à do scoring.js
  const r = Math.abs(nVal) > 1 ? nVal / 100 : nVal;

  if (
    r <= 0 ||
    !isFiniteNum(currentPrice) ||
    !isFiniteNum(targetPrice) ||
    currentPrice <= 0 ||
    targetPrice <= 0
  )
    return "—";
  const n = Math.log(targetPrice / currentPrice) / Math.log(1 + r);
  if (!isFinite(n) || n < 0) return "—";
  if (label === "semana") return `${n.toFixed(1)} semanas`;
  if (label === "mês") return `${n.toFixed(1)} meses`;
  return `${n.toFixed(1)} anos`;
}
const MES_IDX = {
  janeiro: 0,
  fevereiro: 1,
  março: 2,
  marco: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};
function pagamentosAno(p) {
  p = String(p || "").toLowerCase();
  if (p.startsWith("mensal")) return 12;
  if (p.startsWith("trimes")) return 4;
  if (p.startsWith("semes")) return 2;
  if (p.startsWith("anual")) return 1;
  return 0;
}
function mesesPagos(period, mesTipico) {
  const p = String(period || "").toLowerCase();
  const baseIdx =
    MES_IDX[
      String(mesTipico || "")
        .trim()
        .toLowerCase()
    ];
  if (p.startsWith("mensal")) return Array.from({ length: 12 }, (_, i) => i);
  if (p.startsWith("trimes")) {
    const s = Number.isFinite(baseIdx) ? baseIdx : 0;
    return [s, (s + 3) % 12, (s + 6) % 12, (s + 9) % 12];
  }
  if (p.startsWith("semes")) {
    const s = Number.isFinite(baseIdx) ? baseIdx : 0;
    return [s, (s + 6) % 12];
  }
  if (p.startsWith("anual")) return Number.isFinite(baseIdx) ? [baseIdx] : [];
  return [];
}

// ===============================
// Renders — gráficos (uso de Chart.js)
// ===============================
function renderSetorDoughnut(map) {
  const el = document.getElementById("chartSetores");
  if (!el) return;
  if (window.__chSetores) window.__chSetores.destroy();
  const rawLabels = [...map.keys()],
    data = [...map.values()];
  const total = data.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const labels = rawLabels.map((label, index) => {
    const pct = total > 0 ? ((Number(data[index]) || 0) / total) * 100 : 0;
    return `${label} (${pct.toFixed(1)}%)`;
  });
  if (!rawLabels.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  const sectorColors = {
    "Tecnologia": "#4F46E5",
    "Finanças": "#3B82F6",
    "Saúde": "#EF4444",
    "Energia": "#22C55E",
    "Consumo": "#F59E0B",
    "Commodities": "#d97706", // Dedicated Golden/Brown for Commodities
    "Materiais": "#84CC16",
    "Imobiliário": "#EC4899",
    "Utilities": "#06B6D4"
  };

  window.__chSetores = new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: rawLabels.map((label, i) => sectorColors[label] || PALETTE[i % PALETTE.length]),
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
            label: function(context) {
              const label = rawLabels[context.dataIndex] || context.label || "";
              const value = Number(context.parsed) || 0;
              const pct = total > 0 ? (value / total) * 100 : 0;
              const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
              return `${label}: ${fmtEUR.format(value)} (${pct.toFixed(1)}%)`;
            }
          }
        },
      },
    },
  });
}
function renderMercadoDoughnut(map) {
  const el = document.getElementById("chartMercados");
  if (!el) return;
  if (window.__chMercados) window.__chMercados.destroy();
  const labels = [...map.keys()],
    data = [...map.values()];
  if (!labels.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  window.__chMercados = new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map(
            (_, i) => PALETTE[(i + 5) % PALETTE.length],
          ),
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
        },
      },
    },
  });
}
function renderEstrategiaDoughnut(map) {
  const el = document.getElementById("chartEstrategia");
  if (!el) return;
  if (window.__chEstrategia) window.__chEstrategia.destroy();
  const labels = [...map.keys()],
    data = [...map.values()];
  if (!labels.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }

  const STRATEGY_COLORS = {
    CORE: "#3B82F6",      // Blue
    SATELLITE: "#F59E0B", // Amber
    "NÃO DEFINIDA": "#94A3B8" // Muted Slate
  };

  window.__chEstrategia = new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map(l => STRATEGY_COLORS[l.toUpperCase()] || PALETTE[0]),
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
            label: function(context) {
              const label = context.label || "";
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1) + "%";
              const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
              return `${label}: ${fmtEUR.format(value)} (${percentage})`;
            }
          }
        },
      },
    },
  });
}
function renderAtivosDoughnut(map, tickerCatMap) {
  const el = document.getElementById("chartAtivos");
  if (!el) return;
  if (window.__chAtivos) window.__chAtivos.destroy();
  const labels = [...map.keys()],
    data = [...map.values()];
  if (!labels.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }

  // Paletas por categoria estratégica
  const STRATEGY_PALETTES = {
    CORE: ["#1D4ED8", "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE"],
    SATELLITE: ["#B45309", "#D97706", "#F59E0B", "#FBBF24", "#FDE68A", "#FEF3C7"],
    "NÃO DEFINIDA": ["#334155", "#475569", "#64748B", "#94A3B8", "#CBD5E1", "#E2E8F0"]
  };

  const counters = { CORE: 0, SATELLITE: 0, "NÃO DEFINIDA": 0 };
  const backgroundColors = labels.map(ticker => {
    const cat = (tickerCatMap && tickerCatMap.get(ticker)) || "NÃO DEFINIDA";
    const palette = STRATEGY_PALETTES[cat] || STRATEGY_PALETTES["NÃO DEFINIDA"];
    const color = palette[counters[cat] % palette.length];
    counters[cat]++;
    return color;
  });

  window.__chAtivos = new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: backgroundColors,
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
            label: function(context) {
              const label = context.label || "";
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1) + "%";
              const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
              return `${label}: ${fmtEUR.format(value)} (${percentage})`;
            }
          }
        },
      },
    },
  });
}
function renderTop5Bar(arr) {
  const el = document.getElementById("chartTop5");
  if (!el) return;
  if (window.__chTop5) window.__chTop5.destroy();
  const ativos = arr
    .filter((g) => g.qtd > 0)
    .sort((a, b) => (b.investido || 0) - (a.investido || 0))
    .slice(0, 5);
  if (!ativos.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  const labels = ativos.map((a) => a.ticker),
    invest = ativos.map((a) => a.investido || 0),
    lucro = ativos.map((a) => a.lucroAtual || 0);
  window.__chTop5 = new Chart(el, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Investido (€)", data: invest, backgroundColor: "#3B82F6" },
        { label: "Lucro Atual (€)", data: lucro, backgroundColor: "#22C55E" },
      ],
    },
    options: {
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
      plugins: { legend: { labels: { color: chartColors().ticks } } },
    },
  });
}
function renderTop5YieldBar(rows) {
  const el = document.getElementById("chartTop5Yield");
  if (!el) return;
  if (window.__chTop5Yield) window.__chTop5Yield.destroy();
  const ativos = rows
    .filter((r) => r.active && isFiniteNum(r.yieldCur))
    .sort((a, b) => b.yieldCur - a.yieldCur)
    .slice(0, 5);
  if (!ativos.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  const labels = ativos.map((a) => a.ticker),
    ys = ativos.map((a) => Number(a.yieldCur * 100).toFixed(2));
  window.__chTop5Yield = new Chart(el, {
    type: "bar",
    data: { labels, datasets: [{ label: "Yield (%)", data: ys }] },
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
      plugins: { legend: { labels: { color: chartColors().ticks } } },
    },
  });
}
function renderTimeline(points) {
  const el = document.getElementById("chartTimeline");
  if (!el) return;
  if (window.__chTimeline) window.__chTimeline.destroy();
  if (!points.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  const labels = points.map((p) => p.label),
    invested = points.map((p) => p.cumInvest),
    valueNow = points.map((p) => p.valueNow);
  window.__chTimeline = new Chart(el, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Investido acumulado (€)",
          data: invested,
          tension: 0.25,
          borderWidth: 2,
        },
        {
          label: "Avaliação atual (€)",
          data: valueNow,
          tension: 0.25,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      elements: { point: { radius: 0 } },
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
      plugins: { legend: { labels: { color: chartColors().ticks } } },
    },
  });
}
function renderDividendoCalendario12m(arr) {
  const el = document.getElementById("chartDivCalendario");
  if (!el) return;
  if (window.__chDivCal) window.__chDivCal.destroy();
  const labels = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ];
  window.__chDivCal = new Chart(el, {
    type: "bar",
    data: { labels, datasets: [{ label: "€ / mês (estimado)", data: arr }] },
    options: {
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
      plugins: { legend: { labels: { color: chartColors().ticks } } },
    },
  });
}

/**
 * XIRR — taxa interna de retorno anualizada com datas irregulares.
 * cashflows: [{amount: Number, date: Date}]
 * amount negativo = saída de capital; positivo = entrada (inclui valor atual da carteira no final).
 * Devolve a taxa como decimal (0.12 = 12%) ou null se não convergir.
 */
function computeXIRR(cashflows) {
  if (!cashflows || cashflows.length < 2) return null;
  const sorted = [...cashflows].sort((a, b) => a.date - b.date);
  const t0 = sorted[0].date;
  const years = sorted.map(c => (c.date - t0) / 31557600000);

  const npv = r => sorted.reduce((s, c, i) => s + c.amount / Math.pow(1 + r, years[i]), 0);
  const dnpv = r => sorted.reduce((s, c, i) => s - years[i] * c.amount / Math.pow(1 + r, years[i] + 1), 0);

  let r = 0.1;
  for (let i = 0; i < 200; i++) {
    const f = npv(r);
    const df = dnpv(r);
    if (!isFinite(f) || !isFinite(df) || Math.abs(df) < 1e-12) break;
    const nr = r - f / df;
    if (nr <= -1) break;
    if (Math.abs(nr - r) < 1e-8) { r = nr; break; }
    r = nr;
  }
  return isFinite(r) && r > -1 && r < 100 ? r : null;
}

function renderBubbleChart(abertos, totalInvestido) {
  const el = document.getElementById("chartBubble");
  if (!el) return;
  if (window.__chBubble) window.__chBubble.destroy();

  const stateColorMap = {
    "REFORÇAR":    "#ef4444",
    "COMPRAR":     "#22c55e",
    "MANTER":      "#3b82f6",
    "MONITORIZAR": "#3b82f6",
    "REDUZIR":     "#f59e0b",
    "VENDER":      "#ef4444",
    "ESPERAR":     "#64748b",
  };

  const MIN_R = 6, MAX_R = 28;
  const maxWeight = totalInvestido > 0
    ? Math.max(...abertos.map(g => (g.investido || 0) / totalInvestido))
    : 1;

  const points = abertos
    .filter(g => g.qtd > 0 && Number.isFinite(g._pLossPct))
    .map(g => {
      const w = totalInvestido > 0 ? (g.investido || 0) / totalInvestido : 0;
      const r = MIN_R + (MAX_R - MIN_R) * Math.sqrt(w / (maxWeight || 1));
      const sma200 = g._sma200;
      const pa = g.precoAtual;
      const yVal = (isFiniteNum(sma200) && isFiniteNum(pa) && sma200 > 0)
        ? ((pa - sma200) / sma200) * 100
        : 0;
      return {
        x: +(g._pLossPct || 0).toFixed(2),
        y: +yVal.toFixed(2),
        r: +r.toFixed(1),
        ticker: g.ticker,
        estado: g._estadoOp || "ESPERAR",
        peso: +(w * 100).toFixed(1),
        lucro: g.lucroAtual || 0,
        color: stateColorMap[g._estadoOp] || "#64748b",
      };
    });

  if (!points.length) return;

  const grouped = {};
  points.forEach(p => {
    const k = p.estado;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(p);
  });

  const datasets = Object.entries(grouped).map(([estado, pts]) => ({
    label: estado,
    data: pts.map(p => ({ x: p.x, y: p.y, r: p.r, ticker: p.ticker, peso: p.peso, lucro: p.lucro })),
    backgroundColor: (stateColorMap[estado] || "#64748b") + "99",
    borderColor: stateColorMap[estado] || "#64748b",
    borderWidth: 1.5,
  }));

  const cc = chartColors();
  window.__chBubble = new Chart(el, {
    type: "bubble",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: "P&L %", color: cc.ticks, font: { size: 11 } },
          ticks: { color: cc.ticks, callback: v => v + "%" },
          grid: { color: cc.grid },
          border: { dash: [4, 4] },
        },
        y: {
          title: { display: true, text: "Δ SMA200 %", color: cc.ticks, font: { size: 11 } },
          ticks: { color: cc.ticks, callback: v => v + "%" },
          grid: { color: cc.grid },
          border: { dash: [4, 4] },
        },
      },
      plugins: {
        legend: { position: "top", labels: { color: cc.ticks, boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          backgroundColor: cc.tooltipBg,
          titleColor: cc.tooltipFg,
          bodyColor: cc.tooltipFg,
          callbacks: {
            title: ctx => ctx[0]?.raw?.ticker || "",
            label: ctx => {
              const d = ctx.raw;
              const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
              return [
                ` P&L: ${ctx.parsed.x.toFixed(2)}%  |  Δ SMA200: ${ctx.parsed.y.toFixed(2)}%`,
                ` Peso: ${d.peso}%  |  Lucro: ${fmtEUR.format(d.lucro)}`,
              ];
            },
          },
        },
      },
    },
  });
}

// (NOVO) estado global para evitar duplicar listeners
let byTickerGlobal = new Map();
let _allMovimentos = [];
let _eventsWired = false;

function updatePriceFreshness() {
  const el = document.getElementById("priceUpdateIndicator");
  if (!el) return;
  const lastUpdate = getLastUpdatedAt();
  if (!lastUpdate) {
    el.innerHTML = `<i class="fas fa-circle" style="font-size:0.45rem;color:#94a3b8;"></i> Sem dados`;
    return;
  }
  const diffMs = Date.now() - lastUpdate;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  let text, color;
  if (diffMin < 2)        { text = "Preços: agora";         color = "#22c55e"; }
  else if (diffMin < 60)  { text = `Preços: há ${diffMin}min`; color = "#22c55e"; }
  else if (diffH < 6)     { text = `Preços: há ${diffH}h`;  color = "#f59e0b"; }
  else if (diffH < 24)    { text = `Preços: há ${diffH}h`;  color = "#ef4444"; }
  else {
    text = `Preços: ${lastUpdate.toLocaleDateString("pt-PT")}`;
    color = "#ef4444";
  }
  el.innerHTML = `<i class="fas fa-circle" style="font-size:0.45rem;color:${color};"></i> ${text}`;
  el.title = `Última atualização: ${lastUpdate.toLocaleString("pt-PT")}`;
}

// Expor globalmente para onclick no HTML
window.openDetails = async function(ticker) {
  // Prefer the new unified Asset Deep Panel if available
  if (typeof window.openAssetPanel === "function") {
    window.openAssetPanel(ticker);
    return;
  }
  const g = byTickerGlobal.get(ticker);
  if (!g) return;

  const $ = (s) => document.querySelector(s);
  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

  // Reset modal elements that may have been hidden by a previous closed-position view
  const _bBuy = $("#detBtnBuy");
  const _bSell = $("#detBtnSell");
  if (_bBuy) _bBuy.style.display = "";
  if (_bSell) _bSell.style.display = "";
  const _bgBadge = document.getElementById("detEsforcoBadge");
  if (_bgBadge) _bgBadge.style.display = "";

  // ---- POSIÇÃO FECHADA ----
  if ((g.qtd || 0) <= 0) {
    const realizado = g.realizado || 0;
    const totalComprado = g.totalBuyValue || 0;
    const retPct = totalComprado > 0 ? (realizado / totalComprado) * 100 : 0;
    const cmHist = g.custoMedioHistorico || 0;
    const precoAtualFech = g.precoAtual || 0;

    const detBadge = document.getElementById("detEstadoBadge");
    if (detBadge) {
      detBadge.textContent = "FECHADA";
      detBadge.style.background = "rgba(100,116,139,0.15)";
      detBadge.style.color = "#64748b";
      detBadge.style.borderColor = "rgba(100,116,139,0.3)";
    }

    $(`#detTickerTitle`).textContent = `${g.ticker} — ${g.nome}`;
    $(`#detPrecoAtualHeader`).textContent = precoAtualFech > 0 ? fmtEUR.format(precoAtualFech) : "—";

    const elLH = $(`#detLucroAtualHeader`);
    if (elLH) {
      elLH.textContent = `${realizado >= 0 ? "+" : ""}${fmtEUR.format(realizado)} (${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%) Realizado`;
      elLH.className = realizado >= 0 ? "up" : "down";
    }
    $(`#detQtdHeader`).textContent = "Fechada";
    $(`#detPMHeader`).textContent = cmHist > 0 ? fmtEUR.format(cmHist) : "—";
    const capEl2 = $(`#detCapitalHeader`);
    if (capEl2) capEl2.textContent = totalComprado > 0 ? fmtEUR.format(totalComprado) : "—";

    const decDiv2 = $(`#detDecisaoSistema`);
    if (decDiv2) { decDiv2.style.borderColor = "#64748b"; decDiv2.style.background = "rgba(100,116,139,0.05)"; }
    const decTextoEl2 = $(`#detDecisaoTexto`);
    if (decTextoEl2) { decTextoEl2.textContent = "🗂️ POSIÇÃO FECHADA"; decTextoEl2.style.color = "#64748b"; }
    const decSubEl2 = $(`#detDecisaoSub`);
    if (decSubEl2) decSubEl2.innerHTML = `
      <div style="margin-top:6px; line-height:1.6;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.82rem;">
          <div><span style="color:var(--muted-foreground)">P&L Realizado:</span><br>
            <strong style="color:${realizado>=0?'#22c55e':'#ef4444'}">${realizado>=0?"+":""}${fmtEUR.format(realizado)}</strong></div>
          <div><span style="color:var(--muted-foreground)">Retorno Total:</span><br>
            <strong style="color:${retPct>=0?'#22c55e':'#ef4444'}">${retPct>=0?"+":""}${retPct.toFixed(2)}%</strong></div>
          <div><span style="color:var(--muted-foreground)">Capital Investido:</span><br>
            <strong>${totalComprado>0?fmtEUR.format(totalComprado):"—"}</strong></div>
          <div><span style="color:var(--muted-foreground)">PM Histórico:</span><br>
            <strong>${cmHist>0?fmtEUR.format(cmHist):"—"}</strong></div>
        </div>
      </div>`;

    if (_bgBadge) _bgBadge.style.display = "none";
    if (_bBuy)  _bBuy.style.display  = "none";
    if (_bSell) _bSell.style.display = "none";

    $(`#detKpiCapital`).textContent = totalComprado > 0 ? fmtEUR.format(totalComprado) : "—";
    $(`#detKpiUpside`).textContent  = "—";
    $(`#detKpiTP`).textContent      = "—";
    $(`#detKpiSMA200`).textContent  = "—";
    if ($("#detYield"))  $("#detYield").textContent  = "—";
    if ($("#detPE"))     $("#detPE").textContent     = "—";
    if ($("#detRR"))     $("#detRR").textContent     = "—";
    if ($("#detSMA50"))  $("#detSMA50").textContent  = "—";
    if ($("#detSMA200")) $("#detSMA200").textContent = "—";

    if ($(`#detPlanSaida`))  $(`#detPlanSaida`).innerHTML  = "";
    if ($(`#detBarStop`))    $(`#detBarStop`).textContent  = "—";
    if ($(`#detBarPreco`))   $(`#detBarPreco`).textContent = precoAtualFech > 0 ? fmtEUR.format(precoAtualFech) : "—";
    if ($(`#detBarAlvo`))    $(`#detBarAlvo`).textContent  = "—";
    const elChest2 = $("#detWarChestTable");
    if (elChest2) elChest2.innerHTML = "";
    const recBloco2 = $("#detRecuperacaoBloco");
    if (recBloco2) recBloco2.style.display = "none";
    const detStratDiv2 = document.getElementById("detStrategyDiv");
    if (detStratDiv2) detStratDiv2.innerHTML = "";
    const detCrisisDiv2 = document.getElementById("detCrisisSim");
    if (detCrisisDiv2) detCrisisDiv2.innerHTML = "";
    const elRef2 = $("#detNiveisReforco");
    if (elRef2) elRef2.innerHTML = "";
    const elBlocoPM2 = $("#detBlocoReforcoPM");
    if (elBlocoPM2) elBlocoPM2.style.display = "none";
    const elCen2 = $("#detCenariosNovos");
    if (elCen2) elCen2.innerHTML = "";

    const bEdit2 = $("#detBtnEdit");
    const bLink2 = $("#detBtnLink");
    if (bEdit2) bEdit2.onclick = () => {
      document.getElementById("activityDetailModal")?.classList.add("hidden");
      const profModal = document.getElementById("assetProfileModal");
      if (profModal) {
        document.getElementById("profTicker").value = g.ticker;
        document.getElementById("profNome").value = g.nome || "";
        document.getElementById("profSetor").value = g.setor === "—" ? "" : g.setor;
        document.getElementById("profMercado").value = g.mercado === "—" ? "" : g.mercado;
        document.getElementById("profObjetivo").value = g.objetivo || "";
        document.getElementById("profLink").value = g.link || "";
        profModal.classList.remove("hidden");
      }
    };
    if (bLink2) {
      bLink2.onclick = () => { if (g.link) window.open(g.link, "_blank"); };
      bLink2.className = `btn ghost ${g.link ? "" : "muted"}`;
    }

    renderMovementHistory(ticker);
    document.getElementById("activityDetailModal")?.classList.remove("hidden");
    return;
  }
  // ---- FIM POSIÇÃO FECHADA ----

  // VARIAVEIS BASE
  const precoAtual = g.precoAtual || 0;
  const precoMedio = g.qtd > 0 ? (g.investido || 0) / g.qtd : 0;
  const lucroAtual = g.lucroAtual || 0;
  const estadoOp   = g._estadoOp || "ESPERAR";
  const s200       = g._sma200;

  const tpObjetivo = g.qtd > 0 ? ((g.investido || 0) + (g.objetivo || 0)) / g.qtd : 0;
  const faltaMeta  = (g.objetivo || 0) - lucroAtual;
  const upsideP    = precoAtual > 0 ? ((tpObjetivo / precoAtual) - 1) * 100 : 0;
  const percL      = (g.investido || 0) > 0 ? (lucroAtual / (g.investido || 0)) * 100 : 0;

  const warChestRaw = document.getElementById("prtWarChest")?.textContent || "";
  const warChestTotal = parseFloat(warChestRaw.replace(/[^\d,.]/g, "").replace(",", ".")) || 0;

  const s50 = g._sma50;
  const isGoldenCross = s50 && s200 && s50 > s200;
  const isDeathCross = s50 && s200 && s50 < s200;
  const trendSignal = isGoldenCross ? "GOLDEN CROSS 🚀" : (isDeathCross ? "DEATH CROSS ⚠️" : "SEM TENDÊNCIA CLARA");
  const trendColor = isGoldenCross ? "#22c55e" : (isDeathCross ? "#ef4444" : "var(--muted-foreground)");

  let esforcoStr = "Muito próximo", esforcoColor = "#22c55e";
  if (upsideP > 12)     { esforcoStr = "Agressivo"; esforcoColor = "#ef4444"; }
  else if (upsideP > 7) { esforcoStr = "Exigente";  esforcoColor = "#f59e0b"; }
  else if (upsideP > 3) { esforcoStr = "Plausível"; esforcoColor = "#3b82f6"; }
  if (upsideP <= 0 && g.qtd > 0) { esforcoStr = "Atingido"; esforcoColor = "#22c55e"; }

  let decisaoEmoji = "🟢", decisaoTexto = "GUARDAR / MANTER", decisaoSub = "";
  let decisaoBorder = "#22c55e", decisaoBg = "rgba(34,197,94,0.07)";

  const capReforco = warChestTotal > 0 ? warChestTotal * 0.2 : 250; 
  const unitsReforco = capReforco / (precoAtual || 1);
  const tp1Price = precoMedio * 1.05;
  const unitsVenda = g.qtd * 0.2;
  const valorVenda = unitsVenda * tp1Price;

  const objetivoFin = g.objetivo || 0;
  const lucroProgress = objetivoFin > 0 ? (lucroAtual / objetivoFin) * 100 : 0;
  const safeProgress = Math.min(100, Math.max(0, lucroProgress));
  const isGoalMet = lucroAtual >= objetivoFin && objetivoFin > 0;
  const progressColor = isGoalMet ? "#22c55e" : (lucroAtual > 0 ? "#3b82f6" : "#ef4444");

  const progressBarHTML = objetivoFin > 0 ? `
    <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; font-size: 0.7rem; margin-bottom: 4px;">
        <span style="color: var(--muted-foreground)">Progresso do Objetivo: <strong>${lucroProgress.toFixed(1)}%</strong></span>
        <span style="color: ${progressColor}; font-weight: 800;">${isGoalMet ? "CONCLUÍDO" : ""}</span>
      </div>
      <div style="height: 6px; background: rgba(0,0,0,0.1); border-radius: 3px; overflow: hidden;">
        <div style="width: ${safeProgress}%; height: 100%; background: ${progressColor}; transition: width 0.8s ease;"></div>
      </div>
    </div>
  ` : "";

  if (isGoalMet) {
    decisaoEmoji = "🏆"; decisaoTexto = "OBJETIVO ATINGIDO";
    decisaoBorder = "#22c55e"; decisaoBg = "rgba(34,197,94,0.07)";
    decisaoSub = `<div style="margin-top:4px; line-height:1.4;">
      <span style="color:#22c55e;">🌟 <strong>Parabéns!</strong> O lucro alvo foi atingido.</span><br>
      <span style="opacity:0.8;">Pode considerar <strong>Vender a posição</strong> para realizar lucros ou manter para ganhos adicionais.</span>
      ${progressBarHTML}
    </div>`;
  } else if (estadoOp === "REFORÇAR" || estadoOp === "COMPRAR") {
    decisaoEmoji = "🔵"; decisaoTexto = "COMPRAR MAIS";
    decisaoBorder = "#3b82f6"; decisaoBg = "rgba(59,130,246,0.07)";
    decisaoSub = `<div style="margin-top:4px; line-height:1.4;">
      <span style="color:#3b82f6;">✅ <strong>Comprar ${fmtEUR.format(capReforco)} (~${unitsReforco.toFixed(2)} un.)</strong> agora.</span><br>
      <span style="opacity:0.8;">Preço atrativo para aumentar a posição.</span>
      ${progressBarHTML}
    </div>`;
  } else if (upsideP > 12) {
    decisaoEmoji = "🔴"; decisaoTexto = "VENDER FORTE";
    decisaoBorder = "#ef4444"; decisaoBg = "rgba(239,68,68,0.07)";
    decisaoSub = `<div style="margin-top:4px; line-height:1.4;">
      <span style="color:#ef4444;">🚨 <strong>Venda forte:</strong> Libertar 50% (${fmtEUR.format(g.investido * 0.5)}) aos <strong>${fmtEUR.format(precoMedio * 1.15)}</strong>.</span><br>
      <span style="opacity:0.8;">Risco de correção elevado.</span>
      ${progressBarHTML}
    </div>`;
  } else if (upsideP > 7 || estadoOp === "REDUZIR" || estadoOp === "VENDER") {
    decisaoEmoji = "🟡"; decisaoTexto = "VENDER UM POUCO";
    decisaoBorder = "#f59e0b"; decisaoBg = "rgba(245,158,11,0.07)";
    decisaoSub = `<div style="margin-top:4px; line-height:1.4;">
      <span style="color:#f59e0b;">💰 <strong>Vender ${fmtEUR.format(valorVenda)} (~${unitsVenda.toFixed(2)} un.)</strong> nos <strong>${fmtEUR.format(tp1Price)}</strong>.</span><br>
      <span style="opacity:0.8;">Garantir lucros parciais.</span>
      ${progressBarHTML}
    </div>`;
  } else {
    decisaoSub = `<div style="margin-top:4px; line-height:1.4;">
      <span>💎 <strong>Guardar e manter.</strong> Potencial de crescimento saudável.</span><br>
      <span style="opacity:0.8;">Próxima compra recomendada aos <strong>${fmtEUR.format(precoAtual * 0.98)}</strong>.</span>
      ${progressBarHTML}
    </div>`;
  }

  // TÉCNICA
  const formatSmaDelta = (sma, cur) => {
    if (!Number.isFinite(sma) || !Number.isFinite(cur) || sma <= 0) return "—";
    const d = ((cur - sma) / sma) * 100;
    return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
  };

  decisaoSub += `
    <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(0,0,0,0.1); font-size: 0.72rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="color: var(--muted-foreground)">Sinal de Tendência:</span>
        <span style="padding: 2px 8px; border-radius: 4px; background: ${trendColor}15; color: ${trendColor}; font-weight: 800; font-size: 0.65rem; border: 1px solid ${trendColor}30;">
          ${trendSignal}
        </span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div style="background: rgba(0,0,0,0.02); padding: 6px; border-radius: 6px; border: 1px solid var(--border);">
          <div style="color: var(--muted-foreground); font-size: 0.6rem; text-transform: uppercase;">Média 50d (Dist.)</div>
          <div style="font-weight: 700; color: ${precoAtual > s50 ? "#22c55e" : "#ef4444"}">${formatSmaDelta(s50, precoAtual)}</div>
        </div>
        <div style="background: rgba(0,0,0,0.02); padding: 6px; border-radius: 6px; border: 1px solid var(--border);">
          <div style="color: var(--muted-foreground); font-size: 0.6rem; text-transform: uppercase;">Média 200d (Dist.)</div>
          <div style="font-weight: 700; color: ${precoAtual > s200 ? "#22c55e" : "#ef4444"}">${formatSmaDelta(s200, precoAtual)}</div>
        </div>
      </div>
    </div>
  `;

  let stateColor = "#64748b";
  if (estadoOp === "REFORÇAR") stateColor = "#ef4444";
  if (estadoOp === "COMPRAR")  stateColor = "#22c55e";
  if (estadoOp === "REDUZIR")  stateColor = "#f59e0b";
  if (estadoOp === "VENDER")   stateColor = "#ef4444";
  if (estadoOp === "MONITORIZAR" || estadoOp === "MANTER") stateColor = "#3b82f6";

  const detBadge = document.getElementById("detEstadoBadge");
  if (detBadge) {
    detBadge.textContent = estadoOp;
    detBadge.style.background = `${stateColor}18`;
    detBadge.style.color = stateColor;
    detBadge.style.borderColor = `${stateColor}35`;
  }

  $(`#detTickerTitle`).textContent = `${g.ticker} — ${g.nome}`;
  $(`#detPrecoAtualHeader`).textContent = fmtEUR.format(precoAtual);
  const elLucroHeader = $(`#detLucroAtualHeader`);
  elLucroHeader.textContent = `${fmtEUR.format(lucroAtual)} (${percL > 0 ? "+" : ""}${percL.toFixed(2)}%)`;
  elLucroHeader.className = lucroAtual >= 0 ? "up" : "down";
  $(`#detQtdHeader`).textContent = g.qtd.toFixed(4).replace(/\.?0+$/, "");
  $(`#detPMHeader`).textContent = fmtEUR.format(precoMedio);
  const capEl = $(`#detCapitalHeader`);
  if (capEl) capEl.textContent = fmtEUR.format(g.investido || 0);

  const decDiv = $(`#detDecisaoSistema`);
  if (decDiv) { decDiv.style.borderColor = decisaoBorder; decDiv.style.background = decisaoBg; }
  const decTextoEl = $(`#detDecisaoTexto`);
  if (decTextoEl) { decTextoEl.textContent = `${decisaoEmoji} ${decisaoTexto}`; decTextoEl.style.color = decisaoBorder; }
  const decSubEl = $(`#detDecisaoSub`);
  if (decSubEl) decSubEl.innerHTML = decisaoSub;

  const bgBadge = document.getElementById("detEsforcoBadge");
  if (bgBadge) {
    bgBadge.textContent = esforcoStr;
    bgBadge.style.color = esforcoColor;
    bgBadge.style.borderColor = esforcoColor;
    bgBadge.style.backgroundColor = `${esforcoColor}15`;
  }

  const stopTec = s200 ? s200 * 0.95 : precoMedio * 0.9;

  // MÉTRICAS SECUNDÁRIAS (Task 1)
  const yPct = isFiniteNum(g._yCur) ? (g._yCur * 100).toFixed(2) + "%" : "—";
  if ($("#detYield")) $("#detYield").textContent = yPct;
  if ($("#detPE")) $("#detPE").textContent = isFiniteNum(g._pe) ? g._pe.toFixed(1) : "—";
  
  const risk = precoAtual - stopTec;
  const reward = tpObjetivo - precoAtual;
  if ($("#detRR")) $("#detRR").textContent = (risk > 0 && reward > 0) ? `1:${(reward / risk).toFixed(1)}` : "—";
  if ($("#detSMA50")) $("#detSMA50").textContent = formatSmaDelta(g._sma50, precoAtual);
  if ($("#detSMA200")) $("#detSMA200").textContent = formatSmaDelta(s200, precoAtual);

  // 🎯 Estratégia do Ativo (As textboxes que desapareceram)
  const detStratDiv = document.getElementById("detStrategyDiv");
  if (detStratDiv) {
    const sInfo = getDynStrat(g.ticker, g.nome);
    const cat = sInfo ? sInfo.category : "NONE";
    const tgt = sInfo ? (sInfo.target * 100) : 0;

    detStratDiv.innerHTML = `
      <div style="background: rgba(var(--primary-rgb), 0.05); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-top: 10px;">
        <div style="font-size: 0.75rem; font-weight: 700; color: var(--primary); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
          <i class="fas fa-bullseye"></i> DEFINIÇÃO ESTRATÉGICA
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div>
            <label style="display: block; font-size: 0.65rem; color: var(--muted-foreground); margin-bottom: 4px;">CATEGORIA</label>
            <select id="detInpStratCat" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--input); font-size: 0.8rem; color: var(--foreground);">
              <option value="NONE" ${cat === "NONE" ? "selected" : ""}>Nenhuma</option>
              <option value="CORE" ${cat === "CORE" ? "selected" : ""}>Core</option>
              <option value="SATELLITE" ${cat === "SATELLITE" ? "selected" : ""}>Satélite</option>
            </select>
          </div>
          <div>
            <label style="display: block; font-size: 0.65rem; color: var(--muted-foreground); margin-bottom: 4px;">ALVO (%)</label>
            <input type="number" id="detInpStratTarget" value="${tgt}" step="0.1" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border); background: var(--input); font-size: 0.8rem; color: var(--foreground);">
          </div>
        </div>
        <button id="detBtnSaveStrat" class="btn premium" style="width: 100%; margin-top: 10px; font-size: 0.75rem; padding: 6px;">
          <i class="fas fa-save"></i> Guardar Definição
        </button>
      </div>
    `;

    document.getElementById("detBtnSaveStrat").onclick = async () => {
      const newCat = document.getElementById("detInpStratCat").value;
      const newTgt = parseFloat(document.getElementById("detInpStratTarget").value) || 0;
      await window.saveAssetStrategy?.(g.ticker, newCat, newTgt);
    };
  }

  // 🛡️ Simulação de Crises
  const detCrisisDiv = document.getElementById("detCrisisSim");
  if (detCrisisDiv) {
    let crisisHTML = `
      <div style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px;">
        <div style="font-size: 0.8rem; font-weight: 700; color: var(--muted-foreground); margin-bottom: 10px;">Simulação de Crises (Histórico)</div>
        <div style="display: grid; gap: 8px;">
    `;
    
    CRISES_HISTORY.slice(0, 6).forEach(c => {
      const dropPrice = precoAtual * (1 - c.drop / 100);
      crisisHTML += `
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; padding: 6px 0; border-bottom: 1px dashed var(--border);">
          <span style="color: var(--muted-foreground);">${c.name}</span>
          <strong style="color: #ef4444;">${fmtEUR.format(dropPrice)}</strong>
        </div>
      `;
    });
    
    crisisHTML += `</div></div>`;
    detCrisisDiv.innerHTML = crisisHTML;
  }

  $(`#detKpiCapital`).textContent = fmtEUR.format(g.investido || 0);
  $(`#detKpiUpside`).textContent = upsideP > 0 ? `+${upsideP.toFixed(1)}%` : `${upsideP.toFixed(1)}%`;
  $(`#detKpiTP`).textContent = tpObjetivo > 0 ? fmtEUR.format(tpObjetivo) : "—";
  $(`#detKpiSMA200`).textContent = formatSmaDelta(s200, precoAtual);

  const tpLevels = [
    { label: "TP1", pct: 5,  acao: "Reduzir leve",  posicao: "20%", color: "#22c55e" },
    { label: "TP2", pct: 10, acao: "Reduzir médio", posicao: "30%", color: "#f59e0b" },
    { label: "TP3", pct: 15, acao: "Reduzir forte", posicao: "50%", color: "#ef4444" },
  ];
  let saidaHTML = "";
  tpLevels.forEach(tp => {
    const pr = precoMedio * (1 + tp.pct / 100);
    saidaHTML += `<div style="display:grid;grid-template-columns:1fr 1.2fr 1.2fr 1fr;padding:10px 12px;font-size:0.8rem;border-bottom:1px solid var(--border);align-items:center;">` +
      `<div style="font-weight:800;color:${tp.color};">${tp.label} (+${tp.pct}%)</div>` +
      `<div style="font-family:monospace;">${fmtEUR.format(pr)}</div>` +
      `<div style="font-weight:700;color:${tp.color};font-size:0.75rem;text-transform:uppercase;">${tp.acao}</div>` +
      `<div style="text-align:right;font-weight:700;font-size:0.75rem;">${tp.posicao}</div></div>`;
  });
  $(`#detPlanSaida`).innerHTML = saidaHTML;

  $(`#detBarStop`).textContent  = fmtEUR.format(stopTec);
  $(`#detBarPreco`).textContent = fmtEUR.format(precoAtual);
  $(`#detBarAlvo`).textContent  = fmtEUR.format(tpObjetivo);

  const bBuy = $("#detBtnBuy");
  const bSell = $("#detBtnSell");
  const bEdit = $("#detBtnEdit");
  const bLink = $("#detBtnLink");
  const detModalEl = $("#activityDetailModal");

  if (bBuy)  bBuy.onclick  = () => { detModalEl.classList.add("hidden"); window.openActionModal?.("compra", g.ticker); };
  if (bSell) bSell.onclick = () => { detModalEl.classList.add("hidden"); window.openActionModal?.("venda", g.ticker); };
  if (bEdit) bEdit.onclick = () => { 
    detModalEl.classList.add("hidden"); 
    const profModal = document.getElementById("assetProfileModal");
    if (profModal) {
      document.getElementById("profTicker").value = g.ticker;
      document.getElementById("profNome").value = g.nome || "";
      document.getElementById("profSetor").value = g.setor === "—" ? "" : g.setor;
      document.getElementById("profMercado").value = g.mercado === "—" ? "" : g.mercado;
      document.getElementById("profObjetivo").value = g.objetivo || "";
      document.getElementById("profLink").value = g.link || "";
      profModal.classList.remove("hidden");
    }
  };
  if (bLink) {
    bLink.onclick = () => { if (g.link) window.open(g.link, "_blank"); else { bEdit.click(); } };
    bLink.className = `btn ghost ${g.link ? "" : "muted"}`;
  }

  // 📈 Estratégia de Compra (Se cair)
  const reforcos = [
    { label: "-5%",  pct: 0.95, acao: "Reforço Leve",  montante: 75 },
    { label: "-10%", pct: 0.90, acao: "Reforço Médio", montante: 150 },
    { label: "-20%", pct: 0.80, acao: "REFORÇO FORTE", montante: 250 },
  ];
  let refHTML = "";
  reforcos.forEach(r => {
    const pr = precoAtual * r.pct;
    const units = r.montante / (pr || 1);
    refHTML += `<div style="display:grid;grid-template-columns:1fr 1.5fr 1.5fr;padding:10px 12px;font-size:0.8rem;border-bottom:1px solid var(--border);align-items:center;">` +
      `<div style="font-weight:800;color:#ef4444;">${r.label}</div>` +
      `<div style="font-family:monospace;">${fmtEUR.format(pr)}<span style="display:block;font-size:0.65rem;color:var(--muted-foreground);">${fmtEUR.format(r.montante)} = ~${units.toFixed(2)} un.</span></div>` +
      `<div style="font-weight:700;color:var(--muted-foreground);font-size:0.75rem;text-transform:uppercase;">${r.acao}</div></div>`;
  });
  const elRef = $("#detNiveisReforco");
  if (elRef) elRef.innerHTML = refHTML;

  // 📉 Reforço Estratégico (vs PM)
  const elBlocoPM = $("#detBlocoReforcoPM");
  if (elBlocoPM) {
    if (precoMedio > 0) {
      elBlocoPM.style.display = "block";
      const reforcosPM = [
        { label: "no PM",   pct: 1.00, acao: "Manter PM",    montante: 100 },
        { label: "-5% PM",  pct: 0.95, acao: "Baixar PM",    montante: 150 },
        { label: "-10% PM", pct: 0.90, acao: "Reforço Forte", montante: 250 },
      ];
      let refPMHTML = "";
      reforcosPM.forEach(r => {
        const pr = precoMedio * r.pct;
        const units = r.montante / (pr || 1);
        refPMHTML += `<div style="display:grid;grid-template-columns:1fr 1.5fr 1.5fr;padding:10px 12px;font-size:0.8rem;border-bottom:1px solid var(--border);align-items:center;">` +
          `<div style="font-weight:800;color:#f59e0b;">${r.label}</div>` +
          `<div style="font-family:monospace;">${fmtEUR.format(pr)}<span style="display:block;font-size:0.65rem;color:var(--muted-foreground);">${fmtEUR.format(r.montante)} = ~${units.toFixed(2)} un.</span></div>` +
          `<div style="font-weight:700;color:var(--muted-foreground);font-size:0.75rem;text-transform:uppercase;">${r.acao}</div></div>`;
      });
      const elRefPM = $("#detNiveisReforcoPM");
      if (elRefPM) elRefPM.innerHTML = refPMHTML;
    } else {
      elBlocoPM.style.display = "none";
    }
  }

  // 🔄 Simular Nova Compra
  const cenarios = [
    { label: "Investir 75€ agora", valor: 75 },
    { label: "Investir 150€ agora", valor: 150 },
    { label: "Investir 250€ agora", valor: 250 },
  ];
  let cenHTML = "";
  cenarios.forEach(c => {
    const buyUnits = c.valor / (precoAtual || 1);
    const newQ = g.qtd + buyUnits;
    const newPM = (g.investido + c.valor) / newQ;
    cenHTML += `<div style="background:rgba(0,0,0,0.02); padding:10px; border-radius:8px; border:1px solid var(--border); font-size:0.8rem;">` +
      `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>${c.label} (~${buyUnits.toFixed(2)} un.)</span> <strong>${fmtEUR.format(c.valor)}</strong></div>` +
      `<div style="display:flex; justify-content:space-between; color:var(--muted-foreground); font-size:0.75rem;"><span>Novo Preço Médio:</span> <strong style="color:#22c55e;">${fmtEUR.format(newPM)}</strong></div>` +
      `</div>`;
  });
  const elCen = $("#detCenariosNovos");
  if (elCen) elCen.innerHTML = cenHTML;

  // 💰 Reserva p/ Oportunidades (War Chest)
  const gapW = g._strategicNeed || 0;
  const statusW = gapW > 0 ? "REFORÇAR" : "EQUILIBRADO";
  const colorW = gapW > 0 ? "#ef4444" : "#22c55e";
  const gapUnits = gapW / (precoAtual || 1);
  const elChest = $("#detWarChestTable");
  if (elChest) {
    elChest.innerHTML = `
      <div style="padding:12px; font-size:0.85rem;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="color:var(--muted-foreground)">Diferença para Alvo:</span>
          <div>
            <strong style="color:${colorW};">${gapW > 0 ? "+" : ""}${fmtEUR.format(gapW)}</strong>
            <span style="display:block;font-size:0.65rem;color:var(--muted-foreground);text-align:right;">~${gapUnits.toFixed(2)} un.</span>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--muted-foreground)">Estado Estratégico:</span>
          <strong style="color:${colorW};">${statusW}</strong>
        </div>
      </div>
    `;
  }

  // 🛡️ Plano de Recuperação
  const recBloco = $("#detRecuperacaoBloco");
  if (recBloco) {
    if (lucroAtual < 0) {
      recBloco.style.display = "block";
      $(`#detBEML`).textContent = fmtEUR.format(precoMedio);
      $(`#detTPComp`).textContent = fmtEUR.format(precoMedio * 1.05);
      $(`#detRecSub5`).textContent = fmtEUR.format(precoMedio * 0.95 * 1.05);
      $(`#detRecSub10`).textContent = fmtEUR.format(precoMedio * 0.90 * 1.05);
    } else {
      recBloco.style.display = "none";
    }
  }

  renderMovementHistory(ticker);
  detModalEl.classList.remove("hidden");
};

function renderMovementHistory(ticker) {
  const corpo = document.getElementById("detHistoricoCorpo");
  if (!corpo) return;

  const g = byTickerGlobal.get(ticker);
  const isClosed = (g?.qtd || 0) <= 0;
  // For closed positions use current price only to show "what you left on the table" — label it clearly
  const precoAtual = g?.precoAtual || null;

  const movimentos = (_allMovimentos || [])
    .filter(m => m.ticker === ticker)
    .sort((a, b) => b.date - a.date);

  if (movimentos.length === 0) {
    corpo.innerHTML = '<tr><td colspan="7" style="padding: 20px; text-align: center; color: var(--muted-foreground);">Sem movimentos registados.</td></tr>';
    return;
  }

  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  const fmtPct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

  corpo.innerHTML = movimentos.map(m => {
    const isVenda = m.qtd < 0;
    const absQtd = Math.abs(m.qtd);
    const custoTotal = absQtd * m.preco;
    const tipoLabel = isVenda
      ? '<span style="color:#ef4444;font-weight:700;">Venda</span>'
      : '<span style="color:#22c55e;font-weight:700;">Compra</span>';

    let plCell = '<td style="padding: 10px; text-align: right; color: var(--muted-foreground);">—</td>';
    if (!isVenda && precoAtual !== null) {
      const plEur = (precoAtual - m.preco) * absQtd;
      const plPct = m.preco > 0 ? ((precoAtual - m.preco) / m.preco) * 100 : 0;
      const color = plEur >= 0 ? "#22c55e" : "#ef4444";
      const note = isClosed ? `<span style="font-size:0.6rem;color:var(--muted-foreground);display:block;">vs cotação atual</span>` : "";
      plCell = `<td style="padding: 10px; text-align: right; font-weight: 700; color: ${color};">
        ${fmtEUR.format(plEur)}<br>
        <span style="font-size: 0.65rem; opacity: 0.85;">${fmtPct(plPct)}</span>${note}
      </td>`;
    }

    return `
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 10px; white-space: nowrap;">${m.date.toLocaleDateString("pt-PT")}</td>
        <td style="padding: 10px;">${tipoLabel}</td>
        <td style="padding: 10px; text-align: right; font-weight: 600;">${absQtd.toFixed(4).replace(/\.?0+$/, "")}</td>
        <td style="padding: 10px; text-align: right;">${fmtEUR.format(m.preco)}</td>
        <td style="padding: 10px; text-align: right; color: var(--muted-foreground);">${fmtEUR.format(custoTotal)}</td>
        ${plCell}
        <td style="padding: 10px; text-align: center;">
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button class="btn-history-edit" data-edit-move="${m.id}" style="border:none; background:none; cursor:pointer; color:var(--primary);"><i class="fas fa-edit"></i></button>
            <button class="btn-history-delete" data-delete-move="${m.id}" style="border:none; background:none; cursor:pointer; color:#ef4444;"><i class="fas fa-trash-alt"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  corpo.querySelectorAll("[data-edit-move]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const docId = btn.getAttribute("data-edit-move");
      document.getElementById("activityDetailModal")?.classList.add("hidden");
      const dummyBtn = document.createElement("button");
      dummyBtn.setAttribute("data-edit", docId);
      dummyBtn.setAttribute("data-edit-ticker", ticker);
      dummyBtn.style.display = "none";
      document.getElementById("listaAtividades").appendChild(dummyBtn);
      dummyBtn.click();
      dummyBtn.remove();
    };
  });

  corpo.querySelectorAll("[data-delete-move]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Eliminar este movimento?")) return;
      const docId = btn.getAttribute("data-delete-move");
      try {
        await deleteDoc(doc(db, "ativos", docId));
        document.getElementById("activityDetailModal")?.classList.add("hidden");
        showToast("Movimento eliminado.");
      } catch (err) { console.error(err); }
    };
  });
}

// ===============================
// Quick Actions (comprar/vender/editar + collapse)
// ===============================
function wireQuickActions(gruposArr) {
  byTickerGlobal = new Map(gruposArr.map((g) => [g.ticker, g]));
  window._portfolioPositions = byTickerGlobal;
  if (_eventsWired) return;
  _eventsWired = true;

  const $ = (s) => document.querySelector(s);

  const modal = $("#pfAddModal");
  const title = $("#pfAddTitle");
  const form = $("#pfAddForm");
  const close = $("#pfAddClose");
  const cancel = $("#pfAddCancel");

  const tipoSel = $("#pfTipoAcao");
  const labelP = $("#pfLabelPreco");
  const vendaTotWrap = $("#pfVendaTotalWrap");
  const vendaTot = $("#pfVendaTotal");
  // (NOVO) posição atual do ticker que está aberto no modal
  let currentPosQty = 0;

  // (NOVO) hidden onde vamos guardar a posição atual
  const fPosAtual = document.getElementById("pfPosicaoAtual");
  const fTicker = $("#pfTicker");
  const fNome = $("#pfNome");
  const fSetor = $("#pfSetor");
  const fMerc = $("#pfMercado");
  const fQtd = $("#pfQuantidade");
  const fPreco = $("#pfPreco");
  const fData = $("#pfData");
  const fObj = $("#pfObjetivo");
  const fLink = $("#pfLink");

  // --- Listeners do Modal (Internos) ---
  tipoSel?.addEventListener("change", () => {
    const isVenda = tipoSel.value === "venda";
    if (labelP) labelP.textContent = isVenda ? "Preço de venda (€)" : "Preço de compra (€)";
    if (vendaTotWrap) vendaTotWrap.style.display = isVenda ? "block" : "none";
    if (!isVenda) {
      if (vendaTot) vendaTot.checked = false;
      if (fQtd) fQtd.removeAttribute("readonly");
    }
  });

  window.openActionModal = openActionModal;
  function openActionModal(kind, ticker) {
    const g = byTickerGlobal.get(ticker);
    if (!g) return;

    // posição atual em carteira
    currentPosQty = Number(g.qtd || 0);
    if (fPosAtual) fPosAtual.value = String(currentPosQty);

    // garantir que o input de quantidade fica editável
    if (fQtd) fQtd.removeAttribute("readonly");

    modal?.classList.remove("hidden");
    if (title)
      title.textContent = kind === "compra" ? "Comprar ativo" : "Vender ativo";
    // Update icon color based on type
    const iconEl = document.getElementById("pfAddTypeIcon");
    if (iconEl) {
      if (kind === "venda") {
        iconEl.style.background = "rgba(239,68,68,0.1)";
        iconEl.style.color = "#ef4444";
        iconEl.innerHTML = '<i class="fas fa-minus-circle"></i>';
      } else {
        iconEl.style.background = "rgba(79,70,229,0.1)";
        iconEl.style.color = "#4f46e5";
        iconEl.innerHTML = '<i class="fas fa-plus-circle"></i>';
      }
    }
    if (tipoSel) tipoSel.value = kind;
    if (fTicker) fTicker.value = g.ticker;
    if (fNome) fNome.value = g.nome;
    if (fSetor) fSetor.value = g.setor || "";
    if (fMerc) fMerc.value = g.mercado || "";
    if (fQtd) fQtd.value = "";
    if (fPreco) fPreco.value = (kind === "venda" && g.precoAtual) ? Number(g.precoAtual).toFixed(4) : "";
    if (fData) fData.value = new Date().toISOString().split("T")[0];
    if (fObj) fObj.value = g.objetivo || "";
    if (fLink) fLink.value = g.link || "";
    if (vendaTot) vendaTot.checked = false;
    if (vendaTotWrap)
      vendaTotWrap.style.display = kind === "venda" ? "block" : "none";
    if (labelP)
      labelP.textContent =
        kind === "venda" ? "Preço de venda (€)" : "Preço (€)";
    // Reset cost summary
    const custoResumo = document.getElementById("pfCustoResumo");
    if (custoResumo) custoResumo.style.display = "none";
  }

  // Live cost calculation
  const calcCusto = () => {
    const p = parseFloat(fPreco?.value || 0);
    const q = parseFloat(fQtd?.value || 0);
    const incluirComissao = !!document.getElementById("pfComissao")?.checked;
    const tipo = (tipoSel?.value || "compra").toLowerCase();
    
    const custoResumo = document.getElementById("pfCustoResumo");
    const custoTotal = document.getElementById("pfCustoTotal");
    if (!custoResumo || !custoTotal) return;
    if (p > 0 && q > 0) {
      let baseCost = p * q;
      if (incluirComissao) {
         if (tipo === "compra") baseCost += 1;
         else if (tipo === "venda") baseCost = Math.max(0, baseCost - 1);
      }
      const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
      custoTotal.textContent = fmtEUR.format(baseCost);
      custoResumo.style.display = "flex";
    } else {
      custoResumo.style.display = "none";
    }
  };
  fPreco?.addEventListener("input", calcCusto);
  fQtd?.addEventListener("input", calcCusto);
  document.getElementById("pfComissao")?.addEventListener("change", calcCusto);
  tipoSel?.addEventListener("change", calcCusto);

  window.closeModalAtividade = closeModal;
  function closeModal() {
    modal?.classList.add("hidden");
    form?.reset();
    const idHidden = document.getElementById("pfDocId");
    if (idHidden) idHidden.value = "";
    if (tipoSel) tipoSel.value = "compra";
    if (labelP) labelP.textContent = "Preço (€)";
    if (vendaTot) vendaTot.checked = false;
    if (vendaTotWrap) vendaTotWrap.style.display = "none";
    const custoResumo = document.getElementById("pfCustoResumo");
    if (custoResumo) custoResumo.style.display = "none";
  }
  close?.addEventListener("click", closeModal);
  cancel?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  // --- Listeners de Ação do Modal (Submit e Venda Total) ---
  vendaTot?.addEventListener("change", () => {
    const checked = !!vendaTot.checked;
    const pos = Number(fPosAtual?.value || currentPosQty || 0);
    if (!fQtd) return;
    if (checked) {
      if (!(pos > 0)) {
        alert("Não há posição para fechar.");
        vendaTot.checked = false;
        return;
      }
      fQtd.value = Math.abs(pos).toString();
      fQtd.setAttribute("readonly", "readonly");
      // Pré-preencher o preço atual de mercado se ainda não estiver preenchido
      const curP = byTickerGlobal.get(fTicker?.value)?.precoAtual;
      if (curP && fPreco && (!fPreco.value || parseFloat(fPreco.value) === 0)) {
        fPreco.value = Number(curP).toFixed(4);
      }
      calcCusto();
    } else {
      fQtd.removeAttribute("readonly");
      fQtd.value = "";
      calcCusto();
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = (tipoSel?.value || "compra").toLowerCase();
    const nome = fNome?.value.trim() || "";
    const ticker = fTicker?.value.trim().toUpperCase() || "";
    const setor = fSetor?.value.trim() || "";
    const merc = fMerc?.value.trim() || "";
    const qtd = parseFloat(fQtd?.value || 0);
    const preco = parseFloat(fPreco?.value || 0);
    const obj = parseFloat(fObj?.value || 0);
    const lnk = fLink?.value.trim() || "";
    const vendaTotal = !!vendaTot?.checked;
    const incluirComissao = !!document.getElementById("pfComissao")?.checked;
    const docId = (document.getElementById("pfDocId")?.value || "").trim();

    try {
      if (tipo === "edicao" && docId) {
        const docRef = doc(db, "ativos", docId);
        await updateDoc(docRef, {
          nome, ticker, setor, mercado: merc,
          quantidade: qtd, precoCompra: preco,
          objetivoFinanceiro: obj, linkExterno: lnk,
          dataCompra: fData?.value ? Timestamp.fromDate(new Date(fData.value)) : serverTimestamp()
        });
      } else {
        let qtdEfetiva = qtd;
        if (tipo === "venda" && vendaTotal) {
          const pos = Number(fPosAtual?.value || currentPosQty || 0);
          qtdEfetiva = Math.abs(pos);
          if (!(qtdEfetiva > 0)) { alert("Não há posição para fechar."); return; }
        }

        let precoFinal = preco;
        if (incluirComissao && qtdEfetiva > 0) {
          const comissaoUnit = 1 / qtdEfetiva;
          if (tipo === "compra") {
            precoFinal = preco + comissaoUnit;
          } else if (tipo === "venda") {
            precoFinal = Math.max(0, preco - comissaoUnit);
          }
        }

        if (!ticker || !nome || qtdEfetiva <= 0 || precoFinal <= 0) {
          alert("Preenche os campos obrigatórios.");
          return;
        }
        await addDoc(collection(db, "ativos"), {
          tipoAcao: tipo, nome, ticker, setor, mercado: merc,
          quantidade: tipo === "venda" ? -qtdEfetiva : qtdEfetiva,
          precoCompra: precoFinal, objetivoFinanceiro: obj, linkExterno: lnk,
          dataCompra: fData?.value ? Timestamp.fromDate(new Date(fData.value)) : serverTimestamp()
        });
        if (tipo === "venda" && vendaTotal) {
          showToast(`Posição de ${ticker} fechada. P&L registado em "Posições Fechadas".`);
        }
      }
      closeModal();
    } catch (err) {
      console.error("Erro ao guardar:", err);
      alert("Não foi possível guardar. Tenta novamente.");
    }
  });
}

function wireAtividadeListeners() {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  const $ = (s) => document.querySelector(s);
  const modal = $("#pfAddModal");
  const title = $("#pfAddTitle");
  const tipoSel = $("#pfTipoAcao");
  const labelP = $("#pfLabelPreco");
  const vendaTotWrap = $("#pfVendaTotalWrap");
  const fTicker = $("#pfTicker");
  const fNome = $("#pfNome");
  const fSetor = $("#pfSetor");
  const fMerc = $("#pfMercado");
  const fQtd = $("#pfQuantidade");
  const fPreco = $("#pfPreco");
  const fData = $("#pfData");
  const fObj = $("#pfObjetivo");
  const fLink = $("#pfLink");

  cont.addEventListener("click", async (e) => {
    // 1. BUY/SELL/CHART
    const buy = e.target.closest("[data-buy]");
    const sell = e.target.closest("[data-sell]");
    const chart = e.target.closest("[data-chart]");
    if (buy) window.openActionModal?.("compra", buy.getAttribute("data-buy"));
    if (sell) window.openActionModal?.("venda", sell.getAttribute("data-sell"));
    if (chart) openTechnicalChart(chart.getAttribute("data-chart"));

    // 1.1 Holdings Map (NOVO)
    const hMap = e.target.closest(".holdings-map-trigger");
    if (hMap) {
      e.stopPropagation();
      const ticker = hMap.getAttribute("data-holdings-ticker");
      const name = hMap.getAttribute("data-holdings-name");
      const modalH = document.getElementById("holdingsMapModal");
      if (modalH) {
        modalH.classList.remove("hidden");
        renderIndividualHoldingsMap(ticker, name);
      }
    }

    // 1.2 Holdings Edit (NOVO)
    const hEdit = e.target.closest(".holdings-edit-trigger");
    if (hEdit) {
      e.stopPropagation();
      const ticker = hEdit.getAttribute("data-holdings-ticker");
      const editM = document.getElementById("holdingsEditModal");
      if (editM) {
        document.getElementById("editHoldingsTitle").textContent = `Holdings: ${ticker}`;
        editM.classList.remove("hidden");
        // Nota: A carga dos dados pode ser feita via evento custom ou chamando uma função global
        window.loadHoldingsForEdit?.(ticker);
      }
    }

    // 1.3 Asset Profile Edit (NOVO)
    const profTrigger = e.target.closest(".profile-edit-trigger");
    if (profTrigger) {
      e.stopPropagation();
      const ticker = profTrigger.getAttribute("data-profile-ticker");
      const g = byTickerGlobal?.get(ticker);
      if (g) {
        const profModal = document.getElementById("assetProfileModal");
        if (profModal) {
          document.getElementById("profTicker").value = g.ticker;
          document.getElementById("profNome").value = g.nome || "";
          document.getElementById("profSetor").value = g.setor === "—" ? "" : g.setor;
          document.getElementById("profMercado").value = g.mercado === "—" ? "" : g.mercado;
          document.getElementById("profObjetivo").value = g.objetivo || "";
          document.getElementById("profLink").value = g.link || "";
          profModal.classList.remove("hidden");
        }
      }
    }

    // 2. Collapse per card -> Abrir Detalhes
    const t = e.target.closest("[data-toggle-card]");
    if (t) {
      const ticker = t.getAttribute("data-ticker");
      if (ticker) window.openDetails?.(ticker);
    }

    // 3. Expandir/Recolher card (Visual)
    const btnExp = e.target.closest("[data-expand-card]");
    if (btnExp) {
      e.stopPropagation();
      const card = btnExp.closest(".asset-card");
      if (card) card.classList.toggle("is-collapsed");
    }

    // 4. Edit button
    const btnEdit = e.target.closest("[data-edit]");
    if (btnEdit) {
      const docId = btnEdit.getAttribute("data-edit");
      const ticker = btnEdit.getAttribute("data-edit-ticker") || "";
      if (!docId) return;
      try {
        const ref = doc(db, "ativos", docId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const d = snap.data();
        
        modal?.classList.remove("hidden");
        if (title) title.textContent = "Editar movimento";
        if (tipoSel) tipoSel.value = "edicao";
        const idHidden = document.getElementById("pfDocId");
        if (idHidden) idHidden.value = docId;
        
        if (fTicker) fTicker.value = d.ticker || ticker || "";
        if (fNome) fNome.value = d.nome || "";
        if (fSetor) fSetor.value = d.setor || "";
        if (fMerc) fMerc.value = d.mercado || "";
        if (fQtd) fQtd.value = Number(d.quantidade || 0);
        if (fPreco) fPreco.value = Number(d.precoCompra || 0);
        if (fData) {
          const dtRaw = d.dataCompra && typeof d.dataCompra.toDate === "function" ? d.dataCompra.toDate() : (d.dataCompra ? new Date(d.dataCompra) : new Date());
          fData.value = dtRaw.toISOString().split("T")[0];
        }
        if (fObj) fObj.value = Number(d.objetivoFinanceiro || 0);
        if (fLink) fLink.value = d.linkExterno || "";
        
        if (labelP) labelP.textContent = "Preço (€)";
        if (vendaTotWrap) vendaTotWrap.style.display = "none";
      } catch (err) {
        console.error("Erro ao abrir edição:", err);
      }

    }
  });
}

function wireAssetProfileModal() {
  const modal = document.getElementById("assetProfileModal");
  if (!modal || modal.__wired) return;
  modal.__wired = true;

  const closeBtn = document.getElementById("profClose");
  const cancelBtn = document.getElementById("profCancel");
  const form = document.getElementById("profForm");

  const close = () => {
    modal.classList.add("hidden");
    form.reset();
  };

  closeBtn?.addEventListener("click", close);
  cancelBtn?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker = document.getElementById("profTicker")?.value.trim().toUpperCase();
    if (!ticker) return;

    const nome = document.getElementById("profNome")?.value.trim() || "";
    const setor = document.getElementById("profSetor")?.value.trim() || "";
    const mercado = document.getElementById("profMercado")?.value.trim() || "";
    const objetivo = parseFloat(document.getElementById("profObjetivo")?.value || 0);
    const link = document.getElementById("profLink")?.value.trim() || "";

    try {
      const q = query(collection(db, "ativos"), where("ticker", "==", ticker));
      const snap = await getDocs(q);
      const promises = [];
      snap.forEach((d) => {
        promises.push(updateDoc(doc(db, "ativos", d.id), {
          nome, setor, mercado,
          objetivoFinanceiro: objetivo,
          linkExterno: link
        }));
      });
      await Promise.all(promises);
      close();
    } catch (err) {
      console.error("Erro ao atualizar perfil do ativo:", err);
    }
  });
}

// ===============================
// Ajuda (popup)
// ===============================
const HELP_KEY = "prt.help.dismissed";

function wirePortfolioHelpModal() {
  const modal = document.getElementById("prtHelpModal");
  if (!modal || modal.__wired) return;
  modal.__wired = true;

  const closeBtn = document.getElementById("prtHelpClose");
  const okBtn = document.getElementById("prtHelpOK");
  const laterBtn = document.getElementById("prtHelpLater");
  const dontShow = document.getElementById("prtHelpDontShow");
  const helpIcon = document.getElementById("btnPrtHelp");
  const fabHelp = document.getElementById("fabHelp");

  const close = (persist) => {
    if (persist && dontShow?.checked) {
      try {
        localStorage.setItem(HELP_KEY, "1");
      } catch {}
    }
    modal.classList.add("hidden");
  };

  closeBtn?.addEventListener("click", () => close(false));
  laterBtn?.addEventListener("click", () => close(false));
  okBtn?.addEventListener("click", () => close(true));
  helpIcon?.addEventListener("click", () => showPortfolioHelp(true));
  fabHelp?.addEventListener("click", () => showPortfolioHelp(true));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) close(false);
  });
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("hidden") && e.key === "Escape") close(false);
  });
}

function showPortfolioHelp(force = false) {
  const modal = document.getElementById("prtHelpModal");
  if (!modal) return;
  if (!force) {
    try {
      if (localStorage.getItem(HELP_KEY) === "1") return;
    } catch {}
  }
  modal.classList.remove("hidden");
}

  // ===============================
  // INIT (screen)
  // ===============================
  let _lastAtivosSnap = null;
  let _lastAcoesSnap = null;
  let _lastStrategySnap = null;
  let _currentTotalInvested = 0;
  let _currentGruposArr = [];
  let _currentAcoesDataMap = new Map();
  let _invPlanContext = {
    monthlyBase: 0,
    availableCash: 0,
    state: null,
    smartDca: null,
    recommendation: null
  };
  let _lastInvPlanCopyText = "";
  let _allocationTargets = new Map();
  let _allocationPlannerWired = false;

  window._dynamicStrategyGlobals = { CORE: 0.65, SATELLITE: 0.35 };
  window._dynamicStrategyTickers = {};
  let fltState = { estado: "", mercado: "", setor: "", sort: "queda", estrategia: "" };

  function getAllocationRows() {
    const assets = (_currentGruposArr || []).filter(g => Number.isFinite(g.qtd) && g.qtd > 0);
    const rows = assets.map(g => {
      const price = Number(g.precoAtual || 0);
      const value = price > 0 ? price * Number(g.qtd || 0) : Number(g.investido || 0);
      return { ...g, _allocPrice: price, _allocValue: value };
    });
    const total = rows.reduce((s, g) => s + (g._allocValue || 0), 0);
    return { rows, total };
  }

  function seedAllocationTargets(force = false) {
    const { rows, total } = getAllocationRows();
    if (!force && _allocationTargets.size) return;
    _allocationTargets = new Map();
    rows.forEach(g => {
      const pct = total > 0 ? (g._allocValue / total) * 100 : 0;
      _allocationTargets.set(g.ticker, Number(pct.toFixed(2)));
    });
  }

  function allocationPlanForRows() {
    const { rows, total } = getAllocationRows();
    return rows.map(g => {
      const currentPct = total > 0 ? (g._allocValue / total) * 100 : 0;
      const targetPct = Number(_allocationTargets.get(g.ticker) ?? currentPct) || 0;
      const targetValue = total * targetPct / 100;
      const deltaValue = targetValue - g._allocValue;
      const units = g._allocPrice > 0 ? deltaValue / g._allocPrice : 0;
      return { ...g, currentPct, targetPct, targetValue, deltaValue, units, total };
    });
  }

  function renderAllocationPlanner() {
    const modal = document.getElementById("allocationPlannerModal");
    const list = document.getElementById("allocationPlannerList");
    if (!modal || !list) return;

    const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
    const { total } = getAllocationRows();
    seedAllocationTargets(false);
    const plan = allocationPlanForRows().sort((a, b) => b._allocValue - a._allocValue);
    const targetSum = plan.reduce((s, p) => s + p.targetPct, 0);
    const turnover = plan.reduce((s, p) => s + Math.abs(p.deltaValue), 0) / 2;

    const totalEl = document.getElementById("allocPlannerTotalValue");
    const sumEl = document.getElementById("allocPlannerTargetSum");
    const turnoverEl = document.getElementById("allocPlannerTurnover");
    if (totalEl) totalEl.textContent = fmtEUR.format(total);
    if (sumEl) {
      sumEl.textContent = `${targetSum.toFixed(1)}%`;
      sumEl.style.color = Math.abs(targetSum - 100) <= 0.15 ? "#22c55e" : "#ef4444";
    }
    if (turnoverEl) turnoverEl.textContent = fmtEUR.format(turnover);

    if (!plan.length) {
      list.innerHTML = `<div class="muted" style="padding:24px;text-align:center;">Sem ativos abertos para ajustar.</div>`;
      return;
    }

    list.innerHTML = plan.map(p => {
      const actionClass = Math.abs(p.deltaValue) < 1 ? "hold" : p.deltaValue > 0 ? "buy" : "sell";
      const actionVerb = actionClass === "hold" ? "Manter" : actionClass === "buy" ? "Comprar" : "Vender";
      const unitsAbs = Math.abs(p.units);
      const priceLabel = p._allocPrice > 0 ? fmtEUR.format(p._allocPrice) : "sem preco";
      return `
        <div class="allocation-row" data-alloc-row="${escapeHtml(p.ticker)}">
          <div class="allocation-asset">
            <strong>${escapeHtml(p.ticker)}</strong>
            <span>${escapeHtml(p.nome || p.ticker)} - ${priceLabel}</span>
          </div>
          <div class="allocation-current">
            <strong>${p.currentPct.toFixed(1)}%</strong>
            <span>${fmtEUR.format(p._allocValue || 0)}</span>
          </div>
          <div class="allocation-target-control">
            <input type="range" min="0" max="100" step="0.1" value="${p.targetPct.toFixed(1)}" data-alloc-range="${escapeHtml(p.ticker)}" aria-label="Alvo ${escapeHtml(p.ticker)}">
            <input type="number" min="0" max="100" step="0.1" value="${p.targetPct.toFixed(1)}" data-alloc-input="${escapeHtml(p.ticker)}" aria-label="Percentagem alvo ${escapeHtml(p.ticker)}">
          </div>
          <div class="allocation-action">
            <strong class="${actionClass}">${actionVerb} ${fmtEUR.format(Math.abs(p.deltaValue))}</strong>
            <span>${p._allocPrice > 0 ? `${unitsAbs.toFixed(4).replace(/\.?0+$/, "")} un.` : "sem preco atual"}</span>
          </div>
        </div>`;
    }).join("");

    applyAllocationPlanToCards();
  }

  function applyAllocationPlanToCards() {
    const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
    document.querySelectorAll(".allocation-card-plan").forEach(el => el.remove());
    if (!_allocationTargets.size) return;

    allocationPlanForRows().forEach(p => {
      if (Math.abs(p.deltaValue) < 1) return;
      const card = document.getElementById(`card-${p.ticker}`);
      if (!card) return;
      const header = card.querySelector(".asset-header") || card;
      const isBuy = p.deltaValue > 0;
      const unitsAbs = Math.abs(p.units);
      const unitsLabel = p._allocPrice > 0 ? `${unitsAbs.toFixed(4).replace(/\.?0+$/, "")} un.` : "sem preco";
      const html = `
        <div class="allocation-card-plan">
          <span>Alvo ${p.targetPct.toFixed(1)}% - atual ${p.currentPct.toFixed(1)}%</span>
          <strong class="${isBuy ? "buy" : "sell"}">${isBuy ? "Comprar" : "Vender"} ${unitsLabel} (${fmtEUR.format(Math.abs(p.deltaValue))})</strong>
        </div>`;
      header.insertAdjacentHTML("afterend", html);
    });
  }

  function normalizeAllocationTargets() {
    const plan = allocationPlanForRows();
    const sum = plan.reduce((s, p) => s + p.targetPct, 0);
    if (!(sum > 0)) return;
    plan.forEach(p => _allocationTargets.set(p.ticker, Number((p.targetPct / sum * 100).toFixed(2))));
  }

  function wireAllocationPlanner() {
    if (_allocationPlannerWired) return;
    _allocationPlannerWired = true;

    const modal = document.getElementById("allocationPlannerModal");
    const openBtn = document.getElementById("fabAllocation");
    const closeBtn = document.getElementById("allocationPlannerClose");
    const applyBtn = document.getElementById("allocationPlannerApplyCards");
    const useCurrentBtn = document.getElementById("allocUseCurrent");
    const equalBtn = document.getElementById("allocEqualWeight");
    const normalizeBtn = document.getElementById("allocNormalize");

    const close = () => modal?.classList.add("hidden");
    const open = () => {
      seedAllocationTargets(!_allocationTargets.size);
      renderAllocationPlanner();
      modal?.classList.remove("hidden");
    };

    openBtn?.addEventListener("click", open);
    closeBtn?.addEventListener("click", close);
    modal?.addEventListener("click", (e) => { if (e.target === modal) close(); });

    modal?.addEventListener("change", (e) => {
      const input = e.target.closest("[data-alloc-input],[data-alloc-range]");
      if (!input) return;
      const ticker = input.getAttribute("data-alloc-input") || input.getAttribute("data-alloc-range");
      const value = Math.max(0, Math.min(100, Number(input.value) || 0));
      _allocationTargets.set(ticker, Number(value.toFixed(2)));
      const paired = modal.querySelector(input.hasAttribute("data-alloc-input") ? `[data-alloc-range="${ticker}"]` : `[data-alloc-input="${ticker}"]`);
      if (paired) paired.value = value.toFixed(1);
      renderAllocationPlanner();
    });

    useCurrentBtn?.addEventListener("click", () => { seedAllocationTargets(true); renderAllocationPlanner(); });
    equalBtn?.addEventListener("click", () => {
      const { rows } = getAllocationRows();
      const pct = rows.length ? 100 / rows.length : 0;
      _allocationTargets = new Map(rows.map(g => [g.ticker, Number(pct.toFixed(2))]));
      renderAllocationPlanner();
    });
    normalizeBtn?.addEventListener("click", () => { normalizeAllocationTargets(); renderAllocationPlanner(); });
    applyBtn?.addEventListener("click", () => {
      applyAllocationPlanToCards();
      if (typeof showToast === "function") showToast("Alvos refletidos nos cartoes.", "success");
    });
  }
  export async function initScreen() {
    console.log("🏁 initScreen 'atividade' iniciada...");
    const cont = document.getElementById("listaAtividades");
    if (!cont) return;

    _eventsWired = false; // reset para garantir que os listeners se ligam ao novo DOM
    _holdingsEventsWired = false; // Reset específico para o mapa de holdings
    cont.innerHTML = "A carregar…";

    // Registrar ajuda e plano
    wirePortfolioHelpModal();
    showPortfolioHelp();
    wireInvPlan();
    wireAllocationPlanner();
    wireAtividadeListeners();
    wireAssetProfileModal();
    
    // Wire Modal Detalhes (X e fora)
    const detModal = document.getElementById("activityDetailModal");
    const detClose = document.getElementById("activityDetailClose");
    if (detModal && detClose) {
      detClose.onclick = () => detModal.classList.add("hidden");
      detModal.onclick = (e) => { if (e.target === detModal) detModal.classList.add("hidden"); };
    }

    const techModal = document.getElementById("techChartModal");
    const techClose = document.getElementById("techChartClose");
    if (techModal && techClose) {
      techClose.onclick = () => techModal.classList.add("hidden");
      techModal.onclick = (e) => { if (e.target === techModal) techModal.classList.add("hidden"); };
    }

    await ensureChartJS();

    // Wire filters
    const fEstado = document.getElementById("fltEstado");
    const fMercado = document.getElementById("fltMercado");
    const fSetor = document.getElementById("fltSetor");
    const fSort = document.getElementById("fltSort");
    const fEstrategia = document.getElementById("fltEstrategia");

    [fEstado, fMercado, fSetor, fSort, fEstrategia].forEach((el) => {
      el?.addEventListener("change", () => {
        fltState = {
          estado: fEstado?.value || "",
          mercado: fMercado?.value || "",
          setor: fSetor?.value || "",
          sort: fSort?.value || "queda",
          estrategia: fEstrategia?.value || "",
        };
        handleUpdate();
      });
    });


    const handleUpdate = async () => {
      if (!_lastAtivosSnap || !_lastAcoesSnap) return;
      await processAndRender(_lastAtivosSnap, _lastAcoesSnap, _lastStrategySnap);
    };

    // Listeners em tempo real
    onSnapshot(
      query(collection(db, "ativos"), orderBy("dataCompra", "asc")),
      (snap) => {
        _lastAtivosSnap = snap;
        handleUpdate();
      },
    );

    subscribeMarketData((_map, snap) => {
      _lastAcoesSnap = snap;
      updatePriceFreshness();
      handleUpdate();
    });

    onSnapshot(doc(db, "config", "strategy"), (snap) => {
      _lastStrategySnap = snap;
      handleUpdate();
    });

    window.saveAssetStrategy = async (ticker, category, targetPct) => {
      try {
        const stratRef = doc(db, "config", "strategy");
        const snap = await getDoc(stratRef);
        const current = snap.exists() ? snap.data() : {};
        const tickers = current.tickers || {};
        if (category === "NONE") {
          delete tickers[ticker];
        } else {
          tickers[ticker] = { category, target: Number(targetPct) || 0 };
        }
        await setDoc(stratRef, { ...current, tickers }, { merge: true });
        window._dynamicStrategyTickers = tickers;
        showToast("Estratégia guardada!");
      } catch (err) {
        console.error(err);
        showToast("Erro ao guardar.", "error");
      }
    };

    // Inicializar eventos estáticos do Mapa de Holdings (uma única vez)
    wireHoldingsMapEvents();
  }

  async function processAndRender(snap, aSnap, stratSnap) {
    const cont = document.getElementById("listaAtividades");
    if (!cont) return;

    try {
      let dynTickers = {};
      let dynCoreTotal = 0.65;
      let dynSatTotal = 0.35;
      if (stratSnap && stratSnap.exists()) {
        const dd = stratSnap.data();
        dynTickers = dd.tickers || {};
        if (typeof dd.coreWeight === "number") dynCoreTotal = dd.coreWeight / 100;
        if (typeof dd.satelliteWeight === "number") dynSatTotal = dd.satelliteWeight / 100;
      }
    
      window._dynamicStrategyGlobals = { CORE: dynCoreTotal, SATELLITE: dynSatTotal };
      window._dynamicStrategyTickers = dynTickers;
      if (stratSnap && stratSnap.exists()) {
        const _sd = stratSnap.data();
        window._strategyConfig = {
          monthlyBase:    Number(_sd.monthlyBase    || 0),
          availableCash:  Number(_sd.availableCash  || 0),
          cashReservePct: Number(_sd.cashReservePct || 0),
        };
      }

      const infoMap = new Map();
      aSnap.forEach((d) => {
        const x = d.data();
        if (x.ticker) infoMap.set(cleanTicker(x.ticker), x);
      });

      const portfolioAggregation = aggregatePortfolioPositions(snap);
      const gruposArr = portfolioAggregation.groupsArr;
      const movimentosAsc = portfolioAggregation.movimentosAsc;
      _allMovimentos = movimentosAsc;
      const fmtEUR = new Intl.NumberFormat("pt-PT", {
        style: "currency",
        currency: "EUR",
      });

      const rowsForYield = [];
      gruposArr.forEach((g) => {
        const info = infoMap.get(g.ticker) || {};
        const precoAtual = isFiniteNum(info.valorStock)
          ? Number(info.valorStock)
          : null;
        const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
        g.lucroAtual =
          precoAtual !== null ? (precoAtual - precoMedio) * g.qtd : 0;
        g.precoAtual = precoAtual;

        // --- Normalização de dados (alinhamento com analise.js) ---
        const dividendoUnit = isFiniteNum(info.dividendo)
          ? Number(info.dividendo)
          : 0;
        const dmed24 = isFiniteNum(info.dividendoMedio24m)
          ? Number(info.dividendoMedio24m)
          : 0;

        const pe =
          Number(info.pe) ||
          Number(info.peRatio) ||
          Number(info["P/E ratio (Preço/Lucro)"]) ||
          null;
        const sma50 = parseSma(info.sma50 || info.SMA50, precoAtual);
        const sma200 = parseSma(info.sma200 || info.SMA200, precoAtual);
        if (info.sma50 || info.SMA50) {
            console.log(`[DEBUG SMA] ticker: ${g.ticker}, db_sma50: ${info.sma50 || info.SMA50}, precoAtual: ${precoAtual}, parsed_sma50: ${sma50}`);
        }
        const periodicidade = info.periodicidade || "";
        const payN = pagamentosAno(periodicidade);

        const yCur =
          precoAtual && dividendoUnit > 0 && periodicidade
            ? (dividendoUnit * payN) / precoAtual
            : precoAtual && dmed24 > 0
              ? dmed24 / precoAtual
              : null;

        const y24m = precoAtual && dmed24 > 0 ? dmed24 / precoAtual : null;

        // Guardar métricas normalizadas no objeto do grupo
        g._yCur = yCur;
        g._y24m = y24m;
        g._pe = pe;
        g._sma50 = sma50;
        g._sma200 = sma200;
        g._divUnit = dividendoUnit;
        g._divAnual = dmed24 || dividendoUnit * payN; // Usa média 24m ou projeta

        rowsForYield.push({
          ticker: g.ticker,
          active: g.qtd > 0,
          yieldCur: yCur,
        });
      });



      // 2.1) Distribuições (apenas abertas)
      const setoresMap = new Map(),
        mercadosMap = new Map();
      for (const g of gruposArr) {
        if ((g.qtd || 0) <= 0) continue;
        const setor = g.setor || "—";
        setoresMap.set(setor, (setoresMap.get(setor) || 0) + (g.investido || 0));
        const merc = g.mercado || "—";
        mercadosMap.set(merc, (mercadosMap.get(merc) || 0) + (g.investido || 0));
      }

      // 2.2) KPIs agregados
      const abertos = gruposArr.filter((g) => g.qtd > 0);
      const totalInvestido = abertos.reduce((a, g) => a + (g.investido || 0), 0);
      _currentTotalInvested = totalInvestido;
      _currentGruposArr = gruposArr;
      _currentAcoesDataMap = infoMap;

      // (NOVO) Cálculo da distribuição estratégica e por ativo
      const estrategiaMap = new Map();
      const ativosMap = new Map();
      const tickerCatMap = new Map();
      
      let satWeightTotal = 0;

      // Primeiro pass: preparar mapas e calcular exposição de Satélites
      for (const g of abertos) {
        const sInfo = getDynStrat(g.ticker, g.nome);
        g._strategy = sInfo; // Cache da info estratégica
        const cat = sInfo ? sInfo.category : "NÃO DEFINIDA";
        
        estrategiaMap.set(cat, (estrategiaMap.get(cat) || 0) + (g.investido || 0));
        ativosMap.set(g.ticker, (ativosMap.get(g.ticker) || 0) + (g.investido || 0));
        tickerCatMap.set(g.ticker, cat);

        if (sInfo && sInfo.category === "SATELLITE" && totalInvestido > 0) {
          satWeightTotal += (g.investido / totalInvestido);
        }
      }

      const canReinforceSatellite = satWeightTotal < dynSatTotal;

      // Injetar peso total da categoria e calcular GAPs
      let totalWarChest = 0;
      for (const g of abertos) {
        const cat = g._strategy ? g._strategy.category : "NÃO DEFINIDA";
        const catTotalInv = estrategiaMap.get(cat) || 0;
        g._categoryWeightTotal = totalInvestido > 0 ? (catTotalInv / totalInvestido) : 0;

        const sInfo = g._strategy;
        if (!sInfo) continue;

        const currentWeight = totalInvestido > 0 ? (g.investido / totalInvestido) : 0;
        const deviation = sInfo.target - currentWeight;
      
        // Regra: Desvio > 5% e prioridade Core
        const isUnderweight = deviation > 0.05;
        let shouldReinforce = false;
      
        if (isUnderweight) {
          if (sInfo.category === "CORE") {
            shouldReinforce = true;
          } else if (sInfo.category === "SATELLITE" && canReinforceSatellite) {
            shouldReinforce = true;
          }
        }

        if (shouldReinforce) {
          const amtNeeded = (totalInvestido * sInfo.target) - g.investido;
          totalWarChest += Math.max(0, amtNeeded);
        }

        // Guardar métricas para os cards/modal
        g._shouldReinforceStrategic = shouldReinforce;
        g._strategicNeed = Math.max(0, (totalInvestido * sInfo.target) - g.investido);
        g._currentWeight = currentWeight;
        g._strategicExcess = Math.max(0, g.investido - (totalInvestido * sInfo.target));
      }

      // Lucro Atual (aberto)
      const lucroAberto = abertos.reduce((a, g) => a + (g.lucroAtual || 0), 0);
      const lucroRealizado = gruposArr.reduce((a, g) => a + (g.realizado || 0), 0);
      const lucroTotal = lucroAberto + lucroRealizado;
      const retornoPct = totalInvestido > 0.01 ? (lucroTotal / totalInvestido) * 100 : (lucroTotal > 0 ? 100 : 0);

      // Dividendos
      let rendimentoAnual = 0;
      const eurosMes = new Array(12).fill(0);
      for (const g of abertos) {
        const info = infoMap.get(g.ticker) || {};
        const divUnit = isFiniteNum(info.dividendo) ? Number(info.dividendo) : 0;
        const per = info.periodicidade;
        const mesT = info.mes;
        const payN = pagamentosAno(per);
        rendimentoAnual += g.qtd * divUnit * payN;
        for (const m of mesesPagos(per, mesT)) eurosMes[m] += g.qtd * divUnit;
      }

      // Exposição acima da SMA200
      let somaPesosAcima = 0;
      for (const g of abertos) {
        if (!totalInvestido) continue;
        const w = (g.investido || 0) / totalInvestido;
        const p = g.precoAtual, s200 = g._sma200;
        if (isFiniteNum(p) && isFiniteNum(s200) && Number(p) > Number(s200))
          somaPesosAcima += w;
      }
      const expSMA200Pct = somaPesosAcima * 100;

      // Preencher KPIs
      const elTI = document.getElementById("prtTotalInvestido");
      const elLT = document.getElementById("prtLucroTotal");
      const elLA = document.getElementById("prtLucroAcumulado");
      const elRA = document.getElementById("prtRendimentoAnual");
      const elRP = document.getElementById("prtRetorno");
      const elEX = document.getElementById("prtExpSMA200");
      const elWC = document.getElementById("prtWarChest");

      if (elTI) elTI.textContent = fmtEUR.format(totalInvestido);
      if (elLT) elLT.textContent = fmtEUR.format(lucroAberto);
      if (elLA) elLA.textContent = `Acumulado: ${fmtEUR.format(lucroTotal)}`;
      if (elRA) elRA.textContent = fmtEUR.format(rendimentoAnual);
      if (elRP) elRP.textContent = totalInvestido > 0 ? `${retornoPct.toFixed(1)}%` : "---";

      // XIRR — retorno anualizado real (considera timing das compras/vendas)
      try {
        const xirrFlows = movimentosAsc.map(m => ({
          amount: m.qtd > 0 ? -(m.qtd * m.preco) : (Math.abs(m.qtd) * m.preco),
          date: m.date instanceof Date ? m.date : new Date(m.date),
        })).filter(f => isFinite(f.amount) && f.date instanceof Date && isFinite(f.date));
        const totalMktVal = abertos.reduce((s, g) => s + (isFiniteNum(g.precoAtual) ? g.precoAtual * (g.qtd || 0) : (g.investido || 0)), 0);
        if (totalMktVal > 0 && xirrFlows.length > 0) {
          xirrFlows.push({ amount: totalMktVal, date: new Date() });
          const xirrRate = computeXIRR(xirrFlows);
          const elXIRR = document.getElementById("prtXIRR");
          if (elXIRR) {
            if (xirrRate !== null) {
              const pct = (xirrRate * 100).toFixed(1);
              elXIRR.textContent = `XIRR: ${xirrRate >= 0 ? "+" : ""}${pct}% a.a.`;
              elXIRR.style.color = xirrRate >= 0 ? "#22c55e" : "#ef4444";
            } else {
              elXIRR.textContent = "XIRR: dados insuficientes";
              elXIRR.style.color = "";
            }
          }
        }
      } catch (_) { /* silencioso */ }
      if (elEX) {
        elEX.textContent = `${expSMA200Pct.toFixed(0)}%`;
        const elEXC = document.getElementById("prtExpSMA200Comment");
        if (elEXC) {
          if (expSMA200Pct >= 80) elEXC.textContent = "Tendência de alta forte (Bullish). Mercado muito saudável.";
          else if (expSMA200Pct >= 50) elEXC.textContent = "Tendência positiva. Maioria dos ativos em crescimento.";
          else if (expSMA200Pct >= 20) elEXC.textContent = "Cuidado: Mercado em transição ou zona de incerteza.";
          else elEXC.textContent = "Baixa severa (Bearish). Risco elevado ou oportunidade de fundo.";
          elEXC.style.color = expSMA200Pct >= 50 ? "#22c55e" : (expSMA200Pct >= 20 ? "#f59e0b" : "#ef4444");
        }
      }
      if (elWC) elWC.textContent = fmtEUR.format(totalWarChest);

      // --- RESERVA ESTRATÉGICA ---
      {
        const stratData = (stratSnap && stratSnap.exists()) ? stratSnap.data() : {};
        const cashReservePct = Number(stratData.cashReservePct || 0);
        const cashReserveCard = document.getElementById("prtCashReserveCard");
        if (cashReserveCard) {
          if (cashReservePct > 0) {
            cashReserveCard.style.display = "";
            const portfolioValue = abertos.reduce((s, g) =>
              s + (isFiniteNum(g.precoAtual) ? g.precoAtual * (g.qtd || 0) : (g.investido || 0)), 0);
            const cp = CapitalManager.calculateCashPosition(portfolioValue, stratData);
            const gapColor = cp.gapToReserve > 50 ? "#ef4444" : cp.gapToReserve < -50 ? "#22c55e" : "#f59e0b";
            const dispEl = document.getElementById("prtReservaDisponivel");
            const alvoEl = document.getElementById("prtReservaAlvo");
            const cashEl = document.getElementById("prtReservaCash");
            const gapEl  = document.getElementById("prtReservaGap");
            const apoEl  = document.getElementById("prtReservaAporte");
            if (alvoEl) alvoEl.textContent = fmtEUR.format(cp.targetReserve) + ` (${cashReservePct}%)`;
            if (cashEl) cashEl.textContent  = fmtEUR.format(cp.currentCash);
            if (gapEl) {
              gapEl.textContent = cp.gapToReserve > 0
                ? `Falta ${fmtEUR.format(cp.gapToReserve)}`
                : `Excesso ${fmtEUR.format(Math.abs(cp.gapToReserve))}`;
              gapEl.style.color = gapColor;
            }
            if (apoEl) apoEl.textContent = fmtEUR.format(cp.monthlyBase) + "/mês";
            if (dispEl) {
              dispEl.textContent = fmtEUR.format(cp.availableToInvest);
              dispEl.style.color = cp.availableToInvest > 0 ? "#6366f1" : "#ef4444";
            }
          } else {
            cashReserveCard.style.display = "none";
          }
        }
      }

      // --- CÁLCULO DE COBERTURA ESTRATÉGICA (Task 3 - Dinâmico por Ativo) ---
      let totalCoreTarget = 0;
      let totalSatTarget = 0;

      // 1. Calcular alvos baseados na soma do que o utilizador definiu para cada ticker
      for (const tk in dynTickers) {
        const d = dynTickers[tk];
        if (d.category === "CORE") totalCoreTarget += (d.target || 0);
        if (d.category === "SATELLITE") totalSatTarget += (d.target || 0);
      }

      // Se não houver alvos definidos por ticker, usamos os globais como fallback
      if (totalCoreTarget === 0) totalCoreTarget = (window._dynamicStrategyGlobals.CORE || 0.65) * 100;
      if (totalSatTarget === 0) totalSatTarget = (window._dynamicStrategyGlobals.SATELLITE || 0.35) * 100;
      
      const coreTotal = estrategiaMap.get("CORE") || 0;
      const satTotal = estrategiaMap.get("SATELLITE") || 0;
      
      const coreCurrent = totalInvestido > 0 ? (coreTotal / totalInvestido) * 100 : 0;
      const satCurrent = totalInvestido > 0 ? (satTotal / totalInvestido) * 100 : 0;
      const totalCategorizado = coreCurrent + satCurrent;

      const elAT = document.getElementById("prtAllocTotal");
      const elAC = document.getElementById("prtAllocComment");
      
      if (elAT) elAT.textContent = `${totalCategorizado.toFixed(0)}%`;
      
      if (elAC) {
        let gaps = [];
        // Comparamos o atual com a soma dos alvos definidos
        if (coreCurrent < totalCoreTarget - 0.5) gaps.push(`Core (-${(totalCoreTarget - coreCurrent).toFixed(0)}%)`);
        if (satCurrent < totalSatTarget - 0.5) gaps.push(`Satélite (-${(totalSatTarget - satCurrent).toFixed(0)}%)`);
        
        if (gaps.length > 0) {
          elAC.textContent = `Falta alocar: ${gaps.join(" e ")}`;
          elAC.style.color = "#ef4444";
        } else if (totalCategorizado < 99) {
          elAC.textContent = `${(100 - totalCategorizado).toFixed(0)}% do capital sem categoria`;
          elAC.style.color = "#f59e0b";
        } else {
          elAC.textContent = "Estratégia 100% alocada";
          elAC.style.color = "#22c55e";
        }
        elAC.title = `Atual: Core ${coreCurrent.toFixed(1)}% / Sat ${satCurrent.toFixed(1)}% | Alvo Definido: ${totalCoreTarget.toFixed(0)}% / ${totalSatTarget.toFixed(0)}%`;
      }

      // 2.3) Timeline
      movimentosAsc.sort((a, b) => a.date - b.date);
      const qtyNow = new Map(),
        priceNow = new Map();
      gruposArr.forEach((g) => {
        if (isFiniteNum(g.precoAtual))
          priceNow.set(g.ticker, Number(g.precoAtual));
        qtyNow.set(g.ticker, 0);
      });
      let cumInvest = 0;
      const timelinePoints = [];
      for (const m of movimentosAsc) {
        const deltaInvest = Number(m.qtd) * Number(m.preco);
        cumInvest += deltaInvest;
        qtyNow.set(m.ticker, (qtyNow.get(m.ticker) || 0) + m.qtd);
        let valueNow = 0;
        qtyNow.forEach((q, tk) => {
          const p = priceNow.get(tk);
          if (isFiniteNum(p)) valueNow += q * Number(p);
        });
        timelinePoints.push({
          label: isFinite(m.date?.getTime?.())
            ? new Intl.DateTimeFormat("pt-PT", {
              year: "numeric",
              month: "short",
              day: "2-digit",
            }).format(m.date)
            : "",
          cumInvest,
          valueNow,
        });
      }

      // 3) Render gráficos
      renderEstrategiaDoughnut(estrategiaMap);
      renderAtivosDoughnut(ativosMap, tickerCatMap);
      renderSetorDoughnut(setoresMap);
      renderMercadoDoughnut(mercadosMap);
      renderTop5Bar(gruposArr);
      renderTop5YieldBar(rowsForYield);
      renderTimeline(timelinePoints);
      renderDividendoCalendario12m(eurosMes);

      // 3.1) Pré-cálculo de métricas operacionais para filtros/ordenação
      gruposArr.forEach((g) => {
        const precoAtual = g.precoAtual || 0;
        const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
        const posValNow = g.qtd * precoAtual;
        const pLoss = posValNow - g.investido;
        const pLossPct = g.investido > 0 ? (pLoss / g.investido) * 100 : 0;
        const s200 = g._sma200;
        const isCrypto =
          g.mercado === "Criptomoedas" || g.setor === "Criptomoedas";

        // Validação de sanidade para SMA (evita dados lixo tipo 0.01 vs preço 70)
        const isSmaValid =
          s200 &&
          precoAtual > 0 &&
          s200 > precoAtual * 0.01 &&
          s200 < precoAtual * 100;
        const isBelowSMA200 = isSmaValid && precoAtual < s200;

        const lucroAtual = g.lucroAtual || 0;
        const isBull =
          isSmaValid &&
          precoAtual > s200 &&
          Number(infoMap.get(g.ticker)?.taxaCrescimento_1mes || 0) > 0;

        let estadoOp = "ESPERAR";
        const sInfo = g._strategy;

        // --- LÓGICA ESTRATÉGICA ---
        if (sInfo) {
          if (g._shouldReinforceStrategic) {
            estadoOp = "REFORÇAR";
          } else if ((sInfo.target - g._currentWeight) > 0) {
            // Abaixo do alvo, mas desvio < 5% ou impedido por regra de prioridade
            estadoOp = "MONITORIZAR";
          } else if (g._currentWeight > sInfo.target * 1.5) {
            // Muito acima do alvo (Regra 1: "não vende a não ser que ultrapasse 2x", mas vamos avisar aos 1.5x)
            estadoOp = "REDUZIR";
          } else {
            estadoOp = "MANTER";
          }
        } else {
          // --- LÓGICA TÉCNICA ORIGINAL (para ativos fora da estratégia principal) ---
          if (isCrypto) {
            if (pLossPct < -7) estadoOp = "REFORÇAR";
            else if (pLossPct > 15) estadoOp = "REDUZIR";
          } else {
            if (pLossPct < -4 && (!isSmaValid || isBelowSMA200))
              estadoOp = "REFORÇAR";
            else if (isBull && pLossPct > -2) estadoOp = "COMPRAR";
            else if (pLossPct > 10 && pLossPct <= 25) estadoOp = "REDUZIR";
            else if (pLossPct > 25) estadoOp = "VENDER";
          }
        }

        g._estadoOp = estadoOp;
        g._pLossPct = pLossPct;
        g._distBE = Math.abs(pLossPct);
        const tp2 = tp2NecessarioCalc(g) || precoMedio * 1.15;
        g._distTP =
          precoAtual && tp2 ? Math.abs((tp2 / precoAtual - 1) * 100) : 999;
      });

      renderBubbleChart(abertos, totalInvestido);

      // 4) FILTRAGEM E ORDENAÇÃO
      let filtered = gruposArr.filter((g) => Number.isFinite(g.qtd) && g.qtd > 0);

      // Popular dropdowns de Mercado e Setor (apenas se vazios)
      const fMercado = document.getElementById("fltMercado");
      const fSetor = document.getElementById("fltSetor");
      if (
        fMercado &&
        (!fMercado.options.length || fMercado.options.length <= 1)
      ) {
        // Unir mercados e setores da carteira com os da base de dados (acoesDividendos)
        const dbMarkets = [];
        const dbSectors = [];
        aSnap.forEach(d => {
          const data = d.data();
          if (data.mercado) dbMarkets.push(canon(data.mercado));
          const s = normalizeSector(data);
          if (s && s !== "—") dbSectors.push(s);
        });

        const allMarkets = [
          ...new Set([
            ...gruposArr.map((g) => g.mercado),
            ...dbMarkets
          ].filter(m => m && m !== "—")),
        ].sort();
        
        const allSectors = [
          ...new Set([
            ...gruposArr.map((g) => g.setor),
            ...dbSectors,
            "ETF Países Emergentes",
            "Tecnologia",
            "Finanças",
            "Saúde",
            "Energia",
            "Consumo",
            "Commodities"
          ].filter(s => s && s !== "—")),
        ].sort();

        allMarkets.forEach((m) => fMercado.add(new Option(m, m)));
        allSectors.forEach((s) => fSetor.add(new Option(s, s)));

        // Popular datalists do formulário de registo
        const dlSectors = document.getElementById("setoresList");
        const dlMarkets = document.getElementById("mercadosList");
        if (dlSectors) {
          dlSectors.innerHTML = "";
          allSectors.forEach(s => dlSectors.appendChild(new Option(s, s)));
        }
        if (dlMarkets) {
          dlMarkets.innerHTML = "";
          allMarkets.forEach(m => dlMarkets.appendChild(new Option(m, m)));
        }
      }

      // Aplicar Filtros
      if (fltState.mercado)
        filtered = filtered.filter((g) => g.mercado === fltState.mercado);
      if (fltState.setor)
        filtered = filtered.filter((g) => g.setor === fltState.setor);
      if (fltState.estado)
        filtered = filtered.filter((g) => g._estadoOp === fltState.estado);
      if (fltState.estrategia) {
        filtered = filtered.filter((g) => {
          const cat = g._strategy ? g._strategy.category : "NONE";
          return cat === fltState.estrategia;
        });
      }

      // Aplicar Ordenação
      filtered.sort((a, b) => {
        if (fltState.sort === "queda") return a._pLossPct - b._pLossPct;
        if (fltState.sort === "lucro") return a.lucroAtual - b.lucroAtual;
        if (fltState.sort === "yield") return (b._yCur || 0) - (a._yCur || 0);
        if (fltState.sort === "be_dist") return b._distBE - a._distBE;
        if (fltState.sort === "tp_dist") return a._distTP - b._distTP;
        return a.ticker.localeCompare(b.ticker);
      });
      const finalHtml = filtered
        .map((g) => {
          const info = infoMap.get(g.ticker) || {};
          return renderAssetCard(g, info, fmtEUR, tp2NecessarioCalc(g));
        })
        .join("");

      cont.innerHTML =
        finalHtml ||
        `<div class="muted" style="text-align:center; padding: 40px;">Nenhum ativo corresponde aos filtros selecionados.</div>`;
      applyAllocationPlanToCards();
      if (!document.getElementById("allocationPlannerModal")?.classList.contains("hidden")) renderAllocationPlanner();

      // 🗂️ Posições Fechadas (P&L Realizado)
      const fechadasCont = document.getElementById("listaFechadas");
      if (fechadasCont) {
        const fechadas = gruposArr.filter(g => (g.qtd || 0) <= 0 && Math.abs(g.realizado || 0) > 0.001);
        if (fechadas.length > 0) {
          const totalRealizado = fechadas.reduce((s, g) => s + (g.realizado || 0), 0);
          const corTotal = totalRealizado >= 0 ? "#22c55e" : "#ef4444";
          fechadasCont.innerHTML = `
            <details style="border: 1px solid var(--border); border-radius: 12px; overflow: hidden;">
              <summary style="padding: 14px 18px; cursor: pointer; font-size: 0.85rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; list-style: none; background: var(--card);">
                <span><i class="fas fa-archive" style="color: var(--muted-foreground); margin-right: 8px;"></i>Posições Fechadas <span style="font-weight: 500; color: var(--muted-foreground);">(${fechadas.length})</span></span>
                <span style="color: ${corTotal}; font-size: 0.9rem;">${totalRealizado >= 0 ? "+" : ""}${fmtEUR.format(totalRealizado)} realizados</span>
              </summary>
              <div style="overflow: auto;">
                <table style="width: 100%; font-size: 0.8rem; border-collapse: collapse;">
                  <thead>
                    <tr style="border-bottom: 2px solid var(--border); color: var(--muted-foreground); text-align: left; background: var(--card);">
                      <th style="padding: 10px 14px;">Ticker</th>
                      <th style="padding: 10px 14px;">Nome</th>
                      <th style="padding: 10px 14px; text-align: right;">PM</th>
                      <th style="padding: 10px 14px; text-align: right;">Atual</th>
                      <th style="padding: 10px 14px; text-align: right;">Dif.</th>
                      <th style="padding: 10px 14px; text-align: right;">Lucro Realizado</th>
                      <th style="padding: 10px 14px; text-align: right;">Retorno</th>
                      <th style="padding: 10px 14px; text-align: center;">Lotes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${fechadas.sort((a, b) => (b.realizado || 0) - (a.realizado || 0)).map((g, idx) => {
                      const realizado = g.realizado || 0;
                      const cor = realizado >= 0 ? "#22c55e" : "#ef4444";
                      const nLotes = (_allMovimentos || []).filter(m => m.ticker === g.ticker && m.qtd > 0).length;
                      const retPct = (g.totalBuyValue || 0) > 0
                        ? (realizado / g.totalBuyValue) * 100
                        : null;
                      const isLoss = realizado < 0;
                      const simId = `recSim_${idx}`;
                      const pmHistorico = isFiniteNum(g.custoMedioHistorico) && g.custoMedioHistorico > 0 ? Number(g.custoMedioHistorico) : null;
                      const precoAtual = isFiniteNum(g.precoAtual) ? Number(g.precoAtual) : null;
                      const diffAtualPct = pmHistorico && precoAtual !== null
                        ? ((precoAtual - pmHistorico) / pmHistorico) * 100
                        : null;
                      const corDiff = diffAtualPct === null ? "var(--muted-foreground)" : diffAtualPct >= 0 ? "#22c55e" : "#ef4444";
                      const lossAbs = Math.abs(realizado);
                      const defaultGrowth = 10;
                      return `
                        <tr style="border-bottom: 1px solid var(--border);" onclick="window.openDetails('${g.ticker}')" class="cursor-pointer">
                          <td style="padding: 10px 14px; font-weight: 800; font-family: monospace;">${g.ticker}</td>
                          <td style="padding: 10px 14px; color: var(--muted-foreground);">${g.nome}</td>
                          <td style="padding: 10px 14px; text-align: right; font-weight: 700;">${pmHistorico !== null ? fmtEUR.format(pmHistorico) : "—"}</td>
                          <td style="padding: 10px 14px; text-align: right; font-weight: 700;">${precoAtual !== null ? fmtEUR.format(precoAtual) : "—"}</td>
                          <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${corDiff};">${diffAtualPct !== null ? `${diffAtualPct >= 0 ? "+" : ""}${diffAtualPct.toFixed(2)}%` : "—"}</td>
                          <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${cor};">${realizado >= 0 ? "+" : ""}${fmtEUR.format(realizado)}</td>
                          <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${cor};">${retPct !== null ? `${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%` : "—"}</td>
                          <td style="padding: 10px 14px; text-align: center; color: var(--muted-foreground);">
                            ${nLotes}
                            ${isLoss ? `<button type="button" title="Simular recuperação" onclick="event.stopPropagation(); window.toggleRecSim('${simId}')" style="margin-left: 8px; background: none; border: none; cursor: pointer; color: var(--muted-foreground); padding: 2px;"><i class="fas fa-bullseye"></i></button>` : ""}
                          </td>
                        </tr>
                        ${isLoss ? `
                        <tr id="${simId}" class="hidden">
                          <td colspan="8" style="padding: 12px 14px; background: var(--card);">
                            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.78rem;">
                              <span>Preço atual: <strong>${precoAtual !== null ? fmtEUR.format(precoAtual) : "—"}</strong></span>
                              <label>Crescimento esperado (%):
                                <input type="number" id="${simId}_g" value="${defaultGrowth}" min="0.01" step="0.5"
                                  style="width: 70px; margin-left: 4px;"
                                  onclick="event.stopPropagation();"
                                  oninput="window.calcRecSim('${simId}', ${precoAtual || 0}, ${lossAbs})">
                              </label>
                              <span id="${simId}_out">${calcRecSimHtml(precoAtual, lossAbs, defaultGrowth)}</span>
                            </div>
                          </td>
                        </tr>` : ""}`;
                    }).join("")}
                  </tbody>
                </table>
              </div>
            </details>
          `;
        } else {
          fechadasCont.innerHTML = "";
        }
      }

      wireQuickActions(gruposArr);
      wirePortfolioHelpModal();

      // 🔔 Verificar alertas configurados
      try {
        const triggered = checkAlerts(gruposArr, infoMap);
        triggered.forEach(({ alert, message }) => notifyAlert(message, alert.ticker || ""));
      } catch (_) { /* silencioso */ }
      // Atualizar a referência dos dados para o mapa global
      window._currentGruposArr = gruposArr; 
    } catch (e) {
      console.error("Erro ao processar atividade:", e);
    }

  async function getHistoricalData(ticker) {
    const out = new Map();
    const q = query(collection(db, "historico"), where("ticker", "==", ticker));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const x = d.data();
      if (x.ticker) out.set(cleanTicker(x.ticker), x);
    });
    return out;
  }

  function tp2NecessarioCalc(g) {
    const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
    const objetivo = g.objetivo > 0 ? g.objetivo : 0;
    return objetivo > 0 && g.qtd !== 0
      ? precoMedio + objetivo / (g.qtd || 1)
      : null;
  }

  function renderAssetCard(g, info, fmtEUR, tp2Necessario) {
    // METRICS & BADGES
    const precoAtual = g.precoAtual || 0;
    const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
    const lucroAtual = g.lucroAtual || 0;
    const pLossPct = g._pLossPct || 0;
    const estadoOp = g._estadoOp || "ESPERAR";
    const tp2 = tp2Necessario || precoMedio * 1.15;
    const s200 = g._sma200;
    const stopTec = s200 ? s200 * 0.95 : precoMedio * 0.9;

    const yPct = isFiniteNum(g._yCur) ? (g._yCur * 100).toFixed(2) + "%" : "—";
  
    const formatSmaDelta = (sma, cur) => {
      if (!isFiniteNum(sma) || !isFiniteNum(cur) || sma <= 0) return "—";
      const d = ((cur - sma) / sma) * 100;
      if (Math.abs(d) > 1000) return "—";
      return `${d.toFixed(1)}%`;
    };

    const d50Txt = formatSmaDelta(g._sma50, precoAtual);
    const d200Txt = formatSmaDelta(s200, precoAtual);

    // ESTRATÉGIA INFO
    const sInfo = g._strategy;
    const currentW = (g._currentWeight || 0) * 100;
    const targetW = sInfo ? sInfo.target * 100 : 0;
    const weightColor = currentW < targetW ? "var(--primary)" : "var(--success)";

    let stateColor = "#64748b"; // Muted
    if (estadoOp === "REFORÇAR") stateColor = "#ef4444";
    if (estadoOp === "COMPRAR") stateColor = "#22c55e";
    if (estadoOp === "REDUZIR") stateColor = "#f59e0b";
    if (estadoOp === "VENDER") stateColor = "#ef4444";
    if (estadoOp === "MONITORIZAR" || estadoOp === "MANTER") stateColor = "#3b82f6";

    const objetivoFin = g.objetivo || 0;
    const lucroProgress = objetivoFin > 0 ? (lucroAtual / objetivoFin) * 100 : 0;
    const safeProgress = Math.min(100, Math.max(0, lucroProgress));
    const progressColor = lucroAtual >= objetivoFin ? "var(--success)" : (lucroAtual > 0 ? "#22c55e" : "#ef4444");

    const assetType = getAssetType(g.ticker, { ...info, ...g });
    let typeLabel = "AÇÃO";
    let typeColor = "var(--primary)";
    let typeIcon = "fa-briefcase";

    if (assetType === "etf") {
      typeLabel = "ETF";
      typeColor = "#8b5cf6"; // Violet
      typeIcon = "fa-layer-group";
    } else if (assetType === "crypto") {
      typeLabel = "CRYPTO";
      typeColor = "#f59e0b"; // Amber
      typeIcon = "fa-bitcoin-sign";
    }

    return `
    <div class="asset-card is-collapsed" id="card-${g.ticker}" style="border-top: 3px solid ${typeColor}80;">
      <!-- HEADER: Ticker e Preço -->
      <div class="asset-header">
        <div class="asset-header-clickable" data-toggle-card data-ticker="${g.ticker}">
          <div class="asset-info-main">
            <div class="asset-allocation-badge" title="Alocação no Portfólio">
              ${currentW.toFixed(1)}%
            </div>
            <div class="asset-ticker-box">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; flex-wrap: wrap;">
                <span class="asset-ticker-symbol">${g.ticker}</span>
                <span class="type-badge" style="background: ${typeColor}15; color: ${typeColor}; border: 1px solid ${typeColor}30; font-size: 0.6rem; padding: 1px 6px; border-radius: 4px; font-weight: 800; display: flex; align-items: center; gap: 3px;">
                  <i class="fas ${typeIcon}" style="font-size: 0.55rem;"></i> ${typeLabel}
                </span>
                ${sInfo ? `<span class="strategy-badge strategy-badge--${sInfo.category.toLowerCase()}">${sInfo.category}</span>` : ''}
                <span style="background: ${stateColor}18; color: ${stateColor}; border: 1px solid ${stateColor}35; font-size: 0.6rem; padding: 1px 7px; border-radius: 4px; font-weight: 800; letter-spacing: 0.03em;">${estadoOp}</span>
              </div>
              <span class="asset-name" title="${g.nome}">${g.nome}</span>
            </div>
          </div>
          <div class="asset-price-box">
            <div class="asset-price">${fmtEUR.format(precoAtual)}</div>
            <div class="asset-change ${lucroAtual >= 0 ? "up" : "down"}">
              ${lucroAtual >= 0 ? "+" : ""}${fmtEUR.format(lucroAtual)}
            </div>
          </div>
        </div>

        <div class="asset-header-actions" style="display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
          ${assetType === "etf" ? `
            <button class="btn ghost btn-icon holdings-map-trigger" data-holdings-ticker="${g.ticker}" data-holdings-name="${g.nome}" title="Mapa de Holdings" style="color: #8b5cf6;">
              <i class="fas fa-th" style="font-size: 0.9rem;"></i>
            </button>
            <button class="btn ghost btn-icon holdings-edit-trigger" data-holdings-ticker="${g.ticker}" data-holdings-name="${g.nome}" title="Editar Holdings Manualmente" style="color: #10b981;">
              <i class="fas fa-pen-to-square" style="font-size: 0.9rem;"></i>
            </button>
          ` : ""}
          <button class="btn ghost btn-icon expand-toggle" data-expand-card="${g.ticker}" title="Expandir/Recolher">
            <i class="fas fa-chevron-down" style="font-size: 0.9rem;"></i>
          </button>
          <button class="btn ghost btn-icon" onclick="openDetails('${g.ticker}')" title="Detalhes e Histórico">
            <i class="fas fa-chevron-right" style="font-size: 0.9rem;"></i>
          </button>
        </div>
      </div>

      <!-- PROGRESSO DO OBJETIVO -->
      ${objetivoFin > 0 ? `
      <div class="asset-goal-progress" style="margin: 0 16px 12px; padding: 10px; background: rgba(34, 197, 94, 0.03); border-radius: 8px; border: 1px solid rgba(34, 197, 94, 0.1);">
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 5px;">
          <span style="color: var(--muted-foreground)">Objetivo de Lucro: <strong>${fmtEUR.format(objetivoFin)}</strong></span>
          <span style="color: ${lucroAtual >= objetivoFin ? 'var(--success)' : (lucroAtual > 0 ? '#22c55e' : '#ef4444')}; font-weight: 800;">
            ${lucroProgress.toFixed(1)}%
          </span>
        </div>
        <div style="height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;">
          <div style="width: ${safeProgress}%; height: 100%; background: ${progressColor}; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
        </div>
      </div>
      ` : ""}

      <!-- ALOCAÇÃO ESTRATÉGICA -->
      ${sInfo ? `
      <div class="asset-allocation-box" style="margin: 0 16px 12px; padding: 12px; background: rgba(var(--primary-rgb), 0.03); border-radius: 12px; border: 1.5px solid var(--border);">
        <div style="display: flex; justify-content: space-between; font-size: 0.72rem; margin-bottom: 8px; align-items: center;">
          <span style="color: var(--muted-foreground); font-weight: 600;">Contribuição Estratégica: <span style="color: var(--foreground);">${sInfo.category}</span></span>
          <span class="asset-status-badge" style="background: ${stateColor}15; color: ${stateColor}; border: 1px solid ${stateColor}30; font-size: 0.6rem; padding: 2px 6px;">
            ${estadoOp}
          </span>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px;">
          <div>
             <div style="font-size: 0.6rem; text-transform: uppercase; color: var(--muted-foreground); letter-spacing: 0.5px;">Ativo no Portfólio</div>
             <div style="font-size: 0.9rem; font-weight: 800;">
               ${currentW.toFixed(1)}% <span style="font-size: 0.65rem; font-weight: 500; color: var(--muted-foreground);">/ ${targetW.toFixed(1)}% Alvo</span>
               ${currentW < targetW ? `<span style="display:block; font-size: 0.65rem; color: #ef4444; font-weight: 700; margin-top: 2px;">Faltam ~${((g._strategicNeed || 0) / (precoAtual || 1)).toFixed(2)} un.</span>` : ""}
             </div>
          </div>
          <div style="text-align: right;">
             <div style="font-size: 0.6rem; text-transform: uppercase; color: var(--muted-foreground); letter-spacing: 0.5px;">Peso Categoria (${sInfo.category})</div>
             <div style="font-size: 0.9rem; font-weight: 800;">${((g._categoryWeightTotal || 0) * 100).toFixed(1)}% <span style="font-size: 0.65rem; font-weight: 500; color: var(--muted-foreground);">/ ${((sInfo.category === 'CORE' ? window._dynamicStrategyGlobals.CORE : window._dynamicStrategyGlobals.SATELLITE) * 100).toFixed(0)}% Target</span></div>
          </div>
        </div>

        <div style="height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; display: flex; margin-bottom: 8px;">
          <div style="width: ${Math.min(100, (currentW / targetW) * 100)}%; background: ${weightColor}; transition: width 0.8s ease;"></div>
        </div>

        ${g._shouldReinforceStrategic ? `
          <div style="background: rgba(239, 68, 68, 0.08); padding: 8px; border-radius: 6px; border: 1px dashed rgba(239, 68, 68, 0.3); margin-top: 4px;">
            <div style="font-size: 0.68rem; color: #ef4444; font-weight: 800; display: flex; align-items: center; gap: 6px;">
              <i class="fas fa-bullseye"></i> GAP PARA O ALVO: +${formatNum(g._strategicNeed)}€
            </div>
            <div style="font-size: 0.62rem; color: #ef4444; margin-top: 2px; opacity: 0.9;">
              Comprar <strong>~${formatNum(g._strategicNeed / (precoAtual || 1))} unid.</strong> para equilibrar a posição.
            </div>
          </div>
        ` : ""}
        ${estadoOp === "REDUZIR" && (g._strategicExcess || 0) > 0 ? `
          <div style="background: rgba(245, 158, 11, 0.08); padding: 8px; border-radius: 6px; border: 1px dashed rgba(245, 158, 11, 0.3); margin-top: 4px;">
            <div style="font-size: 0.68rem; color: #f59e0b; font-weight: 800; display: flex; align-items: center; gap: 6px;">
              <i class="fas fa-scissors"></i> EXCESSO DETETADO: -${formatNum(g._strategicExcess)}€
            </div>
            <div style="font-size: 0.62rem; color: #f59e0b; margin-top: 2px; opacity: 0.9;">
              Vender <strong>~${formatNum(g._strategicExcess / (precoAtual || 1))} unid.</strong> para libertar capital estratégico.
            </div>
          </div>
        ` : ""}
      </div>
      ` : ""}

      <!-- METRICS GRID -->
      <div class="asset-metrics-grid">
        <div class="metric-item metric-item--highlight">
          <span class="metric-label">Capital Investido</span>
          <span class="metric-value">${fmtEUR.format(g.investido || 0)}</span>
        </div>
        <div class="metric-item metric-item--highlight">
          <span class="metric-label">Preço Médio</span>
          <span class="metric-value">${fmtEUR.format(precoMedio)}</span>
        </div>
        ${assetType !== "crypto" ? `
        <div class="metric-item">
          <span class="metric-label">Yield (atual)</span>
          <span class="metric-value">${yPct}</span>
        </div>
        ${isFiniteNum(g._divAnual) && g._divAnual > 0 && precoMedio > 0 ? `
        <div class="metric-item" title="Yield sobre o preço médio de custo — cresce com o tempo">
          <span class="metric-label">Yield on Cost</span>
          <span class="metric-value" style="color:#22c55e;">${((g._divAnual / precoMedio) * 100).toFixed(2)}%</span>
        </div>
        ` : ""}
        ` : ""}
        ${assetType === "stock" ? `
        <div class="metric-item">
          <span class="metric-label">P/E Ratio</span>
          <span class="metric-value">${isFiniteNum(g._pe) ? g._pe.toFixed(1) : "—"}</span>
        </div>
        ` : ""}
        <div class="metric-item">
          <span class="metric-label">Rácio R/R</span>
          <span class="metric-value">
            ${(() => {
              const risk = precoAtual - stopTec;
              const reward = tp2 - precoAtual;
              if (risk > 0 && reward > 0) return `1:${(reward / risk).toFixed(1)}`;
              return "—";
            })()}
          </span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Δ SMA50</span>
          <span class="metric-value">${d50Txt}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Δ SMA200</span>
          <span class="metric-value">${d200Txt}</span>
        </div>
      </div>

      <!-- ACTIONS: Compactos em Mobile, Alinhados no PC -->
      <div class="asset-actions">
        <button class="btn premium btn-primary" data-buy="${g.ticker}">
          <i class="fas fa-plus-circle"></i> ${estadoOp === "REFORÇAR" ? "Reforçar" : "Comprar"}
        </button>
        
        <button class="btn outline btn-secondary" data-sell="${g.ticker}">
          Vender
        </button>

        <button class="btn ghost btn-icon ${g.link ? "" : "profile-edit-trigger"}" 
                data-profile-ticker="${g.ticker}"
                onclick="${g.link ? `window.open('${g.link}', '_blank')` : ""}" 
                title="${g.link ? "Abrir link externo" : "Adicionar link"}">
          <i class="fas ${g.link ? "fa-link" : "fa-plus"}"></i>
        </button>

        <button class="btn ghost btn-icon profile-edit-trigger" data-profile-ticker="${g.ticker}" title="Editar perfil do ativo">
          <i class="fas fa-edit"></i>
        </button>

        <button class="btn ghost btn-icon" data-chart="${g.ticker}" title="Ver gráfico técnico">
          <i class="fas fa-chart-area"></i>
        </button>
      </div>
    </div>`;
    }
  }

  // ==========================================
  // 📈 Gráfico Técnico (Compras + SMAs)
  // ==========================================
  async function openTechnicalChart(ticker) {
    const g = byTickerGlobal.get(ticker);
    if (!g) return;

    const modal = document.getElementById("techChartModal");
    const title = document.getElementById("techChartTitle");
    const subtitle = document.getElementById("techChartSubtitle");
    const meta = document.getElementById("techChartMeta");

    if (title) title.textContent = `Análise Técnica: ${ticker}`;
    if (subtitle) subtitle.textContent = g.nome;

    // Filtrar compras para o ticker
    const compras = _allMovimentos
      .filter(m => m.ticker === ticker && m.qtd > 0)
      .sort((a, b) => a.date - b.date);

    if (compras.length === 0) {
      alert("Não foram encontrados registos de compra para este ativo.");
      return;
    }

    modal.classList.remove("hidden");
    await ensureChartJS();

    const el = document.getElementById("chartTechnical");
    if (!el) return;
    if (window.__chTechnical) window.__chTechnical.destroy();

    const labels = compras.map(c => c.date.toLocaleDateString("pt-PT"));
    // Se tivermos preço atual, adicionamos como último ponto
    if (g.precoAtual) {
      labels.push("Atual");
    }

    const dataPrices = compras.map(c => c.preco);
    if (g.precoAtual) dataPrices.push(g.precoAtual);

    const avgPrice = g.custoMedio;
    const sma50 = g._sma50;
    const sma200 = g._sma200;

    const datasets = [
      {
        label: "Preço de Compra / Atual",
        data: dataPrices,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        borderWidth: 3,
        pointRadius: 6,
        pointBackgroundColor: compras.map(() => "#3b82f6").concat(g.precoAtual ? ["#ef4444"] : []),
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        tension: 0.4, // Estilo sinusoidal (curva suave)
        fill: true
      },
      {
        label: "Preço Médio",
        data: new Array(labels.length).fill(avgPrice),
        borderColor: "#94a3b8",
        borderDash: [5, 5],
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      }
    ];

    if (sma50) {
      datasets.push({
        label: "SMA 50",
        data: new Array(labels.length).fill(sma50),
        borderColor: "#f59e0b",
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      });
    }

    if (sma200) {
      datasets.push({
        label: "SMA 200",
        data: new Array(labels.length).fill(sma200),
        borderColor: "#ef4444",
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      });
    }

    window.__chTechnical = new Chart(el, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: chartColors().ticks }, grid: { display: false } },
          y: { 
            ticks: { 
              color: chartColors().ticks,
              callback: (val) => "€" + val.toFixed(2)
            }, 
            grid: { color: chartColors().grid } 
          }
        },
        plugins: {
          legend: { display: true, position: "top", labels: { color: chartColors().ticks, boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            backgroundColor: chartColors().tooltipBg,
            titleColor: chartColors().tooltipFg,
            bodyColor: chartColors().tooltipFg,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: €${ctx.parsed.y.toFixed(2)}`
            }
          }
        }
      }
    });

    // Meta info
    if (meta) {
      const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
      meta.innerHTML = `
        <div class="det-kpi">
          <div class="det-kpi-label">Preço Médio</div>
          <div class="det-kpi-value">${fmtEUR.format(avgPrice)}</div>
        </div>
        <div class="det-kpi">
          <div class="det-kpi-label">SMA 50</div>
          <div class="det-kpi-value" style="color:#f59e0b;">${sma50 ? fmtEUR.format(sma50) : "—"}</div>
        </div>
        <div class="det-kpi">
          <div class="det-kpi-label">SMA 200</div>
          <div class="det-kpi-value" style="color:#ef4444;">${sma200 ? fmtEUR.format(sma200) : "—"}</div>
        </div>
        <div class="det-kpi">
          <div class="det-kpi-label">Distância Médio</div>
          <div class="det-kpi-value" style="color:${g.precoAtual > avgPrice ? "#22c55e" : "#ef4444"}">
            ${g.precoAtual ? (((g.precoAtual - avgPrice)/avgPrice)*100).toFixed(1) + "%" : "—"}
          </div>
        </div>
      `;
    }
  }

  // ==========================================
  // 🚀 Planeador de Investimento IA (DCA)
  // ==========================================
// ===============================
// Plano de Investimento IA - Integração com Capital Manager e DCA
// ===============================
async function wireInvPlan() {
  const btnOpen = document.getElementById("btnOpenInvPlan");
  const modal = document.getElementById("invPlanModal");
  const btnClose = document.getElementById("invPlanClose");
  const btnCalc = document.getElementById("btnCalcInvPlan");
  const inpTotal = document.getElementById("inpInvTotal");
  const inpDca = document.getElementById("inpInvDca");
  const inpCashTarget = document.getElementById("inpInvCashTarget");
  const inpAutoSavings = document.getElementById("inpInvAutoSavings");
  const btnSelectAll = document.getElementById("btnInvSelectAll");
  const btnCopy = document.getElementById("btnCopyInvPlan");
  const inpStrat = document.getElementById("inpInvStrat");
  const assetListCont = document.getElementById("invPlanAssetsList");

  if (!btnOpen || !modal) return;
  if (modal.__wired) return;
  modal.__wired = true;

  btnOpen.addEventListener("click", async (e) => {
    e.stopPropagation();
    modal.classList.remove("hidden");
    
    // Carregar recomendação do CapitalManager
    try {
      const snapConfig = await getDoc(doc(db, "config", "strategy"));
      if (snapConfig.exists()) {
        const config = snapConfig.data();
        const positions = _currentGruposArr.map(g => ({ ticker: g.ticker, ...g }));
        const state = CapitalManager.calculatePortfolioState(positions, _currentAcoesDataMap);
        const smartDca = CapitalManager.getSmartDCA(config.monthlyBase || 0, state);
        const recommendation = CapitalManager.getWarChestRecommendation(state, config.availableCash || 0);
        _invPlanContext = {
          monthlyBase: config.monthlyBase || 0,
          availableCash: config.availableCash || 0,
          state,
          smartDca,
          recommendation
        };

        // Preencher com o valor recomendado (Smart DCA + o que estiver disponível para investir hoje)
        const suggestedCashTarget = Math.max(10, Math.min(25, recommendation.percentage || 15));
        if (config.availableCash > 0) inpTotal.value = Number(config.availableCash).toFixed(0);
        if (config.monthlyBase > 0 && inpDca) inpDca.value = Number(config.monthlyBase).toFixed(0);
        if (inpCashTarget) inpCashTarget.value = suggestedCashTarget.toFixed(0);
        const months = Math.max(1, parseInt(document.getElementById("inpInvMonths")?.value, 10) || 6);
        const suggestedValue = (Number(inpTotal.value) || 0) + ((Number(inpDca?.value) || 0) * months);
        if (suggestedValue > 0) {
          
          // Adicionar uma nota visual no modal
          const noteEl = document.createElement("div");
          noteEl.style.fontSize = "0.75rem";
          noteEl.style.color = "var(--success)";
          noteEl.style.marginBottom = "10px";
          noteEl.innerHTML = `💡 Estratégia IA: manter <strong>${suggestedCashTarget.toFixed(0)}%</strong> em cash e planear <strong>${new Intl.NumberFormat("pt-PT", {style:"currency", currency:"EUR"}).format(suggestedValue)}</strong> entre caixa e DCA.`;
          
          const body = modal.querySelector(".modal-body");
          const existingNote = body.querySelector(".ia-suggestion-note");
          if (existingNote) existingNote.remove();
          noteEl.classList.add("ia-suggestion-note");
          body.prepend(noteEl);
        }
      }
    } catch (err) {
      console.warn("Erro ao carregar estratégia para Plano IA:", err);
    }

    renderInvPlanAssets(_currentGruposArr);
  });

  btnSelectAll?.addEventListener("click", () => {
    const checks = assetListCont.querySelectorAll(".inv-asset-check");
    const anyUnchecked = Array.from(checks).some(c => !c.checked);
    checks.forEach(c => { c.checked = anyUnchecked; });
  });

  inpStrat?.addEventListener("change", (e) => {
    const val = e.target.value;
    const checks = assetListCont.querySelectorAll(".inv-asset-check");
    checks.forEach(c => {
      const cat = c.closest("label").dataset.category;
      c.checked = (val === "ALL") ? true : (cat === val);
    });
  });

  btnClose.addEventListener("click", () => modal.classList.add("hidden"));

  btnCalc.addEventListener("click", () => {
    const cash = parseFloat(inpTotal.value) || 0;
    const monthlyDca = parseFloat(document.getElementById("inpInvDca")?.value) || 0;
    const cashTargetPct = Math.max(0, Math.min(80, parseFloat(document.getElementById("inpInvCashTarget")?.value) || 15));
    const months = parseInt(document.getElementById("inpInvMonths").value) || 1;
    const freq = parseFloat(document.getElementById("inpInvFreq").value) || 1;
    const strat = document.getElementById("inpInvStrat").value;
    
    // Obter selecionados
    const checks = assetListCont.querySelectorAll(".inv-asset-check:checked");
    const selectedTickers = Array.from(checks).map(c => c.value);
    const autoSavingsPlans = parseAutoSavingsPlans(inpAutoSavings?.value || "");
    
    generateInvPlan(cash, monthlyDca, cashTargetPct, months, freq, strat, selectedTickers, _currentGruposArr, _currentAcoesDataMap, autoSavingsPlans);
  });

  btnCopy?.addEventListener("click", async () => {
    if (!_lastInvPlanCopyText) {
      if (typeof showToast === "function") showToast("Gera primeiro o plano de investimento.", "info");
      return;
    }

    try {
      await navigator.clipboard.writeText(_lastInvPlanCopyText);
      if (typeof showToast === "function") showToast("Plano copiado.", "success");
    } catch (err) {
      const temp = document.createElement("textarea");
      temp.value = _lastInvPlanCopyText;
      temp.setAttribute("readonly", "");
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      temp.remove();
      if (typeof showToast === "function") showToast("Plano copiado.", "success");
    }
  });

  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("hidden") && e.key === "Escape") modal.classList.add("hidden");
  });
}

function renderInvPlanAssets(ativos) {
  const container = document.getElementById("invPlanAssetsList");
  if (!container) return;
  
  // Filter only assets that currently compose the portfolio (quantity > 0)
  const ativosEmCarteira = ativos.filter(a => Number.isFinite(a.qtd) && a.qtd > 0);
  
  // Começam desmarcados para permitir que a lógica de "Estratégia" funcione por omissão
  container.innerHTML = ativosEmCarteira.map(a => `
    <label style="display: flex; align-items: center; gap: 4px; background: var(--card); padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; border: 1px solid var(--border); cursor: pointer;" data-category="${a._strategy?.category || 'SATELLITE'}">
      <input type="checkbox" class="inv-asset-check" value="${a.ticker}">
      <span>${a.ticker}</span>
    </label>
  `).join("");
}

function parseAutoSavingsPlans(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [rawTicker, rawAmount] = part.split(":").map(x => x?.trim());
      const ticker = cleanTicker(rawTicker || "");
      const amount = Number(String(rawAmount || "0").replace(",", "."));
      return ticker && amount > 0 ? { ticker, amount } : null;
    })
    .filter(Boolean);
}

function generateInvPlan(cash, monthlyDca, cashTargetPct, months, freq, strategy, selectedTickers, ativos, acoesMap, autoSavingsPlans = []) {
  const resultDiv = document.getElementById("invPlanResult");
  const tableBody = document.getElementById("invPlanTableBody");
  if (!resultDiv || !tableBody) return;
  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

  const totalPeriods = Math.max(1, Math.round(months * freq));
  const dcaTotal = monthlyDca * months;
  const autoMonthlyTotal = autoSavingsPlans.reduce((sum, p) => sum + p.amount, 0);
  const autoTotal = autoMonthlyTotal * months;
  const autoByTicker = new Map();
  autoSavingsPlans.forEach(p => {
    autoByTicker.set(p.ticker, (autoByTicker.get(p.ticker) || 0) + (p.amount * months));
  });
  const currentInvestedValue = ativos
    .filter(a => Number.isFinite(a.qtd) && a.qtd > 0)
    .reduce((sum, a) => {
      const marketValue = (a.precoAtual || 0) * (a.qtd || 0);
      return sum + (marketValue > 0 ? marketValue : (a.investido || 0));
    }, 0);
  const totalResources = cash + dcaTotal;
  const projectedPortfolioTotal = currentInvestedValue + totalResources;
  const targetReserveAmount = projectedPortfolioTotal * (cashTargetPct / 100);
  let reserveAmount = targetReserveAmount;
  let investableTotal = Math.max(0, totalResources - reserveAmount - autoTotal);
  const projectedInvestedTotal = currentInvestedValue + autoTotal + investableTotal;
  let cashToPreserveFromNewCapital = Math.max(0, reserveAmount - cash);
  let perPeriod = investableTotal / totalPeriods;

  document.getElementById("resInvPerPeriod").textContent = fmtEUR.format(perPeriod);
  document.getElementById("resInvTotalPeriods").textContent = totalPeriods.toFixed(0);

  // 1. Definir Pool de Ativos
  let pool = [];
  if (selectedTickers.length > 0) {
    // Obedecer estritamente aos selecionados manualmente
    pool = ativos.filter(a => selectedTickers.includes(a.ticker) && Number.isFinite(a.qtd) && a.qtd > 0);
  } else {
    // Obedecer ao filtro de categoria (CORE/SAT/ALL) e apenas ativos no portfólio
    pool = ativos.filter(a => {
      if (!(Number.isFinite(a.qtd) && a.qtd > 0)) return false;
      const cat = (a._strategy && a._strategy.category) ? a._strategy.category : "NONE";
      if (strategy === "ALL") return true;
      return cat === strategy;
    });
  }

  if (pool.length === 0) {
    tableBody.innerHTML = "<tr><td colspan='3' style='padding:20px; text-align:center; color:var(--muted-foreground);'>Nenhum ativo selecionado ou encontrado para esta estratégia.</td></tr>";
    resultDiv.style.display = "block";
    return;
  }

  // Obter o método de distribuição selecionado
  const method = document.getElementById("inpInvMethod")?.value || "GAP";
  const projectedGapFor = (p) => {
    const currentAssetValue = (((p.precoAtual || 0) * (p.qtd || 0)) || (p.investido || 0)) + (autoByTicker.get(p.ticker) || 0);
    const target = (p._strategy && p._strategy.target > 0) ? p._strategy.target : 0;
    return Math.max(0, (projectedInvestedTotal * target) - currentAssetValue);
  };

  const distributeCapped = (items, totalAmount) => {
    items.forEach(p => { p._allocatedTotal = 0; });
    let remaining = totalAmount;
    let candidates = items.filter(p => p.factor > 0);

    for (let guard = 0; guard < 20 && remaining > 0.0001 && candidates.length > 0; guard++) {
      const factorSum = candidates.reduce((sum, p) => sum + p.factor, 0);
      if (factorSum <= 0) break;

      const next = [];
      let allocatedThisRound = 0;

      candidates.forEach(p => {
        const desired = remaining * (p.factor / factorSum);
        const cap = Number.isFinite(p._finalGap) ? Math.max(0, p._finalGap - p._allocatedTotal) : desired;
        const allocated = Math.min(desired, cap);
        p._allocatedTotal += allocated;
        allocatedThisRound += allocated;
        if (cap - allocated > 0.0001) next.push(p);
      });

      if (allocatedThisRound <= 0.0001) break;
      remaining -= allocatedThisRound;
      candidates = next;
    }

    items.forEach(p => {
      p._normalizedWeight = totalAmount > 0 ? p._allocatedTotal / totalAmount : 0;
    });
  };

  // 2. Calcular Fatores de Ponderação (Gaps vs. Targets / Value Averaging)
  const poolWithFactors = pool.map(p => {
    const finalGap = projectedGapFor(p);
    let factor = 0;
    if (method === "GAP") {
      factor = finalGap;
    } else if (method === "VALUE_AVG") {
      // Value Averaging: fator proporcional ao target mas ponderado pelo gap atual
      // Quanto maior o gap (ativo mais abaixo do target), maior o peso relativo
      const target = (p._strategy && p._strategy.target > 0) ? p._strategy.target : 0.01;
      const currentMktVal = (p.precoAtual || 0) * (p.qtd || 0) || (p.investido || 0);
      const midwayTarget = projectedInvestedTotal * target;
      // VA factor = "quanto falta para o target desta semana" normalizado
      const vaGap = Math.max(0, midwayTarget - currentMktVal);
      factor = vaGap > 0 ? vaGap : target * 0.1; // mínimo simbólico
    } else {
      // TARGET: proporcional ao alvo estratégico
      factor = (finalGap > 0 && p._strategy?.target > 0) ? p._strategy.target : 0;
    }
    return { ...p, factor, _finalGap: finalGap };
  });

  // Calcular soma total dos fatores
  let sumFactors = poolWithFactors.reduce((acc, p) => acc + p.factor, 0);

  // Se a soma for zero (ex: método GAP selecionado mas todos os ativos selecionados já atingiram ou excederam o target),
  // reverte-se automaticamente para a proporção dos targets estáticos.
  let isFallback = false;
  if (sumFactors === 0) {
    document.getElementById("resInvPerPeriod").textContent = fmtEUR.format(0);
    isFallback = true;
    const fallbackAsset = poolWithFactors.find(p => p.ticker === "VWCE")
      || poolWithFactors
        .filter(p => p._strategy?.category === "CORE")
        .sort((a, b) => (b._strategy?.target || 0) - (a._strategy?.target || 0))[0]
      || null;
    poolWithFactors.forEach(p => {
      p.factor = fallbackAsset && p.ticker === fallbackAsset.ticker ? 1 : 0;
    });
    sumFactors = poolWithFactors.reduce((acc, p) => acc + p.factor, 0);
  }

  if (sumFactors === 0) {
    tableBody.innerHTML = "<tr><td colspan='3' style='padding:20px; text-align:center; color:var(--muted-foreground);'>Todos os ativos elegíveis estão acima do target final. Deployment pausado para preservar cash.</td></tr>";
    renderAnnualDcaPlan({
      total: 0,
      cash,
      monthlyDca,
      cashTargetPct,
      dcaTotal,
      autoSavingsPlans,
      autoMonthlyTotal,
      autoTotal,
      totalResources,
      projectedPortfolioTotal,
      currentInvestedValue,
      targetReserveAmount,
      cashToPreserveFromNewCapital: totalResources,
      excessCashFromCaps: 0,
      reserveAmount: totalResources,
      investableTotal: 0,
      months,
      freq,
      totalPeriods,
      perPeriod: 0,
      poolWithFactors,
      sumFactors,
      strategy,
      method,
      isFallback
    });
    resultDiv.style.display = "block";
    return;
  }

  const totalGapCapacity = isFallback
    ? investableTotal
    : poolWithFactors.reduce((sum, p) => sum + (p._finalGap || 0), 0);

  let excessCashFromCaps = 0;
  if (!isFallback && investableTotal > totalGapCapacity) {
    const excessToCash = investableTotal - totalGapCapacity;
    excessCashFromCaps = excessToCash;
    investableTotal = totalGapCapacity;
    reserveAmount += excessToCash;
    cashToPreserveFromNewCapital += excessToCash;
  }
  perPeriod = investableTotal / totalPeriods;
  distributeCapped(poolWithFactors, investableTotal);
  document.getElementById("resInvPerPeriod").textContent = fmtEUR.format(perPeriod);

  // Gerir aviso visual de Fallback
  const existingWarning = resultDiv.querySelector(".inv-plan-warning");
  if (existingWarning) existingWarning.remove();
  
  if (isFallback && (method === "GAP" || method === "VALUE_AVG")) {
    const warning = document.createElement("div");
    warning.className = "inv-plan-warning";
    warning.style.fontSize = "0.7rem";
    warning.style.color = "#ef4444";
    warning.style.background = "rgba(239, 68, 68, 0.08)";
    warning.style.padding = "8px";
    warning.style.borderRadius = "6px";
    warning.style.border = "1px dashed rgba(239, 68, 68, 0.3)";
    warning.style.marginBottom = "12px";
    warning.innerHTML = `💡 <strong>Info:</strong> todos os ativos elegíveis já estavam acima do target final. O fallback conservador direcionou o capital para VWCE/CORE.`;
    resultDiv.prepend(warning);
  }

  // 3. Gerar Plano com Pesos Normalizados e Est. Unidades

  if (method === "VALUE_AVG") {
    // Value Averaging: tabela de cenários — o que investir conforme queda/subida do mercado
    const sortedVA = [...poolWithFactors].sort((a, b) => (b._allocatedTotal || 0) - (a._allocatedTotal || 0));
    tableBody.innerHTML = sortedVA.map(p => {
      const baseAlloc = (p._allocatedTotal || 0) / totalPeriods;
      const preco = p.precoAtual || 0;
      // VA: em queda de 10% investimos ~120% do base; em subida de 10% investimos ~80% do base
      const vaDown10 = baseAlloc * 1.20;
      const vaDown20 = baseAlloc * 1.45;
      const vaFlat   = baseAlloc;
      const vaUp10   = baseAlloc * 0.80;
      const vaUp20   = baseAlloc * 0.55;
      const units = preco > 0 ? (baseAlloc / preco) : 0;
      const normalizedWeight = p._normalizedWeight || 0;
      return `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 4px;">
            <strong>${p.ticker}</strong>
            <div style="font-size:0.62rem;color:var(--muted-foreground);margin-top:2px;">
              ${p._strategy?.category || 'SAT'} • ${preco > 0 ? fmtEUR.format(preco) : '—'} • ${(normalizedWeight * 100).toFixed(1)}%
            </div>
          </td>
          <td style="padding:8px 4px;text-align:right;font-weight:700;color:#8b5cf6;">
            ${fmtEUR.format(vaFlat)}
            <div style="font-size:0.6rem;color:var(--muted-foreground);">~${units > 0 ? units.toFixed(2) : '—'} un.</div>
          </td>
          <td style="padding:8px 4px;text-align:right;font-size:0.72rem;">
            <span style="color:#ef4444;display:block;">-20%: ${fmtEUR.format(vaDown20)}</span>
            <span style="color:#f59e0b;display:block;">-10%: ${fmtEUR.format(vaDown10)}</span>
            <span style="color:#94a3b8;display:block;">+10%: ${fmtEUR.format(vaUp10)}</span>
            <span style="color:#22c55e;display:block;">+20%: ${fmtEUR.format(vaUp20)}</span>
          </td>
        </tr>`;
    }).join("");
    // Cabeçalho da tabela — troca header
    const thead = tableBody.closest("table")?.querySelector("thead tr");
    if (thead) thead.innerHTML = `<th style="padding:8px 4px;">Ativo</th><th style="padding:8px 4px;text-align:right;">Base (flat)</th><th style="padding:8px 4px;text-align:right;">VA por cenário/período</th>`;
    // Nota explicativa
    const vaNote = document.createElement("div");
    vaNote.className = "inv-plan-warning";
    vaNote.style.cssText = "font-size:0.7rem;color:#8b5cf6;background:rgba(139,92,246,0.06);padding:10px;border-radius:6px;border:1px dashed rgba(139,92,246,0.3);margin-bottom:12px;";
    vaNote.innerHTML = `📐 <strong>Value Averaging:</strong> investe mais quando o ativo cai abaixo do caminho alvo e menos quando sobe acima. Monitoriza mensalmente e ajusta o montante real conforme a cotação na data de compra. O valor "Base (flat)" assume mercado estável.`;
    resultDiv.prepend(vaNote);
  } else {
    const thead = tableBody.closest("table")?.querySelector("thead tr");
    if (thead) thead.innerHTML = `<th style="padding:8px 4px;">Ativo</th><th style="padding:8px 4px;text-align:right;">% Carteira</th><th style="padding:8px 4px;text-align:right;">Por Período</th>`;
    tableBody.innerHTML = poolWithFactors
      .sort((a, b) => b._allocatedTotal - a._allocatedTotal)
      .map(p => {
        const normalizedWeight = p._normalizedWeight || 0;
        const allocated = (p._allocatedTotal || 0) / totalPeriods;
        const preco = p.precoAtual || 0;
        const units = preco > 0 ? (allocated / preco) : 0;
        return `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 8px 4px;">
              <strong>${p.ticker}</strong>
              <div style="font-size: 0.65rem; color: var(--muted-foreground); margin-top: 2px;">
                ${p._strategy?.category || 'SAT'} • ${preco > 0 ? fmtEUR.format(preco) : '—'}
              </div>
            </td>
            <td style="padding: 8px 4px; text-align: right; font-weight: 500;">
              ${(normalizedWeight * 100).toFixed(1)}%
            </td>
            <td style="padding: 8px 4px; text-align: right; font-weight: 700; color: #8b5cf6;">
              ${fmtEUR.format(allocated)}
              <div style="font-size: 0.65rem; color: var(--success); font-weight: 700; margin-top: 2px;">
                ${units > 0 ? `~${units.toFixed(2)} un.` : '—'}
              </div>
            </td>
          </tr>
        `;
      }).join("");
  }

  renderAnnualDcaPlan({
    total: investableTotal,
    cash,
    monthlyDca,
    cashTargetPct,
    dcaTotal,
    autoSavingsPlans,
    autoMonthlyTotal,
    autoTotal,
    totalResources,
    projectedPortfolioTotal,
    currentInvestedValue,
    targetReserveAmount,
    cashToPreserveFromNewCapital,
    excessCashFromCaps,
    reserveAmount,
    investableTotal,
    months,
    freq,
    totalPeriods,
    perPeriod,
    poolWithFactors,
    sumFactors,
    strategy,
    method,
    isFallback
  });

  resultDiv.style.display = "block";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPlanMonthLabel(offset) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return date.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
}

function renderAnnualDcaPlan(plan) {
  const summary = document.getElementById("invPlanSummaryGrid");
  const timeline = document.getElementById("invPlanTimeline");
  const projection = document.getElementById("invPlanProjection");
  const narrative = document.getElementById("invPlanNarrative");
  const statusBadge = document.getElementById("invPlanStatusBadge");
  const reviewLabel = document.getElementById("invPlanReviewLabel");
  const warningsEl = document.getElementById("invPlanWarnings");
  if (!summary || !timeline || !projection) return;

  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  const ctx = _invPlanContext || {};
  const monthlyEnvelope = plan.months > 0 ? plan.investableTotal / plan.months : plan.investableTotal;
  const currentValue = plan.currentInvestedValue ?? _currentGruposArr
    .filter(g => Number.isFinite(g.qtd) && g.qtd > 0)
    .reduce((sum, g) => sum + ((g.precoAtual || 0) * (g.qtd || 0)), 0);
  const reservePct = plan.cashTargetPct || 0;
  const autoMonthlyText = (plan.autoSavingsPlans || [])
    .map(p => `${p.ticker} ${fmtEUR.format(p.amount)}`)
    .join(" + ");
  const topTargets = [...plan.poolWithFactors]
    .sort((a, b) => (b._allocatedTotal || 0) - (a._allocatedTotal || 0))
    .slice(0, 3)
    .map(p => p.ticker)
    .join(" / ") || "ativos selecionados";

  const strategyLabel = plan.strategy === "ALL" ? "Mista" : plan.strategy;
  const methodLabel = plan.isFallback
    ? "Fallback VWCE/CORE"
    : plan.method === "GAP"
      ? "Gaps finais projetados"
      : plan.method === "VALUE_AVG"
        ? "Value Averaging (VA)"
        : "Proporcional aos targets elegíveis";

  if (narrative) {
    narrative.textContent = `${fmtEUR.format(plan.cash)} em cash + ${fmtEUR.format(plan.monthlyDca)}/mes de DCA. Auto: ${fmtEUR.format(plan.autoMonthlyTotal || 0)}/mes. Manual: ${fmtEUR.format(plan.perPeriod)} por periodo.`;
  }
  if (statusBadge) statusBadge.textContent = ctx.state?.label || "DCA";
  if (reviewLabel) reviewLabel.textContent = plan.months >= 12 ? "Trimestral + anual" : "No fecho";

  const allocationLines = [...plan.poolWithFactors]
    .sort((a, b) => (b._allocatedTotal || 0) - (a._allocatedTotal || 0))
    .map(p => {
      const amount = p._allocatedTotal || 0;
      const weight = plan.investableTotal > 0 ? amount / plan.investableTotal : 0;
      return `- ${p.ticker}: ${(weight * 100).toFixed(1)}% | ${fmtEUR.format(amount)}`;
    });

  summary.innerHTML = [
    ["Cash inicial", fmtEUR.format(plan.cash)],
    ["DCA total", fmtEUR.format(plan.dcaTotal)],
    ["Savings auto", `${fmtEUR.format(plan.autoTotal || 0)} (${fmtEUR.format(plan.autoMonthlyTotal || 0)}/mes)`],
    ["Portfolio final", fmtEUR.format(plan.projectedPortfolioTotal)],
    ["Reserva minima", `${fmtEUR.format(plan.targetReserveAmount)} (${reservePct.toFixed(0)}%)`],
    ["Cash final", fmtEUR.format(plan.reserveAmount)],
    ["Cash extra gaps", fmtEUR.format(plan.excessCashFromCaps || 0)],
    ["A distribuir", fmtEUR.format(plan.investableTotal)],
    ["Prioridade", escapeHtml(topTargets)]
  ].map(([label, value]) => `
    <div class="inv-plan-kpi">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");

  const warnings = [];
  if ((plan.autoTotal || 0) > 0) {
    warnings.push(`Savings automáticos deduzidos: ${fmtEUR.format(plan.autoTotal)} no período.`);
  }
  if ((plan.excessCashFromCaps || 0) > 0) {
    warnings.push(`${fmtEUR.format(plan.excessCashFromCaps)} ficam em cash porque os gaps/caps elegíveis foram esgotados.`);
  }
  const underfed = [...plan.poolWithFactors]
    .filter(p => ((p._finalGap || 0) - (p._allocatedTotal || 0)) > 1)
    .sort((a, b) => ((b._finalGap || 0) - (b._allocatedTotal || 0)) - ((a._finalGap || 0) - (a._allocatedTotal || 0)))
    .slice(0, 3);
  underfed.forEach(p => {
    warnings.push(`${p.ticker} ainda fica abaixo do target final em ~${fmtEUR.format((p._finalGap || 0) - (p._allocatedTotal || 0))}.`);
  });
  if (warningsEl) {
    warningsEl.style.display = warnings.length ? "grid" : "none";
    warningsEl.style.gap = "6px";
    warningsEl.innerHTML = warnings.map(w => `
      <div style="font-size:0.72rem; line-height:1.35; color:var(--muted-foreground); border:1px solid var(--border); border-radius:8px; padding:8px 10px; background:rgba(245,158,11,.08);">
        ${escapeHtml(w)}
      </div>
    `).join("");
  }

  const monthCopyLines = [];
  const rows = Array.from({ length: plan.months }, (_, idx) => {
    const monthNo = idx + 1;
    const isReview = monthNo % 3 === 0 || monthNo === plan.months;
    const investedSoFar = monthlyEnvelope * monthNo;
    const monthTargets = [...plan.poolWithFactors]
      .sort((a, b) => (b._allocatedTotal || 0) - (a._allocatedTotal || 0))
      .filter(p => (p._allocatedTotal || 0) > 0)
      .map(p => {
        const weight = plan.investableTotal > 0 ? (p._allocatedTotal || 0) / plan.investableTotal : 0;
        return `${p.ticker} ${fmtEUR.format(monthlyEnvelope * weight)}`;
      })
      .join(" + ");
    const autoLine = autoMonthlyText ? `Auto: ${autoMonthlyText}` : "Auto: sem savings definidos";
    const manualLine = `Manual: ${monthTargets || "sem deployment manual"}`;
    monthCopyLines.push(`- ${getPlanMonthLabel(idx)}: ${autoLine} | ${manualLine}${isReview ? " | revisão" : ""}`);
    const reviewText = isReview
      ? " Revisao: pesos vs targets, cash reserve e desvios acima de 5pp."
      : "";

    return `
      <div class="inv-plan-month ${isReview ? "review" : ""}">
        <div class="inv-plan-month-title">
          <strong>${escapeHtml(getPlanMonthLabel(idx))}</strong>
          <span>${fmtEUR.format(monthlyEnvelope)}</span>
        </div>
        <p>${autoLine}</p>
        <p>${manualLine}${reviewText}</p>
        <p>Manual acumulado: ${fmtEUR.format(investedSoFar)}. Cash final preservado: ${fmtEUR.format(plan.reserveAmount)}</p>
      </div>
    `;
  });
  timeline.innerHTML = rows.join("");

  _lastInvPlanCopyText = [
    "Plano de Investimento DCA",
    "",
    `Cash inicial: ${fmtEUR.format(plan.cash)}`,
    `DCA mensal: ${fmtEUR.format(plan.monthlyDca)}`,
    `Savings automaticos/mês: ${autoMonthlyText || "sem savings definidos"}`,
    `Savings automaticos no periodo: ${fmtEUR.format(plan.autoTotal || 0)}`,
    `Duração: ${plan.months} meses`,
    `Cash alvo: ${reservePct.toFixed(0)}%`,
    `Portfolio projetado no fim: ${fmtEUR.format(plan.projectedPortfolioTotal)}`,
    `Reserva minima alvo: ${fmtEUR.format(plan.targetReserveAmount)}`,
    `Cash final preservado: ${fmtEUR.format(plan.reserveAmount)}`,
    `Cash adicional a preservar: ${fmtEUR.format(plan.cashToPreserveFromNewCapital || 0)}`,
    `Cash extra por falta de gaps/caps: ${fmtEUR.format(plan.excessCashFromCaps || 0)}`,
    `Capital manual a distribuir: ${fmtEUR.format(plan.investableTotal)}`,
    `Método: ${methodLabel} (${strategyLabel})`,
    "",
    "Alocação por ativo:",
    ...(allocationLines.length ? allocationLines : ["- Sem ativos selecionados"]),
    "",
    "Avisos:",
    ...(warnings.length ? warnings.map(w => `- ${w}`) : ["- Sem avisos"]),
    "",
    "Timeline:",
    ...monthCopyLines
  ].join("\n");

  const midMonth = Math.max(1, Math.ceil(plan.months / 2));
  projection.innerHTML = [
    ["Hoje", fmtEUR.format(currentValue + plan.cash), `Investido + cash inicial`],
    [`${midMonth} meses`, fmtEUR.format(currentValue + plan.cash + (plan.monthlyDca * midMonth)), "Sem valorizacao de mercado"],
    [`${plan.months} meses`, fmtEUR.format(plan.projectedPortfolioTotal), `Cash final preservado: ${fmtEUR.format(plan.reserveAmount)}`]
  ].map(([label, value, sub]) => `
    <div class="inv-plan-kpi">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${sub}</small>
    </div>
  `).join("");
}

// ===============================
// Mapa de Holdings (Treemap)
// ===============================
let _holdingsChart = null;
let _holdingsGeoChart = null;
let _holdingsGlobalViewData = null;
let _holdingsViewSubtitle = "";
let _holdingsEventsWired = false;

function clearHoldingsTreemap() {
  document.getElementById("treemap-tooltip")?.remove();
  const container = document.getElementById("holdingsMapContainer");
  if (container) container.innerHTML = "";
  _holdingsChart = null;
}

function wireHoldingsMapEvents() {
  if (_holdingsEventsWired) return;
  _holdingsEventsWired = true;

  // Injetar função de debug global para o utilizador
  window.debugHoldings = async () => {
    console.log("🚀 [DEBUG] Iniciando diagnóstico manual...");
    try {
      const snap = await getDocs(collection(db, "etfHoldings"));
      console.log("📥 [DEBUG] Documentos na coleção 'etfHoldings':", snap.docs.map(d => d.id));
      if (snap.empty) console.warn("⚠️ [DEBUG] A coleção parece estar VAZIA para este utilizador/projeto.");
      else console.log("✅ [DEBUG] Amostra do 1º doc:", snap.docs[0].data());
    } catch (e) {
      console.error("🔥 [DEBUG] Erro ao ler coleção:", e);
    }
  };

  const btnGlobal = document.getElementById("btnOpenGlobalHoldingsMap");
  const modal = document.getElementById("holdingsMapModal");
  const closeBtns = [
    document.getElementById("holdingsMapClose"),
    document.getElementById("holdingsMapCloseBtn")
  ];

  if (!modal) return;

  const closeHoldings = () => {
    modal.classList.add("hidden");
    if (_holdingsChart) {
      clearHoldingsTreemap();
    }
    if (_holdingsGeoChart) {
      _holdingsGeoChart.dispose();
      _holdingsGeoChart = null;
    }
    _holdingsGlobalViewData = null;
    document.getElementById("holdingsMapViewTabs")?.classList.add("hidden");
  };

  closeBtns.forEach(btn => btn?.addEventListener("click", closeHoldings));
  modal.addEventListener("click", (e) => {
    if (e.target.id === "holdingsMapModal") closeHoldings();
  });

  // --- Eventos do Editor de Holdings ---
  const editModal = document.getElementById("holdingsEditModal");
  const editInput = document.getElementById("holdingsInput");
  const sectorsInput = document.getElementById("holdingsSectorsInput");
  const geographyInput = document.getElementById("holdingsGeographyInput");
  const btnSave = document.getElementById("holdingsEditSave");
  const statusEl = document.getElementById("editHoldingsStatus");
  let currentEditingTicker = "";

  const parseCompositionLines = (text, kind) => {
    const rows = [];
    String(text || "").split("\n").filter(l => l.trim() !== "").forEach(line => {
      const parts = line.split(",");
      if (kind === "holdings") {
        if (parts.length < 3) return;
        const weightStr = parts.pop().trim();
        const symbol = parts.pop().trim();
        const name = parts.join(",").trim();
        rows.push({ name, symbol, weight: parseFloat(weightStr.replace(",", ".")) });
        return;
      }
      if (parts.length < 2) return;
      const weightStr = parts.pop().trim();
      const name = parts.join(",").trim();
      rows.push({ name, weight: parseFloat(weightStr.replace(",", ".")) });
    });
    return rows.filter(r => r.name && Number.isFinite(Number(r.weight)));
  };

  const formatCompositionLines = (items, kind) => {
    if (!Array.isArray(items)) return "";
    return items.map(item => {
      if (kind === "holdings") return `${item.name || item.symbol || ""}, ${item.symbol || item.ticker || ""}, ${item.weight ?? ""}`;
      return `${item.name || item.label || item.country || item.sector || ""}, ${item.weight ?? item.value ?? ""}`;
    }).join("\n");
  };

  document.querySelectorAll(".holdings-edit-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.holdingsTab;
      document.querySelectorAll(".holdings-edit-tab").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".holdings-edit-panel").forEach(panel => {
        panel.classList.toggle("hidden", panel.dataset.holdingsPanel !== target);
      });
    });
  });

  document.getElementById("listaAtividades")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".holdings-edit-trigger");
    if (btn) {
      const ticker = btn.getAttribute("data-holdings-ticker");
      const name = btn.getAttribute("data-holdings-name");
      currentEditingTicker = ticker;
      
      document.getElementById("editHoldingsTitle").textContent = `Holdings: ${ticker}`;
      editModal.classList.remove("hidden");
      editInput.value = "A carregar...";
      
      try {
        const cleanT = cleanTicker(ticker).toUpperCase();
        const snap = await getDocs(collection(db, "etfHoldings"));
        let existingData = null;
        let exactMatch = false;
        snap.forEach(d => {
          const t = String(d.data().ticker || d.id).toUpperCase();
          if (t === cleanT) {
            existingData = d.data();
            exactMatch = true;
          } else if (!exactMatch && t.split('.')[0] === cleanT.split('.')[0]) {
            existingData = d.data();
          }
        });

        editInput.value = formatCompositionLines(existingData?.holdings, "holdings");
        if (sectorsInput) sectorsInput.value = formatCompositionLines(existingData?.sectors, "sectors");
        if (geographyInput) geographyInput.value = formatCompositionLines(existingData?.geography, "geography");
      } catch (err) {
        editInput.value = "Erro ao carregar dados.";
        if (sectorsInput) sectorsInput.value = "";
        if (geographyInput) geographyInput.value = "";
      }
    }
  });

  const closeEdit = () => editModal.classList.add("hidden");
  document.getElementById("holdingsEditClose")?.addEventListener("click", closeEdit);
  document.getElementById("holdingsEditCancel")?.addEventListener("click", closeEdit);
  
  btnSave?.addEventListener("click", async () => {
    const text = editInput.value.trim();
    const sectorText = sectorsInput?.value.trim() || "";
    const geographyText = geographyInput?.value.trim() || "";
    const lines = text.split("\n").filter(l => l.trim() !== "");
    const holdings = [];
    let sectors = [];
    let geography = [];

    try {
      sectors = parseCompositionLines(sectorText, "sectors");
      geography = parseCompositionLines(geographyText, "geography");
      lines.forEach(line => {
        const parts = line.split(",");
        if (parts.length >= 3) {
          const weightStr = parts.pop().trim();
          const symbol = parts.pop().trim();
          const name = parts.join(",").trim();
          holdings.push({
            name: name,
            symbol: symbol,
            weight: parseFloat(weightStr.replace(",", "."))
          });
        }
      });

      if (holdings.length === 0 && text !== "") {
        throw new Error("Formato inválido. Usa: Nome, Símbolo, Peso");
      }

      if (sectors.length === 0 && sectorText !== "") {
        throw new Error("Formato invalido em Setores. Usa: Setor, Peso");
      }
      if (geography.length === 0 && geographyText !== "") {
        throw new Error("Formato invalido em Geografia. Usa: Pais/Regiao, Peso");
      }

      statusEl.textContent = "A gravar...";
      const cleanT = cleanTicker(currentEditingTicker).toUpperCase();
      
      await setDoc(doc(db, "etfHoldings", cleanT), {
        ticker: cleanT,
        name: document.getElementById("editHoldingsTitle").textContent.replace("Holdings: ", ""),
        holdings: holdings,
        sectors: sectors,
        geography: geography,
        updatedAt: serverTimestamp(),
        manual: true
      }, { merge: true });

      statusEl.style.color = "#10b981";
      statusEl.textContent = "✅ Gravado com sucesso!";
      setTimeout(() => {
        closeEdit();
        statusEl.textContent = "";
      }, 1000);

    } catch (err) {
      statusEl.style.color = "#ef4444";
      statusEl.textContent = `❌ Erro: ${err.message}`;
    }
  });

  const escHandler = (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeHoldings();
  };
  document.addEventListener("keydown", escHandler);

  btnGlobal?.addEventListener("click", () => {
    modal.classList.remove("hidden");
    renderGlobalHoldingsMap(window._currentGruposArr || []);
  });

  document.getElementById("holdingsMapViewTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-map-view]");
    if (!btn || !_holdingsGlobalViewData) return;
    const view = btn.getAttribute("data-map-view") || "holdings";
    document.querySelectorAll(".holdings-map-view").forEach(x => x.classList.toggle("active", x === btn));
    renderGlobalHoldingsView(view);
  });

  // Nota: Os botões individuais (holdings-map-trigger) são agora geridos
  // por delegação na função wireAtividadeListeners().
  
  // Expor função de carga para o editor (chamada pela delegação central)
  window.loadHoldingsForEdit = async (ticker) => {
    currentEditingTicker = ticker;
    const editInput = document.getElementById("holdingsInput");
    const sectorsInput = document.getElementById("holdingsSectorsInput");
    const geographyInput = document.getElementById("holdingsGeographyInput");
    if (!editInput) return;
    editInput.value = "A carregar...";
    if (sectorsInput) sectorsInput.value = "A carregar...";
    if (geographyInput) geographyInput.value = "A carregar...";
    try {
      const cleanT = cleanTicker(ticker).toUpperCase();
      const snap = await getDocs(collection(db, "etfHoldings"));
      let existingData = null;
      let exactMatch = false;
      snap.forEach(d => {
        const t = String(d.data().ticker || d.id).toUpperCase();
        if (t === cleanT) {
          existingData = d.data();
          exactMatch = true;
        } else if (!exactMatch && t.split('.')[0] === cleanT.split('.')[0]) {
          existingData = d.data();
        }
      });

      editInput.value = formatCompositionLines(existingData?.holdings, "holdings");
      if (sectorsInput) sectorsInput.value = formatCompositionLines(existingData?.sectors, "sectors");
      if (geographyInput) geographyInput.value = formatCompositionLines(existingData?.geography, "geography");
    } catch (err) {
      editInput.value = "Erro ao carregar dados.";
      if (sectorsInput) sectorsInput.value = "";
      if (geographyInput) geographyInput.value = "";
    }
  };
}

async function renderGlobalHoldingsMap(gruposArr) {
  console.log("🔍 [HoldingsMap] Iniciando render global consolidado.");
  const titleEl = document.getElementById("holdingsMapTitle");
  const subtitleEl = document.getElementById("holdingsMapSubtitle");
  const loadingEl = document.getElementById("holdingsMapLoading");
  const emptyEl = document.getElementById("holdingsMapEmpty");
  const container = document.getElementById("holdingsMapContainer");
  const tabsEl = document.getElementById("holdingsMapViewTabs");

  titleEl.textContent = "Big Mapa de Holdings (Consolidado)";
  subtitleEl.textContent = "Agregação de todas as holdings subjacentes detetadas";
  loadingEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");
  tabsEl?.classList.remove("hidden");
  container.innerHTML = "";
  _holdingsGlobalViewData = null;

  await ensureECharts();

  try {
    const totalInvestido = gruposArr.reduce((acc, g) => {
      const inv = Number(g.investido);
      return acc + (isNaN(inv) ? 0 : inv);
    }, 0);
    
    // (NOVO) Obter mapa global de setores para as holdings com fallback inteligente
    const acoesMap = await getMarketDataSnapshot();
    const tickerSectorMap = new Map();
    const nameSectorMap = new Map();

    acoesMap.forEach((d) => {
      const sector = normalizeSector(d);
      if (d.ticker) tickerSectorMap.set(cleanTicker(d.ticker), sector);
      if (d.nome) nameSectorMap.set(d.nome.toUpperCase(), sector);
    });

    // Fallback para gigantes do mercado (comum em ETFs) que podem estar ausentes ou com nomes diferentes
    const FALLBACK_SECTORS = {
      "AAPL": "Tecnologia", "MSFT": "Tecnologia", "NVDA": "Tecnologia", "AVGO": "Tecnologia", "ASML": "Tecnologia",
      "AMZN": "Consumo Discricionário", "TSLA": "Consumo Discricionário", "HD": "Consumo Discricionário",
      "GOOGL": "Serviços de Comunicação", "GOOG": "Serviços de Comunicação", "META": "Serviços de Comunicação", "NFLX": "Serviços de Comunicação", "DIS": "Serviços de Comunicação",
      "BRK.B": "Financeiro", "BRK-B": "Financeiro", "JPM": "Financeiro", "V": "Financeiro", "MA": "Financeiro", "BAC": "Financeiro", "WFC": "Financeiro",
      "LLY": "Saúde", "UNH": "Saúde", "NVO": "Saúde", "JNJ": "Saúde", "PG": "Consumo Defensivo", "KO": "Consumo Defensivo", "PEP": "Consumo Defensivo",
      "XOM": "Energia", "CVX": "Energia", "SHEL": "Energia", "TTE": "Energia"
    };

    const aggregated = new Map();
    const geographyMap = new Map();
    console.log(`📡 [HoldingsMap] Total Investido: ${totalInvestido.toFixed(2)}€. Processando ${gruposArr.length} ativos...`);

    const allHoldingsSnap = await getDocs(collection(db, "etfHoldings"));
    const holdingsDb = []; // Array de objetos { ticker, data }
    
    allHoldingsSnap.forEach(doc => {
      const d = doc.data();
      const t = String(d.ticker || doc.id).toUpperCase();
      holdingsDb.push({ ticker: t, data: d });
    });

    function dbRectify(t) { return String(t || "").replace(/[^A-Z0-9]/g, ''); }
    function findHoldingsMatch(cleanT) {
      let match = holdingsDb.find(h => h.ticker === cleanT);
      if (!match) {
        match = holdingsDb.find(h => {
          const dbT = h.ticker.split('.')[0];
          const portT = cleanT.split('.')[0];
          return dbRectify(dbT) === dbRectify(portT) || h.ticker.startsWith(cleanT);
        });
      }
      return match || null;
    }

    const geoEligible = gruposArr
      .map(g => {
        const cleanT = cleanTicker(g.ticker).toUpperCase();
        const match = findHoldingsMatch(cleanT);
        const geoRows = normalizeGeoComposition(match?.data?.geography);
        const investido = Number(g.investido) || 0;
        return { g, cleanT, match, geoRows, investido };
      })
      .filter(x => x.investido > 0 && x.geoRows.length > 0);
    const totalGeoInvestido = geoEligible.reduce((sum, x) => sum + x.investido, 0);

    for (const g of gruposArr) {
      if (!g.ticker) continue;
      
      const cleanT = cleanTicker(g.ticker).toUpperCase();
      const investidoAtivo = Number(g.investido) || 0;
      const qtdAtivo = Number(g.qtd) || 0;
      
      let weightInPortfolio = totalInvestido > 0 ? investidoAtivo / totalInvestido : 0;
      if (weightInPortfolio <= 0 && qtdAtivo > 0) weightInPortfolio = 0.01; 
      
      console.log(`🔎 [HoldingsMap] Procurando match para: ${cleanT}`);

      // Procura inteligente (Fuzzy Match)
      // 1. Tenta match exato
      // 2. Tenta match onde o ID da DB começa pelo ticker do portfolio (ex: VWCE -> VWCE.DE)
      // 3. Tenta match ignorando sufixos comuns
      const match = findHoldingsMatch(cleanT);

      const geoRows = normalizeGeoComposition(match?.data?.geography);
      if (geoRows.length) {
        const geoWeight = totalGeoInvestido > 0 ? investidoAtivo / totalGeoInvestido : weightInPortfolio;
        geoRows.forEach(row => addGeoExposure(geographyMap, row.name, row.weight * geoWeight, cleanT));
      } else if (totalGeoInvestido <= 0) {
        addGeoExposure(geographyMap, inferAssetGeography(g), weightInPortfolio * 100, cleanT);
      }

      if (match && match.data.holdings && Array.isArray(match.data.holdings)) {
        const data = match.data;
        console.log(`✅ [HoldingsMap] Match encontrado: ${cleanT} <-> ${match.ticker}`);
        data.holdings.forEach(h => {
          const symbol = h.symbol || h.ticker || h.name || "Unknown";
          let hWeight = Number(h.weight) || Number(h.Weight) || 0;
          // Normalizar recursivamente para fração (0-1) - com trava de segurança
          let safety = 0;
          while (isFinite(hWeight) && Math.abs(hWeight) > 1.0001 && safety < 10) {
            hWeight /= 100;
            safety++;
          }
          
          const contrib = hWeight * weightInPortfolio;

          if (aggregated.has(symbol)) {
            const ext = aggregated.get(symbol);
            ext.weight += contrib;
            ext.etfs.push({ 
              ticker: cleanT, 
              weightInEtf: hWeight, 
              totalContrib: contrib,
              etfSector: g.setor // Guardar setor do ETF para fallback
            });
          } else {
            aggregated.set(symbol, {
              name: h.name || symbol,
              symbol,
              weight: contrib,
              etfs: [{ 
                ticker: cleanT, 
                weightInEtf: hWeight, 
                totalContrib: contrib,
                etfSector: g.setor 
              }]
            });
          }
        });
      } else {
        console.warn(`❓ [HoldingsMap] Sem dados para o ticker limpo: ${cleanT}`);
      }
    }

    if (aggregated.size === 0 && geographyMap.size === 0) {
      console.warn("⚠️ [HoldingsMap] Nenhuma holding agregada.");
      loadingEl.classList.add("hidden");
      emptyEl.classList.remove("hidden");
      return;
    }

    // Agrupar por Setor para o Treemap
    const groupedBySector = new Map();
    aggregated.forEach(h => {
      const cleanT = cleanTicker(h.symbol);
      const upperN = String(h.name || "").toUpperCase();
      
      // Lógica de descoberta de setor:
      // 1. Ticker exact match na DB
      // 2. Fallback manual para gigantes
      // 3. Nome exact match na DB
      // 4. Match parcial por nome (se o nome na DB estiver contido no nome da holding)
      let sector = tickerSectorMap.get(cleanT);
      if (!sector) sector = FALLBACK_SECTORS[cleanT];
      if (!sector) sector = nameSectorMap.get(upperN);
      if (!sector) {
        // Busca parcial por nome
        for (const [dbName, dbSector] of nameSectorMap.entries()) {
          if (upperN.includes(dbName) || dbName.includes(upperN)) {
            sector = dbSector;
            break;
          }
        }
      }
      
      // SEGUNDO FALLBACK: Pelo ETF de origem (Regras do Utilizador)
      if (!sector || sector === "Financeiro & Outros" || sector === "Outros") {
        // Pegar o ETF que mais contribui para esta holding
        const mainEtf = h.etfs.reduce((prev, curr) => (prev.totalContrib > curr.totalContrib) ? prev : curr);
        const eS = String(mainEtf.etfSector || "").toUpperCase();
        
        if (eS.includes("ENERGIA")) sector = "Energia";
        else if (eS.includes("TECNOLOGIA") || eS.includes("ITECH")) sector = "Tecnologia";
        else if (eS.includes("MATERIAIS") || eS.includes("MATERIAS")) sector = "Materias Primas";
        else if (eS.includes("FINANCEIRO") || eS.includes("FINANÇAS")) sector = "Finanças";
        else if (eS.includes("EMERGENTES")) sector = "Paises Emergentes";
        else if (eS.includes("MUNDIAL") || eS.includes("MULT") || eS.includes("MIX")) sector = "Big CAP";
      }
      
      sector = sector || "Big CAP"; // Default final para holdings de ETFs
      
      if (!groupedBySector.has(sector)) {
        groupedBySector.set(sector, {
          name: sector,
          value: 0,
          children: []
        });
      }
      const group = groupedBySector.get(sector);
      const val = h.weight * 100;
      group.value += val;
      group.children.push({
        name: h.symbol,
        fullName: h.name,
        value: val,
        etfs: h.etfs
      });
    });

    // (OPCIONAL) Fundir setores muito pequenos em "Outros" para melhorar a legibilidade
    // Se um setor tiver menos de 1% do total consolidado, podemos movê-lo
    // Mas por agora vamos manter todos e ordenar por relevância.

    const chartData = Array.from(groupedBySector.values())
      .filter(g => g.value > 0)
      .sort((a, b) => b.value - a.value);

    const geoData = normalizeAggregatedGeoData(geographyMap);

    _holdingsGlobalViewData = { holdings: chartData, geography: geoData };
    loadingEl.classList.add("hidden");
    const initialView = chartData.length ? "holdings" : "geography";
    document.querySelectorAll(".holdings-map-view").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-map-view") === initialView);
    });
    renderGlobalHoldingsView(initialView);

  } catch (err) {
    console.error("💥 [HoldingsMap] Erro Fatal:", err);
    loadingEl.classList.add("hidden");
    container.innerHTML = `<p style="color: #ef4444; text-align: center; margin-top: 50px;">Erro: ${err.message}</p>`;
  }
}

function renderGlobalHoldingsView(view) {
  const container = document.getElementById("holdingsMapContainer");
  const subtitleEl = document.getElementById("holdingsMapSubtitle");
  if (!container || !_holdingsGlobalViewData) return;

  if (_holdingsChart) {
    clearHoldingsTreemap();
  }
  if (_holdingsGeoChart) {
    _holdingsGeoChart.dispose();
    _holdingsGeoChart = null;
  }
  container.innerHTML = "";

  if (view === "geography") {
    subtitleEl.textContent = _holdingsViewSubtitle && _holdingsViewSubtitle.includes("geografia")
      ? _holdingsViewSubtitle
      : "Cobertura geografica consolidada do portfolio";
    renderGeographyWorldMap(container, _holdingsGlobalViewData.geography || []);
    return;
  }

  subtitleEl.textContent = _holdingsViewSubtitle || "Agregacao de todas as holdings subjacentes detetadas";
  initTreemap(container, _holdingsGlobalViewData.holdings || [], "Global Portfolio", true);
}

function normalizeGeoComposition(input) {
  const rows = Array.isArray(input)
    ? input.map(item => ({
        name: item.name || item.label || item.country || item.region,
        weight: item.weight ?? item.value ?? item.percent ?? item.pct
      }))
    : Object.entries(input || {}).map(([name, weight]) => ({ name, weight }));

  const normalized = rows
    .map(row => ({ name: normalizeGeoName(row.name), weight: normalizeGeoWeight(row.weight) }))
    .filter(row => row.name && row.weight > 0);

  const total = normalized.reduce((sum, row) => sum + row.weight, 0);
  if (total > 0 && total <= 1.0001) normalized.forEach(row => { row.weight *= 100; });
  return normalized;
}

function normalizeGeoWeight(value) {
  let weight = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(weight)) return 0;
  let safety = 0;
  while (Math.abs(weight) > 100 && safety < 6) {
    weight /= 100;
    safety++;
  }
  return weight;
}

function normalizeGeoName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const key = raw.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliases = {
    "US": "United States", "USA": "United States", "U S": "United States", "UNITED STATES": "United States", "UNITED STATES OF AMERICA": "United States", "ESTADOS UNIDOS": "United States", "ESTADOS UNIDOS DA AMERICA": "United States", "EUA": "United States", "AMERICANO": "United States", "AMERICANO SP500": "United States", "SP500": "United States", "S P 500": "United States",
    "UK": "United Kingdom", "UNITED KINGDOM": "United Kingdom", "REINO UNIDO": "United Kingdom",
    "IRELAND": "Ireland", "IRLANDA": "Ireland",
    "JAPAN": "Japan", "JAPAO": "Japan",
    "CHINA": "China",
    "HONG KONG": "Hong Kong",
    "CANADA": "Canada",
    "FRANCE": "France", "FRANCA": "France",
    "GERMANY": "Germany", "ALEMANHA": "Germany",
    "SWITZERLAND": "Switzerland", "SUICA": "Switzerland",
    "NETHERLANDS": "Netherlands", "PAISES BAIXOS": "Netherlands", "HOLANDA": "Netherlands",
    "SPAIN": "Spain", "ESPANHA": "Spain",
    "BELGIUM": "Belgium", "BELGICA": "Belgium",
    "PORTUGAL": "Portugal",
    "ITALY": "Italy", "ITALIA": "Italy",
    "INDIA": "India",
    "ARABIA SAUDITA": "Saudi Arabia", "SAUDI ARABIA": "Saudi Arabia",
    "AFRICA DO SUL": "South Africa", "SOUTH AFRICA": "South Africa",
    "MEXICO": "Mexico",
    "MALASIA": "Malaysia", "MALAYSIA": "Malaysia",
    "POLONIA": "Poland", "POLAND": "Poland",
    "TAILANDIA": "Thailand", "THAILAND": "Thailand",
    "EMIRADOS ARABES UNIDOS": "United Arab Emirates", "UNITED ARAB EMIRATES": "United Arab Emirates", "UAE": "United Arab Emirates",
    "TAIWAN": "Taiwan",
    "SOUTH KOREA": "Korea", "COREIA DO SUL": "Korea", "KOREA": "Korea",
    "BRAZIL": "Brazil", "BRASIL": "Brazil",
    "AUSTRALIA": "Australia",
    "EUROPE": "Europe", "EUROPA": "Europe",
    "ASIA": "Asia",
    "OTHER": "Other", "OUTROS": "Other", "OUTRAS": "Other", "RESTO DO MUNDO": "Other"
  };
  if (key.includes("SP500") || key.includes("S P 500") || key.includes("AMERICANO")) return "United States";
  return aliases[key] || raw;
}

function inferAssetGeography(asset) {
  return normalizeGeoName(asset?.pais || asset?.country || asset?.mercado || asset?.market || "N/D") || "N/D";
}

function addGeoExposure(map, name, value, sourceTicker) {
  const geo = normalizeGeoName(name) || "N/D";
  const amount = Number(value || 0);
  if (!(amount > 0)) return;
  const row = map.get(geo) || { name: geo, value: 0, sources: [] };
  row.value += amount;
  const src = row.sources.find(s => s.ticker === sourceTicker);
  if (src) src.value += amount;
  else row.sources.push({ ticker: sourceTicker, value: amount });
  map.set(geo, row);
}

function isOtherGeoName(name) {
  const key = String(name || "").toUpperCase();
  return key === "OTHER" || key === "OUTROS" || key === "OUTRAS" || key === "RESTO DO MUNDO";
}

function normalizeAggregatedGeoData(map) {
  const rows = Array.from(map.values()).filter(row => row.value > 0 && !isOtherGeoName(row.name));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!(total > 0)) return rows.sort((a, b) => b.value - a.value);

  return rows.map(row => ({
    ...row,
    value: (row.value / total) * 100,
    sources: row.sources.map(src => ({ ...src, value: (src.value / total) * 100 }))
  })).sort((a, b) => b.value - a.value);
}

function fmtGeoPct(value) {
  const n = Number(value || 0);
  return `${n < 0.1 && n > 0 ? n.toFixed(2) : n.toFixed(1)}%`;
}

async function ensureWorldMapRegistered() {
  await ensureECharts();
  if (window.__appFinanceWorldMapReady) return true;
  const urls = [
    "https://fastly.jsdelivr.net/npm/echarts@5.5.0/map/json/world.json",
    "https://cdn.jsdelivr.net/npm/echarts@5.5.0/map/json/world.json",
    "https://cdn.jsdelivr.net/npm/echarts@4.9.0/map/json/world.json"
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const geoJson = await res.json();
      window.echarts.registerMap("world", geoJson);
      window.__appFinanceWorldMapReady = true;
      return true;
    } catch (err) {
      console.warn("[HoldingsMap] Falha ao carregar world map:", err);
    }
  }
  return false;
}

async function renderGeographyWorldMap(container, geoData) {
  const data = geoData.slice().sort((a, b) => b.value - a.value);
  if (!data.length) {
    container.innerHTML = `<div style="height:100%;display:grid;place-items:center;color:#94a3b8;">Sem dados geograficos gravados para este portfolio.</div>`;
    return;
  }

  const minVisibleMapPct = 0.05;
  const mapData = data.filter(row => Number(row.value || 0) >= minVisibleMapPct);
  const max = Math.max(...mapData.map(d => d.value), 1);
  container.innerHTML = `
    <div class="holdings-geo-layout">
      <div id="holdingsWorldMap" class="holdings-world-map"></div>
      <div class="holdings-geo-panel">
        <div class="holdings-geo-title">Cobertura geografica</div>
        <div style="font-size:0.68rem;color:#94a3b8;margin:-4px 0 10px 0;">Valores normalizados entre tickers com geografia definida; Other/Outros excluido.</div>
        ${data.map(row => `
          <div class="holdings-geo-row">
            <div class="holdings-geo-row-head">
              <span>${escapeHtml(row.name)}</span>
              <strong>${fmtGeoPct(row.value)}</strong>
            </div>
            <div class="holdings-geo-track"><div style="width:${Math.max(2, Math.min(100, row.value))}%;"></div></div>
            <div class="holdings-geo-sources">${row.sources.slice(0, 4).map(s => `${escapeHtml(s.ticker)} ${fmtGeoPct(s.value)}`).join(" | ")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  const mapReady = await ensureWorldMapRegistered();
  if (!mapReady) {
    document.getElementById("holdingsWorldMap").innerHTML = `<div style="height:100%;display:grid;place-items:center;color:#94a3b8;text-align:center;padding:24px;">Mapa mundo indisponivel. A cobertura esta na lista ao lado.</div>`;
    return;
  }

  const mapEl = document.getElementById("holdingsWorldMap");
  _holdingsGeoChart = window.echarts.init(mapEl);
  _holdingsGeoChart.setOption({
    backgroundColor: "#06111f",
    tooltip: {
      trigger: "item",
      formatter: params => {
        const value = Number(params.value || 0);
        return `${params.name}<br><strong>${fmtGeoPct(value)}</strong> do portfolio`;
      }
    },
    visualMap: {
      min: 0,
      max,
      left: 12,
      bottom: 10,
      text: ["Maior", "Menor"],
      textStyle: { color: "#dbeafe" },
      inRange: { color: ["#2dd4bf", "#22c55e", "#bef264"] }
    },
    series: [{
      name: "Cobertura",
      type: "map",
      map: "world",
      roam: true,
      zoom: 1.08,
      emphasis: {
        label: { show: false },
        itemStyle: { areaColor: "#67e8f9", borderColor: "#f8fafc", borderWidth: 1.2 }
      },
      itemStyle: {
        borderColor: "#64748b",
        borderWidth: 0.65,
        areaColor: "#253447"
      },
      data: mapData.map(row => ({
        name: row.name,
        value: Number(row.value.toFixed(2)),
        itemStyle: { borderColor: "#ecfeff", borderWidth: 1.05 }
      }))
    }]
  });

  setTimeout(() => _holdingsGeoChart?.resize(), 50);
}

async function renderIndividualHoldingsMap(ticker, etfName) {
  console.log(`🔍 [HoldingsMap] Iniciando render individual para: ${ticker}`);
  const titleEl = document.getElementById("holdingsMapTitle");
  const subtitleEl = document.getElementById("holdingsMapSubtitle");
  const loadingEl = document.getElementById("holdingsMapLoading");
  const emptyEl = document.getElementById("holdingsMapEmpty");
  const container = document.getElementById("holdingsMapContainer");
  const tabsEl = document.getElementById("holdingsMapViewTabs");

  titleEl.textContent = `Holdings: ${ticker}`;
  subtitleEl.textContent = etfName ? `Distribuição por setor e geografia de ${etfName}` : "Distribuição por setor e geografia do ETF";
  loadingEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");
  tabsEl?.classList.remove("hidden");
  _holdingsGlobalViewData = null;
  _holdingsViewSubtitle = subtitleEl.textContent;
  container.innerHTML = "";

  await ensureECharts();

  try {
    const cleanT = cleanTicker(ticker).toUpperCase();
    const allHoldingsSnap = await getDocs(collection(db, "etfHoldings"));
    let data = null;
    let exactMatch = false;
    allHoldingsSnap.forEach(doc => {
      const d = doc.data();
      const t = String(d.ticker || doc.id).toUpperCase();
      if (t === cleanT) {
        data = d;
        exactMatch = true;
      } else if (!exactMatch && (t.startsWith(cleanT) || t.split('.')[0] === cleanT.split('.')[0])) {
        data = d;
      }
    });

    if (!data || !Array.isArray(data.holdings) || !data.holdings.length) {
      console.warn(`⚠️ [HoldingsMap] Nenhuma holding encontrada para o ticker limpo: ${cleanT}`);
      loadingEl.classList.add("hidden");
      emptyEl.classList.remove("hidden");
      return;
    }

    const rawHoldings = data.holdings.map(h => {
      let w = Number(h.weight) || Number(h.Weight) || 0;
      let safety = 0;
      while (isFinite(w) && Math.abs(w) > 1.0001 && safety < 10) {
        w /= 100;
        safety++;
      }
      return {
        name: h.symbol || h.ticker || h.name || "??",
        value: w * 100,
        fullName: h.name || h.symbol || h.ticker || "Unknown",
        weight: w,
      };
    }).filter(h => h.value > 0);

    if (!rawHoldings.length) {
      console.warn(`⚠️ [HoldingsMap] Dados de holdings sem peso positivo para: ${cleanT}`);
      loadingEl.classList.add("hidden");
      emptyEl.classList.remove("hidden");
      return;
    }

    const acoesMap = await getMarketDataSnapshot();
    const tickerSectorMap = new Map();
    const nameSectorMap = new Map();
    acoesMap.forEach((d) => {
      const sector = normalizeSector(d);
      if (d.ticker) tickerSectorMap.set(cleanTicker(d.ticker), sector);
      if (d.nome) nameSectorMap.set(String(d.nome).toUpperCase(), sector);
    });

    const FALLBACK_SECTORS = {
      "AAPL": "Tecnologia", "MSFT": "Tecnologia", "NVDA": "Tecnologia", "AVGO": "Tecnologia", "ASML": "Tecnologia",
      "AMZN": "Consumo Discricionário", "TSLA": "Consumo Discricionário", "HD": "Consumo Discricionário",
      "GOOGL": "Serviços de Comunicação", "GOOG": "Serviços de Comunicação", "META": "Serviços de Comunicação", "NFLX": "Serviços de Comunicação", "DIS": "Serviços de Comunicação",
      "BRK.B": "Financeiro", "BRK-B": "Financeiro", "JPM": "Financeiro", "V": "Financeiro", "MA": "Financeiro", "BAC": "Financeiro", "WFC": "Financeiro",
      "LLY": "Saúde", "UNH": "Saúde", "NVO": "Saúde", "JNJ": "Saúde", "PG": "Consumo Defensivo", "KO": "Consumo Defensivo", "PEP": "Consumo Defensivo",
      "XOM": "Energia", "CVX": "Energia", "SHEL": "Energia", "TTE": "Energia"
    };

    const groupedBySector = new Map();
    rawHoldings.forEach(h => {
      const cleanSymbol = cleanTicker(h.name).toUpperCase();
      let sector = tickerSectorMap.get(cleanSymbol) || FALLBACK_SECTORS[cleanSymbol];
      if (!sector) {
        const upperName = String(h.fullName).toUpperCase();
        sector = nameSectorMap.get(upperName);
        if (!sector) {
          for (const [dbName, dbSector] of nameSectorMap.entries()) {
            if (upperName.includes(dbName) || dbName.includes(upperName)) {
              sector = dbSector;
              break;
            }
          }
        }
      }
      if (!sector) sector = "Outros";
      const item = {
        name: h.name,
        fullName: h.fullName,
        value: h.value,
        etfs: [{ ticker: cleanT, weightInEtf: h.weight, totalContrib: h.value }]
      };
      if (!groupedBySector.has(sector)) {
        groupedBySector.set(sector, { name: sector, value: 0, children: [] });
      }
      const group = groupedBySector.get(sector);
      group.value += item.value;
      group.children.push(item);
    });

    const chartData = Array.from(groupedBySector.values()).sort((a, b) => b.value - a.value);

    const geoRows = normalizeGeoComposition(data.geography);
    const geographyMap = new Map();
    geoRows.forEach(row => {
      const geoName = normalizeGeoName(row.name);
      if (!geoName) return;
      geographyMap.set(geoName, { name: geoName, value: Number(row.weight), sources: [{ ticker: cleanT, value: Number(row.weight) }] });
    });
    if (geographyMap.size === 0) {
      const inferred = inferAssetGeography(data);
      geographyMap.set(inferred, { name: inferred, value: 100, sources: [{ ticker: cleanT, value: 100 }] });
    }

    _holdingsGlobalViewData = {
      holdings: chartData,
      geography: normalizeAggregatedGeoData(geographyMap)
    };

    loadingEl.classList.add("hidden");
    emptyEl.classList.add("hidden");
    tabsEl?.classList.remove("hidden");
    document.querySelectorAll(".holdings-map-view").forEach(btn => btn.classList.toggle("active", btn.getAttribute("data-map-view") === "holdings"));
    renderGlobalHoldingsView("holdings");

  } catch (err) {
    console.error("💥 [HoldingsMap] Erro individual:", err);
    loadingEl.classList.add("hidden");
    container.innerHTML = `<p style="color: #ef4444; text-align: center; margin-top: 50px;">Erro: ${err.message}</p>`;
  }
}

function initTreemap(container, chartData, contextTitle, isAlreadyGrouped = false) {
  if (_holdingsChart) {
    clearHoldingsTreemap();
  }
  const treemap = new Treemap(container.id, {
    groupHeaderHeight: 25,
    padding: 2,
    width: container.clientWidth || 1000
  });
  _holdingsChart = treemap;

  // Encontrar o peso máximo para nivelar as cores
  let allLeafs = [];
  if (isAlreadyGrouped) {
    chartData.forEach(g => allLeafs.push(...g.children));
  } else {
    allLeafs = chartData;
  }
  const maxWeight = Math.max(...allLeafs.map(item => item.value)) || 1;

  const formattedData = isAlreadyGrouped ? chartData.map(group => ({
    ...group,
    children: group.children.map(item => {
      const ratio = item.value / maxWeight;
      const colorVal = 0.45 + (ratio * 0.55);
      return {
        ...item,
        colorValue: colorVal,
        growth: item.value / 100,
        meta: {
          ticker: item.name,
          fullName: item.fullName,
          etfs: item.etfs,
          weight: item.value
        }
      };
    })
  })) : [{
    name: contextTitle,
    value: chartData.reduce((sum, item) => sum + item.value, 0),
    children: chartData.map(item => {
      // Normalização: A holding mais pesada terá colorValue = 1.0 (Verde Vivo)
      // Escalonamos entre 0.45 (Neutro/Escuro) e 1.0 (Verde)
      const ratio = item.value / maxWeight;
      const colorVal = 0.45 + (ratio * 0.55);

      return {
        name: item.name,
        fullName: item.fullName || item.name,
        value: item.value,
        colorValue: colorVal, 
        growth: item.value / 100,
        meta: {
          ticker: item.name,
          fullName: item.fullName,
          etfs: item.etfs,
          weight: item.value
        }
      };
    })
  }];

  // Sobrepor o showTooltip para mostrar informações específicas de holdings
  treemap.showTooltip = function(e, item) {
    let tip = document.getElementById("treemap-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "treemap-tooltip";
      tip.className = "treemap-tooltip-custom"; // Classe CSS se existir
      Object.assign(tip.style, {
        position: "fixed",
        padding: "12px",
        background: "rgba(15, 23, 42, 0.95)",
        color: "#f8fafc",
        borderRadius: "8px",
        fontSize: "12px",
        pointerEvents: "none",
        zIndex: "10000",
        border: "1px solid #334155",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(4px)",
        minWidth: "180px"
      });
      document.body.appendChild(tip);
    }

    const m = item.meta || {};
    let breakdownHtml = "";
    
    if (m.etfs && m.etfs.length > 0) {
      breakdownHtml = `
        <div style="margin-top: 8px; border-top: 1px solid #334155; padding-top: 6px;">
          <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.05em;">Origem da Posição</div>
          ${m.etfs.map(etf => `
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <span style="color: #cbd5e1;">${etf.ticker}</span>
              <span style="font-weight: 600; color: #8b5cf6;">${(etf.totalContrib * 100).toFixed(2)}%</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    tip.innerHTML = `
      <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: #fff;">${m.fullName || item.name}</div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
        <span style="color: #94a3b8;">Símbolo:</span>
        <span style="font-weight: 600;">${item.name}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: #94a3b8;">Peso Portfolio:</span>
        <span style="font-weight: 600; color: #10b981;">${item.value.toFixed(2)}%</span>
      </div>
      ${breakdownHtml}
    `;

    tip.style.display = "block";
    this.updateTooltipPos(e);
  };

  // Renderizar (altura dinâmica baseada no container ou fixo)
  treemap.render(formattedData, Math.max(container.clientHeight, 500));
}
