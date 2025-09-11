import { db } from "../firebase-config.js";
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ---------------- Chart.js on-demand ---------------- */
async function ensureChartJS() {
  if (window.Chart) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    s.onload = res;
    s.onerror = rej;
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
const charts = { setor: null, mercado: null, yieldpe: null };

/* ---------------- Utils ---------------- */
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmtPct = (v) => `${(Number(v) || 0).toFixed(2)}%`;
const fmt2 = (v) =>
  (Number(v) || 0).toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
function yieldNow(d) {
  const price = toNum(d.valorStock);
  const div = toNum(d.dividendo);
  return price > 0 ? (div / price) * 100 : null;
}
function yield24m(d) {
  const price = toNum(d.valorStock);
  const divM = toNum(d.dividendoMedio24m);
  return price > 0 ? (divM / price) * 100 : null;
}
function deltaPct(price, sma) {
  if (!sma) return null;
  return ((price - sma) / sma) * 100;
}
function peBadge(pe) {
  if (pe == null || pe === 0) return `<span class="badge muted">—</span>`;
  if (pe < 15) return `<span class="badge ok">Barato</span>`;
  if (pe <= 25) return `<span class="badge warn">Justo</span>`;
  return `<span class="badge danger">Caro</span>`;
}
function momentumBadge(g1m, price, sma200) {
  const m = toNum(g1m) > 0;
  const above = toNum(price) > toNum(sma200);
  if (above && m)
    return `<span class="dot dot-green" title="Tendência positiva"></span>`;
  if (above || m)
    return `<span class="dot dot-amber" title="Neutro/atenção"></span>`;
  return `<span class="dot dot-red" title="Pressão negativa"></span>`;
}

/* ---------------- Gráficos ---------------- */
function renderDoughnut(targetId, dataMap) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const labels = Array.from(dataMap.keys());
  const data = Array.from(dataMap.values());
  const instKey = targetId.includes("Setor") ? "setor" : "mercado";
  charts[instKey]?.destroy();

  if (!labels.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }

  charts[instKey] = new Chart(el, {
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
              return ` ${ctx.label}: ${v} (${pct}%)`;
            },
          },
        },
      },
      cutout: "60%",
    },
  });
}

function renderScatterYieldPE(list) {
  const el = document.getElementById("anChartYieldPE");
  if (!el) return;
  charts.yieldpe?.destroy();

  // pontos válidos
  const pts = list
    .map((d) => {
      const y = yieldNow(d);
      const pe = toNum(d.peRatio);
      if (y == null || pe <= 0) return null;
      return { x: pe, y: y, label: d.ticker, setor: d.setor || "—" };
    })
    .filter(Boolean);

  if (!pts.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }

  charts.yieldpe = new Chart(el, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Yield vs P/E",
          data: pts,
          backgroundColor: pts.map(
            (p) =>
              PALETTE[(p.setor.charCodeAt(0) + p.setor.length) % PALETTE.length]
          ),
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: "P/E" },
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
        y: {
          title: { display: true, text: "Yield (%)" },
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              return ` ${p.label} — Setor: ${p.setor} | P/E ${p.x.toFixed(
                1
              )} | Yield ${p.y.toFixed(2)}%`;
            },
          },
        },
      },
    },
  });
}

/* ---------------- Tabela ---------------- */
function renderTable(rows) {
  const tbody = document.getElementById("analysisTableBody");
  if (!tbody) return;
  tbody.innerHTML = rows
    .map((d) => {
      const price = toNum(d.valorStock);
      const yN = yieldNow(d);
      const y24 = yield24m(d);
      const del50 = deltaPct(price, toNum(d.sma50));
      const del200 = deltaPct(price, toNum(d.sma200));
      const g1w = toNum(d.taxaCrescimento_1semana);
      const g1m = toNum(d.taxaCrescimento_1mes);
      const g1y = toNum(d.taxaCrescimento_1ano);

      const yieldBadge =
        yN == null
          ? `<span class="badge muted">—</span>`
          : yN < 2
          ? `<span class="badge muted">${fmtPct(yN)}</span>`
          : yN < 6
          ? `<span class="badge ok">${fmtPct(yN)}</span>`
          : `<span class="badge warn">${fmtPct(yN)}</span>`;

      const yield24Badge =
        y24 == null
          ? `<span class="badge muted">—</span>`
          : yN != null && yN > y24
          ? `<span class="badge up">↑ ${fmtPct(y24)}</span>`
          : `<span class="badge down">↓ ${fmtPct(y24)}</span>`;

      const delta50Badge =
        del50 == null
          ? "—"
          : del50 >= 0
          ? `<span class="up">${fmtPct(del50)}</span>`
          : `<span class="down">${fmtPct(del50)}</span>`;
      const delta200Badge =
        del200 == null
          ? "—"
          : del200 >= 0
          ? `<span class="up">${fmtPct(del200)}</span>`
          : `<span class="down">${fmtPct(del200)}</span>`;

      const peVal =
        d.peRatio != null && d.peRatio !== ""
          ? Number(d.peRatio).toFixed(2)
          : "—";

      return `
      <tr>
        <td><strong>${d.ticker || "—"}</strong></td>
        <td class="muted">${d.nome || "—"}</td>
        <td>${yieldBadge}</td>
        <td>${yield24Badge}</td>
        <td>${peVal} ${peBadge(toNum(d.peRatio))}</td>
        <td>${delta50Badge}</td>
        <td>${delta200Badge}</td>
        <td class="${g1w >= 0 ? "up" : "down"}">${g1w ? fmtPct(g1w) : "—"}</td>
        <td class="${g1m >= 0 ? "up" : "down"}">${g1m ? fmtPct(g1m) : "—"}</td>
        <td class="${g1y >= 0 ? "up" : "down"}">${g1y ? fmtPct(g1y) : "—"}</td>
        <td>${d.periodicidade || "—"}</td>
        <td>${d.mes || "—"}</td>
        <td class="muted">${d.observacao || "—"}</td>
      </tr>
    `;
    })
    .join("");
}

/* ---------------- Filtros/ordenar ---------------- */
function applyFilters(list) {
  const q = document.getElementById("anSearch").value.trim().toLowerCase();
  const fs = document.getElementById("anFiltroSetor").value;
  const fm = document.getElementById("anFiltroMercado").value;
  let out = list.filter((d) => {
    const hitQ =
      !q ||
      String(d.ticker || "")
        .toLowerCase()
        .includes(q) ||
      String(d.nome || "")
        .toLowerCase()
        .includes(q);
    const hitS = !fs || String(d.setor || "") === fs;
    const hitM = !fm || String(d.mercado || "") === fm;
    return hitQ && hitS && hitM;
  });

  const ord = document.getElementById("anOrdenar").value;
  const [key, dir] = ord.split(".");
  const mul = dir === "desc" ? -1 : 1;
  out.sort((a, b) => {
    if (key === "ticker")
      return String(a.ticker || "").localeCompare(String(b.ticker || "")) * mul;
    if (key === "yield")
      return ((yieldNow(a) || -1) - (yieldNow(b) || -1)) * mul;
    if (key === "pe")
      return ((toNum(a.peRatio) || 1e9) - (toNum(b.peRatio) || 1e9)) * mul;
    if (key === "delta200") {
      const da = deltaPct(toNum(a.valorStock), toNum(a.sma200));
      const db = deltaPct(toNum(b.valorStock), toNum(b.sma200));
      return ((da ?? -1e9) - (db ?? -1e9)) * mul;
    }
    return 0;
  });

  return out;
}

/* ---------------- INIT ---------------- */
export async function initScreen() {
  await ensureChartJS();

  const tbody = document.getElementById("analysisTableBody");
  if (!tbody) return;
  tbody.innerHTML = "<tr><td colspan='13'>A carregar…</td></tr>";

  try {
    const snap = await getDocs(collection(db, "acoesDividendos"));
    if (snap.empty) {
      tbody.innerHTML = "<tr><td colspan='13'>Sem dados.</td></tr>";
      return;
    }

    const list = [];
    snap.forEach((d) => list.push(d.data()));

    // KPI simples (amostra — sem ponderação)
    const validY = list.map(yieldNow).filter((v) => v != null);
    const avgYield = validY.length
      ? validY.reduce((a, b) => a + b, 0) / validY.length
      : 0;
    const validPE = list.map((d) => toNum(d.peRatio)).filter((v) => v > 0);
    const avgPE = validPE.length
      ? validPE.reduce((a, b) => a + b, 0) / validPE.length
      : 0;

    document.getElementById("anTotalTickers").textContent = String(list.length);
    document.getElementById("anYieldMedia").textContent = fmtPct(avgYield);
    document.getElementById("anPEmedio").textContent = avgPE.toFixed(1);

    // Filtros dropdown (setor/mercado)
    const fs = document.getElementById("anFiltroSetor");
    const fm = document.getElementById("anFiltroMercado");
    const setores = Array.from(new Set(list.map((d) => d.setor || "—"))).sort();
    const mercados = Array.from(
      new Set(list.map((d) => d.mercado || "—"))
    ).sort();
    setores.forEach((s) => {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      fs.appendChild(o);
    });
    mercados.forEach((m) => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      fm.appendChild(o);
    });

    // Distribuição (contagem por setor/mercado)
    const setorMap = new Map();
    const mercadoMap = new Map();
    list.forEach((d) => {
      const s = d.setor || "—";
      setorMap.set(s, (setorMap.get(s) || 0) + 1);
      const m = d.mercado || "—";
      mercadoMap.set(m, (mercadoMap.get(m) || 0) + 1);
    });

    renderDoughnut("anChartSetor", setorMap);
    renderDoughnut("anChartMercado", mercadoMap);
    renderScatterYieldPE(list);

    // Tabela
    let filtered = applyFilters(list);
    renderTable(filtered);

    // Eventos toolbar
    ["anSearch", "anFiltroSetor", "anFiltroMercado", "anOrdenar"].forEach(
      (id) => {
        document.getElementById(id).addEventListener("input", () => {
          filtered = applyFilters(list);
          renderTable(filtered);
        });
        document.getElementById(id).addEventListener("change", () => {
          filtered = applyFilters(list);
          renderTable(filtered);
        });
      }
    );

    // Re-render charts quando muda o tema
    if (window.__analiseThemeHandler) {
      window.removeEventListener(
        "app:theme-changed",
        window.__analiseThemeHandler
      );
    }
    window.__analiseThemeHandler = () => {
      renderDoughnut("anChartSetor", setorMap);
      renderDoughnut("anChartMercado", mercadoMap);
      renderScatterYieldPE(list);
    };
    window.addEventListener("app:theme-changed", window.__analiseThemeHandler);
  } catch (e) {
    console.error(e);
    tbody.innerHTML = "<tr><td colspan='13'>Erro ao carregar dados.</td></tr>";
  }
}
