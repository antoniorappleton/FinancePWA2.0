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
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { parseSma } from "../utils/scoring.js";
import * as CapitalManager from "../utils/capitalManager.js";

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
      if (x.ticker) out.set(String(x.ticker).toUpperCase(), x);
    });
  }
  return out;
}
function pickBestRate(info) {
  if (typeof info?.taxaCrescimento_1mes === "number")
    return { taxa: info.taxaCrescimento_1mes, periodLabel: "mês" };
  if (typeof info?.taxaCrescimento_1semana === "number")
    return { taxa: info.taxaCrescimento_1semana, periodLabel: "semana" };
  if (typeof info?.taxaCrescimento_1ano === "number")
    return { taxa: info.taxaCrescimento_1ano, periodLabel: "ano" };
  return { taxa: null, periodLabel: null };
}
function estimateTime(currentPrice, targetPrice, growthPct, label) {
  const r = Number(growthPct || 0) / 100;
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
  const labels = [...map.keys()],
    data = [...map.values()];
  if (!labels.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  window.__chSetores = new Chart(el, {
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

// (NOVO) estado global para evitar duplicar listeners
let byTickerGlobal = new Map();
let _eventsWired = false;

// ===============================
// Quick Actions (comprar/vender/editar + collapse)
// ===============================
function wireQuickActions(gruposArr) {
  byTickerGlobal = new Map(gruposArr.map((g) => [g.ticker, g]));
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
  const fObj = $("#pfObjetivo");
  const fLink = $("#pfLink");

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
    if (tipoSel) tipoSel.value = kind;
    if (fTicker) fTicker.value = g.ticker;
    if (fNome) fNome.value = g.nome;
    if (fSetor) fSetor.value = g.setor || "";
    if (fMerc) fMerc.value = g.mercado || "";
    if (fQtd) fQtd.value = "";
    if (fPreco) fPreco.value = "";
    if (fObj) fObj.value = g.objetivo || "";
    if (fLink) fLink.value = g.link || "";
    if (vendaTot) vendaTot.checked = false;
    if (vendaTotWrap)
      vendaTotWrap.style.display = kind === "venda" ? "block" : "none";
    if (labelP)
      labelP.textContent =
        kind === "venda" ? "Preço de venda (€)" : "Preço de compra (€)";
  }
  function closeModal() {
    modal?.classList.add("hidden");
    form?.reset();
    const idHidden = document.getElementById("pfDocId");
    if (idHidden) idHidden.value = "";
    if (tipoSel) tipoSel.value = "compra";
    if (labelP) labelP.textContent = "Preço de compra (€)";
    if (vendaTot) vendaTot.checked = false;
    if (vendaTotWrap) vendaTotWrap.style.display = "none";
  }
  // --- Modal de Detalhes (Estratégico) ---
  const detModal = $("#activityDetailModal");
  const detClose = $("#activityDetailClose");

  function openDetailModal(ticker) {
    const g = byTickerGlobal.get(ticker);
    if (!g) return;

    const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

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

    // WAR CHEST TOTAL
    const warChestRaw = document.getElementById("prtWarChest")?.textContent || "";
    const warChestTotal = parseFloat(warChestRaw.replace(/[^\d,.]/g, "").replace(",", ".")) || 0;

    const formatSmaDelta = (sma, cur) => {
      if (!isFiniteNum(sma) || !isFiniteNum(cur) || sma <= 0) return "—";
      const d = ((cur - sma) / sma) * 100;
      return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
    };

    const s50 = g._sma50;
    const isGoldenCross = s50 && s200 && s50 > s200;
    const isDeathCross = s50 && s200 && s50 < s200;
    const trendSignal = isGoldenCross ? "GOLDEN CROSS 🚀" : (isDeathCross ? "DEATH CROSS ⚠️" : "SEM TENDÊNCIA CLARA");
    const trendColor = isGoldenCross ? "#22c55e" : (isDeathCross ? "#ef4444" : "var(--muted-foreground)");

    // ESFORCO / DECISAO DO SISTEMA
    let esforcoStr = "Muito próximo", esforcoColor = "#22c55e";
    if (upsideP > 12)     { esforcoStr = "Agressivo"; esforcoColor = "#ef4444"; }
    else if (upsideP > 7) { esforcoStr = "Exigente";  esforcoColor = "#f59e0b"; }
    else if (upsideP > 3) { esforcoStr = "Plausível"; esforcoColor = "#3b82f6"; }
    if (upsideP <= 0 && g.qtd > 0) { esforcoStr = "Atingido"; esforcoColor = "#22c55e"; }

    let decisaoEmoji = "🟢", decisaoTexto = "GUARDAR / MANTER", decisaoSub = "";
    let decisaoBorder = "#22c55e", decisaoBg = "rgba(34,197,94,0.07)";

    // Cálculo de valores para instruções
    const capReforco = warChestTotal > 0 ? warChestTotal * 0.2 : 250; 
    const precoReforco = precoAtual * 0.98;
    const unitsReforco = capReforco / precoAtual;

    const tp1Price = precoMedio * 1.05;
    const unitsVenda = g.qtd * 0.2;
    const valorVenda = unitsVenda * tp1Price;

    // Progress bar logic
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
      // MANTER / ESPERAR
      decisaoSub = `<div style="margin-top:4px; line-height:1.4;">
        <span>💎 <strong>Guardar e manter.</strong> Potencial de crescimento saudável.</span><br>
        <span style="opacity:0.8;">Próxima compra recomendada aos <strong>${fmtEUR.format(precoReforco)}</strong>.</span>
        ${progressBarHTML}
      </div>`;
    }

    // Adicionar Secção de Análise Técnica ao decisaoSub
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
        <p style="margin-top: 8px; opacity: 0.7; font-style: italic; font-size: 0.65rem; line-height: 1.3;">
          * Se o preço estiver acima das médias e houver um Golden Cross, a confiança no reforço é máxima.
        </p>
      </div>
    `;

    // HEADER
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

    // BLOCO 0 — DECISAO DO SISTEMA
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

    // BLOCO 1 — QUICK KPIs
    const kpiCap = $(`#detKpiCapital`);
    if (kpiCap) kpiCap.textContent = fmtEUR.format(g.investido || 0);

    const kpiUp = $(`#detKpiUpside`);
    if (kpiUp) {
      kpiUp.textContent = upsideP > 0 ? `+${upsideP.toFixed(1)}%` : (upsideP < 0 ? `${upsideP.toFixed(1)}%` : "0%");
      kpiUp.style.color = "#3b82f6";
    }

    const kpiTP = $(`#detKpiTP`);
    if (kpiTP) kpiTP.textContent = tpObjetivo > 0 ? fmtEUR.format(tpObjetivo) : "—";

    const kpiSMA = $(`#detKpiSMA200`);
    if (kpiSMA) {
      const smaD = formatSmaDelta(s200, precoAtual);
      kpiSMA.textContent = smaD;
      const num = s200 && precoAtual ? ((precoAtual - s200) / s200) * 100 : 0;
      kpiSMA.style.color = num >= 0 ? "#22c55e" : "#ef4444";
    }

    // BLOCO 2 — PLANO DE SAIDA (Multi-TP)
    const tpLevels = [
      { label: "TP1", pct: 5,  acao: "Reduzir leve",  posicao: "20%", color: "#22c55e" },
      { label: "TP2", pct: 10, acao: "Reduzir médio", posicao: "30%", color: "#f59e0b" },
      { label: "TP3", pct: 15, acao: "Reduzir forte", posicao: "50%", color: "#ef4444" },
    ];
    let saidaHTML = "";
    tpLevels.forEach(tp => {
      const pr = precoMedio * (1 + tp.pct / 100);
      const isActive = precoAtual >= pr * 0.98;
      const units = g.qtd * (parseInt(tp.posicao) / 100);
      const posText = `${tp.posicao} <span style="font-size:0.65rem;font-weight:500;display:block;opacity:0.8;text-transform:none;">(~${units.toFixed(2)} un.)</span>`;

      saidaHTML += `<div style="display:grid;grid-template-columns:1fr 1.2fr 1.2fr 1fr;padding:10px 12px;font-size:0.8rem;border-bottom:1px solid var(--border);align-items:center;${isActive ? "background:" + tp.color + "08;" : ""}">` +
        `<div style="font-weight:800;color:${tp.color};">${tp.label} (+${tp.pct}%)</div>` +
        `<div style="font-family:monospace;font-size:0.82rem;">${fmtEUR.format(pr)}</div>` +
        `<div style="font-weight:700;color:${tp.color};font-size:0.75rem;text-transform:uppercase;">${tp.acao}</div>` +
        `<div style="text-align:right;font-weight:700;font-size:0.75rem;color:var(--muted-foreground);">${posText}</div></div>`;
    });
    const saidaEl = $(`#detPlanSaida`);
    if (saidaEl) saidaEl.innerHTML = saidaHTML;

    const saidaInterp = $(`#detSaidaInterpretativo`);
    if (saidaInterp) {
      if (esforcoStr === "Plausível")    saidaInterp.textContent = "✅ Upside plausível — não vender ainda.";
      else if (esforcoStr === "Exigente") saidaInterp.textContent = "⚠️ Upside exigente — começar a reduzir no TP1/TP2.";
      else if (esforcoStr === "Agressivo") saidaInterp.textContent = "🔴 Upside agressivo — distribuir posição forte no TP2/TP3.";
      else if (esforcoStr === "Atingido") saidaInterp.textContent = "🏆 Objetivo cumprido — considera vender e reiniciar ciclo.";
      else saidaInterp.textContent = "🟢 Perto do alvo — manter posição.";
    }

    // BLOCO 3 — PLANO DE QUEDA
    const niveisArr = [
      { d: 2,  action: "Reforço Leve",       color: "#3b82f6" },
      { d: 3,  action: "Reforço Leve",       color: "#3b82f6" },
      { d: 5,  action: "Reforço Médio",      color: "#f59e0b" },
      { d: 8,  action: "Reforço Forte",      color: "#f59e0b" },
      { d: 10, action: "Rever Tese / Risco", color: "#ef4444" },
      { d: 15, action: "Stop / Invalidar",   color: "#ef4444" }
    ];
    let niveisHTML = "";
    niveisArr.forEach(n => {
      const pr = precoAtual * (1 - n.d / 100);
      let actionTxt = n.action;
      if (n.action.includes("Reforço")) {
          const defaultAmt = n.action.includes("Leve") ? 250 : n.action.includes("Médio") ? 500 : 1000;
          const units = defaultAmt / (pr || 1);
          actionTxt = `${n.action} <span style="display:block;font-size:0.65rem;opacity:0.8;text-transform:none;margin-top:2px;">(~${units.toFixed(2)} un. / €${defaultAmt})</span>`;
      }
      niveisHTML += `<div style="display:grid;grid-template-columns:1fr 1.5fr 1.5fr;padding:10px 12px;font-size:0.8rem;border-bottom:1px solid var(--border);align-items:center;">` +
        `<div style="font-weight:800;color:#ef4444;">-${n.d}%</div>` +
        `<div style="font-family:monospace;font-size:0.85rem;">${fmtEUR.format(pr)}</div>` +
        `<div style="font-weight:700;color:${n.color};font-size:0.75rem;text-transform:uppercase;">${actionTxt}</div></div>`;
    });
    const niveisEl = $(`#detNiveisReforco`);
    if (niveisEl) niveisEl.innerHTML = niveisHTML;

    // BLOCO 4 — REFORCO INTELIGENTE
    const refScenarios = [
      { val: 250,  label: "Reforço de 250 €"   },
      { val: 500,  label: "Reforço de 500 €"   },
      { val: 1000, label: "Reforço de 1.000 €" },
    ];
    let cenHTML = "";
    refScenarios.forEach(sc => {
      const invest = sc.val;
      const nQ  = g.qtd + (invest / (precoAtual || 1));
      const nT  = (g.investido || 0) + invest;
      const nPM = nT / (nQ || 1);
      const nTP = (nT + (g.objetivo || 0)) / (nQ || 1);
      const nUpside = precoAtual > 0 ? ((nTP / precoAtual) - 1) * 100 : 0;
      const redTP = tpObjetivo - nTP;
      cenHTML += `<div style="background:rgba(0,0,0,0.015);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:0.75rem;">` +
        `<div style="display:flex;justify-content:space-between;margin-bottom:8px;align-items:center;">` +
        `<strong style="font-size:0.85rem;color:var(--primary);">${sc.label}</strong>` +
        `<span style="background:#22c55e15;color:#22c55e;padding:4px 8px;border-radius:6px;font-weight:800;">PM → ${fmtEUR.format(nPM)}</span></div>` +
        `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;border-top:1px dashed var(--border);padding-top:8px;">` +
        `<div><span style="color:var(--muted-foreground)">Nova Qtd:</span><br><strong style="font-size:0.85rem;">${nQ.toFixed(2)}</strong> <span style="font-size:0.65rem;color:var(--muted-foreground)">(+${(invest/(precoAtual||1)).toFixed(2)})</span></div>` +
        `<div><span style="color:var(--muted-foreground)">Novo TP:</span><br><strong style="color:#22c55e;font-size:0.85rem;">${fmtEUR.format(nTP)}</strong> <span style="font-size:0.65rem;color:#ef4444">(-${fmtEUR.format(redTP > 0 ? redTP : 0)})</span></div>` +
        `<div><span style="color:var(--muted-foreground)">Upside:</span><br><strong style="color:#3b82f6;font-size:0.85rem;">${nUpside > 0 ? "+" : ""}${nUpside.toFixed(1)}%</strong></div>` +
        `</div></div>`;
    });
    const cenEl = $(`#detCenariosNovos`);
    if (cenEl) cenEl.innerHTML = cenHTML;

    // BLOCO 5 — WAR CHEST
    const warChestLevels = [
      { queda: 5,  usarPct: 20, color: "#22c55e" },
      { queda: 10, usarPct: 30, color: "#f59e0b" },
      { queda: 15, usarPct: 50, color: "#ef4444" },
    ];
    let wchHTML = "";
    warChestLevels.forEach(w => {
      const pr = precoAtual * (1 - w.queda / 100);
      const capital = warChestTotal * (w.usarPct / 100);
      const qtdC = capital > 0 && pr > 0 ? capital / pr : 0;
      wchHTML += `<div style="display:grid;grid-template-columns:0.6fr 1fr 1fr 1fr;padding:10px 12px;font-size:0.78rem;border-bottom:1px solid var(--border);align-items:center;">` +
        `<div style="font-weight:800;color:${w.color};">-${w.queda}%</div>` +
        `<div style="font-family:monospace;">${fmtEUR.format(pr)}</div>` +
        `<div style="color:var(--muted-foreground);">Usar <strong style="color:${w.color};">${w.usarPct}%</strong></div>` +
        `<div style="text-align:right;">${capital > 0 ? fmtEUR.format(capital) + " <span style='font-size:0.65rem;color:var(--muted-foreground);display:block;'>(~" + qtdC.toFixed(2) + " unid.)</span>" : "<span style='color:var(--muted-foreground)'>def. War Chest</span>"}</div></div>`;
    });
    const wchEl = $(`#detWarChestTable`);
    if (wchEl) wchEl.innerHTML = `<div style="display:grid;grid-template-columns:0.6fr 1fr 1fr 1fr;padding:6px 12px;font-size:0.65rem;font-weight:700;color:var(--muted-foreground);background:rgba(0,0,0,0.03);border-bottom:1px solid var(--border);"><div>Queda</div><div>Preço</div><div>Capital</div><div style="text-align:right;">Valor</div></div>` + wchHTML;

    // BLOCO 6 — RECUPERACAO DE PERDAS
    const recBloco = $(`#detRecuperacaoBloco`);
    if (lucroAtual < 0 && g.qtd > 0) {
      recBloco.style.display = "block";
      $(`#detBEML`).textContent  = fmtEUR.format(precoMedio);
      $(`#detTPComp`).textContent = fmtEUR.format(tpObjetivo);
      const p5 = precoAtual * 0.95, p10 = precoAtual * 0.90;
      $(`#detRecSub5`).textContent  = `+${((tpObjetivo / p5  - 1) * 100).toFixed(1)}% (até ${fmtEUR.format(tpObjetivo)})`;
      $(`#detRecSub10`).textContent = `+${((tpObjetivo / p10 - 1) * 100).toFixed(1)}% (até ${fmtEUR.format(tpObjetivo)})`;
    } else {
      recBloco.style.display = "none";
    }

    // BLOCO 7 — METRICAS SECUNDARIAS (colapsavel)
    const yPctModal = isFiniteNum(g._yCur) ? (g._yCur * 100).toFixed(2) + "%" : "—";
    $(`#detYield`).textContent  = yPctModal;
    $(`#detPE`).textContent     = isFiniteNum(g._pe) ? g._pe.toFixed(1) : "—";
    $(`#detSMA50`).textContent  = formatSmaDelta(g._sma50, precoAtual);
    $(`#detSMA200`).textContent = formatSmaDelta(s200, precoAtual);
    const stopTec = s200 ? s200 * 0.95 : precoMedio * 0.9;
    const risk = precoAtual - stopTec, reward = tpObjetivo - precoAtual;
    $(`#detRR`).textContent = risk > 0 && reward > 0 ? `1:${(reward / risk).toFixed(1)}` : "—";
    $(`#detBarStop`).textContent  = fmtEUR.format(stopTec);
    $(`#detBarPreco`).textContent = fmtEUR.format(precoAtual);
    $(`#detBarAlvo`).textContent  = fmtEUR.format(tpObjetivo);
    $(`#detObjLucro`).textContent  = fmtEUR.format(g.objetivo || 0);
    $(`#detFaltaMeta`).textContent = faltaMeta > 0 ? fmtEUR.format(faltaMeta) : "0";
    $(`#detTPObj`).textContent     = fmtEUR.format(tpObjetivo);
    $(`#detUpside`).textContent    = upsideP > 0 ? `+${upsideP.toFixed(2)}%` : "0%";
    $(`#detResumoInterpretativo`).textContent = upsideP > 0 ? `Precisa subir +${upsideP.toFixed(1)}% para cumprir o objetivo. (${esforcoStr})` : "Objetivo cumprido! Parabéns.";

    // ESTRATEGIA DINAMICA
    const sInfo = g._strategy;
    $(`#detStrategyDiv`).innerHTML = `
      <div style="font-weight:700;margin-bottom:8px;">Definir Estratégia (Ativo Atual)</div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
        <select id="detDynStrategyCat" style="flex:1;padding:6px;border-radius:4px;border:1px solid var(--border);font-size:0.8rem;background:var(--background);color:var(--foreground);">
          <option value="NONE">Automático / Nenhuma</option><option value="CORE">CORE</option><option value="SATELLITE">SATÉLITE</option>
        </select>
        <div style="display:flex;align-items:center;gap:4px;flex:1;">
          <input type="number" id="detDynStrategyTarget" placeholder="%" step="0.1" max="100" min="0" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border);font-size:0.8rem;background:var(--background);color:var(--foreground);" />
          <span style="font-size:0.8rem;">%</span>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.75rem;align-items:center;">
        <div id="detDynStrategyStatus" style="color:var(--muted-foreground);display:none;">Guardado ✅</div>
        <button id="detBtnSaveStrategy" class="btn outline small" style="padding:4px 12px;margin-left:auto;">Guardar</button>
      </div>
      <div id="detDynStrategyCurrentInfo" style="margin-top:10px;font-size:0.75rem;"></div>`;

    const selCat = $(`#detDynStrategyCat`);
    const iptTarget = $(`#detDynStrategyTarget`);
    const btnSaveStrat = $(`#detBtnSaveStrategy`);

    if (sInfo) {
      selCat.value = sInfo.category;
      iptTarget.value = (sInfo.target * 100).toFixed(1);
      const currentW = (g._currentWeight || 0) * 100;
      const targetW  = sInfo.target * 100;
      let dicaStr = "Aguardar", dicaColor = "var(--muted-foreground)";
      if (g._shouldReinforceStrategic) { dicaStr = "REFORÇAR"; dicaColor = "#ef4444"; }
      else if (g._estadoOp === "REDUZIR" || currentW > targetW * 1.5) { dicaStr = "REDUZIR"; dicaColor = "#f59e0b"; }
      $(`#detDynStrategyCurrentInfo`).innerHTML = `<div style="display:flex;justify-content:space-between;background:rgba(0,0,0,0.02);padding:8px;border-radius:6px;border:1px solid var(--border);"><div>Alocação Atual: <strong style="${Math.abs(targetW - currentW) > 5 ? "color:#ef4444" : ""}">${currentW.toFixed(1)}%</strong></div><div>Dica: <strong><span style="color:${dicaColor}">${dicaStr}</span></strong></div></div>`;
    }

    selCat.onchange = () => {
      if (selCat.value === "NONE") iptTarget.value = "";
      else {
        const isCore = selCat.value === "CORE";
        const catTotal = isCore ? (window._dynamicStrategyGlobals?.CORE || 0.65) * 100 : (window._dynamicStrategyGlobals?.SATELLITE || 0.35) * 100;
        let count = Object.values(window._dynamicStrategyTickers || {}).filter(t => t && t.category === selCat.value && t !== ticker).length;
        iptTarget.value = (catTotal / (count + 1)).toFixed(1);
      }
    };

    btnSaveStrat.onclick = async () => {
      const cat = selCat.value, target = Number(iptTarget.value);
      if (cat !== "NONE" && (isNaN(target) || target <= 0)) { alert("Insira uma percentagem alvo válida."); return; }
      btnSaveStrat.textContent = "...";
      try {
        await setDoc(doc(db, "config", "strategy"), { tickers: { [ticker]: cat === "NONE" ? deleteField() : { category: cat, target } } }, { merge: true });
        $(`#detDynStrategyStatus`).style.display = "block";
        $(`#detDynStrategyStatus`).style.color = "#22c55e";
        $(`#detDynStrategyStatus`).textContent = "Guardado ✅";
      } catch (err) {
        console.error(err);
        $(`#detDynStrategyStatus`).style.display = "block";
        $(`#detDynStrategyStatus`).style.color = "#ef4444";
        $(`#detDynStrategyStatus`).textContent = err.message || "Erro ao guardar!";
      }
      btnSaveStrat.textContent = "Guardar";
    };

    // CRISES
    const detCriSel = $(`#detCrisisSelector`);
    const detCriRes = $(`#detCrisisResult`);
    if (detCriSel) {
      detCriSel.innerHTML = '<option value="0">Simular cenário de queda...</option>' + CRISES_HISTORY.map(c => `<option value="${c.drop}">${c.name}</option>`).join("");
      detCriSel.value = "0";
      if (detCriRes) detCriRes.style.display = "none";
      if (!detCriSel.__wired) {
        detCriSel.__wired = true;
        detCriSel.addEventListener("change", () => {
          const dropPct = Number(detCriSel.value);
          if (dropPct <= 0) { detCriRes.style.display = "none"; return; }
          const group = byTickerGlobal.get(detCriSel.dataset.ticker);
          if (!group) return;
          const pCur = group.precoAtual || 0;
          const cPrice = pCur * (1 - dropPct / 100);
          const iO = group.investido || 0, qO = group.qtd || 0;
          const nQ = qO + (iO / (cPrice || 1));
          const nPM = (iO * 2) / nQ;
          $(`#detCrisisPrice`).textContent = fmtEUR.format(cPrice);
          $(`#detCrisisCost`).textContent  = fmtEUR.format(iO);
          $(`#detCrisisNewPM`).textContent = fmtEUR.format(nPM);
          detCriRes.style.display = "block";
        });
      }
      detCriSel.dataset.ticker = g.ticker;
    }

    // BOTOES
    const bBuy  = $(`#detBtnBuy`);
    const bSell = $(`#detBtnSell`);
    const bEdit = $(`#detBtnEdit`);
    const bLink = $(`#detBtnLink`);
    const detModalEl = $(`#activityDetailModal`);
    if (bBuy)  { bBuy.onclick  = () => { detModalEl.classList.add("hidden"); openActionModal("compra", g.ticker); }; }
    if (bSell) { bSell.onclick = () => { detModalEl.classList.add("hidden"); openActionModal("venda", g.ticker); }; }
    if (bEdit) { bEdit.onclick = () => { detModalEl.classList.add("hidden"); document.querySelector(`[data-edit="${g.lastDocId}"]`)?.click(); }; }
    if (bLink) {
      bLink.onclick = () => { if (g.link) window.open(g.link, "_blank"); else { detModalEl.classList.add("hidden"); document.querySelector(`[data-edit="${g.lastDocId}"]`)?.click(); } };
      bLink.className = `btn ghost ${g.link ? "" : "muted"}`;
    }
    if (bBuy) bBuy.innerHTML = `<i class="fas fa-plus-circle"></i> ${estadoOp === "REFORÇAR" ? "Reforçar" : "Comprar"}`;

    detModalEl.classList.remove("hidden");
  }
    detClose?.addEventListener("click", () => detModal.classList.add("hidden"));
    detModal?.addEventListener("click", (e) => {
      if (e.target.id === "activityDetailModal") detModal.classList.add("hidden");
    });

    cancel?.addEventListener("click", closeModal);
    modal?.addEventListener("click", (e) => {
      if (e.target.id === "pfAddModal") closeModal();
    });

    // BUY/SELL buttons
    document.getElementById("listaAtividades")?.addEventListener("click", (e) => {
      const buy = e.target.closest?.("[data-buy]");
      const sell = e.target.closest?.("[data-sell]");
      if (buy) openActionModal("compra", buy.getAttribute("data-buy"));
      if (sell) openActionModal("venda", sell.getAttribute("data-sell"));
    });

    // Collapse per card (MODIFICADO para abrir o Modal de Detalhes)
    document.getElementById("listaAtividades")?.addEventListener("click", (e) => {
      const t = e.target.closest?.("[data-toggle-card]");
      if (!t) return;

      const ticker = t.getAttribute("data-ticker");
      if (ticker) {
        openDetailModal(ticker);
      }
    });

    // Edit button
    document
      .getElementById("listaAtividades")
      ?.addEventListener("click", async (e) => {
        const btn = e.target.closest?.("[data-edit]");
        if (!btn) return;
        const docId = btn.getAttribute("data-edit");
        const ticker = btn.getAttribute("data-edit-ticker") || "";
        if (!docId) {
          alert("Não encontrei o último movimento deste ticker.");
          return;
        }

        try {
          const ref = doc(db, "ativos", docId);
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            alert("Documento não encontrado.");
            return;
          }
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
          if (fObj) fObj.value = Number(d.objetivoFinanceiro || 0);
          if (fLink) fLink.value = d.linkExterno || "";

          if (labelP) labelP.textContent = "Preço (€)";
          if (vendaTotWrap) vendaTotWrap.style.display = "none";
        } catch (err) {
          console.error("Falha ao abrir edição:", err);
          alert("Não foi possível abrir a edição.");
        }
      });

    // Tipo muda o label e visibilidade de venda total
    tipoSel?.addEventListener("change", () => {
      const isVenda = tipoSel.value === "venda";

      if (labelP)
        labelP.textContent = isVenda
          ? "Preço de venda (€)"
          : "Preço de compra (€)";

      if (vendaTotWrap) vendaTotWrap.style.display = isVenda ? "block" : "none";

      // (NOVO) se não for venda, limpar estado de "venda total"
      if (!isVenda) {
        if (vendaTot) vendaTot.checked = false;
        if (fQtd) {
          fQtd.removeAttribute("readonly");
          // se quiseres limpar também o valor, descomenta:
          // fQtd.value = "";
        }
      }
    });

    // ===============================
    // Venda total = fechar posição (SEM apagar histórico)
    // ===============================
    vendaTot?.addEventListener("change", () => {
      const checked = !!vendaTot.checked;
      const pos = Number(fPosAtual?.value || currentPosQty || 0);

      if (!fQtd) return;

      if (checked) {
        if (!(pos > 0)) {
          alert("Não há posição para fechar (quantidade em carteira = 0).");
          vendaTot.checked = false;
          return;
        }

        // preenche com a posição total
        fQtd.value = Math.abs(pos).toString();
        fQtd.setAttribute("readonly", "readonly");
      } else {
        fQtd.removeAttribute("readonly");
        fQtd.value = "";
      }
    });

    // Submit
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const tipo = (tipoSel?.value || "compra").toLowerCase(); // compra | venda | edicao
      const nome = fNome?.value.trim() || "";
      const ticker = fTicker?.value.trim().toUpperCase() || "";
      const setor = fSetor?.value.trim() || "";
      const merc = fMerc?.value.trim() || "";
      const qtd = toNumStrict(fQtd?.value);
      const preco = toNumStrict(fPreco?.value);
      const obj = toNumStrict(fObj?.value);
      const lnk = fLink?.value?.trim() || "";
      const vendaTotal = !!vendaTot?.checked;
      const docId = (document.getElementById("pfDocId")?.value || "").trim();

      try {
        if (tipo === "edicao" && docId) {
          // Obter o documento original antes de editar
          const docRef = doc(db, "ativos", docId);
          const snap = await getDoc(docRef);
          const originalData = snap.exists() ? snap.data() : {};
          const oldTicker = (originalData.ticker || "").toUpperCase();

          // 1. Atualizar o registo atual
          await updateDoc(docRef, {
            nome,
            ticker,
            setor,
            mercado: merc,
            quantidade: Number.isFinite(qtd) ? qtd : 0,
            precoCompra: Number.isFinite(preco) ? preco : 0,
            objetivoFinanceiro: Number.isFinite(obj) ? obj : 0,
            linkExterno: lnk,
          });

          // 2. (NOVO) Se o objetivo ou link mudou, propagar para TODOS os registos deste ticker
          if (
            (Number.isFinite(obj) && obj !== originalData.objetivoFinanceiro) ||
            lnk !== originalData.linkExterno
          ) {
            const q = query(
              collection(db, "ativos"),
              where("ticker", "==", ticker),
            );
            const snapAll = await getDocs(q);
            const updates = snapAll.docs.map((d) =>
              updateDoc(d.ref, {
                objetivoFinanceiro: obj,
                linkExterno: lnk,
              }),
            );
            await Promise.all(updates);
          }
        } else {
          let qtdEfetiva = qtd;

          // venda total → usar posição atual
          if (tipo === "venda" && vendaTotal) {
            const pos = Number(fPosAtual?.value || currentPosQty || 0);
            qtdEfetiva = Math.abs(pos);

            if (!(qtdEfetiva > 0)) {
              alert("Não há posição para fechar (quantidade em carteira = 0).");
              return;
            }
          }

          // validação base
          if (
            !ticker ||
            !nome ||
            !Number.isFinite(qtdEfetiva) ||
            !Number.isFinite(preco) ||
            qtdEfetiva <= 0 ||
            preco <= 0
          ) {
            alert("Preenche Ticker, Nome, Quantidade (>0) e Preço (>0).");
            return;
          }

          // venda parcial não pode exceder a posição
          if (tipo === "venda" && !vendaTotal) {
            const pos = Number(fPosAtual?.value || currentPosQty || 0);
            if (qtdEfetiva > pos) {
              alert(`Não podes vender mais do que tens. Posição atual: ${pos}`);
              return;
            }
          }
          const quantidade =
            tipo === "venda" ? -Math.abs(qtdEfetiva) : Math.abs(qtdEfetiva);
          const payload = {
            tipoAcao: tipo,
            nome,
            ticker,
            setor,
            mercado: merc,
            quantidade,
            precoCompra: preco,
            objetivoFinanceiro: Number.isFinite(obj) ? obj : 0,
            linkExterno: lnk,
            dataCompra: serverTimestamp(),
          };
          await addDoc(collection(db, "ativos"), payload);

          // (OPCIONAL) Propagar objetivo/link para todos os outros registos deste ticker
          // Isto garante que se mudas o link numa nova compra, ele reflete-se no plano de trade global
          if (obj > 0 || lnk) {
            const q = query(
              collection(db, "ativos"),
              where("ticker", "==", ticker),
            );
            const snapAll = await getDocs(q);
            const upds = snapAll.docs.map((d) =>
              updateDoc(d.ref, {
                objetivoFinanceiro:
                  obj > 0 ? obj : d.data().objetivoFinanceiro || 0,
                linkExterno: lnk || d.data().linkExterno || "",
              }),
            );
            await Promise.all(upds);
          }
        }

        closeModal();
        // Removido location.reload() - a atualização é agora em tempo real via onSnapshot
      } catch (err) {
        console.error("❌ Erro ao guardar movimento:", err);
        alert("Não foi possível guardar. Tenta novamente.");
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
        } catch { }
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
      } catch { }
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

  window._dynamicStrategyGlobals = { CORE: 0.65, SATELLITE: 0.35 };
  window._dynamicStrategyTickers = {};
  let fltState = { estado: "", mercado: "", setor: "", sort: "queda", estrategia: "" };

  export async function initScreen() {
    console.log("🏁 initScreen 'atividade' iniciada...");
    const cont = document.getElementById("listaAtividades");
    if (!cont) return;

    _eventsWired = false; // reset para garantir que os listeners se ligam ao novo DOM
    cont.innerHTML = "A carregar…";

    // Registrar ajuda e plano
    wirePortfolioHelpModal();
    showPortfolioHelp();
    wireInvestPlanner();

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

    onSnapshot(collection(db, "acoesDividendos"), (snap) => {
      _lastAcoesSnap = snap;
      handleUpdate();
    });

    onSnapshot(doc(db, "config", "strategy"), (snap) => {
      _lastStrategySnap = snap;
      handleUpdate();
    });
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

      const getDynStrat = (tk, nm) => {
        if (dynTickers && dynTickers[tk]) {
          if (dynTickers[tk].category === "NONE" || dynTickers[tk].category === null) return null;
          return { category: dynTickers[tk].category, target: (dynTickers[tk].target || 0) / 100 };
        }
        return getStrategicInfo(tk, nm);
      };

      const infoMap = new Map();
      aSnap.forEach((d) => {
        const x = d.data();
        if (x.ticker) infoMap.set(String(x.ticker).toUpperCase(), x);
      });

      const grupos = new Map();
      const movimentosAsc = [];

      snap.forEach((docu) => {
        const d = docu.data();
        const dt =
          d.dataCompra && typeof d.dataCompra.toDate === "function"
            ? d.dataCompra.toDate()
            : null;

        const tickerRaw = String(d.ticker || "").toUpperCase();
        if (!tickerRaw) return;
        const ticker = cleanTicker(tickerRaw);

        const qtd = toNumStrict(d.quantidade);
        const preco = toNumStrict(d.precoCompra);
        const safeQtd = Number.isFinite(qtd) ? qtd : 0;
        const safePreco = Number.isFinite(preco) ? preco : 0;

        const g = grupos.get(ticker) || {
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
          qtd: 0,
          custoMedio: 0,
          investido: 0,
          realizado: 0,
          objetivo: 0,
          link: "",
          anyObjSet: false,
          lastDate: null,
          lastDocId: null,
        };

        if (safeQtd > 0) {
          const totalAntes = g.qtd * g.custoMedio;
          const totalCompra = safeQtd * safePreco;
          const novaQtd = g.qtd + safeQtd;
          g.custoMedio = novaQtd > 0 ? (totalAntes + totalCompra) / novaQtd : 0;
          g.qtd = novaQtd;
        } else if (safeQtd < 0) {
          const sellQtd = Math.abs(safeQtd);
          const lucro = (safePreco - g.custoMedio) * sellQtd;
          g.realizado += lucro;
          g.qtd -= sellQtd;
          if (g.qtd <= 0) {
            g.qtd = 0;
            g.custoMedio = 0;
          }
        }

        g.investido = g.qtd * g.custoMedio;
        const obj = toNumStrict(d.objetivoFinanceiro);
        if (!g.anyObjSet && Number.isFinite(obj) && obj > 0) {
          g.objetivo = obj;
          if (d.linkExterno) g.link = d.linkExterno;
          g.anyObjSet = true;
        } else if (d.linkExterno && !g.link) {
          g.link = d.linkExterno;
        }

        if (!g.lastDate || (dt && dt > g.lastDate)) {
          g.lastDate = dt;
          g.lastDocId = docu.id;
        }

        g.nome = d.nome || g.nome;
        g.setor = (() => {
          const sRaw = d.setor || d.sector || d.Setor || d.Sector || d.industry || d.Industry || d.indústria || d.Indústria || d.segmento || d.segment || g.setor || "";
          let s = canon(sRaw);
          if ((!s || s === "—") && String(d.ticker).includes(":")) {
            const p = String(d.ticker).split(":")[0].trim();
            if (p.length > 2) s = canon(p);
          }
          return s || "—";
        })();
        g.mercado = canon(d.mercado || d.market || d.Market || g.mercado) || "—";

        grupos.set(ticker, g);
        movimentosAsc.push({
          date: dt || new Date(0),
          ticker,
          qtd: safeQtd,
          preco: safePreco,
        });
      });

      const gruposArr = Array.from(grupos.values());
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

      // Lucro Atual (aberto)
      const lucroAberto = abertos.reduce((a, g) => a + (g.lucroAtual || 0), 0);
      // Lucro Total (Acumulado) = Lucro Aberto + Lucro já realizado (vendas passadas)
      const lucroRealizado = gruposArr.reduce(
        (a, g) => a + (g.realizado || 0),
        0,
      );
      const lucroTotal = lucroAberto + lucroRealizado;

      const retornoPct = totalInvestido ? (lucroTotal / totalInvestido) * 100 : 0;

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
        const p = g.precoAtual,
          s200 = g._sma200;
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

      // --- (NOVO) Cálculo Estratégico do War Chest (CORE/SATELLITE) ---
      let totalWarChest = 0;
      let satWeightTotal = 0;

      // Primeiro pass: calcular exposição de Satélites
      for (const g of abertos) {
        const sInfo = getDynStrat(g.ticker, g.nome);
        g._strategy = sInfo; // Cache da info estratégica
        if (sInfo && sInfo.category === "SATELLITE" && totalInvestido > 0) {
          satWeightTotal += (g.investido / totalInvestido);
        }
      }

      const canReinforceSatellite = satWeightTotal < dynSatTotal;

      // Segundo pass: calcular necessidade de capital por ativo
      for (const g of abertos) {
        const sInfo = g._strategy;
        if (!sInfo) continue;

        const currentWeight = totalInvestido > 0 ? (g.investido / totalInvestido) : 0;
        const deviation = sInfo.target - currentWeight;
      
        // Regra 3 e 5: Desvio > 5% e prioridade Core
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

      if (elTI) elTI.textContent = fmtEUR.format(totalInvestido);
      if (elLT) elLT.textContent = fmtEUR.format(lucroAberto);
      if (elLA) elLA.textContent = `Acumulado: ${fmtEUR.format(lucroTotal)}`;
      if (elRA) elRA.textContent = fmtEUR.format(rendimentoAnual);
      if (elRP)
        elRP.textContent =
          totalInvestido > 0 ? `${retornoPct.toFixed(1)}%` : "---";
      if (elEX) elEX.textContent = `${expSMA200Pct.toFixed(0)}%`;
      if (elWC) elWC.textContent = fmtEUR.format(totalWarChest);

      // (NOVO) Cálculo da distribuição estratégica e por ativo
      const estrategiaMap = new Map();
      const ativosMap = new Map();
      const tickerCatMap = new Map();
      for (const g of abertos) {
        const cat = g._strategy ? g._strategy.category : "NÃO DEFINIDA";
        estrategiaMap.set(cat, (estrategiaMap.get(cat) || 0) + (g.investido || 0));
        ativosMap.set(g.ticker, (ativosMap.get(g.ticker) || 0) + (g.investido || 0));
        tickerCatMap.set(g.ticker, cat);
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

      // 4) FILTRAGEM E ORDENAÇÃO
      let filtered = gruposArr.filter((g) => Number.isFinite(g.qtd) && g.qtd > 0);

      // Popular dropdowns de Mercado e Setor (apenas se vazios)
      const fMercado = document.getElementById("fltMercado");
      const fSetor = document.getElementById("fltSetor");
      if (
        fMercado &&
        (!fMercado.options.length || fMercado.options.length <= 1)
      ) {
        const markets = [
          ...new Set(gruposArr.map((g) => g.mercado).filter(Boolean)),
        ].sort();
        markets.forEach((m) => fMercado.add(new Option(m, m)));
        const sectors = [
          ...new Set(gruposArr.map((g) => g.setor).filter(Boolean)),
        ].sort();
        sectors.forEach((s) => fSetor.add(new Option(s, s)));
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

      wireQuickActions(gruposArr);
      wirePortfolioHelpModal();
      wireInvPlan(gruposArr, infoMap);
    } catch (e) {
      console.error("Erro ao processar atividade:", e);
      cont.innerHTML = `<p class="muted">Não foi possível carregar a lista. Detalhe: ${e.message}</p>`;
    }
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

    const isBelowSMA200 = precoAtual && s200 && precoAtual < s200;
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
    // Verde se atingido, azul se positivo, vermelho se negativo
    const progressColor = lucroAtual >= objetivoFin ? "var(--success)" : (lucroAtual > 0 ? "#22c55e" : "#ef4444");

    return `
    <div class="asset-card">
      <!-- HEADER: Ticker e Preço -->
      <div class="asset-header" data-toggle-card data-ticker="${g.ticker}">
        <div class="asset-info-main">
          <div class="asset-status-badge" style="background: ${stateColor}15; color: ${stateColor}; border: 1px solid ${stateColor}30;">
            ${estadoOp}
          </div>
          <div class="asset-ticker-box">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
              <span class="asset-ticker-symbol">${g.ticker}</span>
              ${sInfo ? `<span class="strategy-badge strategy-badge--${sInfo.category.toLowerCase()}">${sInfo.category}</span>` : ''}
            </div>
            <span class="asset-name" title="${g.nome}">${g.nome}</span>



          </div>
        </div>
        
        <div class="asset-price-box">
          <div class="asset-price">${fmtEUR.format(precoAtual)}</div>
          <div class="asset-change ${lucroAtual >= 0 ? "up" : "down"}">
            ${lucroAtual >= 0 ? "+" : ""}${fmtEUR.format(lucroAtual)} (${pLossPct.toFixed(1)}%)
          </div>
        </div>
      </div>

      <!-- PROGRESSO DO OBJETIVO -->
      ${objetivoFin > 0 ? `
      <div style="margin: 0 16px 12px; padding: 10px; background: rgba(34, 197, 94, 0.03); border-radius: 8px; border: 1px solid rgba(34, 197, 94, 0.1);">
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
      <div style="margin: 0 16px 12px; padding: 10px; background: rgba(0,0,0,0.03); border-radius: 8px; border: 1px solid var(--border);">
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 5px;">
          <span style="color: var(--muted-foreground)">Alocação: <strong>${currentW.toFixed(1)}%</strong></span>
          <span style="color: var(--muted-foreground)">Alvo: <strong>${targetW.toFixed(1)}%</strong></span>
        </div>
        <div style="height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; display: flex;">
          <div style="width: ${Math.min(100, (currentW / targetW) * 100)}%; background: ${weightColor};"></div>
        </div>
        ${g._shouldReinforceStrategic ? `
          <div style="font-size: 0.65rem; color: #ef4444; font-weight: 700; margin-top: 6px; display: flex; align-items: center; gap: 4px;">
            <i class="fas fa-arrow-up"></i> Falta alocar €${formatNum(g._strategicNeed)} (~${formatNum(g._strategicNeed / (precoAtual || 1))} unid.) p/ atingir o alvo dos ${targetW.toFixed(1)}%
          </div>
        ` : ""}
        ${estadoOp === "REDUZIR" && (g._strategicExcess || 0) > 0 ? `
          <div style="font-size: 0.65rem; color: #f59e0b; font-weight: 700; margin-top: 6px; display: flex; align-items: center; gap: 4px;">
            <i class="fas fa-arrow-down"></i> Reduzir €${formatNum(g._strategicExcess)} (${formatNum(g._strategicExcess / (precoAtual || 1))} unid.) p/ atingir o alvo
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
        <div class="metric-item">
          <span class="metric-label">Yield</span>
          <span class="metric-value">${yPct}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">P/E Ratio</span>
          <span class="metric-value">${isFiniteNum(g._pe) ? g._pe.toFixed(1) : "—"}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Rácio R/R</span>
          <span class="metric-value">
            ${(() => {
        const risk = precoAtual - stopTec;
        const reward = tp2 - precoAtual;
        return risk > 0 && reward > 0 ? `1:${(reward / risk).toFixed(1)}` : "—";
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

        <button class="btn ghost btn-icon" 
                onclick="${g.link ? `window.open('${g.link}', '_blank')` : `document.querySelector('[data-edit=\\'${g.lastDocId}\\']').click()`}" 
                title="${g.link ? 'Abrir link externo' : 'Adicionar link'}">
          <i class="fas ${g.link ? "fa-link" : "fa-plus"}"></i>
        </button>

        <button class="btn ghost btn-icon" data-edit="${g.lastDocId}" data-edit-ticker="${g.ticker}" title="Editar movimento">
          <i class="fas fa-edit"></i>
        </button>
      </div>
    </div>`;
}

  // ==========================================
  // 🚀 Planeador de Investimento IA (DCA)
  // ==========================================
  function wireInvestPlanner() {
    const modal = document.getElementById("invPlanModal");
    const btnOpen = document.getElementById("btnOpenInvPlan");
    const btnClose = document.getElementById("invPlanClose");
    const btnCalc = document.getElementById("btnCalcInvPlan");
    const assetListCont = document.getElementById("invPlanAssetsList");
    const btnSelectAll = document.getElementById("btnInvSelectAll");
    const inpStrat = document.getElementById("inpInvStrat");

    if (!modal || modal.__wired) return;
    modal.__wired = true;

    btnOpen?.addEventListener("click", (e) => {
      e.stopPropagation();
      modal.classList.remove("hidden");
      populateAssets();
    });

    btnClose?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    function populateAssets() {
      if (!assetListCont) return;
      assetListCont.innerHTML = "";
      const targetsWithGoal = _currentGruposArr.filter(g => g._strategy && g._strategy.target > 0);
      targetsWithGoal.forEach(g => {
        const label = document.createElement("label");
        label.className = "inv-asset-label";
        label.dataset.category = g._strategy.category;
        label.innerHTML = `<input type="checkbox" class="inv-asset-check" value="${g.ticker}" checked> <span>${g.ticker}</span>`;
        assetListCont.appendChild(label);
      });
    }

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

    btnCalc?.addEventListener("click", () => {
      const tAmt = parseFloat(document.getElementById("inpInvTotal").value);
      const mons = parseInt(document.getElementById("inpInvMonths").value);
      const freq = parseFloat(document.getElementById("inpInvFreq").value);
      const checks = assetListCont.querySelectorAll(".inv-asset-check:checked");
      const tickers = Array.from(checks).map(c => c.value);

      if (isNaN(tAmt) || tAmt <= 0) { alert("Insira um montante válido."); return; }
      if (tickers.length === 0) { alert("Selecione pelo menos um ativo."); return; }

      const totalP = Math.max(1, Math.round(mons * freq));
      const perP = tAmt / totalP;

      const resAmt = document.getElementById("resInvPerPeriod");
      const resTot = document.getElementById("resInvTotalPeriods");
      const resBox = document.getElementById("invPlanResult");

      if (resAmt) resAmt.textContent = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(perP);
      if (resTot) resTot.textContent = totalP;
      if (resBox) resBox.style.display = "block";

      renderDCAPlan(perP, tickers);
    });

    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
    document.addEventListener("keydown", (e) => {
      if (!modal.classList.contains("hidden") && e.key === "Escape") modal.classList.add("hidden");
    });
  }

  function renderDCAPlan(amtPerPeriod, selectedTickers) {
    const tbody = document.getElementById("invPlanTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const targets = _currentGruposArr
      .filter(g => selectedTickers.includes(g.ticker))
      .map(g => {
        const s = g._strategy;
        return { 
          ticker: g.ticker, 
          category: s.category,
          targetPct: s.target,
          currentVal: g.qtd * (g.precoAtual || 0),
          preco: g.precoAtual || 0
        };
      })
      .filter(x => x !== null);

    if (targets.length === 0) {
      tbody.innerHTML = "<tr><td colspan='4' style='padding:20px; text-align:center; color:var(--muted-foreground);'>Nenhum ativo com meta estratégica definida em 'Definições'.</td></tr>";
      return;
    }

    const totalValNow = _currentTotalInvested;
    
    // Calcular "Peso Atual"
    let plan = targets.map(t => {
      const currentWeight = totalValNow > 0 ? t.currentVal / totalValNow : 0;
      const shortfall = t.targetPct - currentWeight;
      return { ...t, currentWeight, shortfall };
    });

    // Ordenar: Primeiro CORE, depois por Shortfall (quem está mais longe da meta)
    plan.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category === "CORE" ? -1 : 1;
      }
      return b.shortfall - a.shortfall;
    });

    // Distribuir o montante do período
    // Usamos uma lógica de reequilíbrio: priorizar quem está underweight (shortfall > 0)
    const underweight = plan.filter(p => p.shortfall > 0);
    const useList = underweight.length > 0 ? underweight : plan;
    const sumTargets = useList.reduce((acc, p) => acc + p.targetPct, 0);

    const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

    useList.forEach(p => {
      const weightInPlan = p.targetPct / (sumTargets || 1);
      const allocatedAmt = amtPerPeriod * weightInPlan;
      if (allocatedAmt < 0.01) return;

      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border)";
      tr.innerHTML = `
        <td style="padding: 10px 4px;"><strong>${p.ticker}</strong></td>
        <td style="padding: 10px 4px;"><span class="strategy-badge strategy-badge--${p.category.toLowerCase()}" style="font-size:0.6rem; padding: 2px 6px;">${p.category}</span></td>
        <td style="padding: 10px 4px; text-align: right;">${(p.targetPct * 100).toFixed(1)}%</td>
        <td style="padding: 10px 4px; text-align: right; font-weight: 700; color: #8b5cf6;">${fmtEUR.format(allocatedAmt)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

// ===============================
// Plano de Investimento IA - Integração com Capital Manager
// ===============================
async function wireInvPlan(lastAtivosArr, acoesDataMap) {
  const btnOpen = document.getElementById("btnOpenInvPlan");
  const modal = document.getElementById("invPlanModal");
  const btnClose = document.getElementById("invPlanClose");
  const btnCalc = document.getElementById("btnCalcInvPlan");
  const inpTotal = document.getElementById("inpInvTotal");

  if (!btnOpen || !modal) return;

  btnOpen.addEventListener("click", async () => {
    modal.classList.remove("hidden");
    
    // Carregar recomendação do CapitalManager
    try {
      const snapConfig = await getDoc(doc(db, "config", "strategy"));
      if (snapConfig.exists()) {
        const config = snapConfig.data();
        const positions = lastAtivosArr.map(g => ({ ticker: g.ticker, ...g }));
        const state = CapitalManager.calculatePortfolioState(positions, acoesDataMap);
        const smartDca = CapitalManager.getSmartDCA(config.monthlyBase || 0, state);
        const recommendation = CapitalManager.getWarChestRecommendation(state, config.availableCash || 0);

        // Preencher com o valor recomendado (Smart DCA + o que estiver disponível para investir hoje)
        const suggestedValue = smartDca.adjusted + recommendation.toInvestNow;
        if (suggestedValue > 0) {
          inpTotal.value = suggestedValue.toFixed(0);
          
          // Adicionar uma nota visual no modal
          const noteEl = document.createElement("div");
          noteEl.style.fontSize = "0.75rem";
          noteEl.style.color = "var(--success)";
          noteEl.style.marginBottom = "10px";
          noteEl.innerHTML = `💡 Sugestão IA: <strong>${new Intl.NumberFormat("pt-PT", {style:"currency", currency:"EUR"}).format(suggestedValue)}</strong> (DCA Ajustado + Liquidez Estratégica)`;
          
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

    renderInvPlanAssets(lastAtivosArr);
  });

  btnClose.addEventListener("click", () => modal.classList.add("hidden"));
  btnCalc.addEventListener("click", () => {
    const total = parseFloat(inpTotal.value) || 0;
    const months = parseInt(document.getElementById("inpInvMonths").value) || 1;
    const freq = parseFloat(document.getElementById("inpInvFreq").value) || 1;
    const strat = document.getElementById("inpInvStrat").value;
    
    // Obter selecionados
    const checks = document.querySelectorAll(".inv-asset-check:checked");
    const selectedTickers = Array.from(checks).map(c => c.value);
    
    generateInvPlan(total, months, freq, strat, selectedTickers, lastAtivosArr, acoesDataMap);
  });
}

function renderInvPlanAssets(ativos) {
  const container = document.getElementById("invPlanAssetsList");
  if (!container) return;
  container.innerHTML = ativos.map(a => `
    <label style="display: flex; align-items: center; gap: 4px; background: var(--card); padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; border: 1px solid var(--border); cursor: pointer;">
      <input type="checkbox" class="inv-asset-check" value="${a.ticker}" checked>
      <span>${a.ticker}</span>
    </label>
  `).join("");
}

function generateInvPlan(total, months, freq, strategy, selectedTickers, ativos, acoesMap) {
  const resultDiv = document.getElementById("invPlanResult");
  const tableBody = document.getElementById("invPlanTableBody");
  if (!resultDiv || !tableBody) return;

  const totalPeriods = months * freq;
  const perPeriod = total / (totalPeriods || 1);

  document.getElementById("resInvPerPeriod").textContent = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(perPeriod);
  document.getElementById("resInvTotalPeriods").textContent = totalPeriods.toFixed(0);

  // Lógica de Alocação: Priorizar ativos com maior drawdown e melhor score
  const filtered = ativos.filter(a => selectedTickers.includes(a.ticker));
  if (strategy !== "ALL") {
    // Filtrar por categoria CORE/SATELLITE se necessário
  }

  // Ordenar usando o motor de priorização do CapitalManager
  const prioritized = CapitalManager.prioritizeReinforcements(filtered.map(f => {
    const mkt = acoesMap.get(f.ticker) || {};
    return {
      ...f,
      scoreQuality: (calculateLucroMaximoScore(mkt).score || 0.5),
      scoreValuation: (calculateLucroMaximoScore(mkt).components?.V || 0.5),
      desvioTarget: 1.0 // Placeholder para lógica de target se implementada
    };
  }));

  tableBody.innerHTML = prioritized.slice(0, 8).map(p => {
    const weight = 1 / prioritized.slice(0, 8).length; // Distribuição simples por agora
    return `
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 8px 4px;"><strong>${p.ticker}</strong></td>
        <td style="padding: 8px 4px;"><span style="font-size: 0.65rem; padding: 2px 4px; border-radius: 4px; background: var(--muted);">${p.category || "SAT"}</span></td>
        <td style="padding: 8px 4px; text-align: right;">${(weight * 100).toFixed(0)}%</td>
        <td style="padding: 8px 4px; text-align: right; font-weight: 700; color: var(--success);">${new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(perPeriod * weight)}</td>
      </tr>
    `;
  }).join("");

  resultDiv.style.display = "block";
}
