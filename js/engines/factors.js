import { safeMetric, safePercent, clamp, getAssetCategory } from "../utils/normalize.js";

/**
 * FACTOR EXPOSURE ENGINE
 * Calculates portfolio tilt towards: Growth, Value, Quality, Momentum, Defensive, Cyclical.
 */

export function calculateFactors(asset) {
  const m = asset.mkt || asset;
  const cat = getAssetCategory(m);
  
  // 1. Growth Factor
  const epsG = safePercent(m, "epsYoY") || 0;
  const revG = safePercent(m, "sales_y_y_ttm", "revenue_growth") || 0;
  const growth = clamp((epsG * 0.6 + revG * 0.4) * 4, 0, 100); // 25% growth = 100 score

  // 2. Value Factor (Inverse of multiples)
  const pe = safeMetric(m, "pe") || 25;
  const pb = safeMetric(m, "p_b") || 3;
  const vScorePE = clamp(100 - (pe * 2), 0, 100);
  const vScorePB = clamp(100 - (pb * 15), 0, 100);
  const value = (vScorePE + vScorePB) / 2;

  // 3. Quality Factor
  const roic = safePercent(m, "roic") || 0.10;
  const margin = safePercent(m, "profit_margin") || 0.10;
  const debt = safeMetric(m, "debt_eq") || 1;
  const qScoreROIC = clamp(roic * 400, 0, 100); // 25% ROIC = 100
  const qScoreDebt = clamp(100 - (debt * 30), 0, 100);
  const quality = (qScoreROIC * 0.6 + qScoreDebt * 0.4);

  // 4. Momentum Factor
  const y1 = safePercent(m, "priceChange_1y") || 0;
  const rsi = safeMetric(m, "rsi_14") || 50;
  const momentum = clamp((y1 * 2) + (rsi - 50), 0, 100);

  // 5. Defensive vs Cyclical
  const beta = safeMetric(m, "beta") || 1;
  const defensive = clamp(100 - (beta * 60), 0, 100);
  const cyclical = clamp(beta * 50, 0, 100);

  // Adjustment for ETFs: Broad ETFs are neutral on factors unless specified
  let multiplier = 1.0;
  if (cat === "Broad Market ETF") multiplier = 0.5;

  return {
    growth: Math.round(growth * multiplier),
    value: Math.round(value * multiplier),
    quality: Math.round(quality * multiplier),
    momentum: Math.round(momentum * multiplier),
    defensive: Math.round(defensive * multiplier),
    cyclical: Math.round(cyclical * multiplier)
  };
}

/**
 * Portfolio-level factor exposure.
 */
export function portfolioFactors(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) return null;

  const results = { growth: 0, value: 0, quality: 0, momentum: 0, defensive: 0, cyclical: 0 };
  let totalWeight = 0;

  for (const p of portfolio) {
    const w = (p.valAtual || 0) / totalValue;
    const f = calculateFactors(p);
    
    results.growth += f.growth * w;
    results.value += f.value * w;
    results.quality += f.quality * w;
    results.momentum += f.momentum * w;
    results.defensive += f.defensive * w;
    results.cyclical += f.cyclical * w;
    totalWeight += w;
  }

  // Normalize to 100 scale
  return {
    growth: Math.round(results.growth),
    value: Math.round(results.value),
    quality: Math.round(results.quality),
    momentum: Math.round(results.momentum),
    defensive: Math.round(results.defensive),
    cyclical: Math.round(results.cyclical)
  };
}
