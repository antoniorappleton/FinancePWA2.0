// js/engines/factors.js
// ═══════════════════════════════════════════════════════════════════
// FACTOR EXPOSURE ENGINE
// Calculates real portfolio exposure to investment factors:
// Growth, Value, Quality, Momentum, Small Cap, Defensive, Cyclical
// "Este portfólio está 72% exposto a Growth e 58% a Momentum."
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, safePercent, clamp, isValid } from "../utils/normalize.js";

// ── Factor classification rules ──

function classifyGrowth(asset) {
  const epsNext = safePercent(asset, "epsNextY", "eps_next_y");
  const eps5y   = safePercent(asset, "eps_next_5y", "eps_growth_5y");
  const sales   = safePercent(asset, "sales_y_y_ttm", "revenue_growth");
  
  let score = 0, count = 0;
  if (isFinite(epsNext)) { score += epsNext > 0.15 ? 1.0 : epsNext > 0.08 ? 0.6 : epsNext > 0 ? 0.3 : 0; count++; }
  if (isFinite(eps5y))   { score += eps5y > 0.12 ? 1.0 : eps5y > 0.06 ? 0.6 : eps5y > 0 ? 0.3 : 0; count++; }
  if (isFinite(sales))   { score += sales > 0.15 ? 1.0 : sales > 0.08 ? 0.6 : sales > 0 ? 0.3 : 0; count++; }
  
  return count > 0 ? score / count : 0.3;
}

function classifyValue(asset) {
  const pe   = safeMetric(asset, "pe", "p_e");
  const peg  = safeMetric(asset, "peg");
  const pfcf = safeMetric(asset, "p_fcf");
  const pb   = safeMetric(asset, "p_b");
  
  let score = 0, count = 0;
  if (isFinite(pe) && pe > 0)   { score += pe < 12 ? 1.0 : pe < 20 ? 0.6 : pe < 30 ? 0.3 : 0.1; count++; }
  if (isFinite(peg) && peg > 0) { score += peg < 1 ? 1.0 : peg < 1.5 ? 0.6 : peg < 2.5 ? 0.3 : 0.1; count++; }
  if (isFinite(pfcf) && pfcf > 0) { score += pfcf < 12 ? 1.0 : pfcf < 20 ? 0.6 : 0.2; count++; }
  if (isFinite(pb) && pb > 0)   { score += pb < 1.5 ? 1.0 : pb < 3 ? 0.5 : 0.1; count++; }
  
  return count > 0 ? score / count : 0.3;
}

function classifyQuality(asset) {
  const roic = safePercent(asset, "roic");
  const roe  = safePercent(asset, "roe");
  const gm   = safePercent(asset, "gross_margin");
  const om   = safePercent(asset, "oper_margin");
  const de   = safeMetric(asset, "debt_eq");
  
  let score = 0, count = 0;
  if (isFinite(roic)) { score += roic > 0.15 ? 1.0 : roic > 0.10 ? 0.6 : roic > 0 ? 0.3 : 0; count++; }
  if (isFinite(roe))  { score += roe > 0.20 ? 1.0 : roe > 0.12 ? 0.6 : roe > 0 ? 0.3 : 0; count++; }
  if (isFinite(gm))   { score += gm > 0.40 ? 1.0 : gm > 0.25 ? 0.6 : gm > 0.10 ? 0.3 : 0; count++; }
  if (isFinite(om))   { score += om > 0.20 ? 1.0 : om > 0.10 ? 0.6 : om > 0 ? 0.3 : 0; count++; }
  if (isFinite(de))   { score += de < 0.5 ? 1.0 : de < 1.0 ? 0.7 : de < 2 ? 0.4 : 0.1; count++; }
  
  return count > 0 ? score / count : 0.3;
}

function classifyMomentum(asset) {
  const w1 = safePercent(asset, "priceChange_1w", "g1w");
  const m1 = safePercent(asset, "priceChange_1m", "g1m");
  const y1 = safePercent(asset, "priceChange_1y", "g1y");
  const price = safeMetric(asset, "valorStock", "price");
  const sma50 = safeMetric(asset, "sma50");
  const sma200 = safeMetric(asset, "sma200");
  
  let score = 0, count = 0;
  if (isFinite(m1)) { score += m1 > 0.05 ? 1.0 : m1 > 0 ? 0.5 : 0.1; count++; }
  if (isFinite(y1)) { score += y1 > 0.15 ? 1.0 : y1 > 0 ? 0.5 : 0.1; count++; }
  if (isFinite(price) && isFinite(sma200) && sma200 > 0) {
    score += price > sma200 ? 0.8 : 0.2; count++;
  }
  if (isFinite(price) && isFinite(sma50) && sma50 > 0) {
    score += price > sma50 ? 0.7 : 0.3; count++;
  }
  
  return count > 0 ? score / count : 0.3;
}

function classifyDefensive(asset) {
  const beta = safeMetric(asset, "beta");
  const dy   = safePercent(asset, "yield");
  const de   = safeMetric(asset, "debt_eq");
  const sector = String(asset.setor || asset.sector || "").toLowerCase();
  
  let score = 0, count = 0;
  if (isFinite(beta)) { score += beta < 0.7 ? 1.0 : beta < 1.0 ? 0.6 : 0.2; count++; }
  if (isFinite(dy))   { score += dy > 0.03 ? 0.8 : dy > 0.01 ? 0.5 : 0.2; count++; }
  if (isFinite(de))   { score += de < 0.8 ? 0.8 : de < 1.5 ? 0.5 : 0.2; count++; }
  
  // Sector bonus
  const defSectors = ["consumer defensive", "consumo defensivo", "utilities", "healthcare", "saúde"];
  if (defSectors.some(s => sector.includes(s))) { score += 0.8; count++; }
  
  return count > 0 ? score / count : 0.3;
}

function classifyCyclical(asset) {
  const beta = safeMetric(asset, "beta");
  const sector = String(asset.setor || asset.sector || "").toLowerCase();
  
  let score = 0, count = 0;
  if (isFinite(beta)) { score += beta > 1.3 ? 1.0 : beta > 1.0 ? 0.6 : 0.2; count++; }
  
  const cycSectors = ["consumer cyclical", "consumo cíclico", "industrials", "industriais", "materials", "materiais", "energy", "energia"];
  if (cycSectors.some(s => sector.includes(s))) { score += 0.8; count++; }
  
  return count > 0 ? score / count : 0.3;
}

// ══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════

/**
 * Calculate factor exposure for a portfolio.
 * @param {Array} portfolio - Array of { asset, weight } where weight is 0-1
 * @returns {{ factors: Object, dominant: string, description: string }}
 */
export function factorExposure(portfolio) {
  if (!portfolio || portfolio.length === 0) {
    return { factors: {}, dominant: "Unknown", description: "Portfólio vazio" };
  }

  const factors = {
    growth:    0,
    value:     0,
    quality:   0,
    momentum:  0,
    defensive: 0,
    cyclical:  0
  };

  let totalWeight = 0;

  for (const { asset, weight } of portfolio) {
    const w = weight || (1 / portfolio.length);
    totalWeight += w;

    factors.growth    += classifyGrowth(asset) * w;
    factors.value     += classifyValue(asset) * w;
    factors.quality   += classifyQuality(asset) * w;
    factors.momentum  += classifyMomentum(asset) * w;
    factors.defensive += classifyDefensive(asset) * w;
    factors.cyclical  += classifyCyclical(asset) * w;
  }

  // Normalize to percentages (0-100)
  if (totalWeight > 0) {
    for (const k of Object.keys(factors)) {
      factors[k] = Math.round((factors[k] / totalWeight) * 100);
    }
  }

  // Find dominant factor
  const sorted = Object.entries(factors).sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0]?.[0] || "balanced";
  const secondary = sorted[1]?.[0] || "";

  // Description
  const labels = {
    growth: "Crescimento", value: "Valor", quality: "Qualidade",
    momentum: "Momentum", defensive: "Defensivo", cyclical: "Cíclico"
  };

  const description = `Portfólio ${labels[dominant] || dominant}` +
    (sorted[1] && sorted[1][1] > sorted[0][1] * 0.8
      ? ` com forte componente ${labels[secondary] || secondary}`
      : "");

  return { factors, dominant, secondary, description, ranking: sorted };
}

/**
 * Classify a single asset's factor profile.
 */
export function assetFactorProfile(asset) {
  return {
    growth:    Math.round(classifyGrowth(asset) * 100),
    value:     Math.round(classifyValue(asset) * 100),
    quality:   Math.round(classifyQuality(asset) * 100),
    momentum:  Math.round(classifyMomentum(asset) * 100),
    defensive: Math.round(classifyDefensive(asset) * 100),
    cyclical:  Math.round(classifyCyclical(asset) * 100)
  };
}
