import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { app } from "../firebase-config.js";

import { scoreAssetV2, styleToMultipliers } from "../engines/score-v2.js";
import { portfolioFactors } from "../engines/factors.js";
import { portfolioHealth } from "../engines/portfolio-health.js";
import { riskContribution, weightVsRiskChart } from "../engines/risk-contrib.js";
import { correlationMatrix } from "../engines/correlation.js";
import { stressTest } from "../engines/stress-test.js";
import { portfolioRiskDecomposition } from "../engines/risk.js";
import { thematicExposure } from "../engines/thematic.js";
import { portfolioDNA } from "../engines/dna.js";
import { calculateEconomicDrivers } from "../engines/economic-drivers.js";
import { generateAssetObservations, generatePortfolioObservations } from "../engines/observations.js";
import { analyzeETFOverlap } from "../engines/etf-overlap.js";
import { rebalanceSuggestions } from "../engines/rebalance.js";
import { canonicalTicker, confidenceScore, getAssetCategory } from "../utils/normalize.js";
import { cleanTicker } from "../utils/scoring.js";
import { aggregatePortfolioPositions } from "../utils/portfolioPositions.js";

const db = getFirestore(app);
const readAssetPrice = (asset) =>
  Number(asset?.valorStock || asset?.price || asset?.preco || asset?.precoAtual || 0);

const entryPlannerState = {
  assets: [],
  basePortfolio: [],
  baseTotalValue: 0,
  selected: new Map(),
  hasLoaded: false,
  rerunTimer: null,
  isRunning: false
};

export async function initScreen() {
  const btn = document.getElementById("piRunAnalysis");
  btn?.addEventListener("click", runFullAnalysis);
  bindEntryPlannerEvents();
}

async function runFullAnalysis() {
  if (entryPlannerState.isRunning) return;
  entryPlannerState.isRunning = true;
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
      if (x.ticker) {
        const ct = canonicalTicker(cleanTicker(x.ticker));
        // Se houver duplicados, preferimos o que tiver mais dados (confidenceScore)
        if (!acoesMap.has(ct) || confidenceScore(x) > confidenceScore(acoesMap.get(ct))) {
          acoesMap.set(ct, x);
        }
      }
    });

    const strategy = stratSnap.exists() ? stratSnap.data() : {};
    const styleMult = styleToMultipliers(strategy.styleAlloc);
    const regime = strategy.macroRegime || "high_rates";

    // Build enriched portfolio with the same FIFO source of truth used by the Portfolio screen.
    const { openPositions } = aggregatePortfolioPositions(ativosSnap);
    const basePortfolio = openPositions.map(p => {
      const rawTicker = cleanTicker(p.ticker);
      const ct = canonicalTicker(rawTicker);
      const mkt = acoesMap.get(ct) || acoesMap.get(rawTicker) || {};
      const precoAtual = readAssetPrice(mkt);
      return {
        ticker: ct,
        canonical: ct,
        nome: p.nome || mkt.nome || rawTicker,
        quantidade: Number(p.qtd || 0),
        precoMedio: Number(p.custoMedio || 0),
        precoAtual,
        valAtual: Number(p.qtd || 0) * precoAtual,
        mkt
      };
    }).filter(p => p.quantidade > 0);
    const baseTotalValue = basePortfolio.reduce((s, p) => s + p.valAtual, 0);
    renderEntryPlanner(buildEntryPlannerAssets(acoesMap, basePortfolio), basePortfolio, baseTotalValue);

    const portfolio = applyEntrySimulation(basePortfolio, acoesMap, baseTotalValue);
    const totalValue = portfolio.reduce((s, p) => s + p.valAtual, 0);
    renderEntrySimulationNote(baseTotalValue, totalValue);

    // ── 2. Run all structural engines ──
    const assetScores = [];
    for (const p of portfolio) {
      const v2 = scoreAssetV2(p.mkt, styleMult, regime);
      p.score = v2.finalScore;
      p.v2 = v2;
      assetScores.push({ ...p, v2 });
    }
    assetScores.sort((a, b) => b.v2.finalScore - a.v2.finalScore);

    // Score all available assets so grades appear in Entry Planner selection list
    for (const ea of entryPlannerState.assets) {
      const v2 = scoreAssetV2(ea.mkt, styleMult, regime);
      ea.grade = v2.grade;
      ea.finalScore = v2.finalScore;
    }
    renderEntryAssetList();

    const corr = correlationMatrix(portfolio);
    const factors = portfolioFactors(portfolio, totalValue);
    const health = portfolioHealth(portfolio, totalValue);
    const riskDecomp = portfolioRiskDecomposition(portfolio, totalValue, corr.avgCorrelation);
    const riskContrib = riskContribution(portfolio, totalValue);
    const wrChart = weightVsRiskChart(portfolio, totalValue);
    const stress = stressTest(portfolio, totalValue);
    const themes = thematicExposure(portfolio, totalValue);
    const dna = portfolioDNA(portfolio, totalValue);
    const economicDrivers = calculateEconomicDrivers(portfolio, totalValue);
    const etfOverlap = analyzeETFOverlap(portfolio);
    const rebalance = rebalanceSuggestions(portfolio, totalValue, { riskContrib });
    const portfolioObs = generatePortfolioObservations({ health, correlation: corr, stressTest: stress, factors, dna, etfOverlap });

    // ── 3. Render everything ──
    renderDNA(dna);
    renderHealth(health, riskDecomp);
    renderResilience(riskDecomp);
    renderFactorRadar(factors);
    renderCorrelation(corr);
    renderThematic(themes);
    renderEconomicDrivers(economicDrivers);
    renderStressTests(stress);
    renderWeightRisk(wrChart, riskContrib);
    renderScorecards(assetScores.slice(0, 15));
    renderObservations(portfolioObs, assetScores);
    renderRebalance(rebalance);

    loading?.classList.add("hidden");
    results?.classList.remove("hidden");
    entryPlannerState.hasLoaded = true;

  } catch (err) {
    console.error("Portfolio Intel error:", err);
    loading?.classList.add("hidden");
    if (window.showToast) window.showToast("Erro na análise: " + err.message);
  } finally {
    entryPlannerState.isRunning = false;
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

function renderHealth(health, riskDecomp) {
  const el = (id) => document.getElementById(id);
  const totalScore = Math.round(health.score * 0.6 + riskDecomp.resilienceScore * 0.4);
  el("piHealthScore").textContent = totalScore;
  el("piHealthScore").style.color = totalScore >= 65 ? "var(--success)" : totalScore >= 40 ? "#eab308" : "var(--destructive)";
  el("piHealthClass").textContent = health.classification;
  
  const riskHtml = riskDecomp.decomposition.concentration > 40
    ? `<span style="color:#f97316;">⚠️ Risco Concentração: ${riskDecomp.decomposition.concentration.toFixed(0)}/100</span>`
    : `<span style="color:#22c55e;">✅ Concentração saudável</span>`;
  el("piHiddenRisk").innerHTML = riskHtml;
}

function renderResilience(riskDecomp) {
  const el = (id) => document.getElementById(id);
  const r = riskDecomp.resilienceScore;
  el("piResilience").textContent = r;
  el("piResilience").style.color = r >= 60 ? "var(--success)" : r >= 40 ? "#eab308" : "var(--destructive)";
  
  let summary = "Portfolio resiliente e estruturado.";
  if (r < 40) summary = "Alta fragilidade estrutural detectada.";
  else if (r < 60) summary = "Resiliência moderada com pontos de atenção.";
  el("piResilienceSummary").textContent = summary;
}

function renderFactorRadar(factors) {
  const ctx = document.getElementById("piFactorRadar");
  if (!ctx || !factors) return;
  const labels = ["Growth", "Value", "Quality", "Momentum", "Defensive", "Cyclical"];
  const data = [factors.growth, factors.value, factors.quality, factors.momentum, factors.defensive, factors.cyclical];

  if (window.piRadarChart) window.piRadarChart.destroy();
  window.piRadarChart = new Chart(ctx, {
    type: "radar",
    data: {
      labels,
      datasets: [{
        label: "Fatores (%)",
        data,
        backgroundColor: "rgba(99,102,241,0.15)",
        borderColor: "#6366f1",
        borderWidth: 2,
        pointBackgroundColor: "#6366f1"
      }]
    },
    options: {
      responsive: true,
      scales: { r: { min: 0, max: 100, ticks: { display: false }, pointLabels: { font: { size: 11, weight: "bold" } } } },
      plugins: { legend: { display: false } }
    }
  });
}

function renderCorrelation(corr) {
  const grid = document.getElementById("piCorrelationGrid");
  const warn = document.getElementById("piCorrWarnings");
  if (!grid) return;

  const tickers = corr.tickers.slice(0, 12);
  let html = `<table class="corr-heatmap"><tr><th></th>${tickers.map(t => `<th>${t}</th>`).join("")}</tr>`;
  for (const t of tickers) {
    html += `<tr><th>${t}</th>`;
    for (const t2 of tickers) {
      const v = corr.matrix[t]?.[t2] || 0;
      const intensity = Math.abs(v);
      const r = v > 0.65 ? 239 : 100;
      const g = v > 0.65 ? 68 : 200;
      const bg = t === t2 ? "var(--muted)" : `rgba(${r}, ${g}, 100, ${0.05 + intensity * 0.35})`;
      html += `<td style="background:${bg}; font-weight:${v > 0.65 ? 800 : 400}; color:${v > 0.65 ? "#ef4444" : "inherit"};">${v.toFixed(2)}</td>`;
    }
    html += `</tr>`;
  }
  html += `</table>`;
  grid.innerHTML = html;

  if (warn) warn.innerHTML = corr.warnings.map(w => `<div>⚠️ ${w}</div>`).join("");
}

function renderThematic(themes) {
  const container = document.getElementById("piThematicBars");
  if (!container) return;

  const colors = ["#6366f1", "#ec4899", "#f59e0b", "#22c55e", "#3b82f6", "#f97316", "#14b8a6", "#a78bfa"];

  container.innerHTML = (themes.dominant || []).map((t, i) => `
    <div class="pi-theme-bar">
      <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.8rem;">
        <span class="theme-label">${t.icon || "🏷️"} ${t.name}</span>
        <span class="theme-pct">${t.exposure}%</span>
      </div>
      <div class="bar-track" style="display:flex;">
        <div class="bar-fill" style="width:${t.directPct}%; background:${colors[i % colors.length]};" title="Direto: ${t.directPct}%"></div>
        <div class="bar-fill" style="width:${t.indirectPct}%; background:${colors[i % colors.length]}; opacity:0.4;" title="Indireto: ${t.indirectPct}%"></div>
      </div>
    </div>
  `).join("");
}

function renderEconomicDrivers(drivers) {
  const container = document.getElementById("piThematicBars"); // Appending to the same logical area
  if (!container || !drivers) return;
  
  const html = drivers.map(d => `
    <div style="display:flex; align-items:center; gap:10px; margin-top:12px; padding:8px; background:rgba(var(--primary-rgb), 0.05); border-radius:6px;">
      <span style="font-size:1.2rem;">${d.icon}</span>
      <div style="flex:1;">
        <div style="font-size:0.85rem; font-weight:700;">${d.name}</div>
        <div class="muted" style="font-size:0.75rem;">Exposure: ${d.exposure}%</div>
      </div>
    </div>
  `).join("");
  
  container.insertAdjacentHTML("beforeend", `<h4 style="margin:20px 0 10px 0; font-size:0.85rem; text-transform:uppercase; opacity:0.7;">Economic Drivers</h4>` + html);
}

function renderStressTests(stress) {
  const grid = document.getElementById("piStressGrid");
  if (!grid) return;

  grid.innerHTML = Object.values(stress.scenarios).map(s => `
    <div class="pi-stress-card">
      <div class="scenario-name">${s.name}</div>
      <div class="drop-value ${s.severity.toLowerCase()}">${s.portfolioDropPct}%</div>
      <div class="loss-eur">Perda: ~${s.estimatedLoss?.toLocaleString("pt-PT")}€</div>
      <div class="muted" style="font-size:0.75rem;">Recuperação: ~${s.recoveryMonths} meses</div>
    </div>
  `).join("");
}

function renderWeightRisk(wrData, riskContrib) {
  const ctx = document.getElementById("piWeightRiskChart");
  const warn = document.getElementById("piRiskWarnings");
  if (!ctx) return;

  if (window.piWRChart) window.piWRChart.destroy();
  const labels = wrData.slice(0, 15).map(d => d.ticker);
  window.piWRChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Peso (%)", data: wrData.slice(0, 15).map(d => d.weightPct), backgroundColor: "rgba(99,102,241,0.6)", borderRadius: 4 },
        { label: "Risco (%)", data: wrData.slice(0, 15).map(d => d.riskPct), backgroundColor: "rgba(239,68,68,0.6)", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true } }
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
        <div style="font-size:0.7rem; color:var(--muted-foreground); margin-bottom:8px;">${v2.category}</div>
        ${["quality", "momentum", "valuation", "risk"].map(k => {
          const e = engines[k] || {};
          return `
            <div class="sc-bar-row">
              <span class="sc-bar-label">${k.charAt(0).toUpperCase() + k.slice(1)}</span>
              <div class="sc-bar-track"><div class="sc-bar-fill" style="width:${e.score || 0}%; background:${barColor(e.score || 0)};"></div></div>
              <span class="sc-bar-val">${e.score || 0}</span>
            </div>`;
        }).join("")}
        <div class="muted" style="font-size:0.7rem; margin-top:6px; display:flex; justify-content:space-between;">
           <span>Confiança: ${v2.confidence}%</span>
           <span>Beta: ${v2.engines.risk?.beta?.toFixed(2) || "1.00"}</span>
        </div>
      </div>`;
  }).join("");
}

function renderObservations(portfolioObs, assetScores) {
  const container = document.getElementById("piObservations");
  if (!container) return;

  const allObs = [...portfolioObs];
  for (const a of assetScores.slice(0, 6)) {
    const assetObs = generateAssetObservations(a.mkt, a.v2.engines);
    allObs.push(...assetObs.slice(0, 2));
  }

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

function bindEntryPlannerEvents() {
  const search = document.getElementById("piEntrySearch");
  const reset = document.getElementById("piEntryReset");
  const list = document.getElementById("piEntryAssetList");
  const selected = document.getElementById("piEntrySelected");

  search?.addEventListener("input", () => renderEntryAssetList());
  reset?.addEventListener("click", () => {
    entryPlannerState.selected.clear();
    if (search) search.value = "";
    renderEntryAssetList();
    renderEntrySelectedAssets();
    scheduleAnalysisRerun();
  });

  list?.addEventListener("change", (event) => {
    const input = event.target;
    if (!input?.matches?.("[data-entry-ticker]")) return;
    const ticker = input.dataset.entryTicker;
    if (input.checked) {
      const asset = entryPlannerState.assets.find(a => a.ticker === ticker);
      const currentWeight = getCurrentWeight(asset);
      entryPlannerState.selected.set(ticker, Math.max(1, Math.ceil(currentWeight + 1)));
    } else {
      entryPlannerState.selected.delete(ticker);
    }
    renderEntryAssetList();
    renderEntrySelectedAssets();
    scheduleAnalysisRerun();
  });

  selected?.addEventListener("change", (event) => {
    const input = event.target;
    if (!input?.matches?.("[data-entry-weight]")) return;
    const ticker = input.dataset.entryWeight;
    entryPlannerState.selected.set(ticker, Math.max(0, Number(input.value || 0)));
    renderEntrySelectedAssets();
    scheduleAnalysisRerun();
  });
}

function buildEntryPlannerAssets(acoesMap, portfolio) {
  const positionMap = new Map(portfolio.map(p => [p.ticker, p]));
  const assets = [];

  for (const [ticker, mkt] of acoesMap.entries()) {
    const price = readAssetPrice(mkt);
    if (!(price > 0)) continue;
    const position = positionMap.get(ticker);
    assets.push({
      ticker,
      nome: mkt.nome || mkt.name || position?.nome || ticker,
      price,
      mkt,
      position
    });
  }

  return assets.sort((a, b) => {
    const aHeld = a.position ? 0 : 1;
    const bHeld = b.position ? 0 : 1;
    if (aHeld !== bHeld) return aHeld - bHeld;
    return a.ticker.localeCompare(b.ticker);
  });
}

function renderEntryPlanner(assets, basePortfolio, baseTotalValue) {
  entryPlannerState.assets = assets;
  entryPlannerState.basePortfolio = basePortfolio;
  entryPlannerState.baseTotalValue = baseTotalValue;

  for (const ticker of Array.from(entryPlannerState.selected.keys())) {
    if (!assets.some(a => a.ticker === ticker)) entryPlannerState.selected.delete(ticker);
  }

  const base = document.getElementById("piEntryBaseValue");
  if (base) base.textContent = fmtEUR(baseTotalValue);
  renderEntryAssetList();
  renderEntrySelectedAssets();
}

function renderEntryAssetList() {
  const container = document.getElementById("piEntryAssetList");
  const count = document.getElementById("piEntryCount");
  if (!container) return;

  const query = String(document.getElementById("piEntrySearch")?.value || "").trim().toUpperCase();
  const visible = entryPlannerState.assets
    .filter(a => !query || a.ticker.includes(query) || String(a.nome || "").toUpperCase().includes(query))
    .slice(0, query ? 120 : 48);

  if (count) count.textContent = `${entryPlannerState.selected.size} selecionado(s)`;

  if (!entryPlannerState.assets.length) {
    container.innerHTML = `<div class="muted" style="padding:12px;">Executa a análise para carregar ações com preço disponível.</div>`;
    return;
  }

  container.innerHTML = visible.map(asset => {
    const checked = entryPlannerState.selected.has(asset.ticker) ? "checked" : "";
    const currentWeight = getCurrentWeight(asset);
    const gc = asset.grade?.startsWith("A") ? "#22c55e" : asset.grade?.startsWith("B") ? "#3b82f6" : asset.grade?.startsWith("C") ? "#eab308" : asset.grade?.startsWith("D") ? "#f97316" : "#ef4444";
    const gradeBadge = asset.grade
      ? `<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:0.65rem;font-weight:800;color:white;background:${gc};">${asset.grade}</span> `
      : "";
    return `
      <label class="pi-entry-option">
        <input type="checkbox" data-entry-ticker="${escapeHtml(asset.ticker)}" ${checked}>
        <span class="pi-entry-ticker">${escapeHtml(asset.ticker)}</span>
        <span class="pi-entry-name">${escapeHtml(asset.nome || asset.ticker)}</span>
        <span class="pi-entry-meta">${gradeBadge}${fmtEUR(asset.price)}${currentWeight > 0 ? ` · ${fmtPct(currentWeight)} atual` : ""}</span>
      </label>
    `;
  }).join("") || `<div class="muted" style="padding:12px;">Nenhum ativo encontrado.</div>`;
}

function renderEntrySelectedAssets() {
  const container = document.getElementById("piEntrySelected");
  if (!container) return;

  if (!entryPlannerState.selected.size) {
    container.innerHTML = `<div class="pi-entry-empty">Seleciona uma ou mais ações para simular a avaliação IA com novos pesos.</div>`;
    return;
  }

  const selectedAssets = Array.from(entryPlannerState.selected.entries())
    .map(([ticker, targetWeight]) => {
      const asset = entryPlannerState.assets.find(a => a.ticker === ticker);
      return asset ? { asset, targetWeight } : null;
    })
    .filter(Boolean);

  const totalWeight = Array.from(entryPlannerState.selected.values()).reduce((s, w) => s + Number(w), 0);
  const weightWarn = totalWeight > 100
    ? `<div class="pi-obs warning" style="margin-bottom:10px;">⚠️ Soma dos pesos selecionados: ${totalWeight.toFixed(1)}% — excede 100%. Capital simulado além da carteira base.</div>`
    : "";

  container.innerHTML = weightWarn + selectedAssets.map(({ asset, targetWeight }) => renderEntryPlanCard(asset, targetWeight)).join("");
}

function renderEntryPlanCard(asset, targetWeight) {
  const currentQty = Number(asset.position?.quantidade || 0);
  const currentAvg = Number(asset.position?.precoMedio || 0);
  const currentValue = currentQty * asset.price;
  const targetValue = entryPlannerState.baseTotalValue * (Number(targetWeight || 0) / 100);
  const amountToBuy = Math.max(0, targetValue - currentValue);

  // Sizing rule checks
  const mktData = asset.mkt || {};
  const cat = getAssetCategory(mktData);
  const isETF = cat.includes("ETF");
  const maxPct = isETF ? 25 : 10;
  const tw = Number(targetWeight || 0);
  const sizeWarnings = [];
  if (tw > maxPct) {
    sizeWarnings.push(`Peso de ${tw}% acima do recomendado de ${maxPct}% para ${isETF ? "ETF" : "ação individual"}.`);
  }
  const sector = mktData.setor || mktData.sector || "";
  if (!isETF && sector && entryPlannerState.baseTotalValue > 0) {
    const sectorCurrent = entryPlannerState.basePortfolio
      .filter(p => (p.mkt?.setor || p.mkt?.sector || "") === sector)
      .reduce((s, p) => s + p.valAtual, 0);
    const projSectorPct = ((sectorCurrent + targetValue) / entryPlannerState.baseTotalValue) * 100;
    if (projSectorPct > 30) {
      sizeWarnings.push(`Setor "${sector}" projetado em ${projSectorPct.toFixed(0)}% — limite 30%.`);
    }
  }
  const sizeWarningHtml = sizeWarnings.map(w =>
    `<div style="padding:5px 10px;border-radius:5px;background:rgba(239,68,68,0.08);border-left:3px solid #ef4444;font-size:0.75rem;color:#ef4444;font-weight:600;margin-bottom:6px;">⚠️ ${w}</div>`
  ).join("");

  const scenarios = [
    { label: "Atual", price: asset.price },
    { label: "-5%", price: asset.price * 0.95 },
    { label: "-10%", price: asset.price * 0.90 }
  ];

  return `
    <div class="pi-entry-card"${sizeWarnings.length ? ' style="border-color:#ef4444;"' : ''}>
      <div class="pi-entry-card-head">
        <div>
          <div class="pi-entry-card-title">${escapeHtml(asset.ticker)}</div>
          <div class="muted">${escapeHtml(asset.nome || asset.ticker)}</div>
        </div>
        <label class="pi-entry-weight">
          <span>Peso alvo</span>
          <input type="number" min="0" max="100" step="0.5" data-entry-weight="${escapeHtml(asset.ticker)}" value="${Number(targetWeight || 0)}">
          <span>%</span>
        </label>
      </div>
      ${sizeWarningHtml}
      <div class="pi-entry-stats">
        <span>Atual: <strong>${fmtEUR(currentValue)}</strong> (${fmtPct(getCurrentWeight(asset))})</span>
        <span>Alvo: <strong>${fmtEUR(targetValue)}</strong></span>
        <span>Reforço: <strong>${fmtEUR(amountToBuy)}</strong></span>
      </div>
      <div class="pi-entry-scenarios">
        ${scenarios.map(s => renderEntryScenario(s, amountToBuy, currentQty, currentAvg)).join("")}
      </div>
    </div>
  `;
}

function renderEntryScenario(scenario, amountToBuy, currentQty, currentAvg) {
  const unitsExact = scenario.price > 0 ? amountToBuy / scenario.price : 0;
  const unitsWhole = Math.floor(unitsExact);
  const invested = unitsWhole * scenario.price;
  const newQty = currentQty + unitsWhole;
  const newAvg = newQty > 0
    ? ((currentQty * currentAvg) + invested) / newQty
    : scenario.price;

  return `
    <div class="pi-entry-scenario">
      <div class="pi-entry-scenario-label">${scenario.label}</div>
      <div class="pi-entry-price">${fmtEUR(scenario.price)}</div>
      <div><strong>${unitsWhole.toLocaleString("pt-PT")}</strong> ações</div>
      <div class="muted">${unitsExact.toFixed(2)} un. teóricas</div>
      <div class="muted">PM: ${fmtEUR(newAvg)}</div>
    </div>
  `;
}

function applyEntrySimulation(basePortfolio, acoesMap, baseTotalValue) {
  const simulated = basePortfolio.map(p => ({ ...p, mkt: { ...p.mkt } }));

  for (const [ticker, targetWeight] of entryPlannerState.selected.entries()) {
    const targetValue = baseTotalValue * (Number(targetWeight || 0) / 100);
    if (!(targetValue > 0)) continue;

    const existing = simulated.find(p => p.ticker === ticker);
    const asset = entryPlannerState.assets.find(a => a.ticker === ticker);
    const mkt = asset?.mkt || acoesMap.get(ticker) || {};
    const price = readAssetPrice(mkt);
    if (!(price > 0)) continue;

    if (existing) {
      const amountToBuy = Math.max(0, targetValue - existing.valAtual);
      if (!(amountToBuy > 0)) continue;
      const qtyToBuy = amountToBuy / price;
      const previousCost = existing.quantidade * (existing.precoMedio || price);
      existing.quantidade += qtyToBuy;
      existing.valAtual += amountToBuy;
      existing.precoMedio = existing.quantidade > 0
        ? (previousCost + amountToBuy) / existing.quantidade
        : price;
      existing.simulated = true;
    } else {
      simulated.push({
        ticker,
        canonical: ticker,
        nome: mkt.nome || mkt.name || ticker,
        quantidade: targetValue / price,
        precoMedio: price,
        precoAtual: price,
        valAtual: targetValue,
        mkt,
        simulated: true
      });
    }
  }

  return simulated.filter(p => p.quantidade > 0 && p.valAtual > 0);
}

function renderEntrySimulationNote(baseTotalValue, simulatedTotalValue) {
  const note = document.getElementById("piEntrySimulationNote");
  if (!note) return;
  const added = Math.max(0, simulatedTotalValue - baseTotalValue);
  note.textContent = added > 0
    ? `Avaliação IA simulada com +${fmtEUR(added)} em novos reforços.`
    : "Avaliação IA com a carteira atual.";
}

function scheduleAnalysisRerun() {
  if (!entryPlannerState.hasLoaded) return;
  clearTimeout(entryPlannerState.rerunTimer);
  entryPlannerState.rerunTimer = setTimeout(() => runFullAnalysis(), 350);
}

function getCurrentWeight(asset) {
  if (!asset || !(entryPlannerState.baseTotalValue > 0)) return 0;
  const value = Number(asset.position?.valAtual || asset.position?.quantidade * asset.price || 0);
  return (value / entryPlannerState.baseTotalValue) * 100;
}

function fmtEUR(value) {
  return Number(value || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}

function fmtPct(value) {
  return `${Number(value || 0).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}
