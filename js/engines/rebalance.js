// js/engines/rebalance.js
// ═══════════════════════════════════════════════════════════════════
// SMART REBALANCING ENGINE
// Suggests: reduce concentration, optimize risk, maintain thematic thesis.
// Goal: rebalance without destroying the structural thesis.
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, clamp } from "../utils/normalize.js";
import { normalizeSector } from "../utils/scoring.js";

const MAX_SINGLE = 0.10;    // 10% max per position
const MAX_SECTOR = 0.30;    // 30% max per sector
const TARGET_COUNT = 12;    // Target number of positions

/**
 * Generate rebalancing suggestions.
 * @param {Array} portfolio - Array of { ticker, valAtual, mkt, score? }
 * @param {number} totalValue
 * @param {Object} [options]
 * @param {Object} [options.targetAlloc] - User's target sector/class allocation
 * @param {Object} [options.riskContrib] - Risk contribution analysis results
 * @returns {{ actions: Array, summary: string, estimatedImpact: Object }}
 */
export function rebalanceSuggestions(portfolio, totalValue, options = {}) {
  if (!portfolio || portfolio.length === 0) {
    return { actions: [], summary: "Portfólio vazio", estimatedImpact: {} };
  }

  const total = Math.max(totalValue, 1);
  const actions = [];

  // ── 1. Detect over-concentrated positions ──
  const sorted = [...portfolio].sort((a, b) => (b.valAtual || 0) - (a.valAtual || 0));
  
  for (const p of sorted) {
    const pct = (p.valAtual || 0) / total;
    const ticker = String(p.ticker || "").toUpperCase();

    if (pct > MAX_SINGLE * 1.5) {
      const targetVal = MAX_SINGLE * total;
      const reduce = (p.valAtual || 0) - targetVal;
      actions.push({
        type: "reduce",
        ticker,
        currentPct: Math.round(pct * 100),
        targetPct: Math.round(MAX_SINGLE * 100),
        amount: Math.round(reduce),
        reason: `Concentração excessiva (${(pct * 100).toFixed(1)}% > ${MAX_SINGLE * 100}% máx.)`,
        priority: "high"
      });
    } else if (pct > MAX_SINGLE) {
      const targetVal = MAX_SINGLE * total;
      const reduce = (p.valAtual || 0) - targetVal;
      actions.push({
        type: "trim",
        ticker,
        currentPct: Math.round(pct * 100),
        targetPct: Math.round(MAX_SINGLE * 100),
        amount: Math.round(reduce),
        reason: `Ligeiramente acima do limite (${(pct * 100).toFixed(1)}%)`,
        priority: "medium"
      });
    }
  }

  // ── 2. Detect sector over-concentration ──
  const sectorMap = {};
  portfolio.forEach(p => {
    const s = normalizeSector(p.mkt || p) || "Outros";
    if (!sectorMap[s]) sectorMap[s] = { total: 0, assets: [] };
    sectorMap[s].total += p.valAtual || 0;
    sectorMap[s].assets.push({ ticker: String(p.ticker || "").toUpperCase(), val: p.valAtual || 0 });
  });

  for (const [sector, data] of Object.entries(sectorMap)) {
    const pct = data.total / total;
    if (pct > MAX_SECTOR) {
      // Suggest reducing the lowest-scored asset in this sector
      const sectorAssets = data.assets.sort((a, b) => {
        const scoreA = portfolio.find(p => String(p.ticker || "").toUpperCase() === a.ticker)?.score || 50;
        const scoreB = portfolio.find(p => String(p.ticker || "").toUpperCase() === b.ticker)?.score || 50;
        return scoreA - scoreB;
      });
      
      const weakest = sectorAssets[0];
      if (weakest) {
        actions.push({
          type: "sector_reduce",
          ticker: weakest.ticker,
          sector,
          currentSectorPct: Math.round(pct * 100),
          targetSectorPct: Math.round(MAX_SECTOR * 100),
          reason: `Setor "${sector}" sobreexposto (${(pct * 100).toFixed(0)}%). Reduzir posição mais fraca.`,
          priority: "medium"
        });
      }
    }
  }

  // ── 3. Detect under-diversification ──
  if (portfolio.length < 5) {
    actions.push({
      type: "add",
      reason: `Portfólio com apenas ${portfolio.length} posições — adicionar diversificação`,
      suggestion: "Considerar ETF de base ampla (ex: VWCE, IWDA) para diversificação imediata",
      priority: "high"
    });
  }

  // ── 4. Risk-based suggestions ──
  if (options.riskContrib) {
    const topRisk = options.riskContrib.contributions?.[0];
    if (topRisk && topRisk.riskContribution > 25) {
      actions.push({
        type: "risk_reduce",
        ticker: topRisk.ticker,
        riskPct: topRisk.riskContribution,
        weightPct: topRisk.weight,
        reason: `${topRisk.ticker} contribui ${topRisk.riskContribution.toFixed(1)}% do risco total com apenas ${topRisk.weight.toFixed(1)}% do peso`,
        priority: "high"
      });
    }
  }

  // ── 5. Freed capital deployment suggestion ──
  const totalReduce = actions
    .filter(a => a.type === "reduce" || a.type === "trim")
    .reduce((s, a) => s + (a.amount || 0), 0);

  if (totalReduce > 0) {
    // Suggest where to deploy freed capital
    const underweightSectors = Object.entries(sectorMap)
      .filter(([s, d]) => (d.total / total) < 0.05 && s !== "—" && s !== "Outros")
      .map(([s]) => s);

    if (underweightSectors.length > 0) {
      actions.push({
        type: "deploy",
        amount: Math.round(totalReduce),
        reason: `Capital libertado: ~${totalReduce.toLocaleString()}€. Considerar reforçar setores sub-representados: ${underweightSectors.join(", ")}`,
        priority: "low"
      });
    }
  }

  // ── Sort by priority ──
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

  // ── Summary ──
  const highCount = actions.filter(a => a.priority === "high").length;
  let summary;
  if (actions.length === 0) summary = "✅ Portfólio bem equilibrado — sem ações de rebalanceamento necessárias.";
  else if (highCount >= 3) summary = "🔴 Rebalanceamento urgente — múltiplas posições acima dos limites.";
  else if (highCount >= 1) summary = "🟡 Ajustes recomendados — concentração detetada.";
  else summary = "🟢 Ajustes menores sugeridos — portfólio globalmente saudável.";

  return {
    actions,
    summary,
    actionCount: actions.length,
    highPriorityCount: highCount,
    estimatedImpact: {
      capitalToRedeploy: Math.round(totalReduce),
      positionsToAdjust: new Set(actions.filter(a => a.ticker).map(a => a.ticker)).size
    }
  };
}
