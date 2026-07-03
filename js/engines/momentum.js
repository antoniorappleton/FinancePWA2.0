// js/engines/momentum.js
// ═══════════════════════════════════════════════════════════════════
// MOMENTUM SCORE ENGINE (0–100)
// Multi-timeframe momentum: price trends, moving averages,
// RSI, golden/death crosses, and volume analysis.
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, safePercent, clamp, isValid } from "../utils/normalize.js";

// ── Sub-scores ──

function scorePriceMomentum(asset) {
  const w1 = safePercent(asset, "priceChange_1w", "taxaCrescimento_1semana", "g1w");
  const m1 = safePercent(asset, "priceChange_1m", "taxaCrescimento_1mes", "g1m");
  const y1 = safePercent(asset, "priceChange_1y", "taxaCrescimento_1ano", "g1y");

  let total = 0, count = 0;
  const breakdown = {};

  // Short-term (1 week)
  if (isFinite(w1)) {
    // Moderate positive is best; extreme spikes are suspicious
    let s;
    if (w1 > 0.10) s = 0.6;        // Spike — suspicious pump
    else if (w1 > 0.03) s = 1.0;   // Strong week
    else if (w1 > 0) s = 0.7;      // Mild positive
    else if (w1 > -0.03) s = 0.4;  // Mild dip
    else s = 0.1;                   // Harsh drop
    total += s * 0.15; count++;
    breakdown.week = { score: s, value: w1 };
  }

  // Medium-term (1 month)
  if (isFinite(m1)) {
    let s;
    if (m1 > 0.15) s = 0.7;        // Very strong but watch overextension
    else if (m1 > 0.05) s = 1.0;   // Healthy momentum
    else if (m1 > 0) s = 0.6;
    else if (m1 > -0.05) s = 0.3;
    else s = 0.1;
    total += s * 0.35; count++;
    breakdown.month = { score: s, value: m1 };
  }

  // Long-term (1 year)
  if (isFinite(y1)) {
    let s;
    if (y1 > 0.50) s = 0.8;        // Exceptional but valuations may be stretched
    else if (y1 > 0.20) s = 1.0;   // Strong structural trend
    else if (y1 > 0.05) s = 0.7;
    else if (y1 > -0.10) s = 0.3;
    else s = 0.1;
    total += s * 0.50; count++;
    breakdown.year = { score: s, value: y1 };
  }

  if (count === 0) return { score: 0.5, available: false, breakdown };
  const weights = [0.15, 0.35, 0.50].slice(0, count).reduce((a, b) => a + b, 0);
  return { score: clamp(total / weights, 0, 1), available: true, breakdown };
}

function scoreTrendStructure(asset) {
  const price = safeMetric(asset, "valorStock", "price");
  const sma50 = safeMetric(asset, "sma50", "SMA50");
  const sma200 = safeMetric(asset, "sma200", "SMA200");

  if (!isFinite(price)) return { score: 0.5, available: false, signals: [] };

  const signals = [];
  let s = 0;

  // Price vs SMA200 — most important structural signal
  if (isFinite(sma200) && sma200 > 0) {
    if (price > sma200) {
      s += 0.35;
      signals.push({ type: "bullish", msg: "Preço acima da SMA200" });
    } else {
      signals.push({ type: "bearish", msg: "Preço abaixo da SMA200" });
    }
  }

  // Price vs SMA50 — medium-term trend
  if (isFinite(sma50) && sma50 > 0) {
    if (price > sma50) {
      s += 0.25;
      signals.push({ type: "bullish", msg: "Preço acima da SMA50" });
    } else {
      signals.push({ type: "bearish", msg: "Preço abaixo da SMA50" });
    }
  }

  // Golden Cross / Death Cross
  if (isFinite(sma50) && isFinite(sma200) && sma50 > 0 && sma200 > 0) {
    if (sma50 > sma200) {
      s += 0.20;
      // Check if it's a recent cross (SMA50 close to SMA200)
      const gap = (sma50 - sma200) / sma200;
      if (gap < 0.02) {
        signals.push({ type: "strong_bullish", msg: "🔥 Golden Cross recente!" });
        s += 0.10; // Bonus for fresh cross
      } else {
        signals.push({ type: "bullish", msg: "Golden Cross ativo" });
      }
    } else {
      const gap = (sma200 - sma50) / sma200;
      if (gap < 0.02) {
        signals.push({ type: "strong_bearish", msg: "⚠️ Death Cross recente!" });
      } else {
        signals.push({ type: "bearish", msg: "Death Cross ativo" });
      }
    }
  }

  // Distance from 52-week high
  const highDist = safePercent(asset, "high_52w_dist", "from52wHigh");
  if (isFinite(highDist)) {
    if (Math.abs(highDist) < 0.05) {
      s += 0.10;
      signals.push({ type: "bullish", msg: "Perto do máximo de 52 semanas" });
    } else if (Math.abs(highDist) > 0.30) {
      signals.push({ type: "warning", msg: "Mais de 30% abaixo do máximo" });
    }
  }

  return { score: clamp(s, 0, 1), available: true, signals };
}

function scoreRSI(asset) {
  const rsi = safeMetric(asset, "rsi", "rsi_14", "rsi14", "RSI");
  if (!isFinite(rsi)) return { score: 0.5, available: false, zone: "unknown" };

  let s, zone, warnings = [];

  if (rsi >= 80) {
    s = 0.15; zone = "Extreme Overbought";
    warnings.push("RSI extremo — risco de correção iminente");
  } else if (rsi >= 70) {
    s = 0.35; zone = "Overbought";
    warnings.push("RSI elevado — potencial sobrecompra");
  } else if (rsi >= 55) {
    s = 1.0; zone = "Bullish";
  } else if (rsi >= 45) {
    s = 0.7; zone = "Neutral";
  } else if (rsi >= 30) {
    s = 0.5; zone = "Weak";
  } else if (rsi >= 20) {
    s = 0.6; zone = "Oversold";  // Opportunity zone
    warnings.push("RSI oversold — potencial oportunidade de compra");
  } else {
    s = 0.3; zone = "Extreme Oversold";
    warnings.push("RSI extremo oversold — verificar fundamentais");
  }

  return { score: s, value: rsi, available: true, zone, warnings };
}

// ══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════

/**
 * Calculate Momentum Score for a single asset.
 * @param {Object} asset - Raw asset data from Firestore
 * @returns {{ score: number, signals: Array, warnings: Array, breakdown: Object }}
 */
export function momentumScore(asset) {
  if (!asset) return { score: 50, signals: [], warnings: [], breakdown: {} };

  const price  = scorePriceMomentum(asset);
  const trend  = scoreTrendStructure(asset);
  const rsi    = scoreRSI(asset);

  const W = { price: 0.40, trend: 0.40, rsi: 0.20 };
  const components = { price, trend, rsi };

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

  // Collect signals
  const signals = [...(trend.signals || [])];
  const warnings = [...(rsi.warnings || [])];

  // Add momentum consistency signal
  if (price.available && price.breakdown.week && price.breakdown.month && price.breakdown.year) {
    const allPositive = price.breakdown.week.value > 0 && price.breakdown.month.value > 0 && price.breakdown.year.value > 0;
    if (allPositive) {
      signals.push({ type: "strong_bullish", msg: "Momentum consistente em todos os prazos" });
    }
    const allNegative = price.breakdown.week.value < 0 && price.breakdown.month.value < 0 && price.breakdown.year.value < 0;
    if (allNegative) {
      warnings.push("Momentum negativo em todos os prazos — tendência de queda estrutural");
    }
  }

  // Pump-and-dump detection
  if (price.breakdown.week && price.breakdown.year) {
    if (price.breakdown.week.value > 0.15 && (!price.breakdown.year || price.breakdown.year.value < 0)) {
      warnings.push("⚠️ Spike curto sem suporte estrutural — possível pump-and-dump");
    }
  }

  // Classification
  let classification;
  if (score >= 80) classification = "Strong Uptrend";
  else if (score >= 65) classification = "Bullish";
  else if (score >= 45) classification = "Neutral";
  else if (score >= 30) classification = "Bearish";
  else classification = "Strong Downtrend";

  return {
    score,
    classification,
    signals,
    warnings,
    breakdown: {
      priceMomentum: { ...price, weight: W.price },
      trendStructure: { ...trend, weight: W.trend },
      rsi: { ...rsi, weight: W.rsi }
    }
  };
}
