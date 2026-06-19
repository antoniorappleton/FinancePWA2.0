import { getFirestore, collection, getDocs, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { app } from "../firebase-config.js";

import { scoreAssetV2, styleToMultipliers } from "../engines/score-v2.js";
import { calculateFactors, portfolioFactors } from "../engines/factors.js";
import { portfolioHealth } from "../engines/portfolio-health.js";
import { riskContribution, weightVsRiskChart } from "../engines/risk-contrib.js";
import { correlationMatrix } from "../engines/correlation.js";
import { stressTest } from "../engines/stress-test.js";
import { portfolioRiskDecomposition } from "../engines/risk.js";
import { thematicExposure } from "../engines/thematic.js";
import { portfolioDNA } from "../engines/dna.js";
import { calculateEconomicDrivers } from "../engines/economic-drivers.js";
import { generateAssetObservations, generatePortfolioObservations } from "../engines/observations.js";
import { analyzeETFOverlap, smartETFAnalysis } from "../engines/etf-overlap.js";
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
  universe: "all",
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
    const [ativosSnap, acoesSnap, stratSnap, etfHoldingsSnap] = await Promise.all([
      getDocs(collection(db, "ativos")),
      getDocs(collection(db, "acoesDividendos")),
      getDoc(doc(db, "config", "strategy")),
      getDocs(collection(db, "etfHoldings"))
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
    const manualComposition = buildManualCompositionMap(etfHoldingsSnap);
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
    const baseFactors = entryPlannerState.selected.size
      ? portfolioFactors(basePortfolio, baseTotalValue)
      : null;
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
    renderFactorRadar(factors, baseFactors);
    renderCorrelation(corr);
    renderThematic(themes);
    // renderTickerComposition(portfolio, manualComposition); // DESATIVADO: dados bugados com percentagens incorretas
    renderEconomicDrivers(economicDrivers);
    renderStressTests(stress);
    renderWeightRisk(wrChart, riskContrib);
    renderScorecards(assetScores.slice(0, 15));
    renderObservations(portfolioObs, assetScores);
    renderRebalance(rebalance);

    // Fronteira Eficiente (Markowitz Monte Carlo)
    const efData = computeEfficientFrontier(portfolio, corr);
    renderEfficientFrontier(efData);

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

function renderFactorRadar(factors, baseFactors = null) {
  const ctx = document.getElementById("piFactorRadar");
  if (!ctx || !factors) return;
  const labels = ["Growth", "Value", "Quality", "Momentum", "Defensive", "Cyclical"];
  const data = [factors.growth, factors.value, factors.quality, factors.momentum, factors.defensive, factors.cyclical];
  const baseData = baseFactors
    ? [baseFactors.growth, baseFactors.value, baseFactors.quality, baseFactors.momentum, baseFactors.defensive, baseFactors.cyclical]
    : null;

  if (window.piRadarChart) window.piRadarChart.destroy();
  window.piRadarChart = new Chart(ctx, {
    type: "radar",
    data: {
      labels,
      datasets: [
        ...(baseData ? [{
          label: "Atual",
          data: baseData,
          backgroundColor: "rgba(148,163,184,0.08)",
          borderColor: "#94a3b8",
          borderWidth: 1,
          borderDash: [4, 4],
          pointBackgroundColor: "#94a3b8"
        }] : []),
        {
          label: baseData ? "Simulado" : "Fatores (%)",
          data,
          backgroundColor: "rgba(99,102,241,0.15)",
          borderColor: "#6366f1",
          borderWidth: 2,
          pointBackgroundColor: "#6366f1"
        }
      ]
    },
    options: {
      responsive: true,
      scales: { r: { min: 0, max: 100, ticks: { display: false }, pointLabels: { font: { size: 11, weight: "bold" } } } },
      plugins: { legend: { display: Boolean(baseData), labels: { boxWidth: 10, usePointStyle: true } } }
    }
  });
  renderFactorExpansionHints(factors);
}

function renderFactorExpansionHints(factors) {
  const container = document.getElementById("piFactorHints");
  if (!container || !factors) return;

  const factorMeta = [
    { key: "growth", label: "Growth", pt: "crescimento" },
    { key: "value", label: "Value", pt: "value" },
    { key: "quality", label: "Quality", pt: "qualidade" },
    { key: "momentum", label: "Momentum", pt: "momentum" },
    { key: "defensive", label: "Defensive", pt: "defensivo" },
    { key: "cyclical", label: "Cyclical", pt: "cíclico" }
  ];
  const currentTickers = new Set(entryPlannerState.basePortfolio.map(p => p.ticker));
  const selectedTickers = new Set(entryPlannerState.selected.keys());

  const weakest = factorMeta
    .map(meta => ({ ...meta, value: Number(factors[meta.key] || 0) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 2);

  const hints = weakest
    .map(meta => {
      const candidate = findBestFactorCandidate(meta.key, currentTickers, selectedTickers);
      return candidate ? { meta, candidate } : null;
    })
    .filter(Boolean);

  if (!hints.length) {
    container.innerHTML = `<div class="muted" style="font-size:0.78rem;">Sem dicas adicionais: o universo carregado não tem candidatos claros para estender os fatores menos expressivos.</div>`;
    return;
  }

  container.innerHTML = hints.map(({ meta, candidate }) => `
    <div class="pi-factor-hint">
      <div>
      Junta mais <strong>${escapeHtml(meta.pt)}</strong>, p.ex. <strong>${escapeHtml(candidate.ticker)}</strong>
      <span class="muted">${escapeHtml(candidate.nome || candidate.ticker)} · ${meta.label}: ${candidate.factorScore}/100 · Score IA: ${candidate.finalScore ?? "—"}</span>
      <span class="muted">Peso sugerido para mexer a teia: ${candidate.suggestedWeight}%</span>
      </div>
      <button class="btn outline pi-factor-apply" type="button" data-factor-ticker="${escapeHtml(candidate.ticker)}" data-factor-weight="${candidate.suggestedWeight}">
        <i class="fas fa-plus"></i> Simular
      </button>
    </div>
  `).join("");
}

function findBestFactorCandidate(factorKey, currentTickers, selectedTickers) {
  const ranked = entryPlannerState.assets
    .filter(asset => !currentTickers.has(asset.ticker) && !selectedTickers.has(asset.ticker))
    .map(asset => {
      const factorScore = calculateFactors(asset.mkt || asset)[factorKey] || 0;
      return { ...asset, factorScore, suggestedWeight: getSuggestedFactorWeight(asset) };
    })
    .filter(asset => asset.factorScore >= 45)
    .sort((a, b) => {
      if (b.factorScore !== a.factorScore) return b.factorScore - a.factorScore;
      return (b.finalScore || 0) - (a.finalScore || 0);
    });

  return ranked[0] || null;
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

function buildManualCompositionMap(snapshot) {
  const map = new Map();
  snapshot?.forEach(docSnap => {
    const data = docSnap.data() || {};
    const ticker = String(data.ticker || docSnap.id || "").toUpperCase();
    if (!ticker) return;
    map.set(ticker, data);
  });
  return map;
}

function renderTickerComposition(portfolio, manualComposition) {
  const container = document.getElementById("piTickerComposition");
  if (!container) return;

  const totalValue = portfolio.reduce((sum, p) => sum + Number(p.valAtual || 0), 0) || 1;
  container.innerHTML = portfolio
    .slice()
    .sort((a, b) => Number(b.valAtual || 0) - Number(a.valAtual || 0))
    .map(asset => {
      const composition = getTickerComposition(asset, manualComposition);
      const weight = (Number(asset.valAtual || 0) / totalValue) * 100;
      return `
        <div class="pi-composition-card">
          <div class="pi-composition-head">
            <div>
              <div class="pi-composition-ticker">${escapeHtml(asset.ticker)}</div>
              <div class="muted">${escapeHtml(asset.nome || asset.mkt?.nome || asset.ticker)} · ${fmtPct(weight)} do portfólio</div>
            </div>
            <span class="pi-composition-source">${escapeHtml(composition.source)}</span>
          </div>
          <div class="pi-composition-columns">
            ${renderCompositionGroup("Setores", composition.sectors)}
            ${renderCompositionGroup("Geografia", composition.geography)}
          </div>
        </div>
      `;
    }).join("") || `<div class="muted">Sem posições abertas para decompor.</div>`;
}

function getTickerComposition(asset, manualComposition) {
  const ticker = String(asset?.ticker || "").toUpperCase();
  const manual = findManualComposition(ticker, manualComposition);
  const etf = smartETFAnalysis(ticker);
  const sectors = normalizeComposition(manual?.sectors || manual?.sectorAlloc || etf?.sectors);
  const geography = normalizeComposition(manual?.geography || manual?.countries || manual?.countryAlloc || etf?.geography);
  const fallbackSector = normalizeEntrySector(asset?.mkt || asset);
  const fallbackCountry = inferAssetCountry(asset?.mkt || asset);

  return {
    source: manual ? "Manual" : etf ? "ETF base" : "Ativo",
    sectors: sectors.length ? sectors : [{ name: fallbackSector, weight: 100 }],
    geography: geography.length ? geography : [{ name: fallbackCountry, weight: 100 }]
  };
}

function findManualComposition(ticker, manualComposition) {
  if (!manualComposition?.size) return null;
  if (manualComposition.has(ticker)) return manualComposition.get(ticker);
  const base = ticker.split(".")[0];
  for (const [key, data] of manualComposition.entries()) {
    const k = String(key || "").toUpperCase();
    if (k.split(".")[0] === base || k.startsWith(ticker) || ticker.startsWith(k)) return data;
  }
  return null;
}

function normalizeComposition(input) {
  const rows = Array.isArray(input)
    ? input.map(item => ({
        name: item.name || item.label || item.country || item.sector || item.region || item.ticker,
        weight: item.weight ?? item.value ?? item.percent ?? item.pct
      }))
    : Object.entries(input || {}).map(([name, weight]) => ({ name, weight }));

  const normalized = rows
    .map(row => ({ name: String(row.name || "").trim(), weight: normalizeCompositionWeight(row.weight) }))
    .filter(row => row.name && row.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  const total = normalized.reduce((sum, row) => sum + row.weight, 0);
  
  // Detecta e corrige valores salvos com erro de divisão múltipla por 100
  if (total > 0.001 && total <= 0.011) {
    // Dupla divisão (ex: 65.6 → 0.656 → 0.00656): multiplica por 10000
    normalized.forEach(row => { row.weight *= 10000; });
  } else if (total > 0 && total <= 1.0001) {
    // Simples divisão (ex: 65.6 → 0.656): multiplica por 100
    normalized.forEach(row => { row.weight *= 100; });
  }
  
  return normalized.slice(0, 8);
}

function normalizeCompositionWeight(value) {
  let weight = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(weight)) return 0;
  let safety = 0;
  while (Math.abs(weight) > 100 && safety < 6) {
    weight /= 100;
    safety++;
  }
  return weight;
}

function inferAssetCountry(asset) {
  const raw = asset?.pais || asset?.país || asset?.country || asset?.Country || asset?.mercado || asset?.market || "";
  return String(raw || "").trim() || "N/D";
}

function renderCompositionGroup(title, rows) {
  const top = rows.slice(0, 6);
  return `
    <div class="pi-composition-group">
      <div class="pi-composition-group-title">${title}</div>
      ${top.map(row => `
        <div class="pi-composition-row">
          <div class="pi-composition-row-label">
            <span>${escapeHtml(row.name)}</span>
            <strong>${fmtPct(row.weight)}</strong>
          </div>
          <div class="pi-composition-track">
            <div class="pi-composition-fill" style="width:${Math.max(1, Math.min(100, row.weight))}%;"></div>
          </div>
        </div>
      `).join("") || `<div class="muted" style="font-size:0.78rem;">Sem dados.</div>`}
    </div>
  `;
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

// ══════════════════════════════════════════════════════════════
// 📈 FRONTEIRA EFICIENTE (Markowitz — Monte Carlo 3000 portfolios)
// ══════════════════════════════════════════════════════════════

function capWeights(weights, cap) {
  let w = [...weights];
  for (let iter = 0; iter < 200; iter++) {
    if (!w.some(v => v > cap + 1e-9)) break;
    w = w.map(v => Math.min(v, cap));
    const s = w.reduce((a, b) => a + b, 0);
    w = w.map(v => v / s);
  }
  return w;
}

function computeEfficientFrontier(portfolio, corrObj) {
  const n = portfolio.length;
  if (n < 2) return null;

  const RISK_FREE = 0.03;

  const expReturns = portfolio.map(p => {
    const r = Number(p.mkt?.priceChange_1y ?? p.mkt?.taxaCrescimento_1ano ?? 0);
    const rn = Math.abs(r) > 1 ? r / 100 : r;
    return isFinite(rn) ? Math.max(-0.6, Math.min(rn, 1.5)) : 0.06;
  });

  const vols = portfolio.map(p => {
    const r = Number(p.mkt?.priceChange_1m ?? 0);
    const rn = Math.abs(r) > 1 ? r / 100 : r;
    const av = Math.abs(rn) * Math.sqrt(12);
    return isFinite(av) && av > 0.01 ? Math.min(av, 1.2) : 0.18;
  });

  const matrix = corrObj?.matrix || {};
  const getCorrVal = (i, j) => {
    if (i === j) return 1;
    const ti = portfolio[i].ticker, tj = portfolio[j].ticker;
    const v = matrix[ti]?.[tj] ?? matrix[tj]?.[ti];
    return isFinite(v) ? v : 0.3;
  };

  const cov = Array.from({length: n}, (_, i) =>
    Array.from({length: n}, (_, j) => vols[i] * vols[j] * getCorrVal(i, j))
  );

  const portVariance = w => {
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * cov[i][j];
    return Math.max(0, v);
  };
  const portReturn = w => w.reduce((s, wi, i) => s + wi * expReturns[i], 0);
  const randWeights = () => {
    const r = Array.from({length: n}, () => -Math.log(Math.random() + 1e-10));
    const sum = r.reduce((s, v) => s + v, 0);
    return r.map(v => v / sum);
  };

  const M = 3000;
  const sims = [];
  let best = { sharpe: -Infinity, weights: null };
  for (let k = 0; k < M; k++) {
    const w = randWeights();
    const ret = portReturn(w);
    const vol = Math.sqrt(portVariance(w));
    const sharpe = vol > 0 ? (ret - RISK_FREE) / vol : 0;
    sims.push({ ret, vol, sharpe });
    if (sharpe > best.sharpe) best = { ret, vol, sharpe, weights: w };
  }

  const totalVal = portfolio.reduce((s, p) => s + (p.valAtual || 0), 0);
  const curW = portfolio.map(p => (p.valAtual || 0) / (totalVal || 1));
  const curRet = portReturn(curW);
  const curVol = Math.sqrt(portVariance(curW));
  const curSharpe = curVol > 0 ? (curRet - RISK_FREE) / curVol : 0;

  return { sims, curRet, curVol, curSharpe, best, expReturns, vols, portfolio, curW };
}

function renderEfficientFrontier(data) {
  const canvas = document.getElementById("piEfficientFrontier");
  if (!canvas || !data) return;
  if (window.__piEFChart) window.__piEFChart.destroy();

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const tickColor = isDark ? "rgba(255,255,255,.8)" : "rgba(0,0,0,.7)";
  const gridColor = isDark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.1)";

  const maxS = Math.max(...data.sims.map(s => s.sharpe));
  const minS = Math.min(...data.sims.map(s => s.sharpe));
  const sharpeColor = s => {
    const t = Math.max(0, Math.min(1, (s - minS) / (maxS - minS + 0.001)));
    if (t > 0.66) return `rgba(34,197,94,0.55)`;
    if (t > 0.33) return `rgba(245,158,11,0.55)`;
    return `rgba(239,68,68,0.45)`;
  };

  const grouped = { high: [], mid: [], low: [] };
  data.sims.forEach(s => {
    const t = (s.sharpe - minS) / (maxS - minS + 0.001);
    const bucket = t > 0.66 ? 'high' : t > 0.33 ? 'mid' : 'low';
    grouped[bucket].push({ x: +(s.vol * 100).toFixed(2), y: +(s.ret * 100).toFixed(2) });
  });
  // Render at most 200 pts per bucket (600 total) — calculation used all 3000
  const sampleBucket = (arr, max) => {
    if (arr.length <= max) return arr;
    const step = arr.length / max;
    return Array.from({length: max}, (_, i) => arr[Math.floor(i * step)]);
  };
  grouped.low  = sampleBucket(grouped.low,  300);
  grouped.mid  = sampleBucket(grouped.mid,  300);
  grouped.high = sampleBucket(grouped.high, 300);

  const fmtPct = v => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  window.__piEFChart = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        { label: "Baixo Sharpe", data: grouped.low,  backgroundColor: "rgba(239,68,68,0.35)",   pointRadius: 2 },
        { label: "Médio Sharpe", data: grouped.mid,  backgroundColor: "rgba(245,158,11,0.45)",  pointRadius: 2 },
        { label: "Alto Sharpe",  data: grouped.high, backgroundColor: "rgba(34,197,94,0.55)",   pointRadius: 2 },
        {
          label: "_halo",
          data: [{ x: +(data.curVol * 100).toFixed(2), y: +(data.curRet * 100).toFixed(2) }],
          backgroundColor: "rgba(139,92,246,0.18)",
          borderColor: "rgba(167,139,250,0.55)",
          borderWidth: 3,
          pointRadius: 26,
          pointStyle: "circle",
        },
        {
          label: "★ Carteira Atual",
          data: [{ x: +(data.curVol * 100).toFixed(2), y: +(data.curRet * 100).toFixed(2) }],
          backgroundColor: "#8b5cf6",
          borderColor: "#ffffff",
          borderWidth: 2,
          pointRadius: 16,
          pointStyle: "star",
        },
        {
          label: "◆ Sharpe Máximo",
          data: [{ x: +(data.best.vol * 100).toFixed(2), y: +(data.best.ret * 100).toFixed(2) }],
          backgroundColor: "#06b6d4",
          borderColor: "#0891b2",
          borderWidth: 2,
          pointRadius: 13,
          pointStyle: "rectRot",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: "Risco — Volatilidade Anualizada (%)", color: tickColor, font: { size: 11 } },
          ticks: { color: tickColor, callback: v => v + "%" },
          grid: { color: gridColor },
        },
        y: {
          title: { display: true, text: "Retorno Esperado (%)", color: tickColor, font: { size: 11 } },
          ticks: { color: tickColor, callback: v => v + "%" },
          grid: { color: gridColor },
        },
      },
      plugins: {
        legend: { position: "top", labels: { color: tickColor, boxWidth: 10, font: { size: 11 }, filter: item => !item.text.startsWith("_") } },
        tooltip: {
          callbacks: {
            label: ctx => ` Risco: ${ctx.parsed.x.toFixed(1)}%  |  Retorno: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
    },
  });

  const metaEl = document.getElementById("piEfficientFrontierMeta");
  if (metaEl) {
    const kpi = (label, value, color = "var(--foreground)") => `
      <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--card);">
        <div style="font-size:0.62rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted-foreground); font-weight:800; margin-bottom:4px;">${label}</div>
        <div style="font-size:0.95rem; font-weight:800; color:${color};">${value}</div>
      </div>`;
    metaEl.innerHTML =
      kpi("Retorno esperado (atual)", fmtPct(data.curRet), data.curRet >= 0 ? "#22c55e" : "#ef4444") +
      kpi("Volatilidade (atual)", `${(data.curVol * 100).toFixed(1)}%`) +
      kpi("Rácio Sharpe (atual)", data.curSharpe.toFixed(2), data.curSharpe >= 1 ? "#22c55e" : data.curSharpe >= 0.5 ? "#f59e0b" : "#ef4444") +
      kpi("Sharpe máximo simulado", data.best.sharpe.toFixed(2), "#06b6d4") +
      kpi("Retorno Sharpe max.", fmtPct(data.best.ret), "#06b6d4") +
      kpi("Vol. Sharpe max.", `${(data.best.vol * 100).toFixed(1)}%`, "#06b6d4");
  }

  const actionsEl = document.getElementById("piEFActions");
  if (actionsEl && data.best.weights && data.curW) {
    const totalVal = data.portfolio.reduce((s, p) => s + (p.valAtual || 0), 0);
    const CAP = 0.30;
    const cappedWeights = capWeights(data.best.weights, CAP);
    const moves = data.portfolio
      .map((p, i) => ({
        ticker: p.ticker,
        nome: p.nome || p.ticker,
        cur: data.curW[i] * 100,
        target: cappedWeights[i] * 100,
        delta: (cappedWeights[i] - data.curW[i]) * 100,
        curVal: (data.curW[i] || 0) * totalVal,
        targetVal: (cappedWeights[i] || 0) * totalVal,
      }))
      .filter(m => Math.abs(m.delta) >= 0.5)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    if (!moves.length) {
      actionsEl.innerHTML = `<div class="pi-obs positive" style="margin-top:12px;">✅ A carteira atual já está próxima do portfolio de Sharpe máximo. Nenhum ajuste significativo necessário.</div>`;
    } else {
      const increase = moves.filter(m => m.delta > 0);
      const decrease = moves.filter(m => m.delta < 0);

      const renderMove = (m) => {
        const isUp = m.delta > 0;
        const icon = isUp ? "📈" : "📉";
        const verb = isUp ? "Aumenta" : "Reduz";
        const color = isUp ? "#22c55e" : "#ef4444";
        const bg = isUp ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)";
        const border = isUp ? "#22c55e" : "#ef4444";
        const sign = isUp ? "+" : "";
        const amountChange = Math.abs(m.targetVal - m.curVal);
        const action = isUp
          ? `Compra ~${fmtEUR(amountChange)} adicionais`
          : `Vende ~${fmtEUR(amountChange)}`;
        return `
          <div style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:8px; background:${bg}; border-left:3px solid ${border};">
            <span style="font-size:1.1rem;">${icon}</span>
            <div style="flex:1; min-width:0;">
              <div style="font-weight:900; font-size:0.88rem;">${verb} <strong>${escapeHtml(m.ticker)}</strong></div>
              <div class="muted" style="font-size:0.75rem;">${escapeHtml(m.nome)}</div>
              <div style="font-size:0.78rem; margin-top:3px;">
                <span style="color:var(--muted-foreground);">${m.cur.toFixed(1)}%</span>
                <span style="margin:0 4px; color:var(--muted-foreground);">→</span>
                <span style="font-weight:800; color:${color};">${m.target.toFixed(1)}%</span>
                <span style="color:${color}; font-weight:700; margin-left:6px;">(${sign}${m.delta.toFixed(1)}pp)</span>
              </div>
            </div>
            <div style="text-align:right; font-size:0.75rem; flex:0 0 auto;">
              <div style="font-weight:700; color:${color};">${action}</div>
              <div class="muted">${fmtEUR(m.targetVal)} alvo</div>
            </div>
          </div>`;
      };

      const sharpeGain = data.best.sharpe - data.curSharpe;
      actionsEl.innerHTML = `
        <div style="margin-top:14px; padding-top:12px; border-top:1px dashed var(--border);">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
            <span style="font-weight:900; font-size:0.88rem;">🎯 Para mover a ★ até ao ◆ (Sharpe máximo)</span>
            <span style="font-size:0.75rem; padding:3px 8px; border-radius:20px; background:rgba(6,182,212,0.12); color:#06b6d4; font-weight:800;">+${sharpeGain.toFixed(2)} Sharpe</span>
            <span class="muted" style="font-size:0.72rem;">Baseado na melhor das 3 000 simulações Monte Carlo</span>
          </div>
          ${increase.length ? `
            <div style="font-size:0.72rem; font-weight:900; text-transform:uppercase; color:var(--muted-foreground); margin-bottom:6px;">Reforçar</div>
            <div style="display:grid; gap:6px; margin-bottom:10px;">${increase.map(renderMove).join("")}</div>
          ` : ""}
          ${decrease.length ? `
            <div style="font-size:0.72rem; font-weight:900; text-transform:uppercase; color:var(--muted-foreground); margin-bottom:6px;">Reduzir</div>
            <div style="display:grid; gap:6px;">${decrease.map(renderMove).join("")}</div>
          ` : ""}
          <div style="margin-top:14px; padding:12px 14px; border-radius:10px; background:rgba(245,158,11,0.09); border:1.5px solid #f59e0b; display:flex; gap:12px; align-items:flex-start;">
            <span style="font-size:1.3rem; flex:0 0 auto; line-height:1;">⚠️</span>
            <div style="font-size:0.8rem; line-height:1.5;">
              <div style="font-weight:900; color:#d97706; margin-bottom:4px;">Orientação direcional — não é instrução de execução</div>
              <div style="color:var(--foreground);">Retornos estimados a partir de dados históricos do último ano. Cada ativo limitado a <strong>30% máximo</strong>. Resultado varia a cada execução (estocástico). Valida sempre com a tua análise fundamental antes de agir.</div>
              <div style="margin-top:8px; padding:7px 10px; border-radius:6px; background:rgba(0,0,0,0.04); font-size:0.72rem; color:var(--muted-foreground); font-family:monospace; line-height:1.6;">
                <strong style="font-family:sans-serif; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em;">Fonte dos dados</strong><br>
                Retorno esperado → <code>priceChange_1y</code> (variação de preço no último ano)<br>
                Volatilidade → <code>priceChange_1m × √12</code> (variação mensal anualizada)<br>
                Correlações → estimadas por setor · fallback <code>0.30</code> quando insuficientes
              </div>
            </div>
          </div>
        </div>`;
    }
  }
}

function bindEntryPlannerEvents() {
  const search = document.getElementById("piEntrySearch");
  const universe = document.getElementById("piEntryUniverse");
  const reset = document.getElementById("piEntryReset");
  const list = document.getElementById("piEntryAssetList");
  const selected = document.getElementById("piEntrySelected");
  const factorHints = document.getElementById("piFactorHints");

  search?.addEventListener("input", () => renderEntryAssetList());
  universe?.addEventListener("change", () => {
    entryPlannerState.universe = universe.value || "all";
    renderEntryAssetList();
  });
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
      const defaultWeight = currentWeight > 0 ? Math.ceil(currentWeight + 2) : getSuggestedFactorWeight(asset);
      entryPlannerState.selected.set(ticker, defaultWeight);
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

  selected?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-entry-remove]");
    if (!button) return;
    const ticker = button.dataset.entryRemove;
    if (!ticker) return;
    entryPlannerState.selected.delete(ticker);
    renderEntryAssetList();
    renderEntrySelectedAssets();
    scheduleAnalysisRerun();
  });

  factorHints?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-factor-ticker]");
    if (!button) return;
    const ticker = button.dataset.factorTicker;
    const weight = Number(button.dataset.factorWeight || 0);
    if (!ticker || !(weight > 0)) return;
    entryPlannerState.selected.set(ticker, weight);
    renderEntryAssetList();
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
    const normalizedMkt = {
      ...mkt,
      ticker,
      nome: mkt.nome || mkt.name || position?.nome || ticker
    };
    assets.push({
      ticker,
      nome: normalizedMkt.nome,
      price,
      sector: normalizeEntrySector(normalizedMkt),
      mkt: normalizedMkt,
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
  const universe = document.getElementById("piEntryUniverse");
  if (universe) universe.value = entryPlannerState.universe;

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
  const visible = getVisibleEntryAssets()
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

function getVisibleEntryAssets() {
  const ranked = [...entryPlannerState.assets].sort(compareEntryAssets);
  if (entryPlannerState.universe === "top-global") {
    return ranked.slice(0, 3);
  }
  if (entryPlannerState.universe !== "top-sector") {
    return ranked;
  }

  const bySector = new Map();
  for (const asset of ranked) {
    const sector = asset.sector || "Sem setor";
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector).push(asset);
  }

  return Array.from(bySector.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, assets]) => assets.slice(0, 3));
}

function compareEntryAssets(a, b) {
  const aHeld = a.position ? 0 : 1;
  const bHeld = b.position ? 0 : 1;
  const aScore = Number.isFinite(a.finalScore) ? a.finalScore : -1;
  const bScore = Number.isFinite(b.finalScore) ? b.finalScore : -1;

  if (entryPlannerState.universe === "all" && aHeld !== bHeld) return aHeld - bHeld;
  if (aScore !== bScore) return bScore - aScore;
  if (a.grade && !b.grade) return -1;
  if (!a.grade && b.grade) return 1;
  return a.ticker.localeCompare(b.ticker);
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
  const remaining = 100 - totalWeight;
  const sumState = totalWeight > 100 ? "over" : totalWeight >= 95 ? "full" : "ok";
  const sumBarColor = sumState === "over" ? "#ef4444" : sumState === "full" ? "#22c55e" : "#6366f1";
  const sumBarMsg = sumState === "over"
    ? `⚠ excede 100% — capital simulado além da carteira base`
    : sumState === "full"
    ? `✓ alocação completa`
    : `restam ${remaining.toFixed(1)}% por alocar`;
  const weightBar = `
    <div style="padding:8px 12px; border-radius:8px; background:var(--card); border:1.5px solid ${sumBarColor}; display:flex; align-items:center; gap:10px; box-shadow:0 2px 8px rgba(0,0,0,0.07);">
      <span style="font-size:0.75rem; font-weight:700; color:var(--muted-foreground);">Soma dos pesos</span>
      <strong style="font-size:1.1rem; font-weight:900; color:${sumBarColor};">${totalWeight.toFixed(1)}%</strong>
      <div style="flex:1; height:6px; border-radius:999px; background:var(--border); overflow:hidden;">
        <div style="height:100%; border-radius:inherit; background:${sumBarColor}; width:${Math.min(totalWeight, 100)}%; transition:width 0.3s ease;"></div>
      </div>
      <span style="font-size:0.72rem; color:${sumBarColor}; font-weight:700; white-space:nowrap;">${sumBarMsg}</span>
    </div>`;

  container.innerHTML = weightBar + selectedAssets.map(({ asset, targetWeight }) => renderEntryPlanCard(asset, targetWeight)).join("");
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
          <div class="pi-entry-title-row">
            <div class="pi-entry-card-title">${escapeHtml(asset.ticker)}</div>
            <button class="pi-entry-remove" type="button" data-entry-remove="${escapeHtml(asset.ticker)}" aria-label="Remover ${escapeHtml(asset.ticker)} da simulação" title="Remover da simulação">
              <i class="fas fa-times"></i>
            </button>
          </div>
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
    const mkt = {
      ...(asset?.mkt || acoesMap.get(ticker) || {}),
      ticker,
      nome: asset?.nome || asset?.mkt?.nome || asset?.mkt?.name || ticker
    };
    const price = readAssetPrice(mkt);
    if (!(price > 0)) continue;

    if (existing) {
      const amountToBuy = Math.max(0, targetValue - existing.valAtual);
      if (!(amountToBuy > 0)) continue;
      existing.mkt = { ...mkt };
      existing.nome = existing.nome || mkt.nome || ticker;
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

function getSuggestedFactorWeight(asset) {
  const category = getAssetCategory(asset?.mkt || asset || {});
  if (category.includes("ETF")) return 12;
  if (category === "Commodity") return 8;
  return 8;
}

function normalizeEntrySector(asset) {
  return String(asset?.setor || asset?.sector || asset?.Setor || asset?.Sector || "").trim() || "Sem setor";
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

// Função de migração para corrigir dados em Firestore com erro de divisão por 100
// Executar via console: fixCompositionDataInFirestore()
window.fixCompositionDataInFirestore = async function() {
  const db = getFirestore(app);
  const snap = await getDocs(collection(db, "etfHoldings"));
  let fixCount = 0;
  
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const needsFix = (data.geography || []).some(g => g.weight && g.weight < 0.1);
    
    if (needsFix) {
      const fixed = {
        ...data,
        geography: (data.geography || []).map(g => ({
          ...g,
          weight: g.weight && g.weight < 0.1 ? g.weight * 10000 : g.weight
        })),
        sectors: (data.sectors || []).map(s => ({
          ...s,
          weight: s.weight && s.weight < 0.1 ? s.weight * 10000 : s.weight
        }))
      };
      
      await updateDoc(doc(db, "etfHoldings", docSnap.id), fixed);
      console.log(`✅ Corrigido: ${docSnap.id}`);
      fixCount++;
    }
  }
  
  console.log(`🎉 Migração concluída! ${fixCount} documentos corrigidos.`);
  return fixCount;
};

