import { safeMetric, safePercent, clamp, getAssetCategory } from "../utils/normalize.js";

/**
 * FACTOR EXPOSURE ENGINE
 * D8.6: ETFs → look-through from sector composition. Stocks → fundamentals only; null when unavailable.
 */

// Sector factor priors for ETF look-through (D8.6)
// growth/value/quality: 0–100 scores; beta: raw (used to derive defensive/cyclical)
const SECTOR_FACTOR_PRIORS = {
  // PT canonical
  "Tecnologia":        { growth: 70, value: 20, quality: 65, beta: 1.25 },
  "Saúde":             { growth: 50, value: 45, quality: 70, beta: 0.75 },
  "Financeiros":       { growth: 35, value: 55, quality: 45, beta: 1.05 },
  "Energia":           { growth: 30, value: 60, quality: 40, beta: 1.10 },
  "Consumo Cíclico":   { growth: 55, value: 35, quality: 50, beta: 1.20 },
  "Consumo Defensivo": { growth: 25, value: 50, quality: 60, beta: 0.60 },
  "Industriais":       { growth: 40, value: 45, quality: 55, beta: 1.10 },
  "Materiais":         { growth: 30, value: 50, quality: 45, beta: 1.00 },
  "Imobiliário":       { growth: 25, value: 55, quality: 50, beta: 0.85 },
  "Comunicações":      { growth: 40, value: 40, quality: 50, beta: 0.90 },
  "Utilidades":        { growth: 15, value: 55, quality: 55, beta: 0.50 },
  "Commodities":       { growth: 25, value: 55, quality: 35, beta: 1.05 },
  "Aeroespacial":      { growth: 60, value: 25, quality: 50, beta: 1.35 },
  // EN keys — as stored in ETF_HOLDINGS.sectors and therefore in _etfSectors
  "Technology":             { growth: 70, value: 20, quality: 65, beta: 1.25 },
  "Information Technology": { growth: 70, value: 20, quality: 65, beta: 1.25 },
  "Healthcare":             { growth: 50, value: 45, quality: 70, beta: 0.75 },
  "Health Care":            { growth: 50, value: 45, quality: 70, beta: 0.75 },
  "Industrials":            { growth: 40, value: 45, quality: 55, beta: 1.10 },
  "Consumer Cyclical":      { growth: 55, value: 35, quality: 50, beta: 1.20 },
  "Consumer Discretionary": { growth: 55, value: 35, quality: 50, beta: 1.20 },
  "Consumer Defensive":     { growth: 25, value: 50, quality: 60, beta: 0.60 },
  "Consumer Staples":       { growth: 25, value: 50, quality: 60, beta: 0.60 },
  "Financials":             { growth: 35, value: 55, quality: 45, beta: 1.05 },
  "Financial Services":     { growth: 35, value: 55, quality: 45, beta: 1.05 },
  "Energy":                 { growth: 30, value: 60, quality: 40, beta: 1.10 },
  "Materials":              { growth: 30, value: 50, quality: 45, beta: 1.00 },
  "Basic Materials":        { growth: 30, value: 50, quality: 45, beta: 1.00 },
  "Real Estate":            { growth: 25, value: 55, quality: 50, beta: 0.85 },
  "Communication Services": { growth: 40, value: 40, quality: 50, beta: 0.90 },
  "Telecom":                { growth: 40, value: 40, quality: 50, beta: 0.90 },
  "Utilities":              { growth: 15, value: 55, quality: 55, beta: 0.50 },
};

// Fallback when ETF has no _etfSectors — coarse category-based priors
const CATEGORY_ETF_PRIORS = {
  "Broad Market ETF": { growth: 45, value: 45, quality: 55, beta: 1.00 },
  "Thematic ETF":     { growth: 60, value: 25, quality: 50, beta: 1.20 },
  "Bond ETF":         { growth: 15, value: 70, quality: 65, beta: 0.20 },
  "Sector ETF":       { growth: 45, value: 45, quality: 50, beta: 1.05 },
  "Commodity ETF":    { growth: 25, value: 60, quality: 35, beta: 0.90 },
};

const _FALLBACK_PRIOR = { growth: 40, value: 45, quality: 50, beta: 1.00 };

function _priorsFromSectors(etfSectors) {
  const total = Object.values(etfSectors).reduce((a, b) => a + Number(b), 0) || 100;
  let wG = 0, wV = 0, wQ = 0, wB = 0, wSum = 0;
  for (const [sec, pct] of Object.entries(etfSectors)) {
    const w = Number(pct) / total;
    const p = SECTOR_FACTOR_PRIORS[sec] || _FALLBACK_PRIOR;
    wG += p.growth * w; wV += p.value * w; wQ += p.quality * w; wB += p.beta * w; wSum += w;
  }
  if (wSum === 0) return null;
  const beta = wB / wSum;
  return {
    growth:    Math.round(wG / wSum),
    value:     Math.round(wV / wSum),
    quality:   Math.round(wQ / wSum),
    defensive: Math.round(clamp(100 - beta * 60, 0, 100)),
    cyclical:  Math.round(clamp(beta * 50, 0, 100)),
  };
}

export function calculateFactors(asset) {
  const m = asset.mkt || asset;
  const cat = getAssetCategory(m);

  // Momentum — price is always observable, valid for all asset types
  const y1  = safePercent(m, "priceChange_1y", "taxaCrescimento_1ano", "g1y", "price_1y_ago_pct", "price_change_1y") || 0;
  const rsi = safeMetric(m, "rsi_14", "rsi");
  const momentum = Math.round(clamp((y1 * 200) + (isFinite(rsi) ? (rsi - 50) : 0), 0, 100));

  // --- ETF: look-through from sector composition (D8.6) ---
  if (cat.includes("ETF")) {
    let priors = null;
    if (m._etfSectors && typeof m._etfSectors === "object" && Object.keys(m._etfSectors).length > 0) {
      priors = _priorsFromSectors(m._etfSectors);
    }
    if (!priors) priors = CATEGORY_ETF_PRIORS[cat] || null;
    if (!priors) {
      return {
        growth: null, value: null, quality: null, momentum,
        defensive: null, cyclical: null,
        available: { growth: false, value: false, quality: false, momentum: true, defensive: false, cyclical: false }
      };
    }
    return {
      growth: priors.growth, value: priors.value, quality: priors.quality,
      momentum,
      defensive: priors.defensive, cyclical: priors.cyclical,
      available: { growth: true, value: true, quality: true, momentum: true, defensive: true, cyclical: true }
    };
  }

  // --- Stock: fundamental data only; null when unavailable (D8.6) ---

  // 1. Growth
  const epsG = safePercent(m, "epsYoY", "eps_yoy", "eps_growth", "earnings_growth");
  const revG = safePercent(m, "sales_y_y_ttm", "revenue_growth", "sales_yoy", "revenue_growth_yoy");
  const hasGrowth = isFinite(epsG) || isFinite(revG);
  const growth = hasGrowth
    ? Math.round(clamp(((isFinite(epsG) ? epsG : 0) * 0.6 + (isFinite(revG) ? revG : 0) * 0.4) * 400, 0, 100))
    : null;

  // 2. Value
  const pe = safeMetric(m, "pe", "p_e", "forward_pe", "forward_p_e", "PE");
  const pb = safeMetric(m, "p_b", "pb_ratio", "price_to_book", "P/B", "p_b_ratio");
  const hasPE = isFinite(pe) && pe > 0;
  const hasPB = isFinite(pb) && pb > 0;
  const value = (hasPE || hasPB)
    ? Math.round(((hasPE ? clamp(100 - (pe * 2), 0, 100) : 50) + (hasPB ? clamp(100 - (pb * 15), 0, 100) : 50)) / 2)
    : null;

  // 3. Quality
  const roic = safePercent(m, "roic", "return_on_capital", "return_on_invested_capital");
  const debt = safeMetric(m, "debt_eq", "debt_to_equity", "d_e", "debt_equity");
  const hasQuality = isFinite(roic) || isFinite(debt);
  const quality = hasQuality
    ? Math.round((isFinite(roic) ? clamp(roic * 400, 0, 100) : 50) * 0.6 + (isFinite(debt) ? clamp(100 - (debt * 30), 0, 100) : 50) * 0.4)
    : null;

  // 4. Defensive / Cyclical
  const beta = safeMetric(m, "beta");
  const hasBeta = isFinite(beta) && beta > 0;
  const defensive = hasBeta ? Math.round(clamp(100 - (beta * 60), 0, 100)) : null;
  const cyclical  = hasBeta ? Math.round(clamp(beta * 50, 0, 100)) : null;

  return {
    growth, value, quality, momentum, defensive, cyclical,
    available: { growth: growth !== null, value: value !== null, quality: quality !== null,
                 momentum: true, defensive: hasBeta, cyclical: hasBeta }
  };
}

/**
 * Portfolio-level factor exposure — weighted average over assets with data.
 */
export function portfolioFactors(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) return null;

  const results = { growth: 0, value: 0, quality: 0, momentum: 0, defensive: 0, cyclical: 0 };
  const weights = { growth: 0, value: 0, quality: 0, momentum: 0, defensive: 0, cyclical: 0 };

  for (const p of portfolio) {
    const w = (p.valAtual || 0) / totalValue;
    const f = calculateFactors(p);
    for (const k of ["growth", "value", "quality", "momentum", "defensive", "cyclical"]) {
      if (f[k] !== null && f[k] !== undefined) {
        results[k] += f[k] * w;
        weights[k] += w;
      }
    }
  }

  const safe = (k) => weights[k] > 0 ? Math.round(results[k] / weights[k]) : null;
  return {
    growth:    safe("growth"),
    value:     safe("value"),
    quality:   safe("quality"),
    momentum:  safe("momentum"),
    defensive: safe("defensive"),
    cyclical:  safe("cyclical")
  };
}
