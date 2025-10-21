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
  collection,
  getDocs,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================================================
Carregamento “on-demand” de libs (Chart.js, html2canvas, jsPDF)
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
    "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"
  );
}
async function ensurePDFLibs() {
  if (!window.html2canvas)
    await ensureScript(
      "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
    );
  if (!window.jspdf)
    await ensureScript(
      "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"
    );
}

async function ensureAutoTable() {
  // só carrega o plugin se ainda não existir
  if (!window.jspdf?.autoTable) {
    await ensureScript(
      "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js"
    );
  }
}

/* =========================================================
Aparência / helpers
========================================================= */
const isDark = () =>
  document.documentElement.getAttribute("data-theme") === "dark";
const chartColors = () => ({
  grid: isDark() ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
  ticks: isDark() ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.75)",
  tooltipBg: isDark() ? "rgba(17,17,17,.95)" : "rgba(255,255,255,.95)",
  tooltipFg: isDark() ? "#fff" : "#111",
});
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

/* =========================================================
   Config ajustável — pesos/limites do algoritmo (visível)
   ========================================================= */
const CFG = {
  // limites prudentes (crescimento anualizado composto)
  MAX_ANNUAL_RETURN: 0.8, // +80%/ano (limite técnico)
  MIN_ANNUAL_RETURN: -0.8, // -80%/ano

  // peso dos componentes no score [0..1]
  // R = retorno/€, V = P/E, T = tendência (SMA), D = dividend yield, Rsk = constante
  WEIGHTS: { R: 0.1, V: 0.25, T: 0.3, D: 0.3, Rsk: 0.05 },

  // teto duro por ticker (usado em frações e inteiros)
  CAP_PCT_POR_TICKER: 0.15,

  // blend das taxas conforme período escolhido no simulador
  BLEND_WEIGHTS: {
    "1s": { w: 0.75, m: 0.15, y: 0.1 },
    "1m": { w: 0.1, m: 0.75, y: 0.15 },
    "1a": { w: 0.1, m: 0.15, y: 0.75 },
  },

  // “cap” económico para evitar projeções irrealistas
  REALISM_CAP: { enabled: true, trigger: 0.8, cap: 0.2 }, // se taxa primária anualizada >80%, corta blend a 20%
};

window.ANL_CFG = CFG; // podes ajustar via consola se quiseres

/* =========================================================
   Cálculos de dividendos / yield
   - alpha_update_sheet grava:
     • dividendoMedio24m = ANUAL (média 24m)
     • dividendo         = POR PAGAMENTO (média por pagamento 24m)
     • periodicidade + mes (distribuição mensal)
   ========================================================= */
function anualizarDividendo(dividendoPorPagamento, periodicidade) {
  const d = toNum(dividendoPorPagamento);
  const p = String(periodicidade || "").toLowerCase();
  if (d <= 0) return 0;
  if (p === "mensal") return d * 12;
  if (p === "trimestral") return d * 4;
  if (p === "semestral") return d * 2;
  return d; // anual (ou n/A)
}
function anualPreferido(doc) {
  const d24 = toNum(doc.dividendoMedio24m);
  if (d24 > 0) return d24; // anual (média 24m)
  return anualizarDividendo(doc.dividendo, doc.periodicidade);
}
function perPayment(doc) {
  const base = toNum(doc.dividendo); // por pagamento (média 24m)
  if (base > 0) return base;
  const anual = anualPreferido(doc);
  const per = String(doc.periodicidade || "");
  if (per === "Mensal") return anual / 12;
  if (per === "Trimestral") return anual / 4;
  if (per === "Semestral") return anual / 2;
  if (per === "Anual") return anual;
  return 0;
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
   Seleção / Ordenação / Tabela
   ========================================================= */
const selectedTickers = new Set();
const updateSelCount = () => {
  const el = document.getElementById("anlSelCount");
  if (el) el.textContent = String(selectedTickers.size);
};

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
    const va = acc(a),
      vb = acc(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}
function markSortedHeader() {
  document
    .querySelectorAll("#anlTable thead th.sortable")
    .forEach((th) => th.classList.remove("sorted-asc", "sorted-desc"));
  if (sortKey) {
    const th = document.querySelector(
      `#anlTable thead th[data-sort="${sortKey}"]`
    );
    if (th) th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
  }
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
  const body = document.getElementById("anlHeatmapBody");
  const headMonths = document.getElementById("anlHeatmapHeaderMonths");
  if (!body || !headMonths) return;

  headMonths.innerHTML = mesesPT
    .map((m) => `<div class="cell"><strong>${m}</strong></div>`)
    .join("");

  // thresholds (com base em per-payment)
  const perPayments = rows
    .map((r) => perPayment(r))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const q1 = perPayments.length
    ? perPayments[Math.floor(perPayments.length * 0.33)]
    : 0.01;
  const q2 = perPayments.length
    ? perPayments[Math.floor(perPayments.length * 0.66)]
    : 0.02;

  body.innerHTML = rows
    .map((r) => {
      const per = String(r.periodicidade || "n/A");
      const idxMes = mesToIdx.get(String(r.mes || "")) ?? NaN;
      const meses = mesesPagamento(per, idxMes);
      const perPay = perPayment(r);
      const klass =
        perPay > 0
          ? perPay <= q1
            ? "pay-weak"
            : perPay <= q2
            ? "pay-med"
            : "pay-strong"
          : "";
      const cells = Array.from({ length: 12 }, (_, m) => {
        if (!meses.includes(m)) return `<div class="cell"></div>`;
        const tt = `${r.ticker} • ${mesesPT[m]} • ~${fmtEUR(perPay)}`;
        return `<div class="cell tt ${klass}" data-tt="${tt}">${
          perPay ? fmtEUR(perPay) : ""
        }</div>`;
      }).join("");
      const nome = r.nome ? ` <span class="muted">— ${r.nome}</span>` : "";
      return `
      <div class="row">
        <div class="cell sticky-col"><strong>${r.ticker}</strong>${nome}</div>
        <div class="months">${cells}</div>
      </div>`;
    })
    .join("");

  // sincroniza header ao scroll
  const headerScroll = document.getElementById("anlHeatmapHeaderScroll");
  const onScroll = (e) => {
    headMonths.scrollLeft = e.target.scrollLeft;
    headerScroll.scrollLeft = e.target.scrollLeft;
  };
  body.removeEventListener("scroll", onScroll);
  body.addEventListener("scroll", onScroll, { passive: true });

  // ir para Dezembro na 1ª renderização
  setTimeout(() => {
    const maxX = body.scrollWidth - body.clientWidth;
    if (maxX > 0) {
      body.scrollLeft = maxX;
      headMonths.scrollLeft = maxX;
      headerScroll.scrollLeft = maxX;
    }
  }, 0);
}

/* =========================================================
   Tabela principal
   ========================================================= */
function renderTable(rows) {
  const tb = document.getElementById("anlTableBody");
  if (!tb) return;

  const badgePE = (pe) => {
    if (!Number.isFinite(pe) || pe <= 0)
      return `<span class="badge muted">—</span>`;
    if (pe < 15) return `<span class="badge ok">${pe.toFixed(2)} Barato</span>`;
    if (pe <= 25)
      return `<span class="badge warn">${pe.toFixed(2)} Justo</span>`;
    return `<span class="badge danger">${pe.toFixed(2)} Caro</span>`;
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

  // Mostra fração decimal como % e aceita também valores já em percentagem
  // 0.6496 -> +64.96%   |   64.96 -> +64.96%
  const pct = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return `—`;
    const frac = Math.abs(n) > 1 ? n / 100 : n; // normaliza para fração
    const shown = frac * 100;
    const cls = frac >= 0 ? "up" : "down";
    const sign = frac >= 0 ? "+" : "";
    return `<span class="${cls}">${sign}${shown.toFixed(2)}%</span>`;
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
        <td class="sticky-col"><input type="checkbox" class="anlRowSel" data-ticker="${
          r.ticker
        }" ${checked} /></td>
        <td class="sticky-col"><strong>${r.ticker}</strong></td>
        <td>${r.nome || "—"}</td>
        <td>${r.setor || "—"}</td>
        <td>${r.mercado || "—"}</td>
        <td>${badgeYield(y, y24)}</td>
        <td>${
          Number.isFinite(r.yield24) ? `${r.yield24.toFixed(2)}%` : "—"
        }</td>
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
      </tr>`;
    })
    .join("");

  // listeners dos checkboxes de seleção
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

/* =========================================================
   Firestore (fetch)
   ========================================================= */
let ALL_ROWS = [];
async function fetchAcoes() {
  const snap = await getDocs(query(collection(db, "acoesDividendos")));
  const rows = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const ticker = String(d.ticker || "").toUpperCase();
    if (!ticker) return;

    const valor = toNum(d.valorStock);
    const anual = toNum(d.dividendoMedio24m) || anualPreferido(d); // anual (média 24m preferida)
    const y = computeYieldPct(anual, valor);

    rows.push({
      ticker,
      nome: d.nome || "",
      setor: canon(d.setor || ""),
      mercado: canon(d.mercado || ""),
      valorStock: valor,
      evEbitda:
        Number(d.evEbitda) ||
        Number(d["EV/Ebitda"]) ||
        (() => {
          const ev = Number(d.EV) || Number(d.ev);
          const ebt = Number(d.Ebitda) || Number(d.ebitda);
          return (Number.isFinite(ev) && Number.isFinite(ebt) && ebt > 0) ? ev / ebt : null;
      })(),
      dividendo: toNum(d.dividendo), // POR PAGAMENTO (média 24m)
      dividendoMedio24m: toNum(d.dividendoMedio24m), // ANUAL (média 24m)
      periodicidade: d.periodicidade || "",
      mes: d.mes || "",
      observacao: d.observacao || d["Observação"] || "",

      // derivados
      divPer: perPayment(d),
      divAnual: anual,
      yield: Number.isFinite(y) ? y : null,

      // crescimento (cuidado: podem vir strings)
      g1w: Number(d.taxaCrescimento_1semana) || 0,
      g1m: Number(d.taxaCrescimento_1mes) || 0,
      g1y: Number(d.taxaCrescimento_1ano) || 0,

      // valuation/técnicos (podem vir como string)
      yield24: Number(d.yield24) || null, // se existir, opcional
      pe:
        Number(d.pe) ||
        Number(d.peRatio) ||
        Number(d["P/E ratio (Preço/Lucro)"]) ||
        null,
      sma50: Number(d.sma50) || Number(d.SMA50) || null,
      sma200: Number(d.sma200) || Number(d.SMA200) || null,

      // deltas: usa os da BD se existirem; caso contrário, calcula a partir das SMAs
      delta50: (() => {
        const raw = Number(d.delta50);
        if (Number.isFinite(raw)) return Math.abs(raw) > 1 ? raw / 100 : raw; // aceita 9.1 ou 0.091
        const p = valor,
          s = Number(d.sma50) || Number(d.SMA50);
        return Number.isFinite(p) && Number.isFinite(s) && s > 0
          ? (p - s) / s
          : null;
      })(),

      delta200: (() => {
        const raw = Number(d.delta200);
        if (Number.isFinite(raw)) return Math.abs(raw) > 1 ? raw / 100 : raw;
        const p = valor,
          s = Number(d.sma200) || Number(d.SMA200);
        return Number.isFinite(p) && Number.isFinite(s) && s > 0
          ? (p - s) / s
          : null;
      })(),
    });
  });
  ALL_ROWS = rows;
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
      (r) => keyStr(r.ticker).includes(term) || keyStr(r.nome).includes(term)
    );
  if (setor) rows = rows.filter((r) => r.setor === setor);
  if (mercado) rows = rows.filter((r) => r.mercado === mercado);
  if (periodo) rows = rows.filter((r) => (r.periodicidade || "") === periodo);

  rows = sortRows(rows);
  renderCharts(rows);
  renderHeatmap(rows);
  hookHeatmapScrollSync();
  renderTable(rows);

  const selAll = document.getElementById("anlSelectAll");
  if (selAll)
    selAll.checked =
      rows.length > 0 && rows.every((r) => selectedTickers.has(r.ticker));
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

/** Converte percentagens ou frações em FRAÇÃO decimal (64.9→0.649, 0.649→0.649). */
function asRate(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) > 1 ? n / 100 : n;
}

/** Pequeno agregador por chave. */
function countBy(arr, keyFn) {
  const map = Object.create(null);
  for (const it of arr) {
    const k = String(keyFn(it) ?? "—");
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

/** Percentil simples (0..1). */
function percentile(arr, p) {
  const a = (arr || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const idx = Math.floor((a.length - 1) * Math.max(0, Math.min(1, p)));
  return a[idx];
}

/** Proxy muito simples de volatilidade [0..1] se não houver `row.volatility`. */
function proxyVol(row) {
  const w = Math.min(1, Math.abs(asRate(row?.g1w)) * 10); // semana tem peso alto
  const m = Math.min(1, Math.abs(asRate(row?.g1m)) * 3);  // mês moderado
  const y = Math.min(1, Math.abs(asRate(row?.g1y)));      // ano menor (já anual)
  return Math.max(0, Math.min(1, (w + m + y) / 3));
}

/* ---------------------------------------------
   Anualização prudente e cap económico suave
----------------------------------------------*/

/** Calcula taxa anualizada prudente a partir de g1w/g1m/g1y. */
function annualizeRate(row, periodoSel) {
  const w = asRate(row?.g1w);
  const m = asRate(row?.g1m);
  const y = asRate(row?.g1y);

  // anualizações (compounding)
  const rw = Math.pow(1 + w, 52) - 1;
  const rm = Math.pow(1 + m, 12) - 1;
  const ry = y || 0;

  // clamp técnico (protege extremos)
  const clampRate = (r) => clamp(r, CFG.MIN_ANNUAL_RETURN, CFG.MAX_ANNUAL_RETURN);
  const Rw = clampRate(rw), Rm = clampRate(rm), Ry = clampRate(ry);

  // mistura conforme período escolhido
  const BW = CFG.BLEND_WEIGHTS?.[periodoSel] || CFG.BLEND_WEIGHTS?.["1m"] || { w:0.1, m:0.75, y:0.15 };
  let r_blend = (BW.w * Rw) + (BW.m * Rm) + (BW.y * Ry);

  // prudence factor (ligeiro conservadorismo)
  r_blend *= 0.75;

  // penalização por volatilidade (usa row.volatility ou proxy)
  const vol = Number.isFinite(row?.volatility) ? Math.max(0, Math.min(1, row.volatility)) : proxyVol(row);
  r_blend *= (1 - Math.min(0.7, 0.7 * vol)); // corta até 70% em casos muito voláteis

  // cap económico "suave": limita exuberância quando o sinal primário já é muito alto
  const r_primary = (periodoSel === "1s") ? Rw : (periodoSel === "1m") ? Rm : Ry;
  const RC = CFG.REALISM_CAP || { enabled: true, trigger: 0.60, cap: 0.15 };
  if (RC.enabled && r_primary > RC.trigger) {
    const over = Math.max(0, r_primary - RC.trigger);
    const span = Math.max(1e-9, RC.cap - RC.trigger);
    const damp = 1 - Math.max(0, Math.min(1, over / span)) ** 0.75; // curva suave
    r_blend = Math.min(r_blend, RC.cap * Math.max(0.5, damp));
  }

  return clamp(r_blend, CFG.MIN_ANNUAL_RETURN, CFG.MAX_ANNUAL_RETURN);
}

/* ---------------------------------------------
   Scorings secundários (valuation / técnico)
----------------------------------------------*/

/** P/E — score 0..1 (baixo melhor). Curva suave e robusta. */
function scorePE(pe) {
  const v = Number(pe);
  if (!Number.isFinite(v) || v <= 0) return 0.4;  // neutro-ligeiro
  const lo = 10, hi = 30;                         // âncoras simples
  if (v <= lo * 0.6) return 1.0;
  if (v >= hi * 2)   return 0.1;
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); // 0..1
  const curve = 1 - Math.pow(t, 0.8);                       // côncava
  return clamp(0.1 + 0.9 * curve, 0, 1);
}

/** Tendência — combinação simples de preço vs SMA50/200 e golden cross. */
function scoreTrend(preco, sma50, sma200) {
  let t = 0;
  const p = Number(preco), s50 = Number(sma50), s200 = Number(sma200);
  if (Number.isFinite(p) && Number.isFinite(s50)  && p > s50)  t += 0.2;
  if (Number.isFinite(p) && Number.isFinite(s200) && p > s200) t += 0.3;
  if (Number.isFinite(s50) && Number.isFinite(s200) && s50 > s200) t += 0.1;

  // opcional: distância normalizada ao SMA50 (boost pequeno, capado)
  if (Number.isFinite(p) && Number.isFinite(s50) && s50 > 0) {
    const dist = clamp((p - s50) / s50, -0.2, 0.2); // ±20%
    t += dist * 0.5;
  }
  return clamp(t, 0, 1);
}

/** EV/EBITDA — score 0..1 (baixo melhor), com âncoras por setor. */
function scoreEVEBITDA(evebitda, setor) {
  const v = Number(evebitda);
  if (!Number.isFinite(v) || v <= 0) return 0.4; // neutro-ligeiro

  const A = (CFG.EVEBITDA_ANCHORS?.[String(setor || "—")] || CFG.EVEBITDA_ANCHORS?.default || { lo: 6, hi: 20 });
  const lo = Math.max(1, Number(A.lo) || 6);
  const hi = Math.max(lo + 1, Number(A.hi) || 20);

  if (v <= lo * 0.6) return 1.0; // muito barato
  if (v >= hi * 2)   return 0.1; // muito caro

  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); // 0..1
  const curve = 1 - Math.pow(t, 0.75);                      // côncava
  return clamp(0.1 + 0.9 * curve, 0, 1);
}

/* ---------------------------------------------
   Estender CFG sem o redefinir (pesos e âncoras)
----------------------------------------------*/

// Peso de EV/EBITDA no blend (se ainda não existir)
CFG.WEIGHTS = CFG.WEIGHTS || {};
if (typeof CFG.WEIGHTS.E !== "number") CFG.WEIGHTS.E = 0.20;

// Âncoras por setor para EV/EBITDA (ajusta ao teu universo)
CFG.EVEBITDA_ANCHORS = CFG.EVEBITDA_ANCHORS || {
  default:             { lo: 6,  hi: 20 },
  "Tecnologia":        { lo: 8,  hi: 25 },
  "Saúde":             { lo: 7,  hi: 22 },
  "Consumo Cíclico":   { lo: 7,  hi: 22 },
  "Consumo":           { lo: 7,  hi: 22 },
  "Indústria":         { lo: 6,  hi: 20 },
  "Financeiro":        { lo: 5,  hi: 16 },
  "Utilities":         { lo: 5,  hi: 14 },
  "Energia":           { lo: 5,  hi: 14 },
  "Imobiliário":       { lo: 6,  hi: 18 },
};

/* ---------------------------------------------
   Métricas base do ativo e score composto
----------------------------------------------*/

function calcularMetricasBase(acao, { periodo = "1m", horizonte = 1, incluirDiv = true } = {}) {
  const precoAtual = toNum(acao.valorStock);
  const anualDiv   = toNum(acao.divAnual ?? anualPreferido(acao)); // média 24m preferida
  const rAnnual    = annualizeRate(acao, periodo);
  const h          = Math.max(1, Number(horizonte || 1));

  // desconto de fiabilidade com o tempo (cada ano -15% de confiança)
  const decay = Math.exp(-0.15 * (h - 1));

  // valorização prudente (não usa rAnnual a 100%)
  const valorizacaoNoHorizonte = precoAtual * (Math.pow(1 + rAnnual * 0.8, h) - 1) * decay;
  const dividendosNoHorizonte  = (incluirDiv ? anualDiv * h : 0) * decay;

  const lucroUnidade   = dividendosNoHorizonte + valorizacaoNoHorizonte;
  const retornoPorEuro = precoAtual > 0 ? (lucroUnidade / precoAtual) : 0;

  return {
    preco: precoAtual,
    dividendoAnual: anualDiv,
    taxaPct: rAnnual * 100,
    totalDividendos: dividendosNoHorizonte,
    valorizacao: valorizacaoNoHorizonte,
    lucroUnidade,
    retornoPorEuro,
  };
}

/** Gera candidatos com score composto; aceita modo estrito (só retorno/€). */
function prepararCandidatos(rows, { periodo, horizonte, incluirDiv, modoEstrito = false }) {
  let cands = rows.map(a => ({
    ...a,
    metrics: calcularMetricasBase(a, { periodo, horizonte, incluirDiv }),
  })).filter(c =>
    c.metrics.preco > 0 &&
    Number.isFinite(c.metrics.lucroUnidade) &&
    c.metrics.lucroUnidade > 0
  );
  if (!cands.length) return [];

  // normalização do retorno/€ por p99 (resiste a outliers)
  const rets = cands.map(c => c.metrics.retornoPorEuro).filter(x => Number.isFinite(x) && x > 0);
  const p99  = Math.max(percentile(rets, 0.99), 1e-9);

  // penalização setorial suave (diversificação): 1/sqrt(contagem no setor)
  const bySetor = countBy(cands, c => c.setor);
  const setorFactor = (s) => 1 / Math.sqrt(bySetor[String(s ?? "—")] || 1);

  // compor score
  const out = cands.map(c => {
    const R = clamp(c.metrics.retornoPorEuro / p99, 0, 1);
    if (modoEstrito) return { ...c, score: R, __R: R };

    const V = scorePE(c.pe);
    const T = scoreTrend(c.metrics.preco, c.sma50, c.sma200);
    const D = scoreDividendYield(c);                 // definido noutro ponto do ficheiro
    const E = scoreEVEBITDA(c.evEbitda, c.setor);    // NOVO componente (valuation)

    const W = CFG.WEIGHTS || { R:0.10, V:0.30, T:0.30, D:0.25, E:0.20, Rsk:0.05 };

    // ajuste de risco via volatilidade (ou proxy)
    const vol = Number.isFinite(c?.volatility) ? Math.max(0, Math.min(1, c.volatility)) : proxyVol(c);
    const riskAdj = 1 / (1 + 0.75 * vol); // 0.57..1

    let score = clamp(
      (W.R||0)*R + (W.V||0)*V + (W.T||0)*T + (W.D||0)*D + (W.E||0)*E + (W.Rsk||0)*1.0,
      0, 1
    );
    score *= riskAdj;
    score *= setorFactor(c.setor); // deconcentra suavemente

    return { ...c, score, __R: R, __V: V, __T: T, __D: D, __E: E };
  }).filter(c => c.score > 0);

  return out;
}

/* ---------------------------------------------
   Estruturas auxiliares (linhas/totais)
----------------------------------------------*/

function makeLinha(c, qtd) {
  const investido = qtd * c.metrics.preco;
  return {
    nome: c.nome,
    ticker: c.ticker,
    preco: c.metrics.preco,
    quantidade: qtd,
    investido,
    lucro: qtd * c.metrics.lucroUnidade,
    taxaPct: c.metrics.taxaPct,
    dividendoAnual: c.metrics.dividendoAnual,
    divAnualAlloc: qtd * c.metrics.dividendoAnual,
    divPeriodoAlloc: qtd * c.metrics.totalDividendos,
    valorizAlloc: qtd * c.metrics.valorizacao,
  };
}

function sumarizar(linhas, investimento, gasto) {
  const sum = (k) => (linhas || []).reduce((s, l) => s + (Number(l[k]) || 0), 0);
  return {
    linhas,
    totalLucro:      sum("lucro"),
    totalGasto:      gasto,
    totalDivAnual:   sum("divAnualAlloc"),
    totalDivPeriodo: sum("divPeriodoAlloc"),
    totalValoriz:    sum("valorizAlloc"),
    restante:        Math.max(0, investimento - gasto),
  };
}

/* ---------------------------------------------
   Caps e redistribuição (ticker e setor)
----------------------------------------------*/

function aplicarCapsSetorETicker(allocMap, investimento, getSetorOf) {
  const capTicker = (CFG.CAP_PCT_POR_TICKER ?? 0.18) * investimento;
  const capSetor  = (CFG.CAP_PCT_POR_SETOR  ?? 0.30) * investimento;

  // 1) aplica cap por ticker
  let excedente = 0;
  for (const [c, v] of allocMap) {
    const nv = Math.min(v, capTicker);
    excedente += (v - nv);
    allocMap.set(c, nv);
  }

  // 2) itera redistribuição respeitando cap setorial
  let safety = 0;
  while (excedente > 1e-6 && safety++ < 10) {
    // soma por setor
    const porSetor = new Map();
    for (const [c, v] of allocMap) {
      const s = String(getSetorOf(c) ?? "—");
      porSetor.set(s, (porSetor.get(s) || 0) + v);
    }

    // elegíveis = tickers com margem de ticker e setor
    const elegiveis = [...allocMap.keys()].filter(c => {
      const s = String(getSetorOf(c) ?? "—");
      return (allocMap.get(c) || 0) + 1e-9 < capTicker &&
             (porSetor.get(s) || 0) + 1e-9 < capSetor;
    });
    if (!elegiveis.length) break;

    const somaScore = elegiveis.reduce((s, c) => s + (c.score || 0), 0) || 1;
    for (const c of elegiveis) {
      if (excedente <= 1e-6) break;
      const s = String(getSetorOf(c) ?? "—");
      const margemTicker = capTicker - (allocMap.get(c) || 0);
      const margemSetor  = capSetor  - (porSetor.get(s) || 0);
      const margem = Math.max(0, Math.min(margemTicker, margemSetor));
      if (margem <= 0) continue;

      const share = (c.score || 0) / somaScore * excedente;
      const add   = Math.min(share, margem);
      if (add > 0) {
        allocMap.set(c, (allocMap.get(c) || 0) + add);
        porSetor.set(s, (porSetor.get(s) || 0) + add);
        excedente -= add;
      }
    }
    if (excedente <= 1e-6) break;
  }

  return excedente; // se >0, não foi possível redistribuir tudo (caps apertados)
}

/* ---------------------------------------------
   Distribuições (frações e inteiros)
----------------------------------------------*/

/** Distribui investimento proporcional ao score (permite frações), respeitando caps. */
function distribuirFracoes_porScore(cands, investimento) {
  const somaScore = (cands || []).reduce((s, c) => s + (c.score || 0), 0);
  if (!(investimento > 0) || somaScore <= 0) {
    return sumarizar([], investimento, 0);
  }

  const ord = [...cands].sort((a, b) => (b.score || 0) - (a.score || 0));
  const alloc = new Map();

  // alvo inicial proporcional
  for (const c of ord) {
    alloc.set(c, (c.score / somaScore) * investimento);
  }

  // aplica caps por ticker e setor + redistribui excesso
  aplicarCapsSetorETicker(alloc, investimento, (c) => c.setor);

  // construir linhas (frações)
  const linhas = [];
  for (const c of ord) {
    const inv = alloc.get(c) || 0;
    const qtd = inv / (c.metrics.preco || 1);
    if (qtd > 0 && Number.isFinite(qtd)) linhas.push(makeLinha(c, qtd));
  }
  const gasto = linhas.reduce((s, l) => s + l.investido, 0);
  return sumarizar(linhas, investimento, gasto);
}

/** Distribuição discreta (quantidades inteiras) maximizando retorno/€ e respeitando caps. */
function distribuirInteiros_porScore(cands, investimento) {
  if (!(investimento > 0) || !Array.isArray(cands) || !cands.length) {
    return sumarizar([], investimento, 0);
  }

  const ord = [...cands].sort((a, b) => (b.score || 0) - (a.score || 0));
  const soma = ord.reduce((s, c) => s + (c.score || 0), 0) || 1;

  // alvo em €, depois arredonda para quantidades inteiras
  const allocEuros = new Map(ord.map(c => [c, (c.score / soma) * investimento]));
  aplicarCapsSetorETicker(allocEuros, investimento, (c) => c.setor);

  // quantidades base (floor)
  const base = ord.map(c => {
    const alvo = allocEuros.get(c) || 0;
    const p = c.metrics.preco || Infinity;
    const qtd = Math.max(0, Math.floor(p > 0 ? (alvo / p) : 0));
    return { c, qtd };
  });

  let gasto = base.reduce((s, x) => s + x.qtd * (x.c.metrics.preco || 0), 0);
  let restante = investimento - gasto;

  // greedy 1-a-1 (max retorno/€) com caps
  const capTicker = (CFG.CAP_PCT_POR_TICKER ?? 0.18) * investimento;
  const capSetor  = (CFG.CAP_PCT_POR_SETOR  ?? 0.30) * investimento;
  const investedTicker = (c) => (base.find(x => x.c === c)?.qtd || 0) * (c.metrics.preco || 0);
  const investedSetor  = () => {
    const m = new Map();
    for (const x of base) {
      const s = String(x.c.setor ?? "—");
      m.set(s, (m.get(s) || 0) + x.qtd * (x.c.metrics.preco || 0));
    }
    return m;
  };

  const minPreco = Math.min(...ord.map(c => c.metrics.preco || Infinity));
  let guard = 0;
  while (restante + 1e-9 >= minPreco && guard++ < 500) {
    const setMap = investedSetor();
    let best = null, bestRPE = -Infinity;

    for (const c of ord) {
      const p = c.metrics.preco || Infinity;
      if (!(p > 0 && p <= restante + 1e-9)) continue;

      // caps
      const invTk = investedTicker(c);
      if (invTk + p > capTicker + 1e-9) continue;
      const s = String(c.setor ?? "—");
      if ((setMap.get(s) || 0) + p > capSetor + 1e-9) continue;

      const rpe = (c.metrics.lucroUnidade || 0) / p;
      if (rpe > bestRPE) { bestRPE = rpe; best = c; }
    }

    if (!best) break;
    const rec = base.find(x => x.c === best);
    rec.qtd += 1;
    gasto += best.metrics.preco;
    restante = investimento - gasto;
  }

  const linhas = base.filter(x => x.qtd > 0).map(x => makeLinha(x.c, x.qtd));
  return sumarizar(linhas, investimento, gasto);
}


/* =========================================================
   Modal Simulação (open/close + render)
   ========================================================= */

// --- Estado do último resultado de simulação (para o Relatório) ---
let __ANL_LAST_SIM = {
  rows: [], // linhas normalizadas para o relatório
  opts: null, // { horizonte, periodo, incluirDiv, investimento }
};

// === Simulação (abrir/fechar) ===
function openSimModal() {
  const el = document.getElementById("anlSimModal");
  el?.classList.remove("hidden");
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}
function closeSimModal() {
  const el = document.getElementById("anlSimModal");
  el?.classList.add("hidden");
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
}

// === Relatório (abrir/fechar) ===
function openReportModal() {
  const el = document.getElementById("anlReportModal");
  el?.classList.remove("hidden");
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}
function closeReportModal() {
  const el = document.getElementById("anlReportModal");
  el?.classList.add("hidden");
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
}

function renderResultadoSimulacao(res) {
  const cont = document.getElementById("anlSimResultado");
  if (!cont) return;

  if (!res || !res.linhas || res.linhas.length === 0) {
    cont.innerHTML = `<p class="muted">Sem resultados. Verifica o investimento e a seleção.</p>`;
    return;
  }

  const horizonte = Number(document.getElementById("anlSimHoriz")?.value || 1);
  const periodoSel = document.getElementById("anlSimPeriodo")?.value || "1m";
  const incluirDiv = !!document.getElementById("anlSimIncluiDiv")?.checked;
  const periodoLabel =
    periodoSel === "1s" ? "1 semana" : periodoSel === "1m" ? "1 mês" : "1 ano";

  const retornoTotal = res.totalDivPeriodo + res.totalValoriz;
  const retornoPct =
    res.totalGasto > 0 ? (retornoTotal / res.totalGasto) * 100 : 0;

  const rows = res.linhas
    .filter((l) => l.quantidade > 0 && l.investido > 0)
    .map((l) => {
      const lucroLinha = l.divPeriodoAlloc + l.valorizAlloc;
      const noGrowth = Math.abs(l.valorizAlloc) < 1e-8;
      return `
      <tr>
        <td><strong>${l.ticker}</strong></td>
        <td>${l.nome || "—"}</td>
        <td>${fmtEUR(l.preco)}</td>
        <td>${Number(l.quantidade).toFixed(2)}</td>
        <td>${fmtEUR(l.investido)}</td>
        <td>${fmtEUR(lucroLinha)}${
        noGrowth
          ? ` <span class="badge muted" title="Sem valorização (taxa=0)">r=0%</span>`
          : ""
      }</td>
        <td>${fmtEUR(l.divAnualAlloc)}</td>
        <td>${fmtEUR(l.divPeriodoAlloc)}</td>
        <td>${fmtEUR(l.valorizAlloc)}</td>
      </tr>`;
    })
    .join("");

  cont.innerHTML = `
    <div class="card" style="margin-bottom:10px;">
      <div class="card-content" style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
        <div><strong>Horizonte:</strong> ${horizonte} ${
    horizonte === 1 ? "ano" : "anos"
  }</div>
        <div><strong>Período de crescimento:</strong> ${periodoLabel}</div>
        <div><strong>Dividendos:</strong> ${
          incluirDiv ? "incluídos" : "excluídos"
        }</div>
      </div>
    </div>

    <div class="tabela-scroll-wrapper">
      <table class="fine-table" style="width:100%">
        <thead>
          <tr>
            <th>Ticker</th><th>Nome</th><th>Preço</th><th>Qtd.</th>
            <th>Investido</th>
            <th>Lucro estimado (= Div. no horizonte + Valorização)</th>
            <th>Dividendo anual (aloc.)</th>
            <th>Dividendos no horizonte (h=${horizonte})</th>
            <th>Valorização no horizonte</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th colspan="4" style="text-align:right;">Totais</th>
            <th>${fmtEUR(res.totalGasto)}</th>
            <th>${fmtEUR(retornoTotal)}</th>
            <th>${fmtEUR(res.totalDivAnual)}</th>
            <th>${fmtEUR(res.totalDivPeriodo)}</th>
            <th>${fmtEUR(res.totalValoriz)}</th>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="card" style="margin-top:10px;">
      <div class="card-content" style="display:flex; gap:16px; flex-wrap:wrap;">
        <div><strong>Retorno total (€):</strong> ${fmtEUR(retornoTotal)}</div>
        <div><strong>Retorno total (%):</strong> ${retornoPct.toFixed(2)}%</div>
        <div><strong>Dividendos anuais (soma aloc.):</strong> ${fmtEUR(
          res.totalDivAnual
        )}</div>
        <div><strong>Dividendos no horizonte:</strong> ${fmtEUR(
          res.totalDivPeriodo
        )}</div>
        <div><strong>Valorização no horizonte:</strong> ${fmtEUR(
          res.totalValoriz
        )}</div>
        ${
          res.restante > 0
            ? `<div><strong>Restante não investido:</strong> ${fmtEUR(
                res.restante
              )}</div>`
            : ""
        }
      </div>
    </div>`;
}

/* === Pizza (selecionados) — sem “tremores” === */
let chartSelSetor = null;
async function renderSelectedSectorChart(rowsSelecionadas) {
  await ensureChartJS();
  const wrap = document.getElementById("anlSelSectorChartWrap");
  const el = document.getElementById("anlSelSectorChart");
  if (!wrap || !el) return;
  chartSelSetor?.destroy();

  const map = new Map();
  rowsSelecionadas.forEach((r) => {
    const k = canon(r.setor || "—");
    map.set(k, (map.get(k) || 0) + 1);
  });
  const labels = Array.from(map.keys());
  const data = Array.from(map.values());
  if (!data.length) {
    wrap.classList.add("muted");
    return;
  }
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  chartSelSetor = new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 1 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
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

/* =========================================================
[S11] Relatório (PDF) — V2 profissional (única parte alterada)
========================================================= */

// Helpers específicos da V2

function scoreDividendYield(row) {
  // tenta usar 'yield' já calculado; senão deriva de divAnual/preço
  let yPct = Number(row.yield);
  if (!Number.isFinite(yPct)) {
    const anual = Number(row.divAnual ?? anualPreferido(row)) || 0;
    const preco = Number(row.valorStock) || 0;
    yPct = preco > 0 ? (anual / preco) * 100 : 0;
  }
  const capYield = 8; // 8% ou o que achares prudente; acima disto não ganha mais score
  const frac = clamp(yPct / capYield, 0, 1);
  return frac; // 0..1
}

const _fmtEUR = (n) =>
  Number(n || 0).toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
  });
const _pct = (x) => `${(Number(x || 0) * 100).toFixed(1)}%`;

// Tenta obter imagem de um canvas; se não existir, devolve null
function getChartImageByCanvasId(id) {
  const cnv = document.getElementById(id);
  if (!cnv) return null;
  try {
    const chart = cnv.__chartist || cnv.__chart || cnv.chart || null;
    if (chart?.toBase64Image) return chart.toBase64Image();
    return cnv.toDataURL("image/png");
  } catch {
    return null;
  }
}

const pieOptsForPdf = {
  animation: false,
  maintainAspectRatio: true,
  plugins: {
    legend: { display: true, position: "bottom" }, // mostra legenda
    datalabels: {
      formatter: (v, ctx) => {
        const lbl = ctx.chart.data.labels[ctx.dataIndex] || "";
        const val = Number(v || 0);
        // mostra etiqueta e percentagem aprox.
        const sum =
          (ctx.chart.data.datasets[0].data || []).reduce(
            (a, b) => a + Number(b || 0),
            0
          ) || 1;
        const pct = (val / sum) * 100;
        return `${lbl}\n${pct.toFixed(1)}%`;
      },
      anchor: "center",
      align: "center",
      color: "#222",
      font: { weight: "600", size: 11 },
      clamp: true,
    },
  },
};

// ================================================
// CHARTS TEMPORÁRIOS (PDF) — robusto, com pizzas & datalabels
// ================================================
async function buildTempReportCharts(rows) {
  await ensureChartJS();
  if (!window.ChartDataLabels) {
    await ensureScript(
      "https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2"
    );
  }
  const DATALABELS = window.ChartDataLabels || null;
  const piePlugins = DATALABELS ? [DATALABELS] : [];

  // container offscreen
  const wrap = document.createElement("div");
  wrap.style.position = "fixed";
  wrap.style.left = "-10000px";
  document.body.appendChild(wrap);

  // helper (antes de usar)
  const mkCanvas = (id, w = 900, h = 500) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.id = id;
    wrap.appendChild(c);
    return c.getContext("2d");
  };

  // opções partilhadas para pizzas
  const pieOptsForPdf = {
    animation: false,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: true, position: "bottom" },
      datalabels: DATALABELS
        ? {
            formatter: (v, ctx) => {
              const lbl = ctx.chart.data.labels[ctx.dataIndex] || "";
              const val = Number(v || 0);
              const sum =
                (ctx.chart.data.datasets[0].data || []).reduce(
                  (a, b) => a + Number(b || 0),
                  0
                ) || 1;
              const pct = (val / sum) * 100;
              return `${lbl}\n${pct.toFixed(1)}%`;
            },
            anchor: "center",
            align: "center",
            color: "#222",
            font: { weight: "600", size: 11 },
            clamp: true,
          }
        : undefined,
    },
  };

  // Dados base
  const labels = rows.map((r) => r.ticker);
  const invest = rows.map((r) => Number(r.investido || 0));
  const lucro = rows.map((r) => Number(r.lucro || 0));
  const divH = rows.map((r) =>
    Number((r.divHoriz ?? r.dividendoHorizonte) || 0)
  );
  const valH = rows.map((r) => Number(r.valorizacao || 0));

  // Agregar por setor via ALL_ROWS (ticker → setor)
  const sectorMap = new Map();
  rows.forEach((r) => {
    const base = ALL_ROWS.find((x) => x.ticker === r.ticker);
    const setor = (base?.setor || "—").trim();
    sectorMap.set(
      setor,
      (sectorMap.get(setor) || 0) + Number(r.investido || 0)
    );
  });
  const sectorLabels = Array.from(sectorMap.keys());
  const sectorInvest = Array.from(sectorMap.values());

  const imgs = [];

  // Pizza — por Ativo
  if (!document.getElementById("chartDistInvest")) {
    const ctx = mkCanvas("chartDistInvest", 600, 600); // quadrado = círculo perfeito
    new Chart(ctx, {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            data: invest,
            backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          },
        ],
      },
      options: pieOptsForPdf,
      plugins: piePlugins,
    });
    imgs.push({
      id: "chartDistInvest",
      title: "Distribuição do Investimento por Ativo (Pizza)",
      img: getChartImageByCanvasId("chartDistInvest"),
    });
  }

  // Pizza — por Setor
  if (sectorLabels.length && !document.getElementById("chartDistSector")) {
    const ctx = mkCanvas("chartDistSector", 600, 600);
    new Chart(ctx, {
      type: "pie",
      data: {
        labels: sectorLabels,
        datasets: [
          {
            data: sectorInvest,
            backgroundColor: sectorLabels.map(
              (_, i) => PALETTE[i % PALETTE.length]
            ),
          },
        ],
      },
      options: pieOptsForPdf,
      plugins: piePlugins,
    });
    imgs.push({
      id: "chartDistSector",
      title: "Distribuição do Investimento por Setor (Pizza)",
      img: getChartImageByCanvasId("chartDistSector"),
    });
  }

  // Barras — Lucro
  if (!document.getElementById("chartLucroPorAtivo")) {
    const ctx = mkCanvas("chartLucroPorAtivo");
    new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Lucro (€)", data: lucro }] },
      options: { animation: false, plugins: { legend: { display: false } } },
    });
    imgs.push({
      id: "chartLucroPorAtivo",
      title: "Lucro Estimado por Ativo (Barras)",
      img: getChartImageByCanvasId("chartLucroPorAtivo"),
    });
  }

  // Barras — Dividendos vs Valorização
  if (!document.getElementById("chartDivVsVal")) {
    const ctx = mkCanvas("chartDivVsVal");
    new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Dividendos (H)", data: divH },
          { label: "Valorização (H)", data: valH },
        ],
      },
      options: { animation: false },
    });
    imgs.push({
      id: "chartDivVsVal",
      title: "Dividendos vs Valorização por Ativo (Barras Agrupadas)",
      img: getChartImageByCanvasId("chartDivVsVal"),
    });
  }

  // Barras — Investido por Ativo
  if (!document.getElementById("chartInvestPorAtivo")) {
    const ctx = mkCanvas("chartInvestPorAtivo");
    new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Investido (€)", data: invest }] },
      options: { animation: false, plugins: { legend: { display: false } } },
    });
    imgs.push({
      id: "chartInvestPorAtivo",
      title: "Valor Investido por Ativo (Barras)",
      img: getChartImageByCanvasId("chartInvestPorAtivo"),
    });
  }

  // limpar canvases temporários após captura
  requestAnimationFrame(() => document.body.removeChild(wrap));
  return imgs.filter((x) => !!x.img);
}

// Mantém API antiga: encaminha para a V2
export async function generateReportPDF(selecionadas = [], opts = {}) {
  return generateReportPDF_v2(selecionadas, opts);
}

// === PREVIEW DO RELATÓRIO (igual ao PDF) ====================
let __repCharts = {
  byTicker: null,
  bySector: null,
  lucro: null,
  divval: null,
  investBars: null,
};

// ================================
// PREVIEW (modal) — robusto e com data labels (se disponível)
// ================================
async function renderReportPreview(data, { horizonte }) {
  await ensureChartJS();
  // plugin (labels nas fatias) — carregar e usar de forma segura
  if (!window.ChartDataLabels) {
    await ensureScript(
      "https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2"
    );
  }
  const DATALABELS = window.ChartDataLabels || null;
  const piePlugins = DATALABELS ? [DATALABELS] : [];

  // helpers para destruir antes de recriar
  const getCtx = (id) => {
    const cnv = document.getElementById(id);
    if (!cnv) return null;
    const prev = window.Chart?.getChart?.(cnv);
    if (prev) prev.destroy();
    return cnv.getContext("2d");
  };

  // KPIs
  const totInvest = data.reduce((s, a) => s + Number(a.investido || 0), 0);
  const totDivAnual = data.reduce(
    (s, a) => s + Number(a.dividendoAnual || a.divAnual || 0),
    0
  );
  const totDivHoriz = data.reduce(
    (s, a) => s + Number(a.dividendoHorizonte || a.divHoriz || 0),
    0
  );
  const totVal = data.reduce((s, a) => s + Number(a.valorizacao || 0), 0);
  const totLucro = data.reduce((s, a) => s + Number(a.lucro || 0), 0);
  const retPct = totInvest > 0 ? (totLucro / totInvest) * 100 : 0;

  const _e = (id) => document.getElementById(id);
  _e("repKpiInv").textContent = fmtEUR(totInvest);
  _e("repKpiRet").textContent = `${fmtEUR(totLucro)} (${retPct.toFixed(1)}%)`;
  _e("repKpiDiv").textContent = `${fmtEUR(totDivAnual)} / ${fmtEUR(
    totDivHoriz
  )}  (H=${horizonte})`;
  _e("repKpiVal").textContent = fmtEUR(totVal);

  // Tabela
  const tbody = document.querySelector("#repTable tbody");
  const denom = totInvest > 0 ? totInvest : 1;
  tbody.innerHTML = data
    .map((a) => {
      const inv = Number(a.investido || 0);
      const da = Number(a.dividendoAnual || a.divAnual || 0);
      const dh = Number(a.dividendoHorizonte || a.divHoriz || 0);
      const vz = Number(a.valorizacao || 0);
      const lc = Number(a.lucro || 0);
      return `
      <tr>
        <td>${a.nome || "—"}</td>
        <td><strong>${a.ticker || "—"}</strong></td>
        <td>${fmtEUR(inv)}</td>
        <td>${fmtEUR(da)}</td>
        <td>${fmtEUR(dh)}</td>
        <td>${fmtEUR(vz)}</td>
        <td>${fmtEUR(lc)}</td>
        <td>${((inv / denom) * 100).toFixed(1)}%</td>
      </tr>`;
    })
    .join("");

  // Dados p/ gráficos
  const byTickerLabels = data.map((a) => a.ticker);
  const byTickerInvest = data.map((a) => Number(a.investido || 0));
  const byTickerLucro = data.map((a) => Number(a.lucro || 0));
  const byTickerDivH = data.map((a) =>
    Number(a.dividendoHorizonte || a.divHoriz || 0)
  );
  const byTickerValH = data.map((a) => Number(a.valorizacao || 0));

  // Agregar por setor (lookup em ALL_ROWS)
  const sectorMap = new Map();
  data.forEach((a) => {
    const base = ALL_ROWS.find((r) => r.ticker === a.ticker);
    const setor = canon(base?.setor || "—");
    sectorMap.set(
      setor,
      (sectorMap.get(setor) || 0) + Number(a.investido || 0)
    );
  });
  const bySectorLabels = Array.from(sectorMap.keys());
  const bySectorInvest = Array.from(sectorMap.values());

  // limpar gráficos antigos (se existirem)
  Object.values(__repCharts).forEach((c) => c?.destroy());
  __repCharts = {};

  // opções partilhadas
  const pieCommon = {
    responsive: true,
    animation: false,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
      datalabels: DATALABELS
        ? {
            formatter: (v, ctx) =>
              `${ctx.chart.data.labels[ctx.dataIndex]}\n${fmtEUR(v)}`,
            anchor: "center",
            align: "center",
            clamp: true,
            color: "#222",
            font: { weight: "600" },
          }
        : undefined,
    },
  };
  const barCommon = {
    responsive: false,
    animation: false,
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
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
  };

  // 1) Pizza por Ativo
  const ctxByTicker = getCtx("repChartInvestByTicker");
  if (ctxByTicker) {
    __repCharts.byTicker = new Chart(ctxByTicker, {
      type: "pie",
      data: {
        labels: byTickerLabels,
        datasets: [
          {
            data: byTickerInvest,
            backgroundColor: byTickerLabels.map(
              (_, i) => PALETTE[i % PALETTE.length]
            ),
          },
        ],
      },
      options: pieCommon,
      plugins: piePlugins,
    });
  }

  // 2) Pizza por Setor
  const ctxBySector = getCtx("repChartInvestBySector");
  if (ctxBySector) {
    __repCharts.bySector = new Chart(ctxBySector, {
      type: "pie",
      data: {
        labels: bySectorLabels,
        datasets: [
          {
            data: bySectorInvest,
            backgroundColor: bySectorLabels.map(
              (_, i) => PALETTE[i % PALETTE.length]
            ),
          },
        ],
      },
      options: pieCommon,
      plugins: piePlugins,
    });
  }

  // 3) Barras — Lucro por Ativo
  const ctxLucro = getCtx("repChartLucro");
  if (ctxLucro) {
    __repCharts.lucro = new Chart(ctxLucro, {
      type: "bar",
      data: {
        labels: byTickerLabels,
        datasets: [{ label: "Lucro (€)", data: byTickerLucro }],
      },
      options: barCommon,
    });
  }

  // 4) Barras — Dividendos vs Valorização
  const ctxDivVal = getCtx("repChartDivVsVal");
  if (ctxDivVal) {
    __repCharts.divval = new Chart(ctxDivVal, {
      type: "bar",
      data: {
        labels: byTickerLabels,
        datasets: [
          { label: "Dividendos (H)", data: byTickerDivH },
          { label: "Valorização (H)", data: byTickerValH },
        ],
      },
      options: barCommon,
    });
  }

  // 5) Barras — Investido por Ativo
  const ctxInvest = getCtx("repChartInvestBars");
  if (ctxInvest) {
    __repCharts.investBars = new Chart(ctxInvest, {
      type: "bar",
      data: {
        labels: byTickerLabels,
        datasets: [{ label: "Investido (€)", data: byTickerInvest }],
      },
      options: barCommon,
    });
  }

  // Indicadores-chave (texto)
  const notes = [
    `Retorno Total: ${fmtEUR(totLucro)} (${retPct.toFixed(1)}%)`,
    `Dividendos Anuais (soma): ${fmtEUR(totDivAnual)}`,
    `Valorização no Horizonte: ${fmtEUR(totVal)}`,
    `Rácio Dividendos/Valorização (global): ${
      totVal > 0 ? (totDivHoriz / totVal).toFixed(2) : "—"
    }`,
  ];
  document.getElementById("repKeyNotes").innerHTML = notes
    .map((t) => `<li>${t}</li>`)
    .join("");
}

// Nova V2
export async function generateReportPDF_v2(rows = [], opts = {}) {
  await ensurePDFLibs();
  await ensureAutoTable();
  const { jsPDF } = window.jspdf;

  // 1) se houver simulação recente, usa-a; senão, normaliza 'rows' básicas
  const horizonteUI = Number(
    document.getElementById("anlSimHoriz")?.value || 1
  );
  const horizonte = Math.max(
    1,
    Number(
      opts.horizonte ?? __ANL_LAST_SIM?.opts?.horizonte ?? horizonteUI ?? 1
    )
  );
  let data;

  if (__ANL_LAST_SIM?.rows?.length) {
    data = __ANL_LAST_SIM.rows.map((r) => ({
      nome: r.nome,
      ticker: r.ticker,
      investido: Number(r.investido || 0),
      divAnual: Number(r.dividendoAnual || 0),
      divHoriz: Number(r.dividendoHorizonte || r.divHoriz || 0),
      valorizacao: Number(r.valorizacao || 0),
      lucro: Number(r.lucro || 0),
    }));
  } else {
    // fallback (sem simulação): tudo 0 excepto anual → horizonte = anual*h
    data = (rows || []).map((r) => {
      const nome =
        String(r.nome ?? r.Nome ?? r.ativo ?? "").trim() || r.ticker || "Ativo";
      const ticker = String(r.ticker ?? r.Ticker ?? "").toUpperCase();
      const investido = Number(
        r.investido ?? (r.quantidade || 0) * (r.preco || r.valorStock || 0) ?? 0
      );
      const divAnual = Number(r.dividendoAnual ?? r.dividendo ?? 0);
      const divHoriz = Number(
        r.dividendoHorizonte ?? (divAnual * horizonte || 0)
      );
      const valoriz = Number(r.valorizacao ?? 0);
      const lucro = Number(r.lucro ?? (divHoriz + valoriz || 0));
      return {
        nome,
        ticker,
        investido,
        divAnual,
        divHoriz,
        valorizacao: valoriz,
        lucro,
      };
    });
  }

  // 2) KPIs
  const totInvest = data.reduce((s, a) => s + a.investido, 0);
  const totDivAnual = data.reduce((s, a) => s + a.divAnual, 0);
  const totDivHoriz = data.reduce((s, a) => s + a.divHoriz, 0);
  const totVal = data.reduce((s, a) => s + a.valorizacao, 0);
  const totLucro = data.reduce((s, a) => s + a.lucro, 0);
  const retornoPct = totInvest > 0 ? totLucro / totInvest : 0;

  // 3) doc
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = M;
  const COLOR_PRIMARY = [79, 70, 229],
    COLOR_MUTED = [90, 97, 110];
  const hoje = new Date();
  const titulo = opts.titulo || "Relatório Financeiro do Portefólio";

  // capa
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...COLOR_PRIMARY);
  doc.text(titulo, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(
    `Emitido em ${hoje.toLocaleDateString("pt-PT")} — Horizonte: ${horizonte} ${
      horizonte > 1 ? "períodos" : "período"
    }`,
    M,
    (y += 18)
  );
  y += 12;
  doc.setDrawColor(...COLOR_PRIMARY);
  doc.setLineWidth(1);
  doc.line(M, y, pageW - M, y);
  y += 16;

  // resumo executivo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text("Resumo Executivo", M, y);
  y += 16;
  const boxW = (pageW - M * 2 - 24) / 2,
    boxH = 64;
  function kpiBox(x, y0, title, value, subtitle) {
    doc.setDrawColor(230);
    doc.setFillColor(248);
    doc.roundedRect(x, y0, boxW, boxH, 6, 6, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(title, x + 12, y0 + 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text(value, x + 12, y0 + 36);
    if (subtitle) {
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(subtitle, x + 12, y0 + 52);
    }
  }
  kpiBox(M, y, "Valor Investido", _fmtEUR(totInvest));
  kpiBox(
    M + boxW + 24,
    y,
    "Retorno Total",
    `${_fmtEUR(totLucro)} (${_pct(retornoPct)})`
  );
  y += boxH + 12;
  kpiBox(
    M,
    y,
    "Dividendos (Anual / Horizonte)",
    `${_fmtEUR(totDivAnual)} / ${_fmtEUR(totDivHoriz)}`,
    `H = ${horizonte}`
  );
  kpiBox(M + boxW + 24, y, "Valorização Projetada", _fmtEUR(totVal));
  y += boxH + 18;

  // gráficos: tenta usar canvases na página; senão cria temporários
  const chartsWanted = [
    {
      id: "chartDistInvest",
      title: "Distribuição do Investimento por Ativo (Pizza)",
    },
    { id: "chartLucroPorAtivo", title: "Lucro Estimado por Ativo (Barras)" },
    {
      id: "chartDivVsVal",
      title: "Dividendos vs Valorização por Ativo (Barras Agrupadas)",
    },
    { id: "chartInvestPorAtivo", title: "Valor Investido por Ativo (Barras)" },
  ];

  let chartImgs = chartsWanted
    .map((c) => ({ ...c, img: getChartImageByCanvasId(c.id) }))
    .filter((c) => !!c.img);

  if (chartImgs.length === 0 && data.length) {
    chartImgs = await buildTempReportCharts(
      data.map((a) => ({
        ticker: a.ticker,
        investido: a.investido,
        lucro: a.lucro,
        divHoriz: a.divHoriz,
        valorizacao: a.valorizacao,
      }))
    );
  }

  for (const c of chartImgs) {
    // salto de página conforme a altura que vais usar
    const S = 220; // lado dos gráficos de pizza
    const H = 180; // altura dos gráficos de barras
    const MAX_W = pageW - M * 2;

    const willUseSquare =
      c.id === "chartDistInvest" || c.id === "chartDistSector";
    const needed = willUseSquare ? S + 28 : H + 28;
    if (y + needed + 10 > pageH - M) {
      // +10 de margem
      doc.addPage();
      y = M;
    }

    // título (uma única vez!)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text(c.title, M, y);

    if (willUseSquare) {
      // 🍕 pizzas (Ativo e Setor): quadrado centrado
      const xCentered = (pageW - S) / 2;
      doc.addImage(c.img, "PNG", xCentered, y + 8, S, S, undefined, "FAST");
      y += S + 28;
    } else {
      // 📊 barras (e restantes): largura total, altura compacta
      doc.addImage(c.img, "PNG", M, y + 8, MAX_W, H, undefined, "FAST");
      y += H + 28;
    }
  }

  // tabela
  if (y + 120 > pageH - M) {
    doc.addPage();
    y = M;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text("Análise Individual por Ativo", M, y);
  y += 10;

  const head = [
    [
      "Ativo",
      "Ticker",
      "Investido (€)",
      "Div. Anuais (€)",
      "Div. Horizonte (€)",
      "Valorização (€)",
      "Lucro Estimado (€)",
      "% Port.",
    ],
  ];
  const denom = totInvest > 0 ? totInvest : 1;
  const body = data.map((a) => [
    a.nome,
    a.ticker,
    _fmtEUR(a.investido),
    _fmtEUR(a.divAnual),
    _fmtEUR(a.divHoriz),
    _fmtEUR(a.valorizacao),
    _fmtEUR(a.lucro),
    ((a.investido / denom) * 100).toFixed(1) + "%",
  ]);

  doc.autoTable({
    startY: y + 10,
    head,
    body,
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 4,
      overflow: "linebreak",
    },
    headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 120 },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
    },
    margin: { left: M, right: M },
  });
  y = doc.lastAutoTable.finalY + 16;

  // Indicadores-Chave
  if (y + 90 > pageH - M) {
    doc.addPage();
    y = M;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text("Indicadores-Chave", M, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(50);
  const lines = [
    `Retorno Total: ${_fmtEUR(totLucro)} (${_pct(retornoPct)})`,
    `Dividendos Anuais (soma): ${_fmtEUR(totDivAnual)}`,
    `Valorização no Horizonte: ${_fmtEUR(totVal)}`,
    `Rácio Dividendos/Valorização (global): ${
      totVal > 0 ? (totDivHoriz / totVal).toFixed(2) : "—"
    }`,
  ];
  lines.forEach((t, i) => doc.text(`• ${t}`, M, y + i * 16));
  y += lines.length * 16 + 8;

  // rodapé & save
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(
    `© ${new Date().getFullYear()} APPletonFinance — Simulação de Investimentos`,
    M,
    pageH - 14
  );
  const fileName = `Relatorio_Portefolio_${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
  doc.save(fileName);
}

function distribuirInteiros_porScore_capped(cands, investimento) {
  if (!(investimento > 0) || !Array.isArray(cands) || cands.length === 0) {
    return {
      linhas: [],
      totalLucro: 0,
      totalGasto: 0,
      totalDivAnual: 0,
      totalDivPeriodo: 0,
      totalValoriz: 0,
      restante: investimento,
    };
  }

  // ordena por score desc
  const ordered = [...cands].sort((a, b) => b.score - a.score);
  const n = ordered.length;
  const capTopAbs = 0.35 * investimento;

  // 1) Definir alvos (€) por regra 65/35 (n=2) ou 35% + proporcional (n>=3)
  const targets = new Map();
  if (n === 1) {
    // caso raro: um só ativo — aplica cap 35% para não concentrar tudo
    targets.set(ordered[0], Math.min(capTopAbs, investimento));
  } else if (n === 2) {
    targets.set(ordered[0], 0.65 * investimento);
    targets.set(ordered[1], 0.35 * investimento);
  } else {
    const top = ordered[0];
    const rest = ordered.slice(1);
    const restScoreSum = rest.reduce((s, c) => s + c.score, 0) || 1;
    const topTarget = Math.min(capTopAbs, investimento);
    const rem = Math.max(0, investimento - topTarget);
    targets.set(top, topTarget);
    for (const c of rest) {
      targets.set(c, rem * (c.score / restScoreSum));
    }
  }

  // 2) Converter alvos em quantidades inteiras (floor)
  const base = ordered.map((c) => {
    const preco = c.metrics.preco;
    const alvo = targets.get(c) || 0;
    const qtd = Math.max(0, Math.floor(preco > 0 ? alvo / preco : 0));
    return { c, qtd };
  });

  let gasto = base.reduce((s, x) => s + x.qtd * x.c.metrics.preco, 0);
  let restante = investimento - gasto;

  // helper: quanto já investimos por candidato
  const investedOf = (c, arr) => {
    const it = arr.find((x) => x.c === c);
    return (it?.qtd || 0) * (c.metrics.preco || 0);
  };

  // 3) Distribuir o restante, 1 a 1, maximizando retorno por euro,
  //    respeitando cap de 35% para o melhor quando n>=3
  const minPreco = Math.min(...ordered.map((c) => c.metrics.preco || Infinity));
  while (restante + 1e-9 >= minPreco) {
    // candidatos elegíveis (lucro positivo, preço <= restante, cap ok)
    let best = null;
    let bestRpe = -Infinity; // retorno por euro
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i];
      const preco = c.metrics.preco || Infinity;
      if (!(preco > 0 && preco <= restante + 1e-9)) continue;
      if (!(c.metrics.lucroUnidade > 0)) continue;

      // se houver 3+ ativos, respeitar cap do top
      if (n >= 3 && i === 0) {
        const invTop = investedOf(c, base);
        if (invTop + preco > capTopAbs + 1e-9) continue;
      }

      const rpe = (c.metrics.lucroUnidade || 0) / preco; // retorno/€
      if (rpe > bestRpe) {
        bestRpe = rpe;
        best = c;
      }
    }
    if (!best) break;

    // compra mais 1 unidade do melhor elegível
    const rec = base.find((x) => x.c === best);
    rec.qtd += 1;
    gasto += best.metrics.preco;
    restante = investimento - gasto;
  }

  // 4) Montar linhas e somatórios
  const linhas = base
    .filter(({ qtd }) => qtd > 0)
    .map(({ c, qtd }) => makeLinha(c, qtd));

  return sumarizar(linhas, investimento, gasto);
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
    { passive: true }
  );
}

/* =========================================================
   INIT
   ========================================================= */
export async function initScreen() {
  await ensureChartJS();
  if (!db) {
    console.error("Firebase DB não inicializado!");
    return;
  }

  await fetchAcoes();
  populateFilters();

  // Ordenação
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
  document
    .getElementById("anlMercado")
    ?.addEventListener("change", applyFilters);
  document
    .getElementById("anlPeriodo")
    ?.addEventListener("change", applyFilters);
  document.getElementById("anlReset")?.addEventListener("click", () => {
    document.getElementById("anlSearch").value = "";
    document.getElementById("anlSetor").value = "";
    document.getElementById("anlMercado").value = "";
    document.getElementById("anlPeriodo").value = "";
    applyFilters();
  });

  // Selecionar todos (da lista filtrada)
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

  // Abrir modal + pizza dos selecionados
  document.getElementById("anlSimular")?.addEventListener("click", async () => {
    if (selectedTickers.size === 0) {
      alert("Seleciona pelo menos uma ação para simular.");
      return;
    }
    const selecionadas = ALL_ROWS.filter((r) => selectedTickers.has(r.ticker));
    await renderSelectedSectorChart(selecionadas);
    openSimModal();
  });

  // === Relatório (abrir/fechar) ===
  function openReportModal() {
    const el = document.getElementById("anlReportModal");
    el?.classList.remove("hidden");
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }
  function closeReportModal() {
    const el = document.getElementById("anlReportModal");
    el?.classList.add("hidden");
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  }

  // Exclusividade Total vs Inteiros
  const cbTotal = document.getElementById("anlSimInvestirTotal");
  const cbInteiro = document.getElementById("anlSimInteiros");
  cbTotal?.addEventListener("change", () => {
    if (cbTotal.checked) cbInteiro && (cbInteiro.checked = false);
    else cbInteiro && (cbInteiro.checked = true);
  });
  cbInteiro?.addEventListener("change", () => {
    if (cbInteiro.checked) cbTotal && (cbTotal.checked = false);
    else cbTotal && (cbTotal.checked = true);
  });

  // Calcular simulação
  document
    .getElementById("anlSimCalcular")
    ?.addEventListener("click", async () => {
      const investimento = Number(
        document.getElementById("anlSimInvest")?.value || 0
      );
      const horizonte = Number(
        document.getElementById("anlSimHoriz")?.value || 1
      );
      const periodo = document.getElementById("anlSimPeriodo")?.value || "1m";
      const incluirDiv = !!document.getElementById("anlSimIncluiDiv")?.checked;
      const usarFracoes = !!document.getElementById("anlSimInvestirTotal")
        ?.checked;
      const apenasInteiros =
        !!document.getElementById("anlSimInteiros")?.checked;
      const modoEstrito = !!document.getElementById("anlSimEstrito")?.checked;

      if (!(investimento > 0)) {
        alert("Indica um investimento total válido.");
        return;
      }
      const selecionadas = ALL_ROWS.filter((r) =>
        selectedTickers.has(r.ticker)
      );
      let candidatos = prepararCandidatos(selecionadas, {
        periodo,
        horizonte,
        incluirDiv,
        modoEstrito,
      });
      if (candidatos.length === 0) {
        alert(
          "Nenhum ativo com retorno positivo ou dados válidos para este cenário."
        );
        return;
      }

      const res =
        apenasInteiros && !usarFracoes
          ? distribuirInteiros_porScore(candidatos, investimento)
          : distribuirFracoes_porScore(candidatos, investimento); // 👈 usa-a aqui

      await renderSelectedSectorChart(selecionadas);
      renderResultadoSimulacao(res);

      // --- Normaliza linhas da simulação para o Relatório (v2) ---
      const linhasReport = (res.linhas || [])
        .filter((l) => l.quantidade > 0 && l.investido > 0)
        .map((l) => ({
          nome: l.nome,
          ticker: l.ticker,
          investido: l.investido,
          // ATENÇÃO: para o relatório v2, estes nomes são os esperados:
          dividendoAnual: l.divAnualAlloc, // soma anual alocada
          dividendoHorizonte: l.divPeriodoAlloc, // no horizonte H
          valorizacao: l.valorizAlloc, // no horizonte H
          lucro: l.divPeriodoAlloc + l.valorizAlloc, // lucro total estimado
        }));

      __ANL_LAST_SIM = {
        rows: linhasReport,
        opts: { horizonte, periodo, incluirDiv, investimento },
      };
    });

  // Relatório — agora abre modal de pré-visualização (HTML), e o PDF sai do botão dentro do modal
  const relBtn =
    document.getElementById("anlSimRelatorio") ||
    document.getElementById("btnRelatorio");
  relBtn?.addEventListener("click", async () => {
    // 1) Fonte dos dados: prioridade à última simulação; se não houver, usar seleção crua (fallback simples)
    const temSim =
      Array.isArray(__ANL_LAST_SIM?.rows) && __ANL_LAST_SIM.rows.length > 0;

    const horizonte =
      Number(document.getElementById("anlSimHoriz")?.value) ||
      Number(__ANL_LAST_SIM?.opts?.horizonte) ||
      1;

    let dataRows;
    if (temSim) {
      // dados já normalizados no clique de "Calcular"
      dataRows = __ANL_LAST_SIM.rows.map((r) => ({
        nome: r.nome,
        ticker: r.ticker,
        investido: Number(r.investido || 0),
        dividendoAnual: Number(r.dividendoAnual || r.divAnual || 0),
        dividendoHorizonte: Number(r.dividendoHorizonte || r.divHoriz || 0),
        valorizacao: Number(r.valorizacao || 0),
        lucro: Number(r.lucro || 0),
      }));
    } else {
      // fallback: construir algo a partir da seleção atual (sem simulação)
      const selecionadas = ALL_ROWS.filter((r) =>
        selectedTickers.has(r.ticker)
      );
      if (!selecionadas.length) {
        alert(
          "Seleciona pelo menos uma ação (e idealmente executa a simulação)."
        );
        return;
      }
      dataRows = selecionadas.map((r) => ({
        nome: r.nome,
        ticker: r.ticker,
        // sem simulação, tomamos “1 unidade” como aproximação só para pré-visualizar
        investido: Number(r.valorStock || 0),
        dividendoAnual: Number(r.divAnual || r.dividendoMedio24m || 0),
        dividendoHorizonte:
          Number(r.divAnual || r.dividendoMedio24m || 0) *
          Number(horizonte || 1),
        valorizacao: 0,
        lucro:
          Number(r.divAnual || r.dividendoMedio24m || 0) *
          Number(horizonte || 1),
      }));
    }

    // 2) Render da pré-visualização no modal
    try {
      await renderReportPreview(dataRows, { horizonte });
      openReportModal();
    } catch (e) {
      console.error("[relatorio] preview falhou:", e);
      alert("Não consegui preparar a pré-visualização do relatório.");
    }
  });

  // === Fechar Modais (Simulação + Relatório) ===

  // util para saber se um modal está aberto
  const _isOpen = (el) => el && !el.classList.contains("hidden");

  // SIMULADOR — botões + clique no backdrop
  document
    .getElementById("anlSimClose")
    ?.addEventListener("click", closeSimModal);
  document.getElementById("anlSimModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSimModal(); // clique fora fecha
  });

  // RELATÓRIO — botões corretos + clique no backdrop
  document
    .getElementById("repCloseTop")
    ?.addEventListener("click", closeReportModal);
  document
    .getElementById("repCloseBottom")
    ?.addEventListener("click", closeReportModal);
  document.getElementById("anlReportModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeReportModal(); // clique fora fecha
  });

  // ESC fecha o modal aberto (prioridade ao relatório)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const rep = document.getElementById("anlReportModal");
    const sim = document.getElementById("anlSimModal");
    if (_isOpen(rep)) closeReportModal();
    else if (_isOpen(sim)) closeSimModal();
  });

  // Render inicial
  markSortedHeader();
  applyFilters();
}

/* Auto-init seguro */
if (!window.__ANL_AUTO_INIT__) {
  window.__ANL_AUTO_INIT__ = true;
  initScreen().catch((e) => {
    console.error("[analise] init error", e);
  });

  // Exportar PDF (robusto): garante libs e dados antes de gerar
  const bindExportPdf = () => {
    const btn = document.getElementById("repExportPdf");
    if (!btn) return;

    // remove handlers antigos, se existirem
    btn.replaceWith(btn.cloneNode(true));
    const freshBtn = document.getElementById("repExportPdf");

    freshBtn.addEventListener("click", async () => {
      try {
        // 1) Garante libs carregadas (jspdf + autotable)
        await ensurePDFLibs();
        await ensureAutoTable();
        if (!window.jspdf?.jsPDF) {
          alert("Não consegui carregar o jsPDF. Verifica a ligação.");
          return;
        }

        // 2) Horizonte (UI > sim > fallback 1)
        const horizonte = Number(
          document.getElementById("anlSimHoriz")?.value ||
            __ANL_LAST_SIM?.opts?.horizonte ||
            1
        );

        // 3) Dados do relatório: usa simulação se existir; senão, lê a tabela do preview
        let rowsForReport = [];
        if (Array.isArray(__ANL_LAST_SIM?.rows) && __ANL_LAST_SIM.rows.length) {
          rowsForReport = __ANL_LAST_SIM.rows;
        } else {
          const trs = Array.from(
            document.querySelectorAll("#repTable tbody tr")
          );
          rowsForReport = trs.map((tr) => {
            const td = tr.querySelectorAll("td");
            const num = (s) =>
              Number(
                (s || "")
                  .replace(/[^\d,.-]/g, "")
                  .replace(/\./g, "")
                  .replace(",", ".")
              ) || 0;
            return {
              nome: td[0]?.textContent?.trim() || "",
              ticker: td[1]?.textContent?.trim() || "",
              investido: num(td[2]?.textContent),
              dividendoAnual: num(td[3]?.textContent),
              dividendoHorizonte: num(td[4]?.textContent),
              valorizacao: num(td[5]?.textContent),
              lucro: num(td[6]?.textContent),
            };
          });
        }

        if (!rowsForReport.length) {
          alert(
            "Sem dados para exportar. Executa a simulação ou abre o relatório com seleção válida."
          );
          return;
        }

        // 4) Gera o PDF (usa a tua V2)
        await generateReportPDF_v2(rowsForReport, {
          titulo: "Simulação do Portefólio . APPletonFinance",
          horizonte,
        });
      } catch (e) {
        console.error("[repExportPdf] erro:", e);
        alert(
          "Falhou a exportação do PDF. Consulta a consola para mais detalhes."
        );
      }
    });
  };

  // chama já
  bindExportPdf();
}
