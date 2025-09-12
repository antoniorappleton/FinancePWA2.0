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
const charts = { setor: null, mercado: null, topYield: null };

/* ===============================
   Helpers
   =============================== */
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

function pagamentosAno(periodicidade) {
  if (periodicidade === "Mensal") return 12;
  if (periodicidade === "Trimestral") return 4;
  if (periodicidade === "Semestral") return 2;
  if (periodicidade === "Anual") return 1;
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

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safePct(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}
function fmtEUR(n) {
  return Number(n || 0).toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
  });
}
function fmtPct(x) {
  return `${(Number(x) || 0).toFixed(2)}%`;
}
function badgePE(pe) {
  if (!Number.isFinite(pe) || pe <= 0) return "—";
  if (pe < 15) return `${pe.toFixed(2)} Barato`;
  if (pe <= 25) return `${pe.toFixed(2)} Justo`;
  return `${pe.toFixed(2)} Caro`;
}
function yieldPct(dividendo, valorStock) {
  if (
    !Number.isFinite(dividendo) ||
    !Number.isFinite(valorStock) ||
    valorStock <= 0
  )
    return 0;
  // Se o teu pipeline usa "dividendo" anualizado (avg24m), isto já é anual. Se for por pagamento, ajusta à periodicidade.
  return (dividendo / valorStock) * 100;
}
function classByValue(v, q1, q2) {
  // retorna classe fraca/média/forte
  if (v <= q1) return "pay-weak";
  if (v <= q2) return "pay-med";
  return "pay-strong";
}
function perPaymentAmount(doc) {
  const per = String(doc.periodicidade || "");
  const dAnual = toNum(doc.dividendoMedio24m) || toNum(doc.dividendo); // anualizado (preferimos 24m)
  const pAno = pagamentosAno(per);
  if (pAno <= 0) return 0;
  return dAnual / pAno;
}

/* ===============================
   GRÁFICOS
   =============================== */
function renderDonut(elId, dataMap) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const labels = Array.from(dataMap.keys());
  const data = Array.from(dataMap.values());
  const chart = new Chart(el, {
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
      cutout: "62%",
    },
  });
  return chart;
}

function renderTopYield(elId, rows) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const top = [...rows]
    .filter((r) => Number.isFinite(r.yield) && r.yield > 0)
    .sort((a, b) => b.yield - a.yield)
    .slice(0, 5);
  const labels = top.map((r) => r.ticker);
  const data = top.map((r) => r.yield);
  const chart = new Chart(el, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Yield (%)",
          data,
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
  return chart;
}

/* ===============================
   HEATMAP RENDER
   =============================== */
function renderHeatmap(rows) {
  const body = document.getElementById("anlHeatmapBody");
  if (!body) return;

  // calcular classes por intensidade: vamos usar quartis do perPayment
  const values = rows
    .map((r) => perPaymentAmount(r))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const q1 = values.length ? values[Math.floor(values.length * 0.33)] : 0.01;
  const q2 = values.length ? values[Math.floor(values.length * 0.66)] : 0.02;

  body.innerHTML = rows
    .map((r) => {
      const per = String(r.periodicidade || "n/A");
      const idxMes = mesToIdx.get(String(r.mes || ""));
      const meses = mesesPagamento(per, idxMes);
      const perPay = perPaymentAmount(r);
      const klass = classByValue(perPay, q1, q2);
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
      </div>
    `;
    })
    .join("");
}

/* ===============================
   TABELA
   =============================== */
function renderTable(rows) {
  const tb = document.getElementById("anlTableBody");
  if (!tb) return;

  const clsPE = (pe) => {
    if (!Number.isFinite(pe) || pe <= 0)
      return `<span class="badge muted">—</span>`;
    if (pe < 15) return `<span class="badge ok">${pe.toFixed(2)} Barato</span>`;
    if (pe <= 25)
      return `<span class="badge warn">${pe.toFixed(2)} Justo</span>`;
    return `<span class="badge danger">${pe.toFixed(2)} Caro</span>`;
  };

  const clsYield = (y, y24) => {
    if (!Number.isFinite(y)) return `<span class="badge muted">—</span>`;
    // cor do yield atual
    let base = "muted";
    if (y >= 6) base = "warn";
    else if (y >= 2) base = "ok";
    const curr = `<span class="badge ${base}">${y.toFixed(2)}%</span>`;
    // comparação com média 24m
    if (Number.isFinite(y24)) {
      const diff = y - y24;
      const comp =
        diff >= 0
          ? `<span class="badge up">↑ acima da média</span>`
          : `<span class="badge down">↓ abaixo da média</span>`;
      return `${curr} ${comp}`;
    }
    return curr;
  };

  const badgeDelta = (v) => {
    if (!Number.isFinite(v)) return `—`;
    const cls = v >= 0 ? "up" : "down";
    const sign = v >= 0 ? "+" : "";
    return `<span class="${cls}">${sign}${v.toFixed(2)}%</span>`;
  };

  const badgeGrowth = (v) => badgeDelta(v); // 1S/1M/1A

  tb.innerHTML = rows
    .map((r) => {
      const y = Number.isFinite(r.yield) ? r.yield : null;
      const y24 = Number.isFinite(r.yield24) ? r.yield24 : null;

      return `
      <tr>
        <td class="sticky-col"><strong>${r.ticker}</strong></td>
        <td>${r.nome || ""}</td>
        <td>${r.setor || "—"}</td>
        <td>${r.mercado || "—"}</td>
        <td>${clsYield(y, y24)}</td>
        <td>${Number.isFinite(y24) ? `${y24.toFixed(2)}%` : "—"}</td>
        <td>${clsPE(r.pe)}</td>
        <td>${badgeDelta(r.delta50)}</td>
        <td>${badgeDelta(r.delta200)}</td>
        <td>${badgeGrowth(r.g1w)}</td>
        <td>${badgeGrowth(r.g1m)}</td>
        <td>${badgeGrowth(r.g1y)}</td>
        <td>${r.periodicidade || "n/A"}</td>
        <td>${r.mes || "n/A"}</td>
        <td>${r.observacao || "—"}</td>
      </tr>
    `;
    })
    .join("");
}


/* ===============================
   FILTRO
   =============================== */
function applyFilters(allRows) {
  const q = String(document.getElementById("anlSearch")?.value || "")
    .trim()
    .toLowerCase();
  const setor = document.getElementById("anlSetor")?.value || "";
  const merc = document.getElementById("anlMercado")?.value || "";
  const per = document.getElementById("anlPeriodo")?.value || "";

  return allRows.filter((r) => {
    if (
      q &&
      !(
        String(r.ticker).toLowerCase().includes(q) ||
        String(r.nome || "")
          .toLowerCase()
          .includes(q)
      )
    )
      return false;
    if (setor && r.setor !== setor) return false;
    if (merc && r.mercado !== merc) return false;
    if (per && (r.periodicidade || "") !== per) return false;
    return true;
  });
}
function fillFilterOptions(rows) {
  const setSel = document.getElementById("anlSetor");
  const merSel = document.getElementById("anlMercado");
  if (!setSel || !merSel) return;

  const setores = Array.from(
    new Set(rows.map((r) => r.setor).filter(Boolean))
  ).sort();
  const mercados = Array.from(
    new Set(rows.map((r) => r.mercado).filter(Boolean))
  ).sort();

  setSel.innerHTML =
    `<option value="">Todos</option>` +
    setores.map((s) => `<option>${s}</option>`).join("");
  merSel.innerHTML =
    `<option value="">Todos</option>` +
    mercados.map((s) => `<option>${s}</option>`).join("");
}

/* ===============================
   MAIN INIT
   =============================== */
export async function initScreen() {
  await ensureChartJS();

  // buscar todos os docs da coleção base
  const snap = await getDocs(query(collection(db, "acoesDividendos")));
  const raw = [];
  snap.forEach((d) => raw.push({ id: d.id, ...d.data() }));

  // prepara linhas calculadas
  const rows = raw.map((doc) => {
    const valor = toNum(doc.valorStock);
    const dAnual = toNum(doc.dividendoMedio24m) || toNum(doc.dividendo); // anualizado preferencial
    const y = yieldPct(dAnual, valor);
    const y24 =
      toNum(doc.dividendoMedio24m) && valor > 0
        ? (toNum(doc.dividendoMedio24m) / valor) * 100
        : y;

    const sma50 = toNum(doc.sma50),
      sma200 = toNum(doc.sma200);
    const d50 = sma50 > 0 && valor > 0 ? ((valor - sma50) / sma50) * 100 : null;
    const d200 =
      sma200 > 0 && valor > 0 ? ((valor - sma200) / sma200) * 100 : null;

    return {
      id: doc.id,
      ticker: String(doc.ticker || "").toUpperCase(),
      nome: doc.nome || "",
      setor: doc.setor || "",
      mercado: doc.mercado || "",
      valorStock: valor,
      dividendo: dAnual,
      yield: y,
      yield24: y24,
      pe: toNum(doc.peRatio) || null,
      delta50: d50,
      delta200: d200,
      g1w: toNum(doc.taxaCrescimento_1semana),
      g1m: toNum(doc.taxaCrescimento_1mes),
      g1y: toNum(doc.taxaCrescimento_1ano),
      periodicidade: doc.periodicidade || "n/A",
      mes: doc.mes || "n/A",
      observacao: doc.observacao || "",
    };
  });

  // filtros (popular selects)
  fillFilterOptions(rows);

  // render iniciais
  let current = applyFilters(rows);
  renderTable(current);
  renderHeatmap(current);

  // gráficos agregados
  charts.setor?.destroy();
  charts.mercado?.destroy();
  charts.topYield?.destroy();
  const bySetor = new Map();
  const byMerc = new Map();
  current.forEach((r) => {
    bySetor.set(r.setor || "—", (bySetor.get(r.setor || "—") || 0) + 1);
    byMerc.set(r.mercado || "—", (byMerc.get(r.mercado || "—") || 0) + 1);
  });
  charts.setor = renderDonut("anlChartSetor", bySetor);
  charts.mercado = renderDonut("anlChartMercado", byMerc);
  charts.topYield = renderTopYield("anlChartTopYield", current);

  // listeners de filtro
  const deb = (fn, ms = 300) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  const rerender = () => {
    current = applyFilters(rows);
    renderTable(current);
    renderHeatmap(current);
    charts.setor?.destroy();
    charts.mercado?.destroy();
    charts.topYield?.destroy();
    const sMap = new Map();
    const mMap = new Map();
    current.forEach((r) => {
      sMap.set(r.setor || "—", (sMap.get(r.setor || "—") || 0) + 1);
      mMap.set(r.mercado || "—", (mMap.get(r.mercado || "—") || 0) + 1);
    });
    charts.setor = renderDonut("anlChartSetor", sMap);
    charts.mercado = renderDonut("anlChartMercado", mMap);
    charts.topYield = renderTopYield("anlChartTopYield", current);
  };
  document
    .getElementById("anlSearch")
    ?.addEventListener("input", deb(rerender, 250));
  document.getElementById("anlSetor")?.addEventListener("change", rerender);
  document.getElementById("anlMercado")?.addEventListener("change", rerender);
  document.getElementById("anlPeriodo")?.addEventListener("change", rerender);
  document.getElementById("anlReset")?.addEventListener("click", () => {
    const s = document.getElementById("anlSearch");
    const a = document.getElementById("anlSetor");
    const m = document.getElementById("anlMercado");
    const p = document.getElementById("anlPeriodo");
    if (s) s.value = "";
    if (a) a.value = "";
    if (m) m.value = "";
    if (p) p.value = "";
    rerender();
  });

  // re-temar gráficos quando muda o tema
  if (window.__anlThemeH)
    window.removeEventListener("app:theme-changed", window.__anlThemeH);
  window.__anlThemeH = () => {
    charts.setor?.destroy();
    charts.mercado?.destroy();
    charts.topYield?.destroy();
    charts.setor = renderDonut("anlChartSetor", bySetor);
    charts.mercado = renderDonut("anlChartMercado", byMerc);
    charts.topYield = renderTopYield("anlChartTopYield", current);
  };
  window.addEventListener("app:theme-changed", window.__anlThemeH);
}
