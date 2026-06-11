import { getAssetCategory, HEALTHY_LIMITS, canonicalTicker } from "../utils/normalize.js";
import { normalizeSector } from "../utils/scoring.js";

/**
 * Generate rebalancing suggestions.
 */
export function rebalanceSuggestions(portfolio, totalValue, options = {}) {
  if (!portfolio || portfolio.length === 0) {
    return { actions: [], summary: "Portfolio vazio", estimatedImpact: {} };
  }

  const total = Math.max(totalValue, 1);
  const actions = [];

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

  for (const p of positions) {
    const weight = p.valAtual / total;
    const limit = HEALTHY_LIMITS[p.category] || 0.10;

    if (weight > limit * 1.2) {
      const targetVal = limit * total;
      const reduce = p.valAtual - targetVal;
      const priority = weight > limit * 1.5 ? "high" : "medium";

      actions.push({
        type: "reduce",
        ticker: p.ticker,
        category: p.category,
        currentPct: Math.round(weight * 100),
        targetPct: Math.round(limit * 100),
        amount: Math.round(reduce),
        reason: `${p.ticker} (${p.category}) acima do intervalo ideal de ${Math.round(limit * 100)}%.`,
        priority
      });
    }
  }

  const sectorMap = {};
  for (const p of positions) {
    if (p.category === "Broad Market ETF") continue;

    const s = normalizeSector(p.mkt) || "Outros";
    if (!sectorMap[s]) sectorMap[s] = { total: 0, assets: [] };
    sectorMap[s].total += p.valAtual;
    sectorMap[s].assets.push(p);
  }

  const SECTOR_LIMIT = 0.35;
  for (const [sector, data] of Object.entries(sectorMap)) {
    const weight = data.total / total;
    if (weight > SECTOR_LIMIT) {
      const weakest = data.assets.sort((a, b) => a.score - b.score)[0];
      actions.push({
        type: "sector_reduce",
        ticker: weakest.ticker,
        sector,
        currentSectorPct: Math.round(weight * 100),
        reason: `Concentracao setorial em "${sector}" (${Math.round(weight * 100)}%). Reduzir exposicao marginal.`,
        priority: "medium"
      });
    }
  }

  const coreExposure = positions
    .filter(p => p.category === "Broad Market ETF")
    .reduce((s, p) => s + (p.valAtual / total), 0);

  if (coreExposure < 0.30 && positions.length > 3) {
    actions.push({
      type: "add",
      reason: "Exposicao CORE baixa (< 30%). O portfolio carece de uma ancora diversificada.",
      suggestion: "Considerar aumentar exposicao a ETFs Broad Market (VWCE, VUSA).",
      priority: "medium"
    });
  }

  if (options.riskContrib) {
    const topRisk = options.riskContrib.contributions?.[0];
    if (topRisk?.isDisproportionate && topRisk.riskContribution > 30) {
      actions.push({
        type: "risk_reduce",
        ticker: topRisk.ticker,
        reason: `${topRisk.ticker} contribui para o risco acima do seu peso (${topRisk.riskContribution.toFixed(0)}% do risco vs ${topRisk.weight.toFixed(0)}% do valor).`,
        priority: "high"
      });
    } else if (topRisk && topRisk.category !== "Broad Market ETF" && topRisk.riskContribution > 45) {
      actions.push({
        type: "risk_reduce",
        ticker: topRisk.ticker,
        reason: `${topRisk.ticker} concentra ${topRisk.riskContribution.toFixed(0)}% do risco estimado. Validar se o peso continua alinhado com a tese.`,
        priority: "medium"
      });
    }
  }

  const totalReduce = actions
    .filter(a => a.type === "reduce" || a.type === "sector_reduce")
    .reduce((s, a) => s + (a.amount || 0), 0);

  const highCount = actions.filter(a => a.priority === "high").length;
  let summary;

  if (actions.length === 0) {
    summary = "Portfolio equilibrado. Sem rebalanceamento obrigatorio.";
  } else if (highCount >= 1) {
    summary = "Rebalanceamento recomendado para reduzir riscos desproporcionais.";
  } else if (actions.length >= 3) {
    summary = "Ajustes recomendados para otimizar pesos e exposicoes.";
  } else {
    summary = "Portfolio globalmente saudavel, com pequenos ajustes opcionais.";
  }

  return {
    actions: actions.sort((a, b) => (a.priority === "high" ? -1 : 1)),
    summary,
    estimatedImpact: { capitalToRedeploy: Math.round(totalReduce) }
  };
}
