// js/engines/risk.js
// ═══════════════════════════════════════════════════════════════════
// RISK ENGINE (0–100)
// Comprehensive risk assessment: volatility, leverage, drawdown
// sensitivity, liquidity, and concentration risk.
// Outputs: Risk Score, Crash Sensitivity, Stress Classification
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, safePercent, clamp, isValid } from "../utils/normalize.js";

// ── Historical crisis baselines ──
const CRISIS_DROPS = {
  covid:     { name: "COVID-19 (2020)",         avgDrop: -0.34, techDrop: -0.32, energyDrop: -0.55 },
  gfc:       { name: "Crise Financeira (2008)",  avgDrop: -0.56, techDrop: -0.52, energyDrop: -0.48 },
  dotcom:    { name: "Dotcom (2000)",            avgDrop: -0.49, techDrop: -0.78, energyDrop: -0.20 },
  rates2022: { name: "Subida Taxas (2022)",      avgDrop: -0.24, techDrop: -0.33, energyDrop: 0.10 },
  eurozone:  { name: "Crise Eurozona (2011)",    avgDrop: -0.22, techDrop: -0.18, energyDrop: -0.25 }
};

// ── Sub-scores ──

function scoreBeta(asset) {
  const beta = safeMetric(asset, "beta", "Beta");
  if (!isFinite(beta)) return { score: 0.5, available: false };

  // Lower beta = lower risk = higher score
  let s;
  if (beta <= 0.5) s = 1.0;       // Very defensive
  else if (beta <= 0.8) s = 0.85;  // Low volatility
  else if (beta <= 1.0) s = 0.7;   // Market-like
  else if (beta <= 1.3) s = 0.5;   // Slightly aggressive
  else if (beta <= 1.8) s = 0.3;   // High risk
  else s = 0.1;                    // Extreme volatility

  let classification;
  if (beta <= 0.7) classification = "Defensive";
  else if (beta <= 1.1) classification = "Market-neutral";
  else if (beta <= 1.5) classification = "Aggressive";
  else classification = "Speculative";

  return { score: s, value: beta, available: true, classification };
}

function scoreLeverage(asset) {
  const de = safeMetric(asset, "debt_eq", "debtEquity");
  const cr = safeMetric(asset, "current_ratio", "currentRatio");

  let total = 0, count = 0;
  const breakdown = {};

  if (isFinite(de)) {
    let s;
    if (de <= 0.3) s = 1.0;       // Very low leverage
    else if (de <= 0.8) s = 0.8;
    else if (de <= 1.5) s = 0.5;
    else if (de <= 3.0) s = 0.25;
    else s = 0.05;                 // Dangerously leveraged
    total += s * 0.6; count++;
    breakdown.debtEquity = { score: s, value: de };
  }

  if (isFinite(cr)) {
    let s;
    if (cr >= 2.5) s = 1.0;
    else if (cr >= 1.5) s = 0.8;
    else if (cr >= 1.0) s = 0.5;
    else if (cr >= 0.5) s = 0.2;
    else s = 0.05;
    total += s * 0.4; count++;
    breakdown.currentRatio = { score: s, value: cr };
  }

  if (count === 0) return { score: 0.5, available: false, breakdown };
  const weights = count === 2 ? 1.0 : 0.6;
  return { score: clamp(total / weights, 0, 1), available: true, breakdown };
}

function scoreVolatility(asset) {
  const beta = safeMetric(asset, "beta", "Beta");
  const w1 = safePercent(asset, "priceChange_1w", "g1w");
  const m1 = safePercent(asset, "priceChange_1m", "g1m");
  const rsi = safeMetric(asset, "rsi_14", "RSI");

  let volatilityEstimate = 0.5; // default neutral
  let count = 0;
  const warnings = [];

  // Beta-implied volatility
  if (isFinite(beta)) {
    volatilityEstimate = clamp(beta / 2, 0, 1); // beta 2 = max vol
    count++;
  }

  // Short-term price swings — detect abnormal volatility
  if (isFinite(w1) && isFinite(m1)) {
    const weeklyVol = Math.abs(w1);
    const monthlyVol = Math.abs(m1);

    // If weekly change is > 50% of monthly, volatility is extreme
    if (monthlyVol > 0 && weeklyVol / monthlyVol > 0.7) {
      warnings.push("Volatilidade semanal anormalmente alta vs mensal");
      volatilityEstimate = Math.max(volatilityEstimate, 0.8);
    }
    count++;
  }

  // RSI extremes indicate instability
  if (isFinite(rsi)) {
    if (rsi > 80 || rsi < 20) {
      warnings.push(`RSI extremo (${rsi.toFixed(0)}) — instabilidade de preço`);
      volatilityEstimate = Math.max(volatilityEstimate, 0.7);
    }
  }

  // Score: lower volatility = higher score
  const score = clamp(1 - volatilityEstimate, 0, 1);

  return { score, volatilityEstimate, available: count > 0, warnings };
}

function calculateCrashSensitivity(asset) {
  const beta = safeMetric(asset, "beta", "Beta") || 1.0;
  const sector = String(asset.setor || asset.sector || "").toLowerCase();
  
  const results = {};
  for (const [key, crisis] of Object.entries(CRISIS_DROPS)) {
    let baseDrop = crisis.avgDrop;
    
    // Sector-specific adjustments
    if (sector.includes("tech") || sector.includes("tecnol")) {
      baseDrop = crisis.techDrop || baseDrop;
    } else if (sector.includes("energ")) {
      baseDrop = crisis.energyDrop || baseDrop;
    }

    // Beta-adjusted drop
    const expectedDrop = baseDrop * beta;
    results[key] = {
      name: crisis.name,
      expectedDrop: Math.round(expectedDrop * 100),
      severity: expectedDrop < -0.40 ? "Extreme" : expectedDrop < -0.25 ? "High" : expectedDrop < -0.15 ? "Moderate" : "Low"
    };
  }

  return results;
}

// ══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════

/**
 * Calculate Risk Score for a single asset.
 * Higher score = LOWER risk (safer asset).
 * @param {Object} asset
 * @returns {{ score: number, classification: string, crashSensitivity: Object, warnings: Array, breakdown: Object }}
 */
export function riskScore(asset) {
  if (!asset) return { score: 50, classification: "Unknown", crashSensitivity: {}, warnings: [], breakdown: {} };

  const betaResult   = scoreBeta(asset);
  const leverage     = scoreLeverage(asset);
  const volatility   = scoreVolatility(asset);
  const crashSens    = calculateCrashSensitivity(asset);

  const W = { beta: 0.30, leverage: 0.35, volatility: 0.35 };
  const components = { beta: betaResult, leverage, volatility };

  let weightedSum = 0, weightTotal = 0;

  for (const [key, comp] of Object.entries(components)) {
    const w = W[key];
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

  // Collect all warnings
  const warnings = [...(volatility.warnings || [])];

  // Overall classification
  let classification;
  if (score >= 80) classification = "Stable";
  else if (score >= 65) classification = "Moderate";
  else if (score >= 45) classification = "Aggressive";
  else if (score >= 25) classification = "Speculative";
  else classification = "Extreme Volatility";

  return {
    score,
    classification,
    crashSensitivity: crashSens,
    warnings,
    breakdown: {
      beta:       { ...betaResult, weight: W.beta },
      leverage:   { ...leverage, weight: W.leverage },
      volatility: { ...volatility, weight: W.volatility }
    }
  };
}
