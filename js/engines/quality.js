import { safeMetric, safePercent, clamp, isValid, confidenceScore, getAssetCategory } from "../utils/normalize.js";

// ── Sector-aware thresholds ──
const SECTOR_PROFILES = {
  "Technology":         { roicTarget: 0.20, marginTarget: 0.25, debtCeiling: 1.0 },
  "Tecnologia":         { roicTarget: 0.20, marginTarget: 0.25, debtCeiling: 1.0 },
  "Healthcare":         { roicTarget: 0.15, marginTarget: 0.20, debtCeiling: 1.2 },
  "Saúde":              { roicTarget: 0.15, marginTarget: 0.20, debtCeiling: 1.2 },
  "Financials":         { roicTarget: 0.10, marginTarget: 0.15, debtCeiling: 5.0 },
  "Financeiros":        { roicTarget: 0.10, marginTarget: 0.15, debtCeiling: 5.0 },
  "Energy":             { roicTarget: 0.12, marginTarget: 0.15, debtCeiling: 1.5 },
  "Energia":            { roicTarget: 0.12, marginTarget: 0.15, debtCeiling: 1.5 },
  "Consumer Cyclical":  { roicTarget: 0.15, marginTarget: 0.12, debtCeiling: 1.5 },
  "Consumo Cíclico":    { roicTarget: 0.15, marginTarget: 0.12, debtCeiling: 1.5 },
  "Consumer Defensive": { roicTarget: 0.12, marginTarget: 0.15, debtCeiling: 1.0 },
  "Consumo Defensivo":  { roicTarget: 0.12, marginTarget: 0.15, debtCeiling: 1.0 },
  "Industrials":        { roicTarget: 0.12, marginTarget: 0.12, debtCeiling: 1.5 },
  "Industriais":        { roicTarget: 0.12, marginTarget: 0.12, debtCeiling: 1.5 },
  "Real Estate":        { roicTarget: 0.08, marginTarget: 0.20, debtCeiling: 3.0 },
  "Imobiliário":        { roicTarget: 0.08, marginTarget: 0.20, debtCeiling: 3.0 },
  default:              { roicTarget: 0.12, marginTarget: 0.15, debtCeiling: 1.5 }
};

function getSectorProfile(asset) {
  const sector = asset.setor || asset.sector || asset.Setor || asset.Sector || "";
  return SECTOR_PROFILES[sector] || SECTOR_PROFILES.default;
}

// ── ETF Quality Model (Diversification, TER, Tracking) ──
function scoreETFQuality(asset) {
  const ter = safePercent(asset, "ter", "expense_ratio");
  const holdings = safeMetric(asset, "holdings_count", "num_holdings");
  const cat = getAssetCategory(asset);

  let total = 0, count = 0;

  // 1. TER Score (0.0% to 1.0%)
  if (isFinite(ter)) {
    let s;
    if (ter <= 0.0010) s = 1.0;      // 0.10% (Exceptional)
    else if (ter <= 0.0025) s = 0.85; // 0.25% (Good)
    else if (ter <= 0.0050) s = 0.6;  // 0.50% (Average)
    else if (ter <= 0.0080) s = 0.3;  // 0.80% (Expensive)
    else s = 0.05;
    total += s * 0.4; count += 0.4;
  }

  // 2. Diversification Score
  if (isFinite(holdings)) {
    let s;
    if (cat === "Broad Market ETF") {
      s = holdings > 1500 ? 1.0 : holdings > 500 ? 0.8 : holdings > 100 ? 0.5 : 0.2;
    } else {
      s = holdings > 100 ? 1.0 : holdings > 50 ? 0.8 : holdings > 20 ? 0.5 : 0.2;
    }
    total += s * 0.4; count += 0.4;
  }

  // 3. Category Premium
  const catScore = cat === "Broad Market ETF" ? 0.9 : cat === "Sector ETF" ? 0.7 : 0.6;
  total += catScore * 0.2; count += 0.2;

  const raw = count > 0 ? total / count : 0.6;
  return { 
    score: Math.round(raw * 100), 
    classification: raw > 0.8 ? "Institutional Grade ETF" : raw > 0.6 ? "Quality ETF" : "Niche / High Cost ETF" 
  };
}

// ── Sub-scores (each 0–1) ──

function scoreROIC(asset, profile) {
  const roic = safePercent(asset, "roic", "return_on_capital", "ROIC", "return_on_invested_capital");
  if (!isFinite(roic)) return { score: 0.5, available: false };
  const target = profile.roicTarget;
  let s;
  if (roic >= target * 1.5) s = 1.0;       // Exceptional
  else if (roic >= target) s = 0.8;          // Strong
  else if (roic >= target * 0.5) s = 0.5;   // Average
  else if (roic > 0) s = 0.25;              // Below average
  else s = 0.05;                             // Destroying value
  return { score: s, value: roic, available: true };
}

function scoreMargins(asset, profile) {
  const gross = safePercent(asset, "gross_margin", "grossMargin");
  const oper  = safePercent(asset, "oper_margin", "operMargin", "operating_margin");
  const net   = safePercent(asset, "profit_margin", "profitMargin", "net_margin", "net_profit_margin", "lucro_liquido_margem");
  
  let total = 0, count = 0;
  const breakdown = {};

  if (isFinite(gross)) {
    const s = gross >= 0.50 ? 1.0 : gross >= 0.30 ? 0.75 : gross >= 0.15 ? 0.5 : gross > 0 ? 0.25 : 0.05;
    total += s * 0.3; count++;
    breakdown.gross = { score: s, value: gross };
  }
  if (isFinite(oper)) {
    const target = profile.marginTarget;
    const s = oper >= target * 1.5 ? 1.0 : oper >= target ? 0.8 : oper >= target * 0.5 ? 0.5 : oper > 0 ? 0.2 : 0.05;
    total += s * 0.4; count++;
    breakdown.operating = { score: s, value: oper };
  }
  if (isFinite(net)) {
    const s = net >= 0.20 ? 1.0 : net >= 0.10 ? 0.75 : net >= 0.05 ? 0.5 : net > 0 ? 0.25 : 0.05;
    total += s * 0.3; count++;
    breakdown.net = { score: s, value: net };
  }

  if (count === 0) return { score: 0.5, available: false, breakdown };
  // Normalize by actual weight used
  const weights = count === 3 ? 1 : count === 2 ? 0.7 : 0.4;
  return { score: clamp(total / weights, 0, 1), available: true, breakdown };
}

function scoreBalanceSheet(asset, profile) {
  const de = safeMetric(asset, "debt_eq", "debtEquity", "debt_to_equity");
  const cr = safeMetric(asset, "current_ratio", "currentRatio");
  const qr = safeMetric(asset, "quick_ratio", "quickRatio");
  
  let total = 0, count = 0;
  const breakdown = {};

  if (isFinite(de)) {
    const ceiling = profile.debtCeiling;
    const s = de <= ceiling * 0.3 ? 1.0 : de <= ceiling * 0.6 ? 0.8 : de <= ceiling ? 0.5 : de <= ceiling * 2 ? 0.2 : 0.05;
    total += s * 0.5; count++;
    breakdown.debtEquity = { score: s, value: de };
  }
  if (isFinite(cr)) {
    const s = cr >= 2.0 ? 1.0 : cr >= 1.5 ? 0.8 : cr >= 1.0 ? 0.5 : cr >= 0.5 ? 0.2 : 0.05;
    total += s * 0.3; count++;
    breakdown.currentRatio = { score: s, value: cr };
  }
  if (isFinite(qr)) {
    const s = qr >= 1.5 ? 1.0 : qr >= 1.0 ? 0.75 : qr >= 0.5 ? 0.4 : 0.1;
    total += s * 0.2; count++;
    breakdown.quickRatio = { score: s, value: qr };
  }

  if (count === 0) return { score: 0.5, available: false, breakdown };
  const weights = count === 3 ? 1 : count === 2 ? 0.8 : 0.5;
  return { score: clamp(total / weights, 0, 1), available: true, breakdown };
}

function scoreROE(asset) {
  const roe = safePercent(asset, "roe", "returnOnEquity");
  if (!isFinite(roe)) return { score: 0.5, available: false };
  const s = roe >= 0.25 ? 1.0 : roe >= 0.15 ? 0.8 : roe >= 0.10 ? 0.6 : roe > 0 ? 0.3 : 0.05;
  return { score: s, value: roe, available: true };
}

function scoreGrowthQuality(asset) {
  const epsYoY  = safePercent(asset, "epsYoY", "eps_yoy", "earnings_growth");
  const epsNext = safePercent(asset, "epsNextY", "eps_next_y", "earnings_growth_next");
  const eps5y   = safePercent(asset, "eps_next_5y", "eps_growth_5y");
  const sales   = safePercent(asset, "sales_y_y_ttm", "revenue_growth", "salesGrowth");

  let total = 0, count = 0;
  const breakdown = {};

  if (isFinite(epsYoY)) {
    const s = epsYoY > 0.25 ? 1.0 : epsYoY > 0.10 ? 0.7 : epsYoY > 0 ? 0.4 : epsYoY > -0.10 ? 0.2 : 0.05;
    total += s * 0.3; count++;
    breakdown.epsYoY = { score: s, value: epsYoY };
  }
  if (isFinite(epsNext)) {
    const s = epsNext > 0.15 ? 1.0 : epsNext > 0.05 ? 0.7 : epsNext > 0 ? 0.4 : 0.1;
    total += s * 0.25; count++;
    breakdown.epsNext = { score: s, value: epsNext };
  }
  if (isFinite(eps5y)) {
    const s = eps5y > 0.15 ? 1.0 : eps5y > 0.08 ? 0.7 : eps5y > 0 ? 0.4 : 0.1;
    total += s * 0.25; count++;
    breakdown.eps5y = { score: s, value: eps5y };
  }
  if (isFinite(sales)) {
    const s = sales > 0.20 ? 1.0 : sales > 0.10 ? 0.7 : sales > 0 ? 0.4 : 0.1;
    total += s * 0.2; count++;
    breakdown.salesGrowth = { score: s, value: sales };
  }

  if (count === 0) return { score: 0.5, available: false, breakdown };
  const weights = [0.3, 0.25, 0.25, 0.2].slice(0, count).reduce((a, b) => a + b, 0);
  return { score: clamp(total / weights, 0, 1), available: true, breakdown };
}

// ══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════

/**
 * Calculate Quality Score for a single asset.
 */
export function qualityScore(asset) {
  if (!asset) return { score: 50, breakdown: {}, confidence: 0, classification: "Unknown" };

  const category = getAssetCategory(asset);
  if (category.includes("ETF")) {
    const etf = scoreETFQuality(asset);
    return {
      score: etf.score,
      classification: etf.classification,
      confidence: Math.round(confidenceScore(asset) * 100),
      breakdown: { etf: true, ...etf }
    };
  }

  const profile = getSectorProfile(asset);
  const roic     = scoreROIC(asset, profile);
  const margins  = scoreMargins(asset, profile);
  const balance  = scoreBalanceSheet(asset, profile);
  const roe      = scoreROE(asset);
  const growth   = scoreGrowthQuality(asset);

  const W = { roic: 0.25, margins: 0.25, balance: 0.20, roe: 0.15, growth: 0.15 };
  const components = { roic, margins, balance, roe, growth };

  let weightedSum = 0;
  let weightTotal = 0;

  for (const [key, comp] of Object.entries(components)) {
    const w = W[key] || 0;
    if (comp.available !== false) {
      weightedSum += comp.score * w;
      weightTotal += w;
    } else {
      weightedSum += 0.5 * w * 0.3;
      weightTotal += w * 0.3;
    }
  }

  const raw = weightTotal > 0 ? weightedSum / weightTotal : 0.5;
  const score = Math.round(clamp(raw * 100, 0, 100));
  
  let classification;
  if (score >= 85) classification = "Exceptional Quality";
  else if (score >= 70) classification = "High Quality";
  else if (score >= 55) classification = "Average Quality";
  else if (score >= 40) classification = "Below Average";
  else classification = "Low Quality / Speculative";

  return {
    score,
    classification,
    confidence: Math.round(confidenceScore(asset) * 100),
    breakdown: { roic, margins, balance, roe, growth }
  };
}

