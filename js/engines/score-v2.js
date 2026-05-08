// js/engines/score-v2.js
// ═══════════════════════════════════════════════════════════════════
// SCORE V2 — ORCHESTRATOR
// Combines Quality, Momentum, Valuation, and Risk engines
// into a unified score with full transparency and breakdown.
// ═══════════════════════════════════════════════════════════════════

import { qualityScore } from "./quality.js";
import { momentumScore } from "./momentum.js";
import { valuationScore } from "./valuation.js";
import { riskScore } from "./risk.js";
import { confidenceScore, clamp } from "../utils/normalize.js";

/**
 * Calculate the comprehensive V2 score for a single asset.
 * 
 * @param {Object} asset - Raw asset data from Firestore
 * @param {Object} [styleMultipliers] - Optional user style preference multipliers
 *   e.g. { quality: 1.5, momentum: 0.8, valuation: 1.2, risk: 1.0 }
 * @returns {Object} Full analysis result
 */
export function scoreAssetV2(asset, styleMultipliers = null) {
  if (!asset) {
    return {
      finalScore: 50,
      grade: "C",
      confidence: 0,
      engines: {},
      signals: [],
      warnings: [],
      observations: []
    };
  }

  // ── Run all engines ──
  const quality   = qualityScore(asset);
  const momentum  = momentumScore(asset);
  const valuation = valuationScore(asset);
  const risk      = riskScore(asset);
  const confidence = confidenceScore(asset);

  // ── Base weights ──
  const W = {
    quality:   0.30,
    momentum:  0.20,
    valuation: 0.30,
    risk:      0.20
  };

  // ── Apply user style multipliers ──
  if (styleMultipliers) {
    if (styleMultipliers.quality)   W.quality   *= styleMultipliers.quality;
    if (styleMultipliers.momentum)  W.momentum  *= styleMultipliers.momentum;
    if (styleMultipliers.valuation) W.valuation *= styleMultipliers.valuation;
    if (styleMultipliers.risk)      W.risk      *= styleMultipliers.risk;
    
    // Re-normalize
    const sum = W.quality + W.momentum + W.valuation + W.risk;
    if (sum > 0) {
      W.quality /= sum;
      W.momentum /= sum;
      W.valuation /= sum;
      W.risk /= sum;
    }
  }

  // ── Weighted combination ──
  const weighted = 
    (quality.score   * W.quality) +
    (momentum.score  * W.momentum) +
    (valuation.score * W.valuation) +
    (risk.score      * W.risk);

  const finalScore = Math.round(clamp(weighted, 0, 100));

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

  // ── Collect signals and warnings ──
  const signals = [...(momentum.signals || [])];
  const warnings = [
    ...(momentum.warnings || []),
    ...(risk.warnings || [])
  ];

  // ── Generate AI observations ──
  const observations = generateObservations(asset, { quality, momentum, valuation, risk });

  return {
    finalScore,
    grade,
    confidence: Math.round(confidence * 100),
    weights: { ...W },
    engines: {
      quality:   { score: quality.score,   classification: quality.classification,   breakdown: quality.breakdown },
      momentum:  { score: momentum.score,  classification: momentum.classification,  breakdown: momentum.breakdown },
      valuation: { score: valuation.score, classification: valuation.classification, breakdown: valuation.breakdown },
      risk:      { score: risk.score,      classification: risk.classification,      breakdown: risk.breakdown }
    },
    crashSensitivity: risk.crashSensitivity,
    signals,
    warnings,
    observations
  };
}

/**
 * Generate automatic smart observations based on engine results.
 */
function generateObservations(asset, engines) {
  const obs = [];
  const { quality, momentum, valuation, risk } = engines;
  const ticker = String(asset.ticker || "").toUpperCase();

  // Quality + Valuation combo
  if (quality.score >= 75 && valuation.score >= 70) {
    obs.push({ type: "positive", msg: `${ticker}: Empresa de alta qualidade a preço justo — potencial compounder.` });
  }
  if (quality.score >= 70 && valuation.score <= 35) {
    obs.push({ type: "warning", msg: `${ticker}: Boa qualidade mas valuation muito esticada — cuidado com o timing.` });
  }
  if (quality.score <= 35 && valuation.score >= 75) {
    obs.push({ type: "caution", msg: `${ticker}: Parece barata mas qualidade baixa — pode ser uma "value trap".` });
  }

  // Momentum + Risk combo
  if (momentum.score >= 75 && risk.score <= 35) {
    obs.push({ type: "warning", msg: `${ticker}: Momentum forte mas risco elevado — não oversize esta posição.` });
  }
  if (momentum.score <= 30 && quality.score >= 70) {
    obs.push({ type: "neutral", msg: `${ticker}: Empresa sólida em fase de correção — potencial oportunidade.` });
  }

  // Valuation extremes
  if (valuation.score >= 85) {
    obs.push({ type: "positive", msg: `${ticker}: Deep value — significativamente subavaliada pelo mercado.` });
  }
  if (valuation.score <= 20) {
    obs.push({ type: "warning", msg: `${ticker}: Valuation muito esticada em múltiplas métricas.` });
  }

  // Risk observations
  if (risk.score >= 80) {
    obs.push({ type: "positive", msg: `${ticker}: Perfil de risco muito estável — adequado para posição CORE.` });
  }
  if (risk.score <= 25) {
    obs.push({ type: "caution", msg: `${ticker}: Risco especulativo — limitar a 2-5% do portfólio.` });
  }

  // Divergence detection
  if (quality.score >= 70 && momentum.score <= 30) {
    obs.push({ type: "neutral", msg: `${ticker}: Divergência qualidade/momentum — os fundamentais estão fortes mas o mercado não reflete.` });
  }
  if (quality.score <= 35 && momentum.score >= 70) {
    obs.push({ type: "warning", msg: `${ticker}: Momentum sem fundamentais — pode ser especulativo.` });
  }

  return obs;
}

/**
 * Map V2 style preferences to engine multipliers.
 * Growth → momentum+quality, Value → valuation, Dividend → quality, Quality → quality+risk
 */
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
