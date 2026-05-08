import { safeMetric, clamp, getAssetCategory, HEALTHY_LIMITS, canonicalTicker } from "../utils/normalize.js";
import { normalizeSector } from "../utils/scoring.js";

/**
 * Generate rebalancing suggestions.
 */
export function rebalanceSuggestions(portfolio, totalValue, options = {}) {
  if (!portfolio || portfolio.length === 0) {
    return { actions: [], summary: "Portfólio vazio", estimatedImpact: {} };
  }

  const total = Math.max(totalValue, 1);
  const actions = [];

  // ── 1. Aggregate positions by canonical ticker (Deduplication) ──
  const aggregated = {};
  for (const p of portfolio) {
    const ticker = canonicalTicker(p.ticker);
    if (!aggregated[ticker]) {
      aggregated[ticker] = { 
        ticker, 
        valAtual: 0, 
        originalTickers: new Set(),
        category: getAssetCategory(p.mkt || p),
        score: p.score || 50,
        mkt: p.mkt || p
      };
    }
    aggregated[ticker].valAtual += (p.valAtual || 0);
    aggregated[ticker].originalTickers.add(p.ticker);
  }

  const positions = Object.values(aggregated).sort((a, b) => b.valAtual - a.valAtual);
  
  // ── 2. Detect over-concentrated positions with contextual limits ──
  for (const p of positions) {
    const weight = p.valAtual / total;
    const limit = HEALTHY_LIMITS[p.category] || 0.10;
    
    // Threshold for alerts: 1.2x the healthy limit
    if (weight > limit * 1.2) {
      const targetVal = limit * total;
      const reduce = p.valAtual - targetVal;
      const priority = (weight > limit * 1.5) ? "high" : "medium";
      
      actions.push({
        type: "reduce",
        ticker: p.ticker,
        category: p.category,
        currentPct: Math.round(weight * 100),
        targetPct: Math.round(limit * 100),
        amount: Math.round(reduce),
        reason: `${p.ticker} (${p.category}) acima do limite ideal de ${Math.round(limit * 100)}%.`,
        priority
      });
    }
  }

  // ── 3. Detect sector over-concentration (Excluding Broad ETFs) ──
  const sectorMap = {};
  for (const p of positions) {
    if (p.category === "Broad Market ETF") continue; // Broad ETFs don't contribute to sector concentration risk
    
    const s = normalizeSector(p.mkt) || "Outros";
    if (!sectorMap[s]) sectorMap[s] = { total: 0, assets: [] };
    sectorMap[s].total += p.valAtual;
    sectorMap[s].assets.push(p);
  }

  const SECTOR_LIMIT = 0.35; // 35% max per specific sector
  for (const [sector, data] of Object.entries(sectorMap)) {
    const weight = data.total / total;
    if (weight > SECTOR_LIMIT) {
      const weakest = data.assets.sort((a, b) => a.score - b.score)[0];
      actions.push({
        type: "sector_reduce",
        ticker: weakest.ticker,
        sector,
        currentSectorPct: Math.round(weight * 100),
        reason: `Concentração setorial em "${sector}" (${Math.round(weight * 100)}%). Reduzir exposição.`,
        priority: "medium"
      });
    }
  }

  // ── 4. Core/Satellite Diversification Check ──
  const coreExposure = positions
    .filter(p => p.category === "Broad Market ETF")
    .reduce((s, p) => s + (p.valAtual / total), 0);

  if (coreExposure < 0.30 && positions.length > 3) {
    actions.push({
      type: "add",
      reason: "Exposição CORE baixa (< 30%). O portfólio carece de uma âncora diversificada.",
      suggestion: "Considerar aumentar exposição a ETFs Broad Market (VWCE, VUSA).",
      priority: "medium"
    });
  }

  // ── 5. Risk-based suggestions (using riskContrib if available) ──
  if (options.riskContrib) {
    const topRisk = options.riskContrib.contributions?.[0];
    if (topRisk && topRisk.riskContribution > 30) {
      actions.push({
        type: "risk_reduce",
        ticker: topRisk.ticker,
        reason: `${topRisk.ticker} contribui desproporcionalmente para o risco (${topRisk.riskContribution.toFixed(0)}%).`,
        priority: "high"
      });
    }
  }

  // ── 6. Capital deployment ──
  const totalReduce = actions
    .filter(a => a.type === "reduce" || a.type === "sector_reduce")
    .reduce((s, a) => s + (a.amount || 0), 0);

  // ── Summary Logic (Core/Satellite Aware) ──
  const highCount = actions.filter(a => a.priority === "high").length;
  let summary;
  
  if (actions.length === 0) {
    summary = "✅ Portfólio perfeitamente equilibrado.";
  } else if (highCount >= 1) {
    summary = "🔴 Rebalanceamento estratégico sugerido para reduzir riscos estruturais.";
  } else if (actions.length >= 3) {
    summary = "🟡 Ajustes recomendados para otimização de pesos.";
  } else {
    summary = "🟢 Portfólio globalmente saudável com pequenos ajustes opcionais.";
  }

  return {
    actions: actions.sort((a, b) => (a.priority === "high" ? -1 : 1)),
    summary,
    estimatedImpact: { capitalToRedeploy: Math.round(totalReduce) }
  };
}

