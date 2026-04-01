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
  updateDoc,
  getDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function isFiniteNum(v) {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n);
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

    const info = _lastAcoesSnap
      ? Array.from(_lastAcoesSnap.docs)
          .find((d) => d.data().ticker === ticker)
          ?.data() || {}
      : {};

    const fmtEUR = new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "EUR",
    });
    const tp2 = tp2NecessarioCalc(g) || g.custoMedio * 1.15;
    const precoAtual = g.precoAtual || 0;
    const precoMedio = g.custoMedio || 0;
    const lucroAtual = g.lucroAtual || 0;
    const pLossPct = g._pLossPct;
    const estadoOp = g._estadoOp;
    const s200 = g._sma200;

    // Badge de estado
    const detBadge = document.getElementById("detEstadoBadge");

    // Cores refinadas para melhor contraste em modos claros e escuros
    // (Verdes mais vivos, vermelhos mais profundos)
    let stateColor = "var(--muted-foreground)";
    if (estadoOp === "REFORÇAR") stateColor = "#ef4444";
    if (estadoOp === "COMPRAR") stateColor = "#22c55e";
    if (estadoOp === "REDUZIR") stateColor = "#f59e0b"; // Amber 500 (melhor que eab308 no escuro)
    if (estadoOp === "VENDER") stateColor = "#ef4444";

    if (detBadge) {
      detBadge.textContent = estadoOp;
      detBadge.style.background = `${stateColor}18`; // Ligeiramente mais opacidade (18%)
      detBadge.style.color = stateColor;
      detBadge.style.borderColor = `${stateColor}35`;
    }

    $("#detTickerTitle").textContent = `${g.ticker} — ${g.nome}`;
    $("#detQtd").textContent = g.qtd.toFixed(1);
    $("#detMedio").textContent = fmtEUR.format(precoMedio);
    $("#detInvestido").textContent = fmtEUR.format(g.investido);
    const elLucro = $("#detLucro");
    elLucro.textContent = fmtEUR.format(lucroAtual);
    elLucro.className = lucroAtual >= 0 ? "up" : "down";

    $("#detMetaValor").textContent =
      `${fmtEUR.format(g.objetivo || 0)} de Lucro`;
    $("#detPrecoAlvo").textContent = fmtEUR.format(tp2);

    const metaStatus = $("#detMetaStatus");
    metaStatus.innerHTML = `<span class="badge ${lucroAtual >= (g.objetivo || 0) ? "premium" : "outline"}" style="font-size: 0.7rem; font-weight: 800;">
      ${lucroAtual >= (g.objetivo || 0) ? "META ATINGIDA ✅" : "EM PROGRESSO"}
    </span>`;

    // --- (NOVO) Conselho Estratégico (CORE/SATELLITE) ---
    const sInfo = g._strategy;
    let strategyHtml = "";
    if (sInfo) {
      const currentW = (g._currentWeight || 0) * 100;
      const targetW = sInfo.target * 100;
      const deviation = targetW - currentW;
      const canReinforce = g._shouldReinforceStrategic;

      strategyHtml = `
        <div style="margin-bottom: 20px; padding: 14px; background: rgba(79, 70, 229, 0.04); border-radius: 12px; border: 1px solid rgba(79, 70, 229, 0.08);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="font-weight: 800; font-size: 0.75rem; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
              <i class="fas fa-chess-knight"></i> Estratégia ${sInfo.category}
            </div>
            <div style="font-size: 0.65rem; font-weight: 700; padding: 3px 8px; border-radius: 12px; border: 1px solid; ${canReinforce ? 'color: #ef4444; border-color: #ef444440; background: #ef444410;' : 'color: var(--muted-foreground); border-color: var(--border);'}">
              ${canReinforce ? 'REFORÇO PRIORITÁRIO' : 'OBSERVAR'}
            </div>
          </div>
          <div style="display: flex; gap: 20px; margin-bottom: 10px;">
            <div style="flex: 1;">
              <div style="font-size: 0.6rem; color: var(--muted-foreground); text-transform: uppercase;">Alocação</div>
              <div style="font-size: 1.1rem; font-weight: 800;">${currentW.toFixed(1)}%</div>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 0.6rem; color: var(--muted-foreground); text-transform: uppercase;">Alvo</div>
              <div style="font-size: 1.1rem; font-weight: 800; color: var(--primary);">${targetW.toFixed(1)}%</div>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 0.6rem; color: var(--muted-foreground); text-transform: uppercase;">Desvio</div>
              <div style="font-size: 1.1rem; font-weight: 800; color: ${deviation > 5 ? '#ef4444' : 'inherit'}">${deviation.toFixed(1)}%</div>
            </div>
          </div>
          <div style="padding: 10px; background: #fff; border-radius: 8px; border: 1px dashed var(--border); font-size: 0.8rem; line-height: 1.4;">
            ${canReinforce 
              ? `<strong>Plano:</strong> O ativo está abaixo do alvo (>5%). <strong>Reforçar ${fmtEUR.format(g._strategicNeed)}</strong> para equilibrar.` 
              : deviation > 0 
                ? `<strong>Plano:</strong> Aguardar rebalanceamento trimestral. Desvio atual (${deviation.toFixed(1)}%) é inferior a 5% ou prioridade é CORE.` 
                : `<strong>Plano:</strong> Exposição acima do alvo estratégico. Não realizar novos reforços.`
            }
          </div>
        </div>
      `;
    }

    // Plano de Trade
    const isBelowSMA200 = precoAtual && s200 && precoAtual < s200;
    const r1Pct = isBelowSMA200 ? 5.0 : 2.5;
    const r2Pct = isBelowSMA200 ? 8.5 : 4.5;
    const r1Preco = precoAtual * (1 - r1Pct / 100);
    const r2Preco = precoAtual * (1 - r2Pct / 100);
    const tp1 = precoMedio * 1.05;
    const stopTec = s200 ? s200 * 0.95 : precoMedio * 0.9;

    $("#detTradePlan").innerHTML = `
      ${strategyHtml}
      <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary); margin-bottom: 10px; grid-column: span 3;">📝 Plano de Trade (Zonas)</div>
      <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px;">
        <label class="muted" style="font-size: 0.7rem; display: block;">Compra Base</label>
        <strong style="font-size: 0.9rem;">${fmtEUR.format(precoMedio)}</strong>
      </div>
      <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(234, 179, 8, 0.05);">
        <label class="muted" style="font-size: 0.7rem; display: block;">Reforço 1 (-${r1Pct}%)</label>
        <strong style="font-size: 0.9rem;">${fmtEUR.format(r1Preco)}</strong>
      </div>
      <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(234, 179, 8, 0.1);">
        <label class="muted" style="font-size: 0.7rem; display: block;">Reforço 2 (-${r2Pct}%)</label>
        <strong style="font-size: 0.9rem;">${fmtEUR.format(r2Preco)}</strong>
      </div>
      <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(34, 197, 94, 0.05);">
        <label class="muted" style="font-size: 0.7rem; display: block;">TP1 (+5%)</label>
        <strong style="font-size: 0.9rem;">${fmtEUR.format(tp1)}</strong>
      </div>
      <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(34, 197, 94, 0.1);">
        <label class="muted" style="font-size: 0.7rem; display: block;">TP2</label>
        <strong style="font-size: 0.9rem;">${fmtEUR.format(tp2)}</strong>
      </div>
      <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(239, 68, 68, 0.05);">
        <label class="muted" style="font-size: 0.7rem; display: block;">Stop Técnico</label>
        <strong style="font-size: 0.9rem;">${fmtEUR.format(stopTec)}</strong>
      </div>
    `;

    $("#detBarStop").textContent = `${fmtEUR.format(stopTec)} (STOP)`;
    $("#detBarPreco").textContent = `${fmtEUR.format(precoAtual)} (PREÇO)`;
    $("#detBarAlvo").textContent = `${fmtEUR.format(tp2)} (ALVO)`;

    // Cenários
    const Io = g.investido;
    const Qo = g.qtd;
    const Pa = precoAtual;
    const genScenario = (label, invest, color) => {
      const nQ = Qo + invest / Pa;
      const nT = Io + invest;
      const nPM = nT / nQ;
      const rec = Pa > 0 ? (nPM / Pa - 1) * 100 : 0;
      return `
        <div style="text-align: center; padding: 8px; background: #ffffff; border-radius: 6px; border-bottom: 3px solid ${color}; border: 1px solid rgba(0,0,0,0.08);">
          <div style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: #64748b;">${label}</div>
          <div style="font-size: 0.82rem; margin: 4px 0; color: #111;">+${fmtEUR.format(invest)}</div>
          <div style="font-size: 0.6rem; color: #94a3b8;">Novo PM: ${fmtEUR.format(nPM)}</div>
          <div style="font-size: 0.75rem; font-weight: 700; color: ${color};">+${rec.toFixed(1)}%</div>
        </div>`;
    };
    $("#detCenarios").innerHTML =
      genScenario("Leve", 250, "#eab308") +
      genScenario("Médio", 500, "#3b82f6") +
      genScenario("Forte", 1000, "#22c55e");

    const yPct = isFiniteNum(g._yCur) ? (g._yCur * 100).toFixed(2) + "%" : "—";
    const formatSmaDelta = (sma, cur) => {
      if (!isFiniteNum(sma) || !isFiniteNum(cur) || sma <= 0) return "—";
      const d = ((cur - sma) / sma) * 100;
      return `${d.toFixed(1)}%`;
    };

    $("#detYield").textContent = yPct;
    $("#detPE").textContent = isFiniteNum(g._pe) ? g._pe.toFixed(1) : "—";

    const risk = precoAtual - stopTec;
    const reward = tp2 - precoAtual;
    $("#detRR").textContent =
      risk > 0 && reward > 0 ? `1:${(reward / risk).toFixed(1)}` : "—";

    $("#detSMA50").textContent = formatSmaDelta(g._sma50, precoAtual);
    $("#detSMA200").textContent = formatSmaDelta(s200, precoAtual);

    // Botões de ação no modal
    const bBuy = $("#detBtnBuy");
    const bSell = $("#detBtnSell");
    const bEdit = $("#detBtnEdit");
    const bLink = $("#detBtnLink");

    bBuy.onclick = () => {
      detModal.classList.add("hidden");
      openActionModal("compra", g.ticker);
    };
    bSell.onclick = () => {
      detModal.classList.add("hidden");
      openActionModal("venda", g.ticker);
    };
    bEdit.onclick = () => {
      detModal.classList.add("hidden");
      // Simular click no botão de edit original para não duplicar lógica complexa
      document.querySelector(`[data-edit="${g.lastDocId}"]`)?.click();
    };
    bLink.onclick = () => {
      if (g.link) window.open(g.link, "_blank");
      else {
        detModal.classList.add("hidden");
        document.querySelector(`[data-edit="${g.lastDocId}"]`)?.click();
      }
    };
    bLink.className = `btn ghost ${g.link ? "" : "muted"}`;
    bBuy.textContent = estadoOp === "REFORÇAR" ? "Reforçar" : "Comprar";

    // --- (NOVO) Lógica de Crises no Modal ---
    const detCriSel = $("#detCrisisSelector");
    const detCriRes = $("#detCrisisResult");
    if (detCriSel) {
      detCriSel.innerHTML = '<option value="0">Simular cenário de queda...</option>' + 
        CRISES_HISTORY.map(c => `<option value="${c.drop}">${c.name}</option>`).join("");
      detCriSel.value = "0";
      if (detCriRes) detCriRes.style.display = "none";

      // Adicionar listener específico para o selector do modal (apenas uma vez)
      if (!detCriSel.__wired) {
        detCriSel.__wired = true;
        detCriSel.addEventListener("change", () => {
          const dropPct = Number(detCriSel.value);
          if (dropPct <= 0) {
            detCriRes.style.display = "none";
            return;
          }
          // Precisamos do ticker atual... podemos pegar do detCriSel.dataset se setarmos abaixo
          const tk = detCriSel.dataset.ticker;
          const group = byTickerGlobal.get(tk);
          if (!group) return;

          const pCur = group.precoAtual || 0;
          const cPrice = pCur * (1 - dropPct / 100);
          const iO = group.investido || 0;
          const qO = group.qtd || 0;
          const nQ = qO + (iO / (cPrice || 1));
          const nPM = (iO * 2) / nQ;

          const fmt = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
          $("#detCrisisPrice").textContent = fmt.format(cPrice);
          $("#detCrisisCost").textContent = fmt.format(iO);
          $("#detCrisisNewPM").textContent = fmt.format(nPM);
          detCriRes.style.display = "block";
        });
      }
      detCriSel.dataset.ticker = g.ticker;
    }

    detModal.classList.remove("hidden");
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
let fltState = { estado: "", mercado: "", setor: "", sort: "queda" };

export async function initScreen() {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  _eventsWired = false; // reset para garantir que os listeners se ligam ao novo DOM
  cont.innerHTML = "A carregar…";

  // Registrar ajuda
  wirePortfolioHelpModal();
  showPortfolioHelp();

  await ensureChartJS();

  // Wire filters
  const fEstado = document.getElementById("fltEstado");
  const fMercado = document.getElementById("fltMercado");
  const fSetor = document.getElementById("fltSetor");
  const fSort = document.getElementById("fltSort");

  [fEstado, fMercado, fSetor, fSort].forEach((el) => {
    el?.addEventListener("change", () => {
      fltState = {
        estado: fEstado.value,
        mercado: fMercado.value,
        setor: fSetor.value,
        sort: fSort.value,
      };
      handleUpdate();
    });
  });

  const handleUpdate = async () => {
    if (!_lastAtivosSnap || !_lastAcoesSnap) return;
    await processAndRender(_lastAtivosSnap, _lastAcoesSnap);
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
}

async function processAndRender(snap, aSnap) {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  try {
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

      const ticker = String(d.ticker || "").toUpperCase();
      if (!ticker) return;

      const qtd = toNumStrict(d.quantidade);
      const preco = toNumStrict(d.precoCompra);
      const safeQtd = Number.isFinite(qtd) ? qtd : 0;
      const safePreco = Number.isFinite(preco) ? preco : 0;

      const g = grupos.get(ticker) || {
        ticker,
        nome: d.nome || ticker,
        setor: d.setor || "-",
        mercado: d.mercado || "-",
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
      g.setor = d.setor || g.setor;
      g.mercado = d.mercado || g.mercado;

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
      const sma50 = Number(info.sma50) || Number(info.SMA50) || null;
      const sma200 = Number(info.sma200) || Number(info.SMA200) || null;
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
      const sInfo = getStrategicInfo(g.ticker, g.nome);
      g._strategy = sInfo; // Cache da info estratégica
      if (sInfo && sInfo.category === "SATELLITE") {
        satWeightTotal += (g.investido / totalInvestido);
      }
    }

    const canReinforceSatellite = satWeightTotal < 0.35;

    // Segundo pass: calcular necessidade de capital por ativo
    for (const g of abertos) {
      const sInfo = g._strategy;
      if (!sInfo) continue;

      const currentWeight = g.investido / totalInvestido;
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
  } catch (e) {
    console.error("Erro ao processar atividade:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
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

  return `
    <div class="asset-card">
      <!-- HEADER: Ticker e Preço -->
      <div class="asset-header" data-toggle-card data-ticker="${g.ticker}">
        <div class="asset-info-main">
          <div class="asset-status-badge" style="background: ${stateColor}15; color: ${stateColor}; border: 1px solid ${stateColor}30;">
            ${estadoOp}
          </div>
          <div class="asset-ticker-box">
            <span class="asset-ticker-symbol">${g.ticker}</span>
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
            <i class="fas fa-arrow-up"></i> Reforçar €${formatNum(g._strategicNeed)} p/ atingir o alvo
          </div>
        ` : ""}
      </div>
      ` : ""}

      <!-- METRICS GRID -->
      <div class="asset-metrics-grid">
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
