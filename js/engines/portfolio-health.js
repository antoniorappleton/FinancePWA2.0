// js/engines/portfolio-health.js
// ═══════════════════════════════════════════════════════════════════
// PORTFOLIO HEALTH ENGINE
// Structural score: diversification, concentration, correlation proxy,
// mega-cap dependency, volatility, thematic balance, liquidity.
// Outputs: Portfolio Health Score, Hidden Risk Score, Structural Stability
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, clamp } from "../utils/normalize.js";
import { getAssetType, normalizeSector } from "../utils/scoring.js";

// ── Helpers ──

function herfindahlIndex(weights) {
  // HHI: sum of squared weights. 0 = perfect diversification, 1 = all in one asset.
  return weights.reduce((sum, w) => sum + w * w, 0);
}

function giniCoefficient(values) {
  const n = values.length;
  if (n <= 1) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumDiff += Math.abs(sorted[i] - sorted[j]);
    }
  }
  return sumDiff / (2 * n * n * mean);
}

// ── Sub-scores ──

function scoreDiversification(portfolio, totalValue) {
  if (portfolio.length === 0) return { score: 0, positionCount: 0, details: {} };

  const weights = portfolio.map(p => p.valAtual / Math.max(totalValue, 1));
  const hhi = herfindahlIndex(weights);
  const n = portfolio.length;

  // More positions = better, but with diminishing returns
  const countScore = n >= 20 ? 1.0 : n >= 12 ? 0.85 : n >= 8 ? 0.7 : n >= 5 ? 0.5 : n >= 3 ? 0.3 : 0.1;

  // Lower HHI = better diversification
  const hhiScore = hhi < 0.05 ? 1.0 : hhi < 0.10 ? 0.8 : hhi < 0.20 ? 0.5 : hhi < 0.35 ? 0.3 : 0.1;

  // Sector diversification
  const sectorMap = {};
  portfolio.forEach(p => {
    const s = normalizeSector(p.mkt || p) || "Outros";
    sectorMap[s] = (sectorMap[s] || 0) + (p.valAtual || 0);
  });
  const sectorCount = Object.keys(sectorMap).filter(k => k !== "—" && k !== "Outros").length;
  const sectorScore = sectorCount >= 7 ? 1.0 : sectorCount >= 5 ? 0.8 : sectorCount >= 3 ? 0.5 : 0.2;

  // Type diversification (stocks, ETFs, crypto, bonds)
  const typeMap = {};
  portfolio.forEach(p => {
    const t = getAssetType(p.ticker, p.mkt || p);
    typeMap[t] = (typeMap[t] || 0) + (p.valAtual || 0);
  });
  const typeCount = Object.keys(typeMap).length;
  const typeScore = typeCount >= 3 ? 1.0 : typeCount >= 2 ? 0.7 : 0.3;

  const score = countScore * 0.2 + hhiScore * 0.3 + sectorScore * 0.3 + typeScore * 0.2;

  return {
    score: clamp(score, 0, 1),
    positionCount: n,
    hhi: Math.round(hhi * 1000) / 1000,
    sectorCount,
    typeCount,
    sectors: sectorMap,
    types: typeMap
  };
}

function scoreConcentration(portfolio, totalValue) {
  if (portfolio.length === 0) return { score: 1, top5Pct: 0, warnings: [] };

  const sorted = [...portfolio].sort((a, b) => b.valAtual - a.valAtual);
  const top1 = sorted[0]?.valAtual || 0;
  const top3 = sorted.slice(0, 3).reduce((s, p) => s + p.valAtual, 0);
  const top5 = sorted.slice(0, 5).reduce((s, p) => s + p.valAtual, 0);

  const top1Pct = totalValue > 0 ? top1 / totalValue : 0;
  const top3Pct = totalValue > 0 ? top3 / totalValue : 0;
  const top5Pct = totalValue > 0 ? top5 / totalValue : 0;

  const warnings = [];
  if (top1Pct > 0.25) warnings.push(`${sorted[0]?.ticker} representa ${(top1Pct * 100).toFixed(0)}% do portfólio — risco de concentração`);
  if (top3Pct > 0.60) warnings.push(`Top 3 posições representam ${(top3Pct * 100).toFixed(0)}% — diversificação insuficiente`);

  // Lower concentration = higher score (safer)
  let s;
  if (top5Pct < 0.40) s = 1.0;
  else if (top5Pct < 0.55) s = 0.75;
  else if (top5Pct < 0.70) s = 0.5;
  else if (top5Pct < 0.85) s = 0.25;
  else s = 0.1;

  return {
    score: s,
    top1: { ticker: sorted[0]?.ticker, pct: Math.round(top1Pct * 100) },
    top3Pct: Math.round(top3Pct * 100),
    top5Pct: Math.round(top5Pct * 100),
    warnings
  };
}

function scoreMegaCapDependency(portfolio, totalValue) {
  const MEGA_CAPS = new Set([
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA",
    "BRK.B", "BRK.A", "UNH", "JNJ", "JPM", "V", "XOM", "PG", "MA",
    "HD", "AVGO", "LLY", "MRK", "COST", "ABBV", "PEP", "KO", "ADBE",
    "WMT", "CRM", "TMO", "NFLX", "AMD", "ORCL", "ACN", "CSCO"
  ]);

  let megaCapValue = 0;
  const megaCaps = [];

  for (const p of portfolio) {
    const ticker = String(p.ticker || "").toUpperCase();
    if (MEGA_CAPS.has(ticker)) {
      megaCapValue += p.valAtual || 0;
      megaCaps.push({ ticker, value: p.valAtual });
    }
  }

  const pct = totalValue > 0 ? megaCapValue / totalValue : 0;
  
  // Some mega-cap exposure is healthy, too much is risky
  let s;
  if (pct < 0.20) s = 0.9;       // Low dependency
  else if (pct < 0.40) s = 1.0;  // Healthy mix
  else if (pct < 0.60) s = 0.7;
  else if (pct < 0.80) s = 0.4;
  else s = 0.2;                   // Over-concentrated in mega-caps

  return { score: s, pct: Math.round(pct * 100), megaCaps };
}

function scorePortfolioVolatility(portfolio) {
  // Estimate portfolio volatility using beta as proxy
  let totalWeight = 0, weightedBeta = 0;
  let count = 0;

  for (const p of portfolio) {
    const beta = safeMetric(p.mkt || p, "beta", "Beta");
    const weight = p.valAtual || 0;
    if (isFinite(beta) && weight > 0) {
      weightedBeta += beta * weight;
      totalWeight += weight;
      count++;
    }
  }

  if (count === 0 || totalWeight === 0) return { score: 0.5, portfolioBeta: 1.0, available: false };

  const avgBeta = weightedBeta / totalWeight;
  
  let s;
  if (avgBeta <= 0.6) s = 1.0;
  else if (avgBeta <= 0.9) s = 0.85;
  else if (avgBeta <= 1.1) s = 0.7;
  else if (avgBeta <= 1.4) s = 0.45;
  else s = 0.2;

  return { score: s, portfolioBeta: Math.round(avgBeta * 100) / 100, available: true };
}

// ══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════

/**
 * Calculate Portfolio Health Score.
 * @param {Array} portfolio - Array of enriched positions { ticker, valAtual, mkt, ... }
 * @param {number} totalValue - Total portfolio value
 * @returns {{ score: number, classification: string, hiddenRiskScore: number, breakdown: Object, warnings: Array }}
 */
export function portfolioHealth(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) {
    return { score: 0, classification: "Empty Portfolio", hiddenRiskScore: 0, breakdown: {}, warnings: ["Portfólio vazio"] };
  }

  const diversification  = scoreDiversification(portfolio, totalValue);
  const concentration    = scoreConcentration(portfolio, totalValue);
  const megaCap          = scoreMegaCapDependency(portfolio, totalValue);
  const volatility       = scorePortfolioVolatility(portfolio);

  const W = { diversification: 0.30, concentration: 0.25, megaCap: 0.15, volatility: 0.30 };

  const weighted =
    diversification.score * W.diversification +
    concentration.score   * W.concentration +
    megaCap.score         * W.megaCap +
    volatility.score      * W.volatility;

  const score = Math.round(clamp(weighted * 100, 0, 100));

  // Hidden Risk = inverse of concentration + mega-cap dependency
  const hiddenRiskScore = Math.round(clamp((1 - concentration.score * 0.5 - megaCap.score * 0.5) * 100, 0, 100));

  // All warnings
  const warnings = [...concentration.warnings];
  if (megaCap.pct > 60) warnings.push(`Dependência de mega-caps: ${megaCap.pct}% do valor`);
  if (diversification.sectorCount < 3) warnings.push("Exposição setorial muito limitada");
  if (volatility.available && volatility.portfolioBeta > 1.4) warnings.push(`Beta do portfólio elevado: ${volatility.portfolioBeta}`);

  let classification;
  if (score >= 80) classification = "Excelente";
  else if (score >= 65) classification = "Saudável";
  else if (score >= 50) classification = "Razoável";
  else if (score >= 35) classification = "Necessita Atenção";
  else classification = "Crítico";

  return {
    score,
    classification,
    hiddenRiskScore,
    warnings,
    breakdown: {
      diversification: { ...diversification, weight: W.diversification },
      concentration:   { ...concentration, weight: W.concentration },
      megaCap:         { ...megaCap, weight: W.megaCap },
      volatility:      { ...volatility, weight: W.volatility }
    }
  };
}
