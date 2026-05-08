// js/engines/temporal.js
// ═══════════════════════════════════════════════════════════════════
// LONG-TERM SCORING ENGINE
// Separate scores for short, medium, and long-term horizons.
// "Quantum pode ser fraco curto prazo mas excelente estruturalmente."
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, safePercent, clamp, isValid } from "../utils/normalize.js";

/**
 * Calculate temporal scores for an asset.
 * @param {Object} asset - Asset data
 * @param {Object} v2Engines - { quality, momentum, valuation, risk } engine results
 * @returns {{ shortTerm: Object, mediumTerm: Object, longTerm: Object, bestHorizon: string }}
 */
export function temporalScore(asset, v2Engines) {
  if (!asset || !v2Engines) {
    const empty = { score: 50, factors: [], classification: "Neutral" };
    return { shortTerm: empty, mediumTerm: empty, longTerm: empty, bestHorizon: "medium" };
  }

  const { quality, momentum, valuation, risk } = v2Engines;

  // ── Short-Term (1-3 months) ──
  // Heavily weighted on momentum and technical signals
  const shortFactors = [];
  let shortScore = 50;
  
  if (momentum) {
    shortScore = momentum.score * 0.50;
    shortFactors.push({ name: "Momentum", weight: 50, score: momentum.score });
  }
  if (valuation) {
    shortScore += valuation.score * 0.15;
    shortFactors.push({ name: "Valuation", weight: 15, score: valuation.score });
  }
  if (risk) {
    shortScore += risk.score * 0.35;
    shortFactors.push({ name: "Risk", weight: 35, score: risk.score });
  }

  // RSI extreme bonus/penalty
  const rsi = safeMetric(asset, "rsi_14", "RSI");
  if (isFinite(rsi)) {
    if (rsi < 25) { shortScore += 8; shortFactors.push({ name: "RSI Oversold (opportunity)", weight: 0, score: 80 }); }
    if (rsi > 80) { shortScore -= 10; shortFactors.push({ name: "RSI Overbought (risk)", weight: 0, score: 20 }); }
  }

  shortScore = Math.round(clamp(shortScore, 0, 100));

  // ── Medium-Term (3-12 months) ──
  // Balanced across all engines
  let mediumScore = 50;
  const mediumFactors = [];

  if (quality)   { mediumScore = quality.score * 0.25; mediumFactors.push({ name: "Quality", weight: 25, score: quality.score }); }
  if (momentum)  { mediumScore += momentum.score * 0.25; mediumFactors.push({ name: "Momentum", weight: 25, score: momentum.score }); }
  if (valuation) { mediumScore += valuation.score * 0.30; mediumFactors.push({ name: "Valuation", weight: 30, score: valuation.score }); }
  if (risk)      { mediumScore += risk.score * 0.20; mediumFactors.push({ name: "Risk", weight: 20, score: risk.score }); }

  mediumScore = Math.round(clamp(mediumScore, 0, 100));

  // ── Long-Term (1-5 years) ──
  // Quality and valuation dominate; momentum is nearly irrelevant
  let longScore = 50;
  const longFactors = [];

  if (quality) {
    longScore = quality.score * 0.40;
    longFactors.push({ name: "Quality", weight: 40, score: quality.score });
  }
  if (valuation) {
    longScore += valuation.score * 0.30;
    longFactors.push({ name: "Valuation", weight: 30, score: valuation.score });
  }
  if (risk) {
    longScore += risk.score * 0.20;
    longFactors.push({ name: "Risk", weight: 20, score: risk.score });
  }
  if (momentum) {
    longScore += momentum.score * 0.10;
    longFactors.push({ name: "Momentum", weight: 10, score: momentum.score });
  }

  // Long-term growth bonus
  const eps5y = safePercent(asset, "eps_next_5y", "eps_growth_5y");
  if (isFinite(eps5y) && eps5y > 0.10) {
    longScore += 5;
    longFactors.push({ name: "EPS Growth 5Y Boost", weight: 0, score: 90 });
  }

  longScore = Math.round(clamp(longScore, 0, 100));

  // ── Classification ──
  const classify = (s) => s >= 75 ? "Strong Buy" : s >= 60 ? "Buy" : s >= 45 ? "Hold" : s >= 30 ? "Underperform" : "Avoid";

  // ── Best horizon ──
  let bestHorizon = "medium";
  if (longScore > shortScore && longScore > mediumScore) bestHorizon = "long";
  else if (shortScore > mediumScore && shortScore > longScore) bestHorizon = "short";

  return {
    shortTerm:  { score: shortScore,  factors: shortFactors,  classification: classify(shortScore),  horizon: "1-3 meses" },
    mediumTerm: { score: mediumScore, factors: mediumFactors, classification: classify(mediumScore), horizon: "3-12 meses" },
    longTerm:   { score: longScore,   factors: longFactors,   classification: classify(longScore),   horizon: "1-5 anos" },
    bestHorizon,
    divergence: Math.abs(longScore - shortScore) > 25
      ? `Divergência: ${longScore > shortScore ? "Melhor a longo prazo" : "Melhor a curto prazo"} (${Math.abs(longScore - shortScore)} pts)`
      : null
  };
}
