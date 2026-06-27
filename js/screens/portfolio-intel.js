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
import { analyzeETFOverlap, smartETFAnalysis, enrichETFAsset, isKnownETF } from "../engines/etf-overlap.js";
import { rebalanceSuggestions } from "../engines/rebalance.js";
import { canonicalTicker, confidenceScore, getAssetCategory, HEALTHY_LIMITS } from "../utils/normalize.js";
import { cleanTicker } from "../utils/scoring.js";
import { aggregatePortfolioPositions } from "../utils/portfolioPositions.js";
import { generatePortfolioReport } from "../utils/reportGenerator.js";
import { calculatePortfolioAssessment } from "../utils/portfolioAssessment.js";

const db = getFirestore(app);
const readAssetPrice = (asset) =>
  Number(asset?.valorStock || asset?.price || asset?.preco || asset?.precoAtual || 0);

const SECTOR_RADAR_LABELS = [
  "Tecnologia", "Financeiro", "Comunicacao", "Consumo Ciclico", "Industria", "Saude",
  "Consumo Basico", "Energia", "Utilidades", "Imobiliario", "Materiais", "Outros"
];

const SECTOR_BENCHMARKS = {
  sp500: {
    label: "S&P 500",
    weights: {
      "Tecnologia": 36.5,
      "Financeiro": 12.3,
      "Comunicacao": 10.6,
      "Consumo Ciclico": 9.7,
      "Industria": 8.4,
      "Saude": 8.4,
      "Consumo Basico": 5.3,
      "Energia": 3.0,
      "Utilidades": 2.1,
      "Imobiliario": 1.8,
      "Materiais": 1.8,
      "Outros": 0.1
    }
  },
  berkshire: {
    label: "Berkshire Hathaway",
    weights: {
      "Financeiro": 45,
      "Tecnologia": 22,
      "Consumo Basico": 11,
      "Energia": 8,
      "Outros": 14
    }
  }
};
const entryPlannerState = {
  assets: [],
  basePortfolio: [],
  baseTotalValue: 0,
  selected: new Map(),
  universe: "all",
  hasLoaded: false,
  rerunTimer: null,
  isRunning: false,
  sectorBenchmark: "sp500",
  lastPortfolioForSectorRadar: null,
  eventsBound: false
};

export async function initScreen() {
  const btn = document.getElementById("piRunAnalysis");
  if (btn) btn.onclick = runFullAnalysis;
  const pdfBtn = document.getElementById("piExportReport");
  if (pdfBtn) pdfBtn.onclick = async () => {
    const oldHtml = pdfBtn.innerHTML;
    try {
      pdfBtn.disabled = true;
      pdfBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A gerar...`;
      await generatePortfolioReport({ autoExport: true });
    } catch (err) {
      console.error("Erro ao exportar relatorio integrado:", err);
      window.showToast?.("Erro ao exportar PDF integrado.", "error");
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.innerHTML = oldHtml;
    }
  };
  if (!entryPlannerState.eventsBound) {
    bindEntryPlannerEvents();
    bindSectorBenchmarkEvents();
    bindEFEvents();
    entryPlannerState.eventsBound = true;
  }
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
        const ct = canonicalTicker(x.ticker);
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
    window._macroRegime = regime; // exposto para asset-deep-panel e outros componentes

    // Build enriched portfolio with the same FIFO source of truth used by the Portfolio screen.
    const { openPositions } = aggregatePortfolioPositions(ativosSnap);
    const basePortfolio = openPositions.map(p => {
      const rawTicker = cleanTicker(p.ticker);
      const ct = canonicalTicker(rawTicker);
      const mkt = { ...(acoesMap.get(ct) || acoesMap.get(rawTicker) || {}) };
      const manual = manualComposition.get(ct) || manualComposition.get(rawTicker);
      if (manual) Object.assign(mkt, {
        holdings: Array.isArray(manual.holdings) ? manual.holdings : mkt.holdings,
        sectors: Array.isArray(manual.sectors) ? manual.sectors : mkt.sectors,
        geography: Array.isArray(manual.geography) ? manual.geography : mkt.geography,
        holdings_count: Array.isArray(manual.holdings) ? manual.holdings.length : mkt.holdings_count
      });
      mkt.ticker = mkt.ticker || ct;
      if (isKnownETF(ct) || Array.isArray(mkt.holdings)) enrichETFAsset(mkt, acoesMap);
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

    const portfolio = basePortfolio;
    const totalValue = baseTotalValue;

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
    const riskDecomp = portfolioRiskDecomposition(portfolio, totalValue, corr.avgCorrelation, { sectorConcentrationLimitPct: strategy.sectorConcentrationLimitPct });
    const riskContrib = riskContribution(portfolio, totalValue);
    const wrChart = weightVsRiskChart(portfolio, totalValue);
    const stress = stressTest(portfolio, totalValue);
    const themes = thematicExposure(portfolio, totalValue);
    const dna = portfolioDNA(portfolio, totalValue);
    const economicDrivers = calculateEconomicDrivers(portfolio, totalValue);
    const etfOverlap = analyzeETFOverlap(portfolio);
    const rebalance = rebalanceSuggestions(portfolio, totalValue, { riskContrib, sectorConcentrationLimitPct: strategy.sectorConcentrationLimitPct });
    const portfolioObs = generatePortfolioObservations({ health, correlation: corr, stressTest: stress, factors, dna, etfOverlap });

    // ── 3. Render everything ──
    results?.classList.remove("hidden");
    renderDNA(dna);
    renderHealth(health, riskDecomp);
    renderResilience(riskDecomp);
    renderFactorRadar(factors, baseFactors);
    renderSectorBenchmarkRadar(portfolio, totalValue);
    renderThematic(themes);
    // renderTickerComposition(portfolio, manualComposition); // DESATIVADO: dados bugados com percentagens incorretas
    renderEconomicDrivers(economicDrivers);
    renderStressTests(stress);
    renderWeightRisk(wrChart, riskContrib);
    renderScorecards(assetScores.slice(0, 15));
    renderObservations(portfolioObs, assetScores);
    renderRebalance(rebalance);

    // Fronteira Eficiente (Markowitz Monte Carlo — 3 janelas)
    const efData = computeEfficientFrontier(portfolio, corr);
    renderEfficientFrontier(efData);
    updateEFSeedDisplay();

    loading?.classList.add("hidden");
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
      maintainAspectRatio: false,
      animation: false,
      resizeDelay: 120,
      devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      elements: { line: { borderWidth: 3 }, point: { radius: 3, hoverRadius: 5 } },
      scales: { r: { min: 0, max: 100, ticks: { display: true, stepSize: 25, backdropColor: "transparent", color: "#94a3b8", font: { size: 11, weight: "700" } }, grid: { color: "rgba(148,163,184,0.24)", circular: true }, angleLines: { color: "rgba(148,163,184,0.22)" }, pointLabels: { padding: 12, font: { size: 13, weight: "800" } } } },
      plugins: { legend: { display: Boolean(baseData), labels: { boxWidth: 12, usePointStyle: true, font: { size: 12, weight: "700" } } } }
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

function bindSectorBenchmarkEvents() {
  document.getElementById("piResults")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sector-benchmark]");
    if (!btn) return;
    entryPlannerState.sectorBenchmark = btn.getAttribute("data-sector-benchmark") || "sp500";
    document.querySelectorAll("[data-sector-benchmark]").forEach(x => x.classList.toggle("active", x === btn));
    const last = entryPlannerState.lastPortfolioForSectorRadar;
    if (last) renderSectorBenchmarkRadar(last.portfolio, last.totalValue);
  });
}

function normalizeRadarSector(raw) {
  const s = String(raw || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (s.includes("tech") || s.includes("tecnolog") || s.includes("itech") || s.includes("information")) return "Tecnologia";
  if (s.includes("finan") || s.includes("bank") || s.includes("segur")) return "Financeiro";
  if (s.includes("comunic") || s.includes("telecom") || s.includes("communication")) return "Comunicacao";
  if (s.includes("discr") || s.includes("ciclic") || s.includes("cyclic") || s.includes("consumer cyc")) return "Consumo Ciclico";
  if (s.includes("industr")) return "Industria";
  if (s.includes("saude") || s.includes("health") || s.includes("pharma")) return "Saude";
  if (s.includes("basico") || s.includes("defens") || s.includes("staples") || s.includes("consumer defensive")) return "Consumo Basico";
  if (s.includes("energ") || s.includes("oil") || s.includes("gas")) return "Energia";
  if (s.includes("utilit") || s.includes("utilities")) return "Utilidades";
  if (s.includes("imob") || s.includes("real estate") || s.includes("reit")) return "Imobiliario";
  if (s.includes("mater") || s.includes("basic materials") || s.includes("minera")) return "Materiais";
  return "Outros";
}


function normalizeSectorComposition(input) {
  if (!input) return null;
  const rows = Array.isArray(input)
    ? input.map(row => [row?.name || row?.label || row?.sector, row?.weight ?? row?.value])
    : Object.entries(input);
  const out = [];
  rows.forEach(([name, weight]) => {
    let w = Number(weight || 0);
    if (!Number.isFinite(w) || w <= 0) return;
    if (w <= 1) w *= 100;
    while (w > 100) w /= 100;
    out.push({ sector: normalizeRadarSector(name), weight: w });
  });
  const total = out.reduce((sum, row) => sum + row.weight, 0) || 1;
  return out.map(row => ({ ...row, weight: row.weight / total }));
}
function portfolioSectorWeights(portfolio, totalValue) {
  const out = Object.fromEntries(SECTOR_RADAR_LABELS.map(label => [label, 0]));
  const total = Math.max(Number(totalValue || 0), 1);
  portfolio.forEach(p => {
    const portfolioWeight = (Number(p.valAtual || 0) / total) * 100;
    const category = getAssetCategory(p.mkt || p);
    const etfSectors = normalizeSectorComposition(p.mkt?._etfSectors || p.mkt?.sectors || p._etfSectors);
    if (category.includes("ETF") && etfSectors?.length) {
      etfSectors.forEach(row => {
        out[row.sector] = (out[row.sector] || 0) + portfolioWeight * row.weight;
      });
      return;
    }
    const sector = normalizeRadarSector(p.mkt?.setor || p.mkt?.sector || p.setor || p.category);
    out[sector] = (out[sector] || 0) + portfolioWeight;
  });
  return out;
}

function renderSectorBenchmarkRadar(portfolio, totalValue) {
  const canvas = document.getElementById("piSectorBenchmarkRadar");
  if (!canvas) return;
  entryPlannerState.lastPortfolioForSectorRadar = { portfolio, totalValue };

  if (window.piSectorBenchmarkChart) { window.piSectorBenchmarkChart.destroy(); window.piSectorBenchmarkChart = null; }

  const key   = entryPlannerState.sectorBenchmark || "sp500";
  const bench = SECTOR_BENCHMARKS[key] || SECTOR_BENCHMARKS.sp500;
  const mine  = portfolioSectorWeights(portfolio, totalValue);
  const myRaw = SECTOR_RADAR_LABELS.map(l => Math.round((mine[l]          || 0) * 10) / 10);
  const bcRaw = SECTOR_RADAR_LABELS.map(l => Math.round((bench.weights[l] || 0) * 10) / 10);

  _drawPolarRose(canvas, SECTOR_RADAR_LABELS, myRaw, bcRaw, bench.label);

  const diffs = SECTOR_RADAR_LABELS
    .map((label, i) => ({ label, delta: myRaw[i] - bcRaw[i] }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  const el = document.getElementById("piSectorBenchmarkSummary");
  if (el) el.textContent = `Maiores diferenças vs ${bench.label}: ${diffs.map(d => `${d.label} ${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(1)}pp`).join(" · ")}`;
}

function _drawPolarRose(canvas, labels, portData, benchData, benchLabel) {
  const dpr = Math.max(window.devicePixelRatio || 1, 2);
  const W0  = canvas.offsetWidth  || canvas.parentElement?.offsetWidth  || 380;
  const H0  = canvas.offsetHeight || canvas.parentElement?.offsetHeight || 380;
  canvas.width  = W0 * dpr;
  canvas.height = H0 * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const isDark   = document.documentElement.getAttribute("data-theme") === "dark";
  const textCol  = isDark ? "#94a3b8" : "#64748b";
  const gridCol  = isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)";
  const sepCol   = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.18)";

  const cx = W0 / 2, cy = H0 / 2;
  const MARGIN = 54;
  const R = Math.min(W0, H0) / 2 - MARGIN;
  if (R < 40) return;

  // Log scale: % value → radius 0..R
  const RING_PCTS = [1, 3, 10, 30, 100];
  const LOG_DENOM = Math.log10(101);
  const toR = v => v > 0 ? (Math.log10(v + 1) / LOG_DENOM) * R : 0;

  const n    = labels.length;               // 12 sectors
  const step = (Math.PI * 2) / (n * 2);    // 15° per bar slot (2 bars per sector)
  const barW = step * 0.86;                 // 86% of slot = bar width
  const gapH = step * 0.14;                 // 14% = gap between bars

  ctx.clearRect(0, 0, W0, H0);

  // ── Outer boundary circle
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = gridCol;
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Ring gridlines
  for (const pct of RING_PCTS) {
    const r = toR(pct);
    if (r < 2) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // ── Radial separators between sector pairs
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * 2 * step - gapH / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    ctx.strokeStyle = sepCol;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // ── Draw petals (portfolio = teal, benchmark = coral)
  const C = {
    port:  "rgba(20,184,166,0.82)",
    bench: "rgba(239,100,80,0.82)",
    portB: "rgba(20,184,166,1)",
    benchB:"rgba(239,100,80,1)",
  };

  for (let i = 0; i < n; i++) {
    const base = -Math.PI / 2 + i * 2 * step;

    // Portfolio petal
    const r1 = toR(portData[i]);
    if (r1 > 1.5) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r1, base + gapH / 2, base + barW + gapH / 2);
      ctx.closePath();
      ctx.fillStyle = C.port;
      ctx.fill();
      ctx.strokeStyle = C.portB;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // Benchmark petal
    const r2 = toR(benchData[i]);
    if (r2 > 1.5) {
      const ba = base + step;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r2, ba + gapH / 2, ba + barW + gapH / 2);
      ctx.closePath();
      ctx.fillStyle = C.bench;
      ctx.fill();
      ctx.strokeStyle = C.benchB;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // ── Ring % labels (just left of 12-o'clock, inside each ring)
  ctx.textBaseline = "bottom";
  ctx.textAlign    = "right";
  const lblAngle   = -Math.PI / 2 - 0.08;
  for (const pct of RING_PCTS) {
    const r = toR(pct);
    if (r < 8) continue;
    ctx.font      = `700 ${r < 30 ? 8 : 9}px sans-serif`;
    ctx.fillStyle = isDark ? "#64748b" : "#94a3b8";
    ctx.fillText(`${pct}%`,
      cx + r * Math.cos(lblAngle),
      cy + r * Math.sin(lblAngle) - 1
    );
  }

  // ── Sector labels (outside the ring, tangent-rotated)
  ctx.font      = "700 9px sans-serif";
  ctx.fillStyle = textCol;
  ctx.textBaseline = "middle";

  for (let i = 0; i < n; i++) {
    const midAngle = -Math.PI / 2 + i * 2 * step + step; // between the two petals
    const lr = R + 20;
    const lx = cx + lr * Math.cos(midAngle);
    const ly = cy + lr * Math.sin(midAngle);

    ctx.save();
    ctx.translate(lx, ly);
    // Tangent rotation: +90°, then flip if in lower-left half to avoid upside-down text
    let rot = midAngle + Math.PI / 2;
    const normRot = ((rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (normRot > Math.PI / 2 && normRot < Math.PI * 1.5) rot += Math.PI;
    ctx.rotate(rot);
    ctx.textAlign = "center";
    const lbl = labels[i].length > 10 ? labels[i].slice(0, 9) + "…" : labels[i];
    ctx.fillText(lbl, 0, 0);
    ctx.restore();
  }

  // ── Legend (bottom-left)
  const LX = 12, LY = H0 - 34;
  const SW = 12, SH = 9;
  ctx.textAlign    = "left";
  ctx.textBaseline = "middle";
  ctx.font         = "700 10px sans-serif";

  ctx.fillStyle = C.port;
  ctx.fillRect(LX, LY, SW, SH);
  ctx.fillStyle = textCol;
  ctx.fillText("Portfólio", LX + SW + 5, LY + SH / 2);

  ctx.fillStyle = C.bench;
  ctx.fillRect(LX, LY + 14, SW, SH);
  ctx.fillStyle = textCol;
  ctx.fillText(benchLabel, LX + SW + 5, LY + 14 + SH / 2);
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
    map.set(cleanTicker(ticker), data);
    map.set(canonicalTicker(ticker), data);
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
      animation: false,
      resizeDelay: 120,
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
      <div class="pi-scorecard" data-ticker="${a.ticker}" style="cursor:pointer" title="Ver análise completa">
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

  // Open Asset Deep Panel on scorecard click
  container.querySelectorAll(".pi-scorecard[data-ticker]").forEach(card => {
    card.addEventListener("click", () => {
      const ticker = card.dataset.ticker;
      if (typeof window.openAssetPanel === "function") window.openAssetPanel(ticker);
    });
  });
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

const efState = {
  mode: 'capped',      // 'capped' | 'free'
  seed: null,          // null = random each run
  activeWindow: '12m', // '6m' | '12m' | '36m'
  data: null           // computed result { '6m': {...}, '12m': {...}, '36m': {...} }
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function efPercentile(sims, p) {
  const sorted = sims.map(s => s.sharpe).sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function getWindowReturn(mkt, windowKey) {
  if (windowKey === '6m') {
    const r6 = mkt?.priceChange_6m ?? mkt?.priceChange_6M;
    if (r6 != null) {
      const rn = Math.abs(r6) > 1 ? r6 / 100 : r6;
      return { r: Math.pow(1 + rn, 2) - 1, hasData: true, note: null };
    }
    const r1m = Number(mkt?.priceChange_1m ?? 0);
    const rn1m = Math.abs(r1m) > 1 ? r1m / 100 : r1m;
    return { r: Math.pow(1 + rn1m, 12) - 1, hasData: false, note: '1m anualizado (6m indisponível)' };
  }
  if (windowKey === '36m') {
    const r3 = mkt?.priceChange_3y ?? mkt?.priceChange_36m ?? mkt?.taxaCrescimento_3anos;
    if (r3 != null) {
      const rn = Math.abs(r3) > 1 ? r3 / 100 : r3;
      return { r: Math.pow(1 + rn, 1 / 3) - 1, hasData: true, note: null };
    }
    const r1y = Number(mkt?.priceChange_1y ?? mkt?.taxaCrescimento_1ano ?? 0);
    const rn = Math.abs(r1y) > 1 ? r1y / 100 : r1y;
    return { r: rn, hasData: false, note: '12m (36m indisponível — aproximação)' };
  }
  // 12m default
  const r1y = Number(mkt?.priceChange_1y ?? mkt?.taxaCrescimento_1ano ?? 0);
  const rn = Math.abs(r1y) > 1 ? r1y / 100 : r1y;
  return { r: rn, hasData: true, note: null };
}

function capWeights(weights, cap) {
  const n = weights.length;
  const effectiveCap = Math.max(cap, 1 / n);
  let w = [...weights];
  for (let iter = 0; iter < 200; iter++) {
    if (!w.some(v => v > effectiveCap + 1e-9)) break;
    w = w.map(v => Math.min(v, effectiveCap));
    const s = w.reduce((a, b) => a + b, 0);
    if (!(s > 0)) return weights.map(() => 1 / n);
    w = w.map(v => v / s);
  }
  return w;
}

// Category-aware max caps (capped mode). Broad Market ETFs also get a min floor
// so the optimizer can't dismantle the core anchor.
const CATEGORY_CAPS = {
  "Broad Market ETF": { min: 0.30, max: 0.70 },
  "Sector ETF":       { min: 0.00, max: 0.20 },
  "Thematic ETF":     { min: 0.00, max: 0.15 },
  "Single Stock":     { min: 0.00, max: 0.10 },
  "Speculative Asset":{ min: 0.00, max: 0.05 },
  "Commodity":        { min: 0.00, max: 0.12 },
  "Satellite Asset":  { min: 0.00, max: 0.08 },
};
const DEFAULT_CONSTRAINT = { min: 0.00, max: 0.25 };

function buildCategoryConstraints(portfolio) {
  return portfolio.map(p => {
    const cat = getAssetCategory(p.mkt || p);
    return CATEGORY_CAPS[cat] ?? DEFAULT_CONSTRAINT;
  });
}

// Projects weights onto the per-asset [min, max] box while keeping sum = 1.
// Pass 1: iterative max-cap (existing logic, per-asset).
// Pass 2: raise any asset below its floor, taking proportionally from assets above theirs.
function applyPortfolioConstraints(rawW, constraints) {
  const n = rawW.length;
  let w = [...rawW];

  // Pass 1 — max caps
  for (let iter = 0; iter < 300; iter++) {
    if (!w.some((v, i) => v > constraints[i].max + 1e-9)) break;
    w = w.map((v, i) => Math.min(v, constraints[i].max));
    const s = w.reduce((a, b) => a + b, 0);
    if (!(s > 0)) return w.map(() => 1 / n);
    w = w.map(v => v / s);
  }

  // Pass 2 — min floors
  for (let iter = 0; iter < 300; iter++) {
    if (!w.some((v, i) => v < constraints[i].min - 1e-9)) break;
    let deficit = 0;
    w = w.map((v, i) => {
      if (v < constraints[i].min) { deficit += constraints[i].min - v; return constraints[i].min; }
      return v;
    });
    const overIdx = w.map((v, i) => v > constraints[i].min + 1e-9 ? i : -1).filter(i => i >= 0);
    const overSum = overIdx.reduce((s, i) => s + (w[i] - constraints[i].min), 0);
    if (overSum < 1e-10) break;
    for (const i of overIdx) w[i] -= (w[i] - constraints[i].min) / overSum * deficit;
  }

  const s = w.reduce((a, b) => a + b, 0);
  return s > 0 ? w.map(v => v / s) : w;
}

function computeEfficientFrontierForWindow(portfolio, corrObj, windowKey, rand, weightCap) {
  const n = portfolio.length;
  if (n < 2) return null;
  const RISK_FREE = 0.03;

  const returnData = portfolio.map(p => getWindowReturn(p.mkt, windowKey));
  // Fallback estimates (hasData===false) use Math.pow(1+r1m, 12) which amplifies one
  // month's noise to potentially absurd annual figures (e.g. +105%). Apply a tighter
  // clamp [-40%, +50%] for those; confirmed data can use the wider [-60%, +150%].
  const expReturns = returnData.map(d =>
    isFinite(d.r)
      ? (d.hasData ? Math.max(-0.60, Math.min(d.r, 1.50)) : Math.max(-0.40, Math.min(d.r, 0.50)))
      : 0.06
  );
  const shortHistory = returnData.map((d, i) => ({ ticker: portfolio[i].ticker, hasData: d.hasData, note: d.note }))
    .filter(x => !x.hasData);

  // Vol estimation: tier lookup uses the same window-matched return already in
  // returnData (6m return for 6m window, 3y annualised for 36m, etc.) so risk
  // varies between windows, not just expected return. The monthly signal floors
  // assets that were calm in the selected window but are inherently volatile.
  const vols = portfolio.map((p, i) => {
    const mkt = p.mkt || {};
    const cat = getAssetCategory(mkt);
    const isETF = cat.includes('ETF');

    // Short-term signal — monthly return annualised
    const r1m = Number(mkt.priceChange_1m ?? 0);
    const rn1m = Math.abs(r1m) > 1 ? r1m / 100 : r1m;
    const volShort = Math.abs(rn1m) * Math.sqrt(12);

    // Use the same annualised return that getWindowReturn chose for this window
    const rAbs = Math.abs(isFinite(returnData[i].r) ? returnData[i].r : 0);

    let baseline;
    if (isETF) {
      if (rAbs > 0.40) baseline = 0.28;
      else if (rAbs > 0.20) baseline = 0.18;
      else baseline = 0.13;
    } else {
      if (rAbs > 0.60) baseline = 0.48;
      else if (rAbs > 0.35) baseline = 0.33;
      else if (rAbs > 0.15) baseline = 0.25;
      else baseline = 0.20;
    }

    return Math.min(Math.max(baseline, volShort), 0.90);
  });

  // Correlation matrix is computed once per analysis run from historical prices and
  // is shared across all three windows (6m/12m/36m). This is a known limitation:
  // short-term and long-term correlation regimes can differ. Accepted trade-off for
  // now — changing it would require per-window price history in Firestore.
  const matrix = corrObj?.matrix || {};
  const getCorrVal = (i, j) => {
    if (i === j) return 1;
    const ti = portfolio[i].ticker, tj = portfolio[j].ticker;
    const v = matrix[ti]?.[tj] ?? matrix[tj]?.[ti];
    return isFinite(v) ? v : 0.3;
  };
  const cov = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => vols[i] * vols[j] * getCorrVal(i, j))
  );

  const portVariance = w => {
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * cov[i][j];
    return Math.max(0, v);
  };
  const portReturn = w => w.reduce((s, wi, i) => s + wi * expReturns[i], 0);
  const rawWeights = () => {
    const r = Array.from({ length: n }, () => -Math.log(rand() + 1e-10));
    const sum = r.reduce((s, v) => s + v, 0);
    return r.map(v => v / sum);
  };

  // Capped mode uses per-category constraints (Broad Market ETF: min 30%, max 70%;
  // Thematic/Sector ETF: max 15-20%; Single Stock: max 10%) instead of a uniform 30% cap.
  // This prevents the optimizer from dismantling core anchor positions.
  const catConstraints = weightCap != null ? buildCategoryConstraints(portfolio) : null;
  // Keep effectiveWeightCap for display purposes (show "30% max" label in UI)
  const effectiveWeightCap = weightCap;

  const M = 1200;
  const sims = [];
  let best = { sharpe: -Infinity, weights: null };
  for (let k = 0; k < M; k++) {
    const w = catConstraints != null
      ? applyPortfolioConstraints(rawWeights(), catConstraints)
      : rawWeights();
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

  return { sims, curRet, curVol, curSharpe, best, expReturns, vols, portfolio, curW, shortHistory, windowKey, effectiveWeightCap, catConstraints };
}

function computeEfficientFrontier(portfolio, corrObj) {
  // Pre-compute both modes so toggle is instant (no re-simulation on switch).
  // When seeded, both modes use identical starting seeds → same raw portfolios,
  // different constraint → fair "capped vs free" comparison.
  const results = { capped: {}, free: {} };
  for (const win of ['6m', '12m', '36m']) {
    const seedBase = efState.seed != null ? efState.seed + win.charCodeAt(0) * 7 : null;
    const mkRand = () => seedBase != null ? mulberry32(seedBase) : Math.random.bind(Math);
    results.free[win]   = computeEfficientFrontierForWindow(portfolio, corrObj, win, mkRand(), null);
    results.capped[win] = computeEfficientFrontierForWindow(portfolio, corrObj, win, mkRand(), 0.30);
  }
  efState.data = results;
  return results;
}

function renderEfficientFrontier(allData) {
  if (!allData) return;
  const data = allData[efState.mode]?.[efState.activeWindow];
  if (!data) return;

  // ── Sync window tab highlight ──
  document.querySelectorAll("[data-ef-window]").forEach(b =>
    b.classList.toggle("active", b.dataset.efWindow === efState.activeWindow)
  );

  // ── Mode banner ──
  const banner = document.getElementById("piEFModeBanner");
  const modeIcon = document.getElementById("piEFModeIcon");
  const modeText = document.getElementById("piEFModeText");
  if (banner && modeIcon && modeText) {
    const isFree = efState.mode === 'free';
    banner.className = `ef-mode-banner ${isFree ? 'ef-mode-free' : 'ef-mode-capped'}`;
    modeIcon.textContent = isFree ? "⚠️" : "🔒";
    modeText.textContent = isFree
      ? "Modo sem limites ACTIVO — sem cap por activo"
      : "Modo com limites — máx. 30% por activo";
    const toggle = document.getElementById("piEFModeToggle");
    if (toggle) toggle.checked = isFree;
  }

  // ── Return source label ──
  // Show a low-confidence label when any asset is using a fallback estimate, because
  // the fallback formula (Math.pow(1+r1m,12) or 1y proxy) can mislead if presented
  // with the same authority as genuine window data.
  const labelEl = document.getElementById("piEFReturnLabel");
  if (labelEl) {
    const hasLowConf = (data.shortHistory?.length ?? 0) > 0;
    const windowLabels = {
      '6m':  'Retorno Histórico (Janela: 6 meses, anualizado) — baseado em priceChange_6m. Nota: retorno passado ≠ expectativa futura.',
      '12m': 'Retorno Histórico (Janela: 12 meses) — baseado em priceChange_1y. Nota: retorno passado ≠ expectativa futura.',
      '36m': 'Retorno Histórico (Janela: 36 meses, anualizado) — baseado em priceChange_3y. Nota: retorno passado ≠ expectativa futura.',
    };
    const lowConfLabels = {
      '6m':  'Estimativa de baixa confiança (1m → anualizado para um ou mais activos) — dados de 6 meses indisponíveis. Clamp aplicado: [−40%, +50%].',
      '12m': 'Retorno Histórico (Janela: 12 meses) — baseado em priceChange_1y. Nota: retorno passado ≠ expectativa futura.',
      '36m': 'Estimativa de baixa confiança (12m como aproximação para um ou mais activos) — dados de 3 anos indisponíveis. Clamp aplicado: [−40%, +50%].',
    };
    labelEl.textContent = (hasLowConf ? lowConfLabels : windowLabels)[efState.activeWindow] || '';
    labelEl.style.color = hasLowConf ? '#f59e0b' : '';
    labelEl.style.fontWeight = hasLowConf ? '700' : '';
  }

  // ── Insufficient history warnings ──
  const histEl = document.getElementById("piEFHistoryWarnings");
  if (histEl) {
    if (data.shortHistory?.length) {
      histEl.innerHTML = `<div style="margin-bottom:8px; font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--muted-foreground);">⚠ Histórico insuficiente para covariância fiável:</div>` +
        data.shortHistory.map(h =>
          `<span class="ef-hist-warn">⚠ ${escapeHtml(h.ticker)}: ${escapeHtml(h.note || 'dados indisponíveis')}</span>`
        ).join('');
    } else {
      histEl.innerHTML = '';
    }
  }

  // ── Chart ──
  const canvas = document.getElementById("piEfficientFrontier");
  if (!canvas) return;
  if (window.__piEFChart) window.__piEFChart.destroy();

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const tickColor = isDark ? "rgba(255,255,255,.8)" : "rgba(0,0,0,.7)";
  const gridColor = isDark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.1)";

  const maxS = Math.max(...data.sims.map(s => s.sharpe));
  const minS = Math.min(...data.sims.map(s => s.sharpe));

  const grouped = { high: [], mid: [], low: [] };
  data.sims.forEach(s => {
    const t = (s.sharpe - minS) / (maxS - minS + 0.001);
    const bucket = t > 0.66 ? 'high' : t > 0.33 ? 'mid' : 'low';
    grouped[bucket].push({ x: +(s.vol * 100).toFixed(2), y: +(s.ret * 100).toFixed(2) });
  });
  const sampleBucket = (arr, max) => {
    if (arr.length <= max) return arr;
    const step = arr.length / max;
    return Array.from({ length: max }, (_, i) => arr[Math.floor(i * step)]);
  };
  grouped.low  = sampleBucket(grouped.low,  300);
  grouped.mid  = sampleBucket(grouped.mid,  300);
  grouped.high = sampleBucket(grouped.high, 300);

  const yAxisLabel = {
    '6m':  'Retorno Histórico 6m anualizado (%)',
    '12m': 'Retorno Histórico 12m (%)',
    '36m': 'Retorno Histórico 36m anualizado (%)',
  }[efState.activeWindow] || 'Retorno Histórico (%)';

  // Axis bounds derived from the simulation cloud, not from individual asset dots.
  // Asset dots can sit outside the canvas (clipped by Chart.js) without stretching
  // the axes — which was the root cause of the "esquisito" X-axis deformation.
  let sXMin = Infinity, sXMax = -Infinity, sYMin = Infinity, sYMax = -Infinity;
  for (const s of data.sims) {
    const sv = s.vol * 100, sr = s.ret * 100;
    if (sv < sXMin) sXMin = sv;
    if (sv > sXMax) sXMax = sv;
    if (sr < sYMin) sYMin = sr;
    if (sr > sYMax) sYMax = sr;
  }
  const xPad = Math.max((sXMax - sXMin) * 0.08, 1);
  const yPad = Math.max((sYMax - sYMin) * 0.10, 1);
  const axisXMin = Math.floor(sXMin - xPad);
  const axisXMax = Math.ceil(sXMax + xPad);
  const axisYMin = Math.floor(sYMin - yPad);
  const axisYMax = Math.ceil(sYMax + yPad);

  // Individual asset anchor points (drawn first = behind the Sharpe cloud)
  const assetDots = data.portfolio.map((p, i) => ({
    x: +(data.vols[i] * 100).toFixed(2),
    y: +(data.expReturns[i] * 100).toFixed(2),
    ticker: p.ticker,
  }));

  // Detect dots that fall outside the fixed axis range (silently clipped by Chart.js)
  const clippedDots = assetDots.filter(
    d => d.x < axisXMin || d.x > axisXMax || d.y < axisYMin || d.y > axisYMax
  );
  const clipWarnEl = document.getElementById("piEFClipWarning");
  if (clipWarnEl) {
    if (clippedDots.length > 0) {
      const names = clippedDots.map(d => d.ticker).join(", ");
      clipWarnEl.textContent = `ℹ ${clippedDots.length} activo(s) fora do intervalo visível (não afectam o zoom): ${names}`;
      clipWarnEl.style.display = "block";
    } else {
      clipWarnEl.style.display = "none";
    }
  }

  // Update canvas aria-label with live context
  const _ariaCapStr = data.effectiveWeightCap != null
    ? `com cap ${(data.effectiveWeightCap * 100).toFixed(0)}%`
    : 'sem limites';
  const _ariaWindow = { '6m': '6 meses', '12m': '12 meses', '36m': '36 meses' }[efState.activeWindow] || efState.activeWindow;
  canvas.setAttribute("aria-label",
    `Fronteira Eficiente — ${data.sims.length} portfolios simulados, modo ${_ariaCapStr}, janela ${_ariaWindow}. Sharpe máximo: ${data.best.sharpe.toFixed(2)} (vol ${(data.best.vol * 100).toFixed(1)}%, retorno ${(data.best.ret * 100).toFixed(1)}%).`
  );

  window.__piEFChart = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        // Asset dots first so they sit BEHIND the Sharpe cloud
        {
          label: "Activos individuais",
          data: assetDots,
          backgroundColor: "rgba(255,165,0,0.75)",
          borderColor: "rgba(255,140,0,0.9)",
          borderWidth: 1.5,
          pointRadius: 7,
          pointStyle: "crossRot",
        },
        { label: "Baixo Sharpe", data: grouped.low,  backgroundColor: "rgba(239,68,68,0.30)",  pointRadius: 2 },
        { label: "Médio Sharpe", data: grouped.mid,  backgroundColor: "rgba(245,158,11,0.40)", pointRadius: 2 },
        { label: "Alto Sharpe",  data: grouped.high, backgroundColor: "rgba(34,197,94,0.50)",  pointRadius: 2 },
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
      animation: false,
      resizeDelay: 120,
      scales: {
        x: {
          min: axisXMin, max: axisXMax,
          title: { display: true, text: "Risco — Volatilidade Anualizada (%)", color: tickColor, font: { size: 11 } },
          ticks: { color: tickColor, callback: v => v + "%" },
          grid: { color: gridColor },
        },
        y: {
          min: axisYMin, max: axisYMax,
          title: { display: true, text: yAxisLabel, color: tickColor, font: { size: 11 } },
          ticks: { color: tickColor, callback: v => v + "%" },
          grid: { color: gridColor },
        },
      },
      plugins: {
        legend: {
          position: "top",
          labels: { color: tickColor, boxWidth: 10, font: { size: 11 }, filter: item => !item.text.startsWith("_") }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.dataset.label === "Activos individuais") {
                return ` ${ctx.raw.ticker}  |  Vol est.: ${ctx.parsed.x.toFixed(1)}%  |  Retorno: ${ctx.parsed.y.toFixed(1)}%`;
              }
              return ` Risco: ${ctx.parsed.x.toFixed(1)}%  |  Retorno: ${ctx.parsed.y.toFixed(1)}%`;
            },
          },
        },
      },
    },
  });

  // ── KPIs with percentiles ──
  const metaEl = document.getElementById("piEfficientFrontierMeta");
  if (metaEl) {
    const fmtPct = v => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
    const kpi = (label, value, color = "var(--foreground)", sub = "") => `
      <div style="border:1px solid var(--border); border-radius:10px; padding:10px; background:var(--card);">
        <div style="font-size:0.62rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted-foreground); font-weight:800; margin-bottom:4px;">${label}</div>
        <div style="font-size:0.95rem; font-weight:800; color:${color};">${value}</div>
        ${sub ? `<div style="font-size:0.68rem; color:var(--muted-foreground); margin-top:2px;">${sub}</div>` : ""}
      </div>`;

    const p10 = efPercentile(data.sims, 10);
    const p50 = efPercentile(data.sims, 50);
    const p90 = efPercentile(data.sims, 90);
    const shColor = v => v >= 1 ? "#22c55e" : v >= 0.5 ? "#f59e0b" : "#ef4444";

    metaEl.innerHTML =
      kpi("Retorno histórico (atual)", fmtPct(data.curRet), data.curRet >= 0 ? "#22c55e" : "#ef4444", `Janela: ${efState.activeWindow}`) +
      kpi("Volatilidade (atual)", `${(data.curVol * 100).toFixed(1)}%`) +
      kpi("Sharpe (atual)", data.curSharpe.toFixed(2), shColor(data.curSharpe)) +
      kpi("Sharpe p10 — pessimista", p10.toFixed(2), shColor(p10), "10% das simulações abaixo deste valor") +
      kpi("Sharpe p50 — mediana", p50.toFixed(2), shColor(p50), "metade das simulações abaixo deste valor") +
      kpi("Sharpe p90 — otimista", p90.toFixed(2), shColor(p90), "90% das simulações abaixo deste valor") +
      kpi("Sharpe máximo simulado", data.best.sharpe.toFixed(2), "#06b6d4", "melhor das 1 200 simulações") +
      kpi("Retorno no Sharpe max.", fmtPct(data.best.ret), "#06b6d4") +
      kpi("Vol. no Sharpe max.", `${(data.best.vol * 100).toFixed(1)}%`, "#06b6d4");
  }

  // ── Action panel ──
  const actionsEl = document.getElementById("piEFActions");
  if (!actionsEl || !data.best.weights || !data.curW) return;

  const isFree = efState.mode === 'free';
  const totalVal = data.portfolio.reduce((s, p) => s + (p.valAtual || 0), 0);
  // best.weights already reflects the mode's constraint (applied during simulation)
  const targetWeights = [...data.best.weights];

  const moves = data.portfolio
    .map((p, i) => ({
      ticker: p.ticker,
      nome: p.nome || p.ticker,
      cur: data.curW[i] * 100,
      target: targetWeights[i] * 100,
      delta: (targetWeights[i] - data.curW[i]) * 100,
      curVal: (data.curW[i] || 0) * totalVal,
      targetVal: (targetWeights[i] || 0) * totalVal,
    }))
    .filter(m => Math.abs(m.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  if (!moves.length) {
    actionsEl.innerHTML = `<div class="pi-obs positive" style="margin-top:12px;">✅ A carteira atual já está próxima do portfolio de Sharpe máximo. Nenhum ajuste significativo necessário.</div>`;
    return;
  }

  const increase = moves.filter(m => m.delta > 0);
  const decrease = moves.filter(m => m.delta < 0);

  // Annotate moves with their strategic category and any health-limit contradictions
  const movesWithContext = moves.map(m => {
    const mkt = data.portfolio.find(p => p.ticker === m.ticker)?.mkt || {};
    const cat = getAssetCategory(mkt);
    const healthMax = HEALTHY_LIMITS[cat] ?? DEFAULT_CONSTRAINT.max;
    const isCore = cat === "Broad Market ETF";
    // A contradiction: reducing below healthy max, or reducing a Core position at all
    const contradiction =
      (!m.delta > 0 && isCore) ||                                // reducing Core anchor
      (m.delta > 0 && m.target / 100 > healthMax + 0.01);       // pushing above category limit
    return { ...m, cat, isCore, contradiction };
  });

  const renderMove = (m) => {
    const isUp = m.delta > 0;
    const icon = isUp ? "📈" : "📉";
    const verb = isUp ? "Aumenta" : "Reduz";
    const color = isUp ? "#22c55e" : "#ef4444";
    const bg = isUp ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)";
    const border = isUp ? "#22c55e" : "#ef4444";
    const sign = isUp ? "+" : "";
    const amountChange = Math.abs(m.targetVal - m.curVal);
    const action = isUp ? `Compra ~${fmtEUR(amountChange)} adicionais` : `Vende ~${fmtEUR(amountChange)}`;

    const catBadge = `<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:0.62rem;font-weight:800;background:rgba(99,102,241,0.1);color:#6366f1;margin-left:6px;">${escapeHtml(m.cat)}</span>`;
    const coreBadge = m.isCore && !isUp
      ? `<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:0.62rem;font-weight:900;background:rgba(239,68,68,0.12);color:#dc2626;margin-left:4px;">⚓ Âncora Core</span>`
      : "";
    const contradictionNote = m.contradiction && isUp
      ? `<div style="font-size:0.7rem;color:#d97706;margin-top:3px;">⚠️ Acima do limite saudável para ${escapeHtml(m.cat)} (${((HEALTHY_LIMITS[m.cat] ?? DEFAULT_CONSTRAINT.max)*100).toFixed(0)}%)</div>`
      : "";

    return `
      <div style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:8px; background:${bg}; border-left:3px solid ${border};">
        <span style="font-size:1.1rem;">${icon}</span>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:900; font-size:0.88rem;">${verb} <strong>${escapeHtml(m.ticker)}</strong>${catBadge}${coreBadge}</div>
          <div class="muted" style="font-size:0.75rem;">${escapeHtml(m.nome)}</div>
          <div style="font-size:0.78rem; margin-top:3px;">
            <span style="color:var(--muted-foreground);">${m.cur.toFixed(1)}%</span>
            <span style="margin:0 4px; color:var(--muted-foreground);">→</span>
            <span style="font-weight:800; color:${color};">${m.target.toFixed(1)}%</span>
            <span style="color:${color}; font-weight:700; margin-left:6px;">(${sign}${m.delta.toFixed(1)}pp)</span>
          </div>
          ${contradictionNote}
        </div>
        <div style="text-align:right; font-size:0.75rem; flex:0 0 auto;">
          <div style="font-weight:700; color:${color};">${action}</div>
          <div class="muted">${fmtEUR(m.targetVal)} alvo</div>
        </div>
      </div>`;
  };

  const sharpeGain = data.best.sharpe - data.curSharpe;
  const windowLabel = { '6m': '6 meses', '12m': '12 meses', '36m': '36 meses' }[efState.activeWindow] || efState.activeWindow;

  // Detect structural contradictions (Core anchor being dismantled)
  const coreReductions = decrease.filter(m => m.isCore);
  const contradictionBanner = coreReductions.length > 0
    ? `<div style="margin-bottom:10px; padding:10px 12px; border-radius:8px; background:rgba(239,68,68,0.08); border:1.5px solid #ef4444; font-size:0.78rem; color:var(--foreground); line-height:1.5;">
        <strong style="color:#dc2626;">⚓ Atenção — o optimizador propõe reduzir ${coreReductions.map(m => m.ticker).join(", ")} (Âncora Core).</strong>
        O optimizador maximiza Sharpe histórico; não sabe que esta posição é o núcleo de longo prazo da carteira.
        Em modo <em>com cap</em> o VWCE nunca desce abaixo de 30% (floor aplicado). Em modo <em>sem limites</em> não há protecção — trata como exercício teórico.
      </div>`
    : "";

  // Disclaimer changes based on mode
  const disclaimer = isFree
    ? `<div style="margin-top:14px; padding:12px 14px; border-radius:10px; background:rgba(239,68,68,0.09); border:2px solid #ef4444; display:flex; gap:12px; align-items:flex-start;">
        <span style="font-size:1.4rem; flex:0 0 auto; line-height:1;">🚨</span>
        <div style="font-size:0.8rem; line-height:1.55;">
          <div style="font-weight:900; color:#ef4444; margin-bottom:6px;">MODO SEM LIMITES ACTIVO</div>
          <div style="color:var(--foreground);">As sugestões podem recomendar concentração extrema num único activo. Isto reflecte o histórico recente (janela: <strong>${escapeHtml(windowLabel)}</strong>), não uma garantia futura. Trata como ponto de partida de discussão, não como instrução de execução.</div>
          <div style="margin-top:8px; color:var(--foreground);">Sem limite por activo. Resultado estocástico. Valida sempre com análise fundamental independente.</div>
          <div style="margin-top:8px; padding:7px 10px; border-radius:6px; background:rgba(0,0,0,0.04); font-size:0.72rem; color:var(--muted-foreground); font-family:monospace; line-height:1.6;">
            <strong style="font-family:sans-serif; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em;">Fonte dos dados</strong><br>
            Retorno histórico → janela ${escapeHtml(windowLabel)}<br>
            Volatilidade → tier por categoria + sinal mensal<br>
            Correlações → estimadas por setor (fixas entre janelas) · fallback <code>0.30</code>
          </div>
        </div>
      </div>`
    : `<div style="margin-top:14px; padding:12px 14px; border-radius:10px; background:rgba(245,158,11,0.09); border:1.5px solid #f59e0b; display:flex; gap:12px; align-items:flex-start;">
        <span style="font-size:1.3rem; flex:0 0 auto; line-height:1;">⚠️</span>
        <div style="font-size:0.8rem; line-height:1.5;">
          <div style="font-weight:900; color:#d97706; margin-bottom:4px;">Orientação direcional — não é instrução de execução</div>
          <div style="color:var(--foreground);">Retornos históricos da janela <strong>${escapeHtml(windowLabel)}</strong>. Constraints por categoria aplicados: Broad Market ETF mín. 30% / máx. 70%; Thematic ETF máx. 15%; Single Stock máx. 10%. Resultado estocástico. Valida com análise fundamental antes de agir.</div>
          <div style="margin-top:8px; padding:7px 10px; border-radius:6px; background:rgba(0,0,0,0.04); font-size:0.72rem; color:var(--muted-foreground); font-family:monospace; line-height:1.6;">
            <strong style="font-family:sans-serif; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em;">Fonte dos dados</strong><br>
            Retorno histórico → janela ${escapeHtml(windowLabel)}<br>
            Volatilidade → tier por categoria + sinal mensal<br>
            Correlações → estimadas por setor (fixas entre janelas) · fallback <code>0.30</code>
          </div>
        </div>
      </div>`;

  actionsEl.innerHTML = `
    <div style="margin-top:14px; padding-top:12px; border-top:1px dashed var(--border);">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
        <span style="font-weight:900; font-size:0.88rem;">🎯 Para mover a ★ até ao ◆ (Sharpe máximo)</span>
        <span style="font-size:0.75rem; padding:3px 8px; border-radius:20px; background:rgba(6,182,212,0.12); color:#06b6d4; font-weight:800;">+${sharpeGain.toFixed(2)} Sharpe</span>
        <span class="muted" style="font-size:0.72rem;">Melhor das 1 200 simulações · janela ${escapeHtml(windowLabel)} · ${isFree ? "sem cap" : "constraints por categoria"}</span>
      </div>
      ${contradictionBanner}
      ${increase.length ? `
        <div style="font-size:0.72rem; font-weight:900; text-transform:uppercase; color:var(--muted-foreground); margin-bottom:6px;">Reforçar</div>
        <div style="display:grid; gap:6px; margin-bottom:10px;">${increase.map(renderMove).join("")}</div>
      ` : ""}
      ${decrease.length ? `
        <div style="font-size:0.72rem; font-weight:900; text-transform:uppercase; color:var(--muted-foreground); margin-bottom:6px;">Reduzir</div>
        <div style="display:grid; gap:6px;">${decrease.map(renderMove).join("")}</div>
      ` : ""}
      ${disclaimer}
    </div>`;
}

function bindEFEvents() {
  document.getElementById("piEFModeToggle")?.addEventListener("change", (e) => {
    efState.mode = e.target.checked ? "free" : "capped";
    if (efState.data) renderEfficientFrontier(efState.data);
  });

  document.querySelectorAll("[data-ef-window]").forEach(btn => {
    btn.addEventListener("click", () => {
      efState.activeWindow = btn.dataset.efWindow;
      document.querySelectorAll("[data-ef-window]").forEach(b =>
        b.classList.toggle("active", b === btn)
      );
      if (efState.data) renderEfficientFrontier(efState.data);
    });
  });

  document.getElementById("piEFSeed")?.addEventListener("change", (e) => {
    const v = e.target.value.trim();
    efState.seed = v ? parseInt(v, 10) : null;
  });

  document.getElementById("piEFReseed")?.addEventListener("click", () => {
    efState.seed = null;
    const inp = document.getElementById("piEFSeed");
    if (inp) inp.value = "";
    if (entryPlannerState.hasLoaded) scheduleAnalysisRerun();
  });
}

function updateEFSeedDisplay() {
  const inp = document.getElementById("piEFSeed");
  if (inp && efState.seed != null) inp.value = efState.seed;
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

