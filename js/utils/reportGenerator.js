// js/utils/reportGenerator.js
import { db } from "../firebase-config.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { calculateLucroMaximoScore, getAssetType, cleanTicker, normalizeSector } from "./scoring.js";
import { canonicalTicker, confidenceScore } from "./normalize.js";
import { aggregatePortfolioPositions } from "./portfolioPositions.js";
import { calculatePortfolioAssessment } from "./portfolioAssessment.js";
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
import { generatePortfolioObservations } from "../engines/observations.js";
import { analyzeETFOverlap, enrichETFAsset, isKnownETF } from "../engines/etf-overlap.js";
import { rebalanceSuggestions } from "../engines/rebalance.js";

let chartInstances = {};
const REPORT_COLORS = ["#4F46E5", "#22C55E", "#EAB308", "#EF4444", "#06B6D4", "#F59E0B", "#A855F7", "#14B8A6"];
const CRISES_HISTORY = [
  { name: "Cenario provavel atual", drop: 13 },
  { name: "Crise geopolitica moderada", drop: 11.5 },
  { name: "Invasao da Ucrania (2022)", drop: 24 },
  { name: "Crash COVID-19 (2020)", drop: 34 },
  { name: "Crise financeira (2008)", drop: 56 }
];

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
function ensureScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
async function ensureReportLibs() {
  if (!window.Chart) await ensureScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js");
  if (!window.jspdf) await ensureScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
  if (!window.jspdf?.autoTable) await ensureScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js");
}

const fmtEUR = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n || 0));
const pct = n => `${Number(n || 0).toFixed(1)}%`;
const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Number(n || 0)));
const readAssetPrice = asset => Number(asset?.valorStock || asset?.price || asset?.preco || asset?.precoAtual || 0);

function buildManualCompositionMap(snapshot) {
  const map = new Map();
  snapshot?.forEach(d => {
    const x = d.data();
    const raw = String(x.ticker || d.id || "").toUpperCase();
    const clean = cleanTicker(raw).toUpperCase();
    const canonical = canonicalTicker(clean);
    const patch = {
      holdings: Array.isArray(x.holdings) ? x.holdings : undefined,
      sectors: Array.isArray(x.sectors) ? x.sectors : undefined,
      geography: Array.isArray(x.geography) ? x.geography : undefined,
      holdings_count: Array.isArray(x.holdings) ? x.holdings.length : undefined,
      _etfHoldingsDoc: x
    };
    [raw, clean, canonical].filter(Boolean).forEach(k => map.set(k, patch));
  });
  return map;
}
function buildAcoesMap(acoesSnap, manualComposition) {
  const map = new Map();
  acoesSnap.forEach(d => {
    const x = d.data();
    if (!x.ticker) return;
    const clean = cleanTicker(x.ticker);
    const canonical = canonicalTicker(clean);
    const current = map.get(canonical);
    if (!current || confidenceScore(x) > confidenceScore(current)) map.set(canonical, x);
    if (!map.has(clean)) map.set(clean, x);
  });
  for (const [ticker, patch] of manualComposition.entries()) {
    const canonical = canonicalTicker(ticker);
    const existing = map.get(canonical) || map.get(ticker) || { ticker: canonical || ticker, nome: ticker, setor: "ETF" };
    const merged = { ...existing, ...patch, ticker: existing.ticker || canonical || ticker };
    map.set(ticker, merged);
    map.set(canonical, merged);
  }
  return map;
}
function generateSmartDiagnosis(enriched, totalValue) {
  const cats = { CORE: 0, SATELLITE: 0, CRYPTO: 0 };
  const sectors = {}, types = { stock: 0, etf: 0, crypto: 0 };
  enriched.forEach(p => {
    const type = getAssetType(p.ticker, p.mkt);
    types[type] = (types[type] || 0) + p.valAtual;
    const s = p.setor || normalizeSector(p.mkt || p) || "Outros";
    sectors[s] = (sectors[s] || 0) + p.valAtual;
    const key = `${p.ticker} ${p.nome}`.toUpperCase();
    const isCore = type === "etf" && ["CORE", "VWCE", "IWDA", "VUSA", "CSPX", "EUNL", "VGWL", "SP500", "WORLD"].some(k => key.includes(k));
    if (type === "crypto") cats.CRYPTO += p.valAtual;
    else if (isCore) cats.CORE += p.valAtual;
    else cats.SATELLITE += p.valAtual;
  });
  const total = Math.max(1, totalValue);
  const corePct = (cats.CORE / total) * 100, satPct = (cats.SATELLITE / total) * 100, cryPct = (cats.CRYPTO / total) * 100;
  const forces = [], risks = [], actions = [];
  if (corePct >= 45) forces.push("A carteira tem uma base diversificada relevante.");
  else actions.push("Reforcar uma base CORE ajuda a reduzir dependencia de apostas isoladas.");
  if (cryPct > 15) risks.push("Cripto tem peso elevado e pode ampliar quedas.");
  if (Object.keys(sectors).length < 5) actions.push("Aumentar a variedade de setores para suavizar ciclos diferentes.");
  return { corePct, satPct, cryPct, forces, risks, actions, sectors, types };
}
function calculatePortfolioScoreV2({ assetAvg, diag, analysis, enriched }) {
  const shared = calculatePortfolioAssessment({ health: analysis?.health, riskDecomp: analysis?.riskDecomp });
  const structureScore = diag.corePct >= 45 && diag.corePct <= 80 ? 90 : diag.corePct >= 30 ? 78 : 58;
  const divScore = Math.min(100, Object.keys(diag.sectors).length * 14 + enriched.length * 2);
  return {
    total: shared.total,
    label: shared.label,
    breakdown: {
      saude: shared.breakdown.saude,
      resiliencia: shared.breakdown.resiliencia,
      ativos: assetAvg,
      estrutura: structureScore,
      diversificacao: divScore
    }
  };
}

async function buildCombinedReportData() {
  const [ativosSnap, acoesSnap, stratSnap, etfHoldingsSnap] = await Promise.all([
    getDocs(collection(db, "ativos")),
    getDocs(collection(db, "acoesDividendos")),
    getDoc(doc(db, "config", "strategy")),
    getDocs(collection(db, "etfHoldings"))
  ]);
  const strategy = stratSnap.exists() ? stratSnap.data() : {};
  const styleMult = styleToMultipliers(strategy.styleAlloc);
  const regime = strategy.macroRegime || "high_rates";
  const manualComposition = buildManualCompositionMap(etfHoldingsSnap);
  const acoesMap = buildAcoesMap(acoesSnap, manualComposition);
  const { openPositions } = aggregatePortfolioPositions(ativosSnap);

  let totalValue = 0, totalInvested = 0, totalScoreWeight = 0;
  const enriched = openPositions.map(p => {
    const rawTicker = cleanTicker(p.ticker);
    const canonical = canonicalTicker(rawTicker);
    const mkt = { ...(acoesMap.get(canonical) || acoesMap.get(rawTicker) || {}), ticker: canonical || rawTicker };
    const manual = manualComposition.get(canonical) || manualComposition.get(rawTicker);
    if (manual) Object.assign(mkt, manual);
    if (isKnownETF(mkt.ticker) || Array.isArray(mkt.holdings)) enrichETFAsset(mkt, acoesMap);
    const precoAtual = readAssetPrice(mkt) || Number(p.custoMedio || 0);
    const valAtual = Number(p.qtd || 0) * precoAtual;
    const v2 = scoreAssetV2(mkt, styleMult, regime);
    const legacy = calculateLucroMaximoScore(mkt);
    const assetType = getAssetType(rawTicker, mkt);
    totalValue += valAtual;
    totalInvested += Number(p.investido || 0);
    totalScoreWeight += v2.finalScore * valAtual;
    return { ...p, ticker: canonical || rawTicker, nome: p.nome || mkt.nome || rawTicker, setor: p.setor || normalizeSector(mkt) || "Outros", precoAtual, valAtual, score: v2.finalScore, legacyScore: legacy.score, grade: v2.grade, v2, mkt, category: assetType };
  }).filter(p => p.qtd > 0 && p.valAtual > 0);

  const assetAvg = totalValue > 0 ? totalScoreWeight / totalValue : 0;
  const diag = generateSmartDiagnosis(enriched, totalValue);
  const corr = correlationMatrix(enriched);
  const factors = portfolioFactors(enriched, totalValue);
  const health = portfolioHealth(enriched, totalValue);
  const riskDecomp = portfolioRiskDecomposition(enriched, totalValue, corr.avgCorrelation);
  const riskContrib = riskContribution(enriched, totalValue);
  const wrChart = weightVsRiskChart(enriched, totalValue);
  const stress = stressTest(enriched, totalValue);
  const themes = thematicExposure(enriched, totalValue);
  const dna = portfolioDNA(enriched, totalValue);
  const economicDrivers = calculateEconomicDrivers(enriched, totalValue);
  const etfOverlap = analyzeETFOverlap(enriched);
  const rebalance = rebalanceSuggestions(enriched, totalValue, { riskContrib });
  const portfolioObs = generatePortfolioObservations({ health, correlation: corr, stressTest: stress, factors, dna, etfOverlap });
  const analysis = { corr, factors, health, riskDecomp, riskContrib, wrChart, stress, themes, dna, economicDrivers, etfOverlap, rebalance, portfolioObs };
  const scoreV2 = calculatePortfolioScoreV2({ assetAvg, diag, analysis, enriched });
  const narrative = buildIntegratedNarrative({ totalValue, totalInvested, enriched, diag, scoreV2, analysis });
  return { totalValue, totalInvested, enriched, diag, scoreV2, analysis, narrative, strategy };
}

function buildIntegratedNarrative(data) {
  const { totalValue, totalInvested, enriched, diag, scoreV2, analysis } = data;
  const profit = totalValue - totalInvested;
  const profitPct = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;
  const top = [...enriched].sort((a, b) => b.valAtual - a.valAtual)[0];
  const topPct = top && totalValue > 0 ? (top.valAtual / totalValue) * 100 : 0;
  const worst = analysis.stress?.worstCase;
  const dnaName = analysis.dna?.primary?.name || "carteira personalizada";
  const summary = [
    `A carteira tem perfil ${dnaName}, com score integrado de ${scoreV2.total.toFixed(0)}/100.`,
    `O resultado acumulado esta em ${fmtEUR(profit)} (${pct(profitPct)}), com patrimonio atual de ${fmtEUR(totalValue)}.`
  ];
  if (top) summary.push(`A maior posicao e ${top.ticker}, com cerca de ${pct(topPct)} da carteira.`);
  if (worst) summary.push(`No pior stress test, a perda estimada e ${fmtEUR(worst.estimatedLoss)} (${worst.portfolioDropPct}%).`);

  const risks = [ ...(diag.risks || []), ...(analysis.health?.warnings || []), ...(analysis.corr?.warnings || []), ...(analysis.etfOverlap?.warnings || []) ];
  const actions = [ ...(diag.actions || []), ...(analysis.rebalance?.actions || []).map(a => a.reason || a.suggestion).filter(Boolean), ...(analysis.portfolioObs || []).map(o => o.msg) ];
  return {
    summary: dedupeText(summary).slice(0, 4),
    strengths: dedupeText([...(diag.forces || []), `Saude estrutural: ${analysis.health?.classification || "n/d"}.`, `Resiliencia: ${analysis.stress?.summary || "n/d"}.`]).slice(0, 4),
    risks: dedupeText(risks).slice(0, 5),
    actions: dedupeText(actions).slice(0, 6)
  };
}
function dedupeText(items) {
  const seen = new Set();
  return items.map(x => String(x || "").replace(/[\u{1F300}-\u{1FAFF}]/gu, "").trim()).filter(Boolean).filter(x => {
    const key = x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generatePortfolioReport(options = {}) {
  const modal = document.getElementById("reportModal");
  const content = document.getElementById("reportContent");
  const loader = document.getElementById("reportLoader");
  const autoExport = Boolean(options.autoExport);
  if (modal && content && !autoExport) {
    modal.classList.remove("hidden");
    content.innerHTML = "";
    if (loader) content.appendChild(loader);
  }
  try {
    await ensureReportLibs();
    const data = await buildCombinedReportData();
    if (autoExport || !modal || !content) {
      await exportPortfolioToPDF(data);
      return data;
    }
    content.innerHTML = renderReportUI(data);
    initReportCharts(data.enriched, data.diag);
    const btn = document.getElementById("btnReportPrint");
    if (btn) btn.onclick = () => exportPortfolioToPDF(data);
    return data;
  } catch (err) {
    console.error(err);
    if (content) content.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Erro: ${err.message}</div>`;
    else if (window.showToast) window.showToast("Erro ao gerar PDF: " + err.message, "error");
    throw err;
  }
}

function renderReportUI(data) {
  const { totalValue, totalInvested, scoreV2, diag, enriched, analysis, narrative } = data;
  const globalProfit = totalValue - totalInvested;
  const globalProfitPct = totalInvested > 0 ? (globalProfit / totalInvested) * 100 : 0;
  const resilience = analysis.riskDecomp?.resilienceScore ?? analysis.stress?.resilience ?? 0;
  return `
    <style>
      .report-v2 { font-family: 'Inter', sans-serif; color: #1e293b; background: #f8fafc; padding: 0; }
      .header-v2 { background: #1e293b; color: white; padding: 25px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center; }
      .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; padding: 20px; }
      .kpi-card { background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center; }
      .kpi-val { font-size: 1.1rem; font-weight: 800; display: block; color: #0f172a; }
      .kpi-lbl { font-size: 0.65rem; color: #64748b; text-transform: uppercase; font-weight: 700; }
      .main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 0 20px 20px 20px; }
      .section-v2 { background: white; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; }
      .title-v2 { font-size: 0.85rem; font-weight: 800; text-transform: uppercase; color: #1e293b; margin-bottom: 15px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
      .chart-container { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; padding: 20px; background: white; margin: 0 20px 20px 20px; border-radius: 12px; border: 1px solid #e2e8f0; }
      .chart-box { height: 260px; text-align: center; }
      .report-list { margin: 0; padding-left: 18px; display: grid; gap: 8px; font-size: 0.8rem; line-height: 1.35; }
      .pill-soft { display:inline-block; padding:2px 7px; border-radius:4px; background:#f1f5f9; font-size:0.65rem; font-weight:800; }
      @media (max-width: 850px) { .chart-container { grid-template-columns: 1fr; gap: 30px; } .chart-box { height: 300px; } .kpi-row { grid-template-columns: repeat(2, 1fr); } .main-grid { grid-template-columns: 1fr; } }
      @media (max-width: 480px) { .kpi-row { grid-template-columns: 1fr; } .header-v2 { flex-direction: column; text-align: center; gap: 15px; padding: 20px; } .section-v2 { padding: 15px; } .chart-container { margin: 0 10px 20px 10px; padding: 15px; } .kpi-row, .main-grid { padding: 15px; } }
    </style>
    <div class="report-v2">
      <div class="header-v2"><div><h1 style="margin:0; font-size:1.5rem;">APPFinance</h1><p style="margin:0; opacity:0.7; font-size:0.8rem;">Relatorio integrado: Portfolio Intelligence + Investimento</p></div><img src="icons/icon-192.png" style="width:45px; filter: brightness(0) invert(1);"></div>
      <div class="kpi-row">
        <div class="kpi-card"><span class="kpi-lbl">Patrimonio</span><span class="kpi-val">${fmtEUR(totalValue)}</span></div>
        <div class="kpi-card"><span class="kpi-lbl">Investido</span><span class="kpi-val">${fmtEUR(totalInvested)}</span></div>
        <div class="kpi-card"><span class="kpi-lbl">Resultado</span><span class="kpi-val" style="color:${globalProfit>=0?'#22c55e':'#ef4444'}">${fmtEUR(globalProfit)} (${pct(globalProfitPct)})</span></div>
        <div class="kpi-card" style="border-left: 4px solid #4f46e5;"><span class="kpi-lbl" style="color:#4f46e5;">Score integrado</span><span class="kpi-val" style="color:#4f46e5;">${scoreV2.total.toFixed(0)}/100</span></div>
      </div>
      <div class="main-grid">
        <div class="section-v2"><div class="title-v2">Leitura integrada</div><ul class="report-list">${narrative.summary.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>
        <div class="section-v2"><div class="title-v2">O que fazer agora</div><ul class="report-list">${(narrative.actions.length ? narrative.actions : ["Manter acompanhamento mensal e reforcar apenas onde a tese continua valida."]).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>
      </div>
      <div class="chart-container"><div class="chart-box"><canvas id="chartStrat"></canvas><div class="kpi-lbl">Estrategia</div></div><div class="chart-box"><canvas id="chartAssets"></canvas><div class="kpi-lbl">Principais ativos</div></div><div class="chart-box"><canvas id="chartSectors"></canvas><div class="kpi-lbl">Setores</div></div></div>
      <div class="main-grid">
        <div class="section-v2"><div class="title-v2">Portfolio Intelligence</div><div style="display:grid; gap:12px;">${Object.entries(scoreV2.breakdown).map(([k,v]) => `<div><div style="display:flex; justify-content:space-between; font-size:0.7rem; font-weight:700; margin-bottom:3px;"><span style="text-transform:uppercase;">${escapeHtml(k)}</span><span>${v.toFixed(0)}%</span></div><div style="height:6px; background:#f1f5f9; border-radius:3px; overflow:hidden;"><div style="width:${clamp(v)}%; height:100%; background:#4f46e5;"></div></div></div>`).join('')}</div><div style="margin-top:14px; font-size:0.78rem; color:#475569;">Saude: <strong>${escapeHtml(analysis.health?.classification || "n/d")}</strong> | Resiliencia: <strong>${resilience}/100</strong> | Correlacao media: <strong>${Number(analysis.corr?.avgCorrelation || 0).toFixed(2)}</strong></div></div>
        <div class="section-v2"><div class="title-v2">Riscos principais</div><ul class="report-list">${(narrative.risks.length ? narrative.risks : ["Sem alertas criticos nos motores estruturais."]).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>
      </div>
      <div class="main-grid">
        <div class="section-v2"><div class="title-v2">Stress test</div><div style="font-size:0.75rem; display:grid; gap:7px;">${CRISES_HISTORY.map(c => `<div style="display:flex; justify-content:space-between; padding-bottom:4px; border-bottom:1px solid #f8fafc;"><span>${escapeHtml(c.name)}</span><span style="color:#ef4444; font-weight:700;">-${fmtEUR(totalValue * c.drop / 100)}</span></div>`).join('')}</div></div>
        <div class="section-v2"><div class="title-v2">Exposicoes</div><div style="font-size:0.78rem; display:grid; gap:8px;"><div>CORE: <strong>${pct(diag.corePct)}</strong> | Satellite: <strong>${pct(diag.satPct)}</strong> | Cripto: <strong>${pct(diag.cryPct)}</strong></div><div>DNA: <strong>${escapeHtml(analysis.dna?.primary?.name || "Personalizado")}</strong></div><div>Temas principais: <strong>${topEntries(analysis.themes, 3).map(x => x[0]).join(", ") || "n/d"}</strong></div><div>Drivers economicos: <strong>${topEntries(analysis.economicDrivers, 3).map(x => x[0]).join(", ") || "n/d"}</strong></div></div></div>
      </div>
      <div class="section-v2" style="margin: 0 20px 20px 20px;"><div class="title-v2">Detalhamento do portfolio</div><div style="overflow-x: auto;"><table style="width:100%; min-width: 650px; border-collapse:collapse; font-size:0.75rem;"><thead><tr style="text-align:left; color:#64748b; background:#f8fafc;"><th style="padding:8px;">Ativo</th><th>Tipo</th><th>Investido</th><th>Atual</th><th>Resultado</th><th>Score</th></tr></thead><tbody>${portfolioRows(enriched).map(p => `<tr style="border-top:1px solid #f1f5f9;"><td style="padding:8px;"><strong>${escapeHtml(p.ticker)}</strong><br><span style="font-size:0.6rem; color:#94a3b8;">${escapeHtml(p.nome)}</span></td><td><span class="pill-soft">${escapeHtml(p.category.toUpperCase())}</span></td><td>${fmtEUR(p.investido)}</td><td>${fmtEUR(p.valAtual)}</td><td style="color:${(p.valAtual-p.investido)>=0?'#22c55e':'#ef4444'}">${pct(positionProfitPct(p))}</td><td><strong>${p.score.toFixed(0)}</strong> <span style="color:#94a3b8;">${escapeHtml(p.grade || "")}</span></td></tr>`).join('')}</tbody></table></div></div>
    </div>`;
}

function normalizeRadarSector(raw) {
  const s = String(raw || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (s.includes("tech") || s.includes("tecnolog") || s.includes("information")) return "Tecnologia";
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
    const type = getAssetType(p.ticker, p.mkt || p);
    const etfSectors = normalizeSectorComposition(p.mkt?._etfSectors || p.mkt?.sectors || p._etfSectors);
    if (type === "etf" && etfSectors?.length) {
      etfSectors.forEach(row => { out[row.sector] = (out[row.sector] || 0) + portfolioWeight * row.weight; });
      return;
    }
    const sector = normalizeRadarSector(p.mkt?.setor || p.mkt?.sector || p.setor || p.category);
    out[sector] = (out[sector] || 0) + portfolioWeight;
  });
  return out;
}
function drawPolarRosePDF(canvas, labels, portData, benchData, benchLabel) {
  const W0 = canvas.width, H0 = canvas.height;
  const ctx = canvas.getContext("2d");
  const cx = W0 / 2, cy = H0 / 2;
  const MARGIN = 72;
  const R = Math.min(W0, H0) / 2 - MARGIN;
  if (R < 40) return;

  const RING_PCTS = [1, 3, 10, 30, 100];
  const LOG_DENOM = Math.log10(101);
  const toR = v => v > 0 ? (Math.log10(v + 1) / LOG_DENOM) * R : 0;
  const n    = labels.length;
  const step = (Math.PI * 2) / (n * 2);
  const barW = step * 0.86;
  const gapH = step * 0.14;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W0, H0);

  for (const pct of RING_PCTS) {
    const r = toR(pct);
    if (r < 2) continue;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(148,163,184,0.35)"; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(148,163,184,0.25)"; ctx.lineWidth = 1; ctx.stroke();

  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * 2 * step - gapH / 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    ctx.strokeStyle = "rgba(148,163,184,0.22)"; ctx.lineWidth = 0.8; ctx.stroke();
  }

  const C = { port: "rgba(20,184,166,0.82)", bench: "rgba(239,100,80,0.82)", portB: "rgba(20,184,166,1)", benchB: "rgba(239,100,80,1)" };
  for (let i = 0; i < n; i++) {
    const base = -Math.PI / 2 + i * 2 * step;
    const r1 = toR(portData[i]);
    if (r1 > 1.5) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r1, base + gapH / 2, base + barW + gapH / 2); ctx.closePath();
      ctx.fillStyle = C.port; ctx.fill(); ctx.strokeStyle = C.portB; ctx.lineWidth = 0.8; ctx.stroke();
    }
    const r2 = toR(benchData[i]);
    if (r2 > 1.5) {
      const ba = base + step;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r2, ba + gapH / 2, ba + barW + gapH / 2); ctx.closePath();
      ctx.fillStyle = C.bench; ctx.fill(); ctx.strokeStyle = C.benchB; ctx.lineWidth = 0.8; ctx.stroke();
    }
  }

  ctx.textBaseline = "bottom"; ctx.textAlign = "right";
  const lblAngle = -Math.PI / 2 - 0.08;
  for (const pct of RING_PCTS) {
    const r = toR(pct);
    if (r < 12) continue;
    ctx.font = `700 ${r < 50 ? 12 : 13}px sans-serif`; ctx.fillStyle = "#94a3b8";
    ctx.fillText(`${pct}%`, cx + r * Math.cos(lblAngle), cy + r * Math.sin(lblAngle) - 1);
  }

  ctx.font = "800 13px sans-serif"; ctx.fillStyle = "#475569"; ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const midAngle = -Math.PI / 2 + i * 2 * step + step;
    const lx = cx + (R + 28) * Math.cos(midAngle);
    const ly = cy + (R + 28) * Math.sin(midAngle);
    ctx.save(); ctx.translate(lx, ly);
    let rot = midAngle + Math.PI / 2;
    const nr = ((rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (nr > Math.PI / 2 && nr < Math.PI * 1.5) rot += Math.PI;
    ctx.rotate(rot); ctx.textAlign = "center";
    ctx.fillText(labels[i].length > 10 ? labels[i].slice(0, 9) + "…" : labels[i], 0, 0);
    ctx.restore();
  }

  const LX = 18, LY = H0 - 46, SW = 16, SH = 12;
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = "700 14px sans-serif";
  ctx.fillStyle = C.port; ctx.fillRect(LX, LY, SW, SH);
  ctx.fillStyle = "#475569"; ctx.fillText("Portfólio", LX + SW + 7, LY + SH / 2);
  ctx.fillStyle = C.bench; ctx.fillRect(LX, LY + 19, SW, SH);
  ctx.fillStyle = "#475569"; ctx.fillText(benchLabel, LX + SW + 7, LY + 19 + SH / 2);
}
function sectorBarConfig(portfolioWeights) {
  const labels = SECTOR_RADAR_LABELS;
  const myData = labels.map(l => Math.round((portfolioWeights[l] || 0) * 10) / 10);
  const sp500Data = labels.map(l => SECTOR_BENCHMARKS.sp500.weights[l] || 0);
  const berkData = labels.map(l => SECTOR_BENCHMARKS.berkshire.weights[l] || 0);
  return {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Meu portfólio", data: myData, backgroundColor: "rgba(79,70,229,0.80)", borderColor: "#4f46e5", borderWidth: 1, borderRadius: 3 },
        { label: "S&P 500", data: sp500Data, backgroundColor: "rgba(148,163,184,0.70)", borderColor: "#94a3b8", borderWidth: 1, borderRadius: 3 },
        { label: "Berkshire", data: berkData, backgroundColor: "rgba(245,158,11,0.70)", borderColor: "#f59e0b", borderWidth: 1, borderRadius: 3 }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: false,
      animation: false,
      devicePixelRatio: 1.5,
      layout: { padding: { left: 10, right: 30, top: 10, bottom: 10 } },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 16, padding: 18, font: { size: 20, weight: "bold" } } }
      },
      scales: {
        x: { ticks: { callback: v => `${v}%`, font: { size: 16 } }, grid: { color: "#e2e8f0" }, max: 50 },
        y: { ticks: { font: { size: 15, weight: "700" } }, grid: { display: false } }
      }
    }
  };
}
function seededRandom(seed = 42) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function estimateReturn(asset) {
  const raw = Number(asset?.mkt?.priceChange_1y ?? asset?.mkt?.taxaCrescimento_1ano ?? 0);
  const r = Math.abs(raw) > 1 ? raw / 100 : raw;
  return Number.isFinite(r) ? Math.max(-0.60, Math.min(r, 1.50)) : 0.06;
}
function estimateVol(asset) {
  const type = getAssetType(asset.ticker, asset.mkt || asset);
  const r1mRaw = Number(asset?.mkt?.priceChange_1m ?? 0);
  const r1m = Math.abs(r1mRaw) > 1 ? r1mRaw / 100 : r1mRaw;
  const shortVol = Math.abs(r1m) * Math.sqrt(12);
  if (type === "crypto") return Math.min(Math.max(0.75, shortVol), 0.90);
  const r1yRaw = Number(asset?.mkt?.priceChange_1y ?? asset?.mkt?.taxaCrescimento_1ano ?? 0);
  const r1y = Math.abs(r1yRaw) > 1 ? r1yRaw / 100 : r1yRaw;
  const rAbs = Math.abs(Number.isFinite(r1y) ? r1y : 0);
  let base;
  if (type === "etf") {
    base = rAbs > 0.40 ? 0.28 : rAbs > 0.20 ? 0.18 : 0.13;
  } else {
    base = rAbs > 0.60 ? 0.48 : rAbs > 0.35 ? 0.33 : rAbs > 0.15 ? 0.25 : 0.20;
  }
  return Math.min(Math.max(base, shortVol), 0.90);
}
function computeReportEfficientFrontier(enriched, corrObj, simulations = 1200) {
  const portfolio = enriched.filter(p => Number(p.valAtual || 0) > 0).slice(0, 18);
  const n = portfolio.length;
  if (n < 2) return null;
  const rand = seededRandom(8122);
  const returns = portfolio.map(estimateReturn);
  const vols = portfolio.map(estimateVol);
  const matrix = corrObj?.matrix || {};
  const getCorr = (i, j) => {
    if (i === j) return 1;
    const a = portfolio[i].ticker, b = portfolio[j].ticker;
    const v = matrix[a]?.[b] ?? matrix[b]?.[a];
    return Number.isFinite(v) ? v : 0.35;
  };
  const portReturn = w => w.reduce((sum, wi, i) => sum + wi * returns[i], 0);
  const portVol = w => {
    let variance = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) variance += w[i] * w[j] * vols[i] * vols[j] * getCorr(i, j);
    return Math.sqrt(Math.max(0, variance));
  };
  const cappedWeights = raw => {
    const cap = Math.max(0.30, 1 / n);
    let w = [...raw];
    for (let iter = 0; iter < 80; iter++) {
      if (!w.some(v => v > cap + 1e-9)) break;
      w = w.map(v => Math.min(v, cap));
      const s = w.reduce((a, b) => a + b, 0) || 1;
      w = w.map(v => v / s);
    }
    return w;
  };
  const randomWeights = () => {
    const raw = Array.from({ length: n }, () => -Math.log(rand() + 1e-10));
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    return cappedWeights(raw.map(v => v / sum));
  };
  const sims = [];
  let best = null;
  for (let i = 0; i < simulations; i++) {
    const w = randomWeights();
    const ret = portReturn(w);
    const vol = portVol(w);
    const sharpe = vol > 0 ? (ret - 0.03) / vol : 0;
    const row = { x: vol * 100, y: ret * 100, sharpe };
    sims.push(row);
    if (!best || sharpe > best.sharpe) best = { ...row, weights: w };
  }
  const total = portfolio.reduce((sum, p) => sum + Number(p.valAtual || 0), 0) || 1;
  const currentW = portfolio.map(p => Number(p.valAtual || 0) / total);
  const currentVol = portVol(currentW), currentRet = portReturn(currentW);
  return { sims, best, current: { x: currentVol * 100, y: currentRet * 100, sharpe: currentVol > 0 ? (currentRet - 0.03) / currentVol : 0 } };
}
function frontierConfig(frontier) {
  return {
    type: "scatter",
    data: { datasets: [
      { label: "Carteiras simuladas", data: frontier.sims, parsing: false, pointRadius: 2, pointBackgroundColor: "rgba(79,70,229,0.32)", pointBorderWidth: 0 },
      { label: "Carteira atual", data: [frontier.current], pointRadius: 6, pointBackgroundColor: "#8b5cf6", pointBorderColor: "#ffffff", pointBorderWidth: 2 },
      { label: "Sharpe maximo", data: [frontier.best], pointRadius: 6, pointStyle: "rectRot", pointBackgroundColor: "#06b6d4", pointBorderColor: "#ffffff", pointBorderWidth: 2 }
    ] },
    options: { responsive: false, animation: false, devicePixelRatio: 1.5, layout: { padding: 10 }, plugins: { legend: { position: "bottom", labels: { boxWidth: 14, padding: 18, font: { size: 22, weight: "bold" } } }, tooltip: { enabled: false } }, scales: { x: { title: { display: true, text: "Risco / volatilidade anualizada (%)", font: { size: 20, weight: "bold" } }, ticks: { font: { size: 17 } }, grid: { color: "#e2e8f0" } }, y: { title: { display: true, text: "Retorno historico anualizado (%)", font: { size: 20, weight: "bold" } }, ticks: { font: { size: 17 } }, grid: { color: "#e2e8f0" } } } }
  };
}
function initReportCharts(enriched, diag) {
  if (!window.Chart) return;
  Object.values(chartInstances).forEach(c => c?.destroy?.());
  chartInstances = {};
  const config = (labels, data) => doughnutConfig(labels, data, true);
  chartInstances.strat = new Chart(document.getElementById('chartStrat'), config(['CORE', 'SATELLITE', 'CRYPTO'], [diag.corePct, diag.satPct, diag.cryPct]));
  const topA = portfolioRows(enriched).slice(0, 5);
  chartInstances.assets = new Chart(document.getElementById('chartAssets'), config(topA.map(a=>a.ticker), topA.map(a=>a.valAtual)));
  const sKeys = Object.keys(diag.sectors).sort((a,b)=>diag.sectors[b]-diag.sectors[a]).slice(0,5);
  chartInstances.sectors = new Chart(document.getElementById('chartSectors'), config(sKeys, sKeys.map(k=>diag.sectors[k])));
}
function doughnutConfig(labels, data, showLegend = true) {
  const total = data.reduce((a, b) => a + Number(b || 0), 0) || 1;
  return { type: 'doughnut', data: { labels: labels.map((l, i) => `${l}: ${pct((Number(data[i] || 0) / total) * 100)}`), datasets: [{ data, backgroundColor: REPORT_COLORS, borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: true, animation: false, cutout: '70%', plugins: { legend: { display: showLegend, position: 'bottom', labels: { boxWidth: 18, font: { size: 28, weight: 'bold' }, padding: 12 } } } } };
}
function canvasToJpeg(chart, quality = 0.92) {
  const c = chart.canvas;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.restore();
  return c.toDataURL('image/jpeg', quality);
}
async function buildChartImages(data) {
  if (!window.Chart) return {};
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1200px;min-height:900px;display:flex;gap:20px;flex-wrap:wrap;background:#fff;";
  document.body.appendChild(wrap);
  const makeCanvas = (w = 360, h = 330) => { const c = document.createElement("canvas"); c.width = w; c.height = h; c.style.width = `${w}px`; c.style.height = `${h}px`; wrap.appendChild(c); return c; };
  const charts = [];
  try {
    const topA = portfolioRows(data.enriched).slice(0, 5);
    const sKeys = Object.keys(data.diag.sectors).sort((a,b)=>data.diag.sectors[b]-data.diag.sectors[a]).slice(0,5);
    charts.push(new Chart(makeCanvas(340, 420), doughnutConfig(['CORE', 'SATELLITE', 'CRYPTO'], [data.diag.corePct, data.diag.satPct, data.diag.cryPct], true)));
    charts.push(new Chart(makeCanvas(340, 420), doughnutConfig(topA.map(a=>a.ticker), topA.map(a=>a.valAtual), true)));
    charts.push(new Chart(makeCanvas(340, 420), doughnutConfig(sKeys, sKeys.map(k=>data.diag.sectors[k]), true)));

    const sectorWeights = portfolioSectorWeights(data.enriched, data.totalValue);
    const portRaw = SECTOR_RADAR_LABELS.map(l => Math.round((sectorWeights[l] || 0) * 10) / 10);
    const cSp500 = makeCanvas(520, 460);
    drawPolarRosePDF(cSp500, SECTOR_RADAR_LABELS, portRaw, SECTOR_RADAR_LABELS.map(l => SECTOR_BENCHMARKS.sp500.weights[l] || 0), SECTOR_BENCHMARKS.sp500.label);
    const cBerk = makeCanvas(520, 460);
    drawPolarRosePDF(cBerk, SECTOR_RADAR_LABELS, portRaw, SECTOR_RADAR_LABELS.map(l => SECTOR_BENCHMARKS.berkshire.weights[l] || 0), SECTOR_BENCHMARKS.berkshire.label);

    const frontier = computeReportEfficientFrontier(data.enriched, data.analysis?.corr);
    if (frontier) charts.push(new Chart(makeCanvas(900, 420), frontierConfig(frontier)));

    charts.push(new Chart(makeCanvas(900, 520), sectorBarConfig(sectorWeights)));

    await new Promise(resolve => setTimeout(resolve, 150));
    return {
      strat: charts[0] ? canvasToJpeg(charts[0]) : null,
      assets: charts[1] ? canvasToJpeg(charts[1]) : null,
      sectors: charts[2] ? canvasToJpeg(charts[2]) : null,
      sectorSp500: cSp500.toDataURL('image/jpeg', 0.92),
      sectorBerkshire: cBerk.toDataURL('image/jpeg', 0.92),
      frontier: charts[3] ? canvasToJpeg(charts[3]) : null,
      sectorBar: charts[4] ? canvasToJpeg(charts[4]) : null
    };
  } finally { charts.forEach(c => c?.destroy?.()); wrap.remove(); }
}
async function exportPortfolioToPDF(data) {
  await ensureReportLibs();
  const { totalValue, totalInvested, scoreV2, diag, enriched, analysis, narrative, strategy } = data;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'pt', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth(), pageHeight = doc.internal.pageSize.getHeight(), margin = 40;
  let currY = 0;
  const line = y => { doc.setDrawColor(241, 245, 249); doc.setLineWidth(1); doc.line(margin, y, pageWidth - margin, y); };
  const section = title => { doc.setFontSize(12); doc.setTextColor(30); doc.setFont("helvetica", "bold"); doc.text(title, margin, currY); currY += 10; line(currY); currY += 20; };
  const bulletList = (items, x, y, maxWidth, color = [70, 80, 95]) => { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...color); let yy = y; items.forEach(item => { const lines = doc.splitTextToSize(`- ${item}`, maxWidth); doc.text(lines, x, yy); yy += lines.length * 10 + 4; }); return yy; };

  doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 100, 'F');
  const logoB64 = await getBase64Image("icons/icon-192.png");
  if (logoB64) doc.addImage(logoB64, 'PNG', margin, 25, 50, 50);
  doc.setFontSize(22); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.text("APPFinance", margin + 65, 55);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(210); doc.text(`Relatorio integrado: Portfolio Intelligence + Investimento - ${new Date().toLocaleDateString("pt-PT")}`, margin + 65, 75);

  currY = 130; section("1. Resumo executivo");
  const globalProfit = totalValue - totalInvested;
  const globalProfitPct = totalInvested > 0 ? (globalProfit / totalInvested) * 100 : 0;
  const kpis = [
    { l: "PATRIMONIO", v: fmtEUR(totalValue) },
    { l: "INVESTIDO", v: fmtEUR(totalInvested) },
    { l: "RESULTADO", v: `${fmtEUR(globalProfit)} (${pct(globalProfitPct)})`, c: globalProfit >= 0 ? [34,197,94] : [239,68,68] },
    { l: "SCORE INTEGRADO", v: `${scoreV2.total.toFixed(0)}/100`, c: scoreV2.total >= 70 ? [34,197,94] : scoreV2.total < 40 ? [239,68,68] : [79,70,229] }
  ];
  let kX = margin;
  kpis.forEach(k => { doc.setFontSize(7); doc.setTextColor(120); doc.text(k.l, kX, currY); doc.setTextColor(...(k.c || [30,41,59])); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text(k.v, kX, currY + 12); kX += 130; });
  currY += 55;
  currY = bulletList(narrative.summary, margin, currY, pageWidth - margin * 2);

  currY += 15; section("2. Leitura combinada, sem duplicar sinais");
  const colW = (pageWidth - margin * 2 - 25) / 2;
  doc.setFontSize(9); doc.setTextColor(30); doc.setFont("helvetica", "bold"); doc.text("Riscos a acompanhar", margin, currY); doc.text("Acoes sugeridas", margin + colW + 25, currY);
  const leftY = bulletList(narrative.risks.length ? narrative.risks : ["Sem alertas criticos nos motores estruturais."], margin, currY + 16, colW);
  const rightY = bulletList(narrative.actions.length ? narrative.actions : ["Manter acompanhamento mensal e reforcar apenas onde a tese continua valida."], margin + colW + 25, currY + 16, colW);
  currY = Math.max(leftY, rightY) + 15;

  section("3. Alocacao visual");
  const chartImages = await buildChartImages(data);
  const imgW = 148, imgH = 185;
  const gap = Math.floor((pageWidth - margin * 2 - imgW * 3) / 2);
  const labels3 = ["Estrategia", "Principais ativos", "Setores"];
  [chartImages.strat, chartImages.assets, chartImages.sectors].forEach((img, i) => {
    if (!img) return;
    const x = margin + i * (imgW + gap);
    doc.addImage(img, 'JPEG', x, currY, imgW, imgH);
    doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(80);
    doc.text(labels3[i], x + imgW / 2, currY + imgH + 9, { align: "center" });
  });
  currY += imgH + 20;

  doc.addPage(); doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 40, 'F'); doc.setFontSize(10); doc.setTextColor(255); doc.text("4. Portfolio Intelligence", margin, 25); currY = 65;
  section("4.1 Saude, resiliencia e fatores");
  Object.entries(scoreV2.breakdown).forEach(([k, v], i) => { const y = currY + i * 16; doc.setFontSize(8); doc.setTextColor(80); doc.text(k.toUpperCase(), margin, y); doc.setFillColor(240); doc.rect(margin + 95, y - 6, 100, 5, 'F'); doc.setFillColor(79, 70, 229); doc.rect(margin + 95, y - 6, clamp(v), 5, 'F'); doc.text(`${v.toFixed(0)}%`, margin + 205, y); });
  const factorEntries = topEntries(analysis.factors, 6);
  bulletList([`Saude estrutural: ${analysis.health?.classification || "n/d"} (${analysis.health?.score || 0}/100).`, `Resiliencia a crises: ${analysis.riskDecomp?.resilienceScore ?? analysis.stress?.resilience ?? 0}/100.`, `Fatores dominantes: ${factorEntries.slice(0, 3).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ") || "n/d"}.`, `Correlacao media: ${Number(analysis.corr?.avgCorrelation || 0).toFixed(2)}.`], margin + 260, currY, pageWidth - margin - 260);

  currY += 115; section("4.2 Stress test em linguagem simples");
  const stressRows = Object.values(analysis.stress?.scenarios || {}).slice(0, 5).map(s => [s.name, `${s.portfolioDropPct}%`, fmtEUR(s.estimatedLoss), `${s.recoveryMonths || "-"} meses`]);
  doc.autoTable({ startY: currY, margin: { left: margin, right: margin }, head: [["Cenario", "Queda", "Perda estimada", "Recuperacao"]], body: stressRows, theme: 'striped', headStyles: { fillColor: [30, 41, 59] }, styles: { fontSize: 8 } });
  currY = doc.lastAutoTable.finalY + 25;

  section("4.3 Exposicoes e rebalanceamento");
  const availCash = Number(strategy?.availableCash || 0);
  const monthlyBase = Number(strategy?.monthlyBase || 0);
  bulletList([
    `CORE ${pct(diag.corePct)}, Satellite ${pct(diag.satPct)}, Cripto ${pct(diag.cryPct)}.`,
    `DNA principal: ${analysis.dna?.primary?.name || "Personalizado"}.`,
    `Resumo de rebalanceamento: ${analysis.rebalance?.summary || "n/d"}.`,
    availCash > 0 ? `Liquidez disponivel para alocar: ${fmtEUR(availCash)}.` : "Liquidez disponivel: nao configurada (define em Settings).",
    monthlyBase > 0 ? `Investimento mensal base (DCA): ${fmtEUR(monthlyBase)}/mes.` : null,
    monthlyBase > 0 && availCash > 0 ? `Com DCA de ${fmtEUR(monthlyBase)}/mes + liquidez de ${fmtEUR(availCash)}, tens ${fmtEUR(availCash + monthlyBase)} para redistribuir ja.` : null
  ].filter(Boolean), margin, currY, pageWidth - margin * 2);
  currY += monthlyBase > 0 ? 70 : 50;

  if (chartImages.frontier || chartImages.sectorSp500 || chartImages.sectorBerkshire) {
    doc.addPage();
    doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 40, 'F'); doc.setFontSize(10); doc.setTextColor(255); doc.text("5. Fronteira e benchmarks", margin, 25);
    currY = 65;
    if (chartImages.frontier) {
      section("5.1 Fronteira Eficiente");
      doc.addImage(chartImages.frontier, 'JPEG', margin, currY, pageWidth - margin * 2, 230);
      currY += 255;
      doc.setFontSize(8); doc.setTextColor(90); doc.text("Simulacao Monte Carlo com limite maximo de 30% por ativo. Retornos historicos nao sao promessa de retorno futuro.", margin, currY);
      currY += 25;
    }
    if (chartImages.sectorSp500 || chartImages.sectorBerkshire || chartImages.sectorBar) {
      section("5.2 Distancia setorial vs S&P 500 e Berkshire");
      const radarW = (pageWidth - margin * 2 - 20) / 2;
      if (chartImages.sectorSp500) doc.addImage(chartImages.sectorSp500, 'JPEG', margin, currY, radarW, 235);
      if (chartImages.sectorBerkshire) doc.addImage(chartImages.sectorBerkshire, 'JPEG', margin + radarW + 20, currY, radarW, 235);
      if (chartImages.sectorBar) {
        doc.addPage();
        doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 40, 'F');
        doc.setFontSize(10); doc.setTextColor(255); doc.text("5.3 Comparacao setorial detalhada", margin, 25);
        currY = 60;
        doc.addImage(chartImages.sectorBar, 'JPEG', margin, currY, pageWidth - margin * 2, 310);
        currY += 325;
        doc.setFontSize(7); doc.setTextColor(90); doc.text("Pesos setoriais do portfolio vs S&P 500 e Berkshire Hathaway. Escala maxima 50%.", margin, currY);
      }
    }
  }

  doc.addPage(); doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 40, 'F'); doc.setFontSize(10); doc.setTextColor(255); doc.text("6. Detalhamento do portfolio", margin, 25);
  doc.autoTable({
    startY: 60, margin: { left: margin, right: margin },
    head: [['Ativo', 'Tipo', 'Investido', 'Atual', 'Resultado', 'Score']],
    body: portfolioRows(enriched).map(p => [p.ticker, p.category.toUpperCase(), fmtEUR(p.investido), fmtEUR(p.valAtual), pct(positionProfitPct(p)), `${p.score.toFixed(0)} ${p.grade || ""}`]),
    theme: 'striped', headStyles: { fillColor: [30, 41, 59] }, styles: { fontSize: 8 }, columnStyles: { 4: { halign: 'right' }, 5: { halign: 'center' } },
    didParseCell: cellData => {
      if (cellData.section === 'body' && cellData.column.index === 4) { const val = parseFloat(cellData.cell.raw); if (val > 0) cellData.cell.styles.textColor = [34, 197, 94]; else if (val < 0) cellData.cell.styles.textColor = [239, 68, 68]; }
      if (cellData.section === 'body' && cellData.column.index === 5) { const val = parseInt(cellData.cell.raw, 10); if (val >= 70) cellData.cell.styles.textColor = [34, 197, 94]; else if (val < 40) cellData.cell.styles.textColor = [239, 68, 68]; else cellData.cell.styles.textColor = [234, 179, 8]; }
    }
  });
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(150); doc.text("APPFinance - Relatorio integrado gerado por motores quantitativos. Nao e aconselhamento financeiro.", margin, pageHeight - 20); doc.text(`${i}/${pages}`, pageWidth - margin, pageHeight - 20, { align: "right" }); }
  doc.save(`APPFinance_Relatorio_Integrado_${new Date().toISOString().slice(0,10)}.pdf`);
}

function portfolioRows(enriched) { return [...enriched].sort((a, b) => b.valAtual - a.valAtual); }
function positionProfitPct(p) { return Number(p.investido || 0) > 0 ? ((Number(p.valAtual || 0) - Number(p.investido || 0)) / Number(p.investido || 0)) * 100 : 0; }
function topEntries(obj, limit = 3) { if (!obj || typeof obj !== "object") return []; return Object.entries(obj).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => b[1] - a[1]).slice(0, limit); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }
const getBase64Image = async path => { try { const response = await fetch(path); const blob = await response.blob(); return new Promise(resolve => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.readAsDataURL(blob); }); } catch (e) { return null; } };
