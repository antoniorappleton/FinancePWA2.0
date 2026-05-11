import { safeMetric, safePercent, clamp, getAssetCategory } from "../utils/normalize.js";

/**
 * FACTOR EXPOSURE ENGINE
 * Calculates portfolio tilt towards: Growth, Value, Quality, Momentum, Defensive, Cyclical.
 */

export function calculateFactors(asset) {
  const m = asset.mkt || asset;
  const cat = getAssetCategory(m);
  
  // 1. Growth Factor
  // Try multiple keys for EPS and Revenue growth
  let epsG = safePercent(m, "epsYoY", "eps_yoy", "eps_growth", "earnings_growth") || NaN;
  let revG = safePercent(m, "sales_y_y_ttm", "revenue_growth", "sales_yoy", "revenue_growth_yoy") || NaN;
  
  // Fallback for ETFs or missing fundamental data: use price growth as a proxy for Growth factor
  if (isNaN(epsG) || isNaN(revG)) {
    const priceG = safePercent(m, "priceChange_1y", "taxaCrescimento_1ano", "g1y", "price_1y_ago_pct") || 0;
    if (isNaN(epsG)) epsG = priceG;
    if (isNaN(revG)) revG = priceG;
  }

  // 25% growth (0.25) * 400 = 100 score
  const growth = clamp((epsG * 0.6 + revG * 0.4) * 400, 0, 100); 

  // 2. Value Factor (Inverse of multiples)
  const pe = safeMetric(m, "pe", "p_e", "forward_pe", "forward_p_e", "PE") || 25;
  const pb = safeMetric(m, "p_b", "pb_ratio", "price_to_book", "P/B", "p_b_ratio") || 3;
  const vScorePE = clamp(100 - (pe * 2), 0, 100);
  const vScorePB = clamp(100 - (pb * 15), 0, 100);
  const value = (vScorePE + vScorePB) / 2;

  // 3. Quality Factor
  const roic = safePercent(m, "roic", "return_on_capital", "return_on_invested_capital") || 0.10;
  const margin = safePercent(m, "profit_margin", "operating_margin", "gross_margin", "net_margin") || 0.10;
  const debt = safeMetric(m, "debt_eq", "debt_to_equity", "d_e", "debt_equity") || 1;
  const qScoreROIC = clamp(roic * 400, 0, 100); // 25% ROIC = 100
  const qScoreDebt = clamp(100 - (debt * 30), 0, 100);
  const quality = (qScoreROIC * 0.6 + qScoreDebt * 0.4);

  // 4. Momentum Factor
  const y1 = safePercent(m, "priceChange_1y", "taxaCrescimento_1ano", "g1y", "price_1y_ago_pct", "price_change_1y") || 0;
  const rsi = safeMetric(m, "rsi_14", "rsi") || 50;
  // Normalize: 25% price growth = 50 points, RSI relative to 50 = up to 50 points
  const momentum = clamp((y1 * 200) + (rsi - 50), 0, 100);

  // 5. Defensive vs Cyclical
  const beta = safeMetric(m, "beta") || 1;
  const defensive = clamp(100 - (beta * 60), 0, 100);
  const cyclical = clamp(beta * 50, 0, 100);

  // Adjustment for ETFs: Broad ETFs are neutral on factors unless specified
  let multiplier = 1.0;
  if (cat === "Broad Market ETF") multiplier = 0.75; // Increased from 0.5 to be less aggressive

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
