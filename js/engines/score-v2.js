import { qualityScore } from "./quality.js";
import { momentumScore } from "./momentum.js";
import { valuationScore } from "./valuation.js";
import { riskScore } from "./risk.js";
import { confidenceScore, clamp, getAssetCategory } from "../utils/normalize.js";
import { applyRegimeWeights } from "./macro.js";

// Quality-First philosophy: Quality + Valuation always dominate Momentum
// Momentum is a noisy, volatile signal — useful but never the primary driver
const BASE_WEIGHTS = { quality: 0.35, momentum: 0.15, valuation: 0.30, risk: 0.20 };
const MAX_MOMENTUM_WEIGHT = 0.25; // Cap: even in risk-on regimes, momentum ≤ 25%

/**
 * Calculate the comprehensive V2 score for a single asset.
 */
export function scoreAssetV2(asset, styleMultipliers = null, regime = "high_rates") {
  if (!asset) return { finalScore: 50, grade: "C", confidence: 0, engines: {}, signals: [], warnings: [], observations: [] };

  const category = getAssetCategory(asset);
  const isETF = category.includes("ETF");

  // ── Run all engines ──
  const quality   = qualityScore(asset);
  const momentum  = momentumScore(asset);
  const valuation = valuationScore(asset);
  const risk      = riskScore(asset);
  const conf      = confidenceScore(asset);

  // ── 1. Regime-adjusted weights (Quality + Valuation always > Momentum) ──
  const W = applyRegimeWeights(BASE_WEIGHTS, regime);
  if (W.momentum > MAX_MOMENTUM_WEIGHT) {
    const excess = W.momentum - MAX_MOMENTUM_WEIGHT;
    W.momentum = MAX_MOMENTUM_WEIGHT;
    W.quality += excess * 0.6;
    W.valuation += excess * 0.4;
    const s = W.quality + W.momentum + W.valuation + W.risk;
    W.quality /= s; W.momentum /= s; W.valuation /= s; W.risk /= s;
  }

  // ── 2. Apply Asset-Class Adjustments ──
  if (isETF) {
    // ETFs are more about Momentum and Risk/Diversification than Valuation/Quality
    W.quality   *= 0.8;
    W.valuation *= 0.7;
    W.momentum  *= 1.2;
    W.risk      *= 1.5;
  } else if (category === "Commodity") {
    // Commodities/Physical metals don't have P/E or ROIC.
    // They are scored primarily on Momentum and Risk/Hedge value.
    W.quality   = 0.10;
    W.valuation = 0.10;
    W.momentum  = 0.40;
    W.risk      = 0.40;
    
    // Neutralize missing fundamental scores
    if (quality.score < 10 || isNaN(quality.score)) quality.score = 50;
    if (valuation.score < 10 || isNaN(valuation.score)) valuation.score = 50;
  }

  // ── 3. Apply user style multipliers ──
  if (styleMultipliers) {
    if (styleMultipliers.quality)   W.quality   *= styleMultipliers.quality;
    if (styleMultipliers.momentum)  W.momentum  *= styleMultipliers.momentum;
    if (styleMultipliers.valuation) W.valuation *= styleMultipliers.valuation;
    if (styleMultipliers.risk)      W.risk      *= styleMultipliers.risk;
  }

  // Normalize weights
  const sum = W.quality + W.momentum + W.valuation + W.risk;
  if (sum > 0) {
    W.quality /= sum; W.momentum /= sum; W.valuation /= sum; W.risk /= sum;
  }

  // ── 4. Weighted combination ──
  const weighted = 
    (quality.score   * W.quality) +
    (momentum.score  * W.momentum) +
    (valuation.score * W.valuation) +
    (risk.score      * W.risk);

  // ── 5. Confidence Adjustment ──
  // If confidence is low, pull score towards 50 to avoid false signals
  const finalScore = Math.round(weighted * conf + 50 * (1 - conf));

  // ── Letter grade ──
  let grade;
  if (finalScore >= 85) grade = "A+";
  else if (finalScore >= 78) grade = "A";
  else if (finalScore >= 70) grade = "B+";
  else if (finalScore >= 62) grade = "B";
  else if (finalScore >= 54) grade = "C+";
  else if (finalScore >= 45) grade = "C";
  else if (finalScore >= 35) grade = "D";
  else grade = "F";

  const signals = [...(momentum.signals || [])];
  const warnings = [
    ...(momentum.warnings || []),
    ...(risk.warnings || []),
    ...(conf < 0.4 ? ["Confiança de dados baixa — análise pode estar incompleta"] : [])
  ];

  const observations = generateObservations(asset, { quality, momentum, valuation, risk }, category);

  return {
    finalScore,
    grade,
    confidence: Math.round(conf * 100),
    weights: { ...W },
    category,
    isETF,
    engines: {
      quality,
      momentum,
      valuation,
      risk
    },
    signals,
    warnings,
    observations
  };
}

function generateObservations(asset, engines, category) {
  const obs = [];
  const { quality, momentum, valuation, risk } = engines;
  const ticker = String(asset.ticker || "").toUpperCase();

  if (category === "Broad Market ETF") {
    obs.push({ type: "positive", msg: `${ticker}: Âncora de portfólio (Broad Market) — excelente para gestão de risco passiva.` });
    if (momentum.score > 70) obs.push({ type: "positive", msg: `${ticker}: Momento de mercado forte para índices globais.` });
    return obs;
  }

  // Quality + Valuation combo
  if (quality.score >= 75 && valuation.score >= 70) {
    obs.push({ type: "positive", msg: `${ticker}: Empresa de alta qualidade a preço justo — potencial compounder.` });
  }
  if (quality.score >= 70 && valuation.score <= 35) {
    obs.push({ type: "warning", msg: `${ticker}: Boa qualidade mas valuation muito esticada — cuidado com o premium pago.` });
  }

  // Risk observations
  if (risk.score >= 80) {
    obs.push({ type: "positive", msg: `${ticker}: Perfil de risco estável — adequado para posição CORE.` });
  } else if (risk.score <= 30) {
    obs.push({ type: "caution", msg: `${ticker}: Risco elevado / especulativo — limitar exposição.` });
  }

  // Category specific
  if (category === "Thematic ETF") {
    obs.push({ type: "neutral", msg: `${ticker}: Exposição temática focada — maior volatilidade esperada.` });
  }

  return obs;
}

export function styleToMultipliers(styleAlloc) {
  if (!styleAlloc) return null;
  const g = (styleAlloc.growth || 25) / 100;
  const v = (styleAlloc.value || 25) / 100;
  const d = (styleAlloc.div || 25) / 100;
  const q = (styleAlloc.qual || 25) / 100;

  return {
    quality:   1 + (q * 1.5) + (d * 0.5),
    momentum:  1 + (g * 1.5),
    valuation: 1 + (v * 2.0),
    risk:      1 + (q * 1.0) + (d * 0.5)
  };
}
