// js/engines/risk-contrib.js
// ═══════════════════════════════════════════════════════════════════
// RISK CONTRIBUTION ANALYSIS
// Shows which asset contributes most to RISK, not just to weight.
// "5% crypto pode representar 20% do risco total."
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, clamp } from "../utils/normalize.js";

/**
 * Calculate risk contribution of each asset in the portfolio.
 * Uses beta as a proxy for volatility to estimate marginal risk contribution.
 * 
 * @param {Array} portfolio - Array of { ticker, valAtual, mkt, ... }
 * @param {number} totalValue
 * @returns {{ contributions: Array, portfolioBeta: number, riskConcentration: Object, warnings: Array }}
 */
export function riskContribution(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) {
    return { contributions: [], portfolioBeta: 0, riskConcentration: {}, warnings: ["Portfólio vazio"] };
  }

  const total = Math.max(totalValue, 1);
  const warnings = [];

  // ── 1. Calculate weighted beta for each position ──
  const items = portfolio.map(p => {
    const ticker = String(p.ticker || "").toUpperCase();
    const beta = safeMetric(p.mkt || p, "beta", "Beta");
    const effectiveBeta = isFinite(beta) && beta > 0 ? beta : 1.0;
    const weight = (p.valAtual || 0) / total;
    const nome = String(p.nome || p.mkt?.nome || "").toUpperCase();
    
    // Crypto gets a synthetic high beta
    let adjustedBeta = effectiveBeta;
    if (nome.includes("BITCOIN") || nome.includes("ETHEREUM") || nome.includes("CRYPTO")) {
      adjustedBeta = Math.max(effectiveBeta, 3.0); // Crypto is at least 3x market vol
    }

    return {
      ticker,
      weight: Math.round(weight * 1000) / 10,
      beta: Math.round(effectiveBeta * 100) / 100,
      adjustedBeta: Math.round(adjustedBeta * 100) / 100,
      valAtual: p.valAtual || 0,
      riskWeight: weight * adjustedBeta // Raw risk weight (unnormalized)
    };
  });

  // ── 2. Normalize risk contributions ──
  const totalRiskWeight = items.reduce((s, i) => s + i.riskWeight, 0) || 1;

  for (const item of items) {
    item.riskContribution = Math.round((item.riskWeight / totalRiskWeight) * 1000) / 10;
    item.riskRatio = item.weight > 0 ? Math.round((item.riskContribution / item.weight) * 100) / 100 : 0;
  }

  // Sort by risk contribution (highest first)
  items.sort((a, b) => b.riskContribution - a.riskContribution);

  // ── 3. Portfolio beta ──
  const portfolioBeta = items.reduce((s, i) => s + (i.adjustedBeta * (i.weight / 100)), 0);

  // ── 4. Risk concentration analysis ──
  const top1Risk = items[0]?.riskContribution || 0;
  const top3Risk = items.slice(0, 3).reduce((s, i) => s + i.riskContribution, 0);
  const top5Risk = items.slice(0, 5).reduce((s, i) => s + i.riskContribution, 0);

  const riskConcentration = {
    top1: { ticker: items[0]?.ticker, pct: top1Risk },
    top3Pct: Math.round(top3Risk * 10) / 10,
    top5Pct: Math.round(top5Risk * 10) / 10
  };

  // ── 5. Detect hidden risk ──
  for (const item of items) {
    if (item.riskRatio > 2.5) {
      warnings.push(`${item.ticker}: contribui ${item.riskContribution}% do risco com apenas ${item.weight}% do valor — desproporcional`);
    }
  }

  if (top1Risk > 25) {
    warnings.push(`${items[0]?.ticker} sozinho representa ${top1Risk.toFixed(1)}% do risco total do portfólio`);
  }

  if (top3Risk > 60) {
    warnings.push(`Top 3 contribuintes de risco representam ${top3Risk.toFixed(0)}% do risco total`);
  }

  // ── 6. Risk score (higher = better distributed risk) ──
  let riskDistScore;
  if (top1Risk < 15 && top3Risk < 40) riskDistScore = 100;
  else if (top1Risk < 20 && top3Risk < 50) riskDistScore = 80;
  else if (top1Risk < 30) riskDistScore = 60;
  else if (top1Risk < 40) riskDistScore = 40;
  else riskDistScore = 20;

  return {
    contributions: items,
    portfolioBeta: Math.round(portfolioBeta * 100) / 100,
    riskConcentration,
    riskDistributionScore: riskDistScore,
    warnings
  };
}

/**
 * Compare weight vs risk for display purposes.
 * Returns data suitable for a bar chart comparison.
 */
export function weightVsRiskChart(portfolio, totalValue) {
  const result = riskContribution(portfolio, totalValue);
  
  return result.contributions.slice(0, 10).map(c => ({
    ticker: c.ticker,
    weightPct: c.weight,
    riskPct: c.riskContribution,
    ratio: c.riskRatio,
    isDisproportionate: c.riskRatio > 2.0
  }));
}
