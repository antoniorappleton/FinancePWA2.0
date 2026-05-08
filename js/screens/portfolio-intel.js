// js/screens/portfolio-intel.js
// ═══════════════════════════════════════════════════════════════════
// PORTFOLIO INTELLIGENCE — UI Integration
// Imports all engines and renders results in the portfolio-intel screen.
// ═══════════════════════════════════════════════════════════════════

import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { app } from "../firebase-config.js";

import { scoreAssetV2, styleToMultipliers } from "../engines/score-v2.js";
import { factorExposure } from "../engines/factors.js";
import { portfolioHealth } from "../engines/portfolio-health.js";
import { riskContribution, weightVsRiskChart } from "../engines/risk-contrib.js";
import { correlationMatrix } from "../engines/correlation.js";
import { stressTest } from "../engines/stress-test.js";
import { thematicExposure } from "../engines/thematic.js";
import { portfolioDNA } from "../engines/dna.js";
import { temporalScore } from "../engines/temporal.js";
import { generateAssetObservations, generatePortfolioObservations } from "../engines/observations.js";
import { analyzeETFOverlap } from "../engines/etf-overlap.js";
import { rebalanceSuggestions } from "../engines/rebalance.js";

const db = getFirestore(app);

export async function initScreen() {
  const btn = document.getElementById("piRunAnalysis");
  btn?.addEventListener("click", runFullAnalysis);
}

async function runFullAnalysis() {
  const loading = document.getElementById("piLoading");
  const results = document.getElementById("piResults");
  loading?.classList.remove("hidden");
  results?.classList.add("hidden");

  try {
    // ── 1. Load data ──
    const [ativosSnap, acoesSnap, stratSnap] = await Promise.all([
      getDocs(collection(db, "ativos")),
      getDocs(collection(db, "acoesDividendos")),
      getDoc(doc(db, "config", "strategy"))
    ]);

    const acoesMap = new Map();
    acoesSnap.forEach(d => {
      const x = d.data();
      if (x.ticker) acoesMap.set(String(x.ticker).toUpperCase(), x);
    });

    const strategy = stratSnap.exists() ? stratSnap.data() : {};
    const styleMult = styleToMultipliers(strategy.styleAlloc);

    // Build enriched portfolio
    const portfolio = [];
    ativosSnap.forEach(docu => {
      const d = docu.data();
      const ticker = String(d.ticker || "").toUpperCase();
      const mkt = acoesMap.get(ticker) || {};
      const precoAtual = Number(mkt.valorStock || mkt.price || 0);
      const valAtual = (d.quantidade || 0) * precoAtual;

      portfolio.push({
        ticker,
        nome: d.nome || mkt.nome || ticker,
        quantidade: d.quantidade || 0,
        precoMedio: d.precoMedio || 0,
        precoAtual,
        valAtual,
        mkt,
        score: 0
      });
    });

    const totalValue = portfolio.reduce((s, p) => s + p.valAtual, 0);

    // ── 2. Run all engines ──
    // Score V2 for each asset
    const assetScores = [];
    for (const p of portfolio) {
      const v2 = scoreAssetV2(p.mkt, styleMult);
      p.score = v2.finalScore;
      p.v2 = v2;
      assetScores.push({ ...p, v2 });
    }
    assetScores.sort((a, b) => b.v2.finalScore - a.v2.finalScore);

    const factorArray = portfolio.map(p => ({ asset: p.mkt, weight: p.valAtual / Math.max(totalValue, 1) }));
    const factors = factorExposure(factorArray);
    const health = portfolioHealth(portfolio, totalValue);
    const riskContrib = riskContribution(portfolio, totalValue);
    const wrChart = weightVsRiskChart(portfolio, totalValue);
    const corr = correlationMatrix(portfolio);
    const stress = stressTest(portfolio, totalValue);
    const themes = thematicExposure(portfolio, totalValue);
    const dna = portfolioDNA(portfolio, totalValue);
    const etfOverlap = analyzeETFOverlap(portfolio);
    const rebalance = rebalanceSuggestions(portfolio, totalValue, { riskContrib });
    const portfolioObs = generatePortfolioObservations({ health, correlation: corr, stressTest: stress, factors, dna, etfOverlap });

    // ── 3. Render everything ──
    renderDNA(dna);
    renderHealth(health);
    renderResilience(stress);
    renderFactorRadar(factors);
    renderCorrelation(corr);
    renderThematic(themes);
    renderStressTests(stress);
    renderWeightRisk(wrChart, riskContrib);
    renderScorecards(assetScores.slice(0, 12));
    renderObservations(portfolioObs, assetScores);
    renderRebalance(rebalance);

    loading?.classList.add("hidden");
    results?.classList.remove("hidden");

  } catch (err) {
    console.error("Portfolio Intel error:", err);
    loading?.classList.add("hidden");
    if (window.showToast) window.showToast("Erro na análise: " + err.message);
  }
}

// ══════════════════════════════════════════════════════════════
// RENDERERS
// ══════════════════════════════════════════════════════════════

function renderDNA(dna) {
  const el = (id) => document.getElementById(id);
  el("piDnaEmoji").textContent = dna.primary?.emoji || "🧩";
  el("piDnaName").textContent = dna.primary?.name || "Custom Portfolio";
  el("piDnaSecondary").textContent = dna.secondary ? `Secundário: ${dna.secondary.emoji} ${dna.secondary.name}` : "";
}

function renderHealth(health) {
  const el = (id) => document.getElementById(id);
  el("piHealthScore").textContent = health.score;
  el("piHealthScore").style.color = health.score >= 65 ? "var(--success)" : health.score >= 40 ? "#eab308" : "var(--destructive)";
  el("piHealthClass").textContent = health.classification;
  el("piHiddenRisk").innerHTML = health.hiddenRiskScore > 40
    ? `<span style="color:#f97316;">⚠️ Risco Escondido: ${health.hiddenRiskScore}/100</span>`
    : `<span style="color:#22c55e;">✅ Risco escondido baixo</span>`;
}

function renderResilience(stress) {
  const el = (id) => document.getElementById(id);
  el("piResilience").textContent = stress.resilience;
  el("piResilience").style.color = stress.resilience >= 60 ? "var(--success)" : stress.resilience >= 40 ? "#eab308" : "var(--destructive)";
  el("piResilienceSummary").textContent = stress.summary;
}

function renderFactorRadar(factors) {
  const ctx = document.getElementById("piFactorRadar");
  if (!ctx) return;
  const labels = ["Growth", "Value", "Quality", "Momentum", "Defensive", "Cyclical"];
  const data = [factors.factors.growth, factors.factors.value, factors.factors.quality, factors.factors.momentum, factors.factors.defensive, factors.factors.cyclical];

  new Chart(ctx, {
    type: "radar",
    data: {
      labels,
      datasets: [{
        label: "Exposição (%)",
        data,
        backgroundColor: "rgba(99,102,241,0.15)",
        borderColor: "#6366f1",
        borderWidth: 2,
        pointBackgroundColor: "#6366f1"
      }]
    },
    options: {
      responsive: true,
      scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, font: { size: 10 } }, pointLabels: { font: { size: 11, weight: "bold" } } } },
      plugins: { legend: { display: false } }
    }
  });
}

function renderCorrelation(corr) {
  const grid = document.getElementById("piCorrelationGrid");
  const warn = document.getElementById("piCorrWarnings");
  if (!grid) return;

  const tickers = corr.tickers.slice(0, 10);
  let html = `<table class="corr-heatmap"><tr><th></th>${tickers.map(t => `<th>${t}</th>`).join("")}</tr>`;
  for (const t of tickers) {
    html += `<tr><th>${t}</th>`;
    for (const t2 of tickers) {
      const v = corr.matrix[t]?.[t2] || 0;
      const r = Math.round(v * 255), g = Math.round((1 - v) * 200);
      const bg = t === t2 ? "var(--muted)" : `rgba(${r}, ${g}, 100, 0.3)`;
      html += `<td style="background:${bg}; font-weight:${v > 0.6 ? 700 : 400};">${v.toFixed(2)}</td>`;
    }
    html += `</tr>`;
  }
  html += `</table>`;
  grid.innerHTML = html;

  if (warn) warn.innerHTML = corr.warnings.map(w => `<div>⚠️ ${w}</div>`).join("");
}

function renderThematic(themes) {
  const container = document.getElementById("piThematicBars");
  const warn = document.getElementById("piThematicWarnings");
  if (!container) return;

  const colors = ["#6366f1", "#ec4899", "#f59e0b", "#22c55e", "#3b82f6", "#f97316", "#14b8a6", "#a78bfa", "#ef4444", "#84cc16"];

  container.innerHTML = (themes.dominant || []).map((t, i) => `
    <div class="pi-theme-bar">
      <span class="theme-label">${t.icon || "🏷️"} ${t.name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(t.exposure, 100)}%; background:${colors[i % colors.length]};"></div></div>
      <span class="theme-pct">${t.exposure}%</span>
    </div>
  `).join("");

  if (warn) warn.innerHTML = (themes.warnings || []).map(w => `<div>⚠️ ${w}</div>`).join("");
}

function renderStressTests(stress) {
  const grid = document.getElementById("piStressGrid");
  if (!grid) return;

  grid.innerHTML = Object.values(stress.scenarios).map(s => `
    <div class="pi-stress-card">
      <div class="scenario-name">${s.name}</div>
      <div class="drop-value ${s.severity.toLowerCase()}">${s.portfolioDropPct}%</div>
      <div class="loss-eur">Perda: ~${s.estimatedLoss?.toLocaleString("pt-PT")}€</div>
      <div class="muted" style="font-size:0.75rem;">Duração: ${s.duration} | Recup.: ~${s.recoveryMonths}m</div>
    </div>
  `).join("");
}

function renderWeightRisk(wrData, riskContrib) {
  const ctx = document.getElementById("piWeightRiskChart");
  const warn = document.getElementById("piRiskWarnings");
  if (!ctx) return;

  const labels = wrData.map(d => d.ticker);
  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Peso (%)", data: wrData.map(d => d.weightPct), backgroundColor: "rgba(99,102,241,0.6)", borderRadius: 4 },
        { label: "Risco (%)", data: wrData.map(d => d.riskPct), backgroundColor: "rgba(239,68,68,0.6)", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true, title: { display: true, text: "%" } } }
    }
  });

  if (warn) warn.innerHTML = (riskContrib.warnings || []).map(w => `<div>⚠️ ${w}</div>`).join("");
}

function renderScorecards(assets) {
  const container = document.getElementById("piScorecards");
  if (!container) return;

  const gradeClass = (g) => g.startsWith("A") ? "A" : g.startsWith("B") ? "B" : g.startsWith("C") ? "C" : g.startsWith("D") ? "D" : "F";
  const barColor = (s) => s >= 70 ? "#22c55e" : s >= 50 ? "#3b82f6" : s >= 35 ? "#eab308" : "#ef4444";

  container.innerHTML = assets.map(a => {
    const v2 = a.v2;
    const engines = v2.engines || {};
    return `
      <div class="pi-scorecard">
        <div class="sc-header">
          <span class="sc-ticker">${a.ticker}</span>
          <span class="sc-grade ${gradeClass(v2.grade)}">${v2.grade} — ${v2.finalScore}</span>
        </div>
        ${["quality", "momentum", "valuation", "risk"].map(k => {
          const e = engines[k] || {};
          return `
            <div class="sc-bar-row">
              <span class="sc-bar-label">${k.charAt(0).toUpperCase() + k.slice(1)}</span>
              <div class="sc-bar-track"><div class="sc-bar-fill" style="width:${e.score || 0}%; background:${barColor(e.score || 0)};"></div></div>
              <span class="sc-bar-val">${e.score || 0}</span>
            </div>`;
        }).join("")}
        <div class="muted" style="font-size:0.75rem; margin-top:6px;">Confiança: ${v2.confidence}%</div>
      </div>`;
  }).join("");
}

function renderObservations(portfolioObs, assetScores) {
  const container = document.getElementById("piObservations");
  if (!container) return;

  // Collect top asset observations too
  const allObs = [...portfolioObs];
  for (const a of assetScores.slice(0, 6)) {
    const assetObs = generateAssetObservations(a.mkt, a.v2.engines);
    allObs.push(...assetObs.slice(0, 2));
  }

  // Deduplicate and limit
  const unique = [];
  const seen = new Set();
  for (const o of allObs) {
    if (!seen.has(o.msg)) { unique.push(o); seen.add(o.msg); }
  }

  const icons = { positive: "✅", warning: "⚠️", caution: "🟠", neutral: "💡" };

  container.innerHTML = unique.slice(0, 15).map(o => `
    <div class="pi-obs ${o.type}">${icons[o.type] || "💡"} ${o.msg}</div>
  `).join("");
}

function renderRebalance(rebalance) {
  const summary = document.getElementById("piRebalanceSummary");
  const actions = document.getElementById("piRebalanceActions");
  if (!summary || !actions) return;

  summary.textContent = rebalance.summary;

  if (rebalance.actions.length === 0) {
    actions.innerHTML = `<div class="pi-obs positive">✅ Nenhuma ação de rebalanceamento necessária.</div>`;
    return;
  }

  const icons = { reduce: "📉", trim: "✂️", add: "➕", deploy: "🎯", sector_reduce: "🏷️", risk_reduce: "⚠️" };

  actions.innerHTML = rebalance.actions.slice(0, 10).map(a => `
    <div class="pi-rebal-action ${a.priority}">
      <span>${icons[a.type] || "🔄"}</span>
      <div>
        ${a.ticker ? `<strong>${a.ticker}</strong> — ` : ""}${a.reason}
        ${a.amount ? `<br><span class="muted">Montante: ~${a.amount.toLocaleString("pt-PT")}€</span>` : ""}
        ${a.suggestion ? `<br><span class="muted">${a.suggestion}</span>` : ""}
      </div>
    </div>
  `).join("");
}
