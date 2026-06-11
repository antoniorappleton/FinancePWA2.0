// js/engines/risk-contrib.js
// Risk contribution analysis.
// Shows which assets contribute most to estimated portfolio risk, not just weight.

import { safeMetric, getAssetCategory } from "../utils/normalize.js";

/**
 * Calculate risk contribution of each asset in the portfolio.
 * Uses beta as a pragmatic volatility proxy. Because beta data can be sparse,
 * the output distinguishes proportional core risk from genuinely hidden risk.
 *
 * @param {Array} portfolio - Array of { ticker, valAtual, mkt, ... }
 * @param {number} totalValue
 * @returns {{ contributions: Array, portfolioBeta: number, riskConcentration: Object, warnings: Array }}
 */
export function riskContribution(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) {
    return { contributions: [], portfolioBeta: 0, riskConcentration: {}, warnings: ["Portfolio vazio"] };
  }

  const total = Math.max(totalValue, 1);
  const warnings = [];

  const items = portfolio.map(p => {
    const ticker = String(p.ticker || "").toUpperCase();
    const beta = safeMetric(p.mkt || p, "beta", "Beta");
    const effectiveBeta = isFinite(beta) && beta > 0 ? beta : 1.0;
    const weight = (p.valAtual || 0) / total;
    const nome = String(p.nome || p.mkt?.nome || "").toUpperCase();
    const category = getAssetCategory(p.mkt || p);

    let adjustedBeta = effectiveBeta;
    if (nome.includes("BITCOIN") || nome.includes("ETHEREUM") || nome.includes("CRYPTO")) {
      adjustedBeta = Math.max(effectiveBeta, 3.0);
    }

    return {
      ticker,
      weight: Math.round(weight * 1000) / 10,
      beta: Math.round(effectiveBeta * 100) / 100,
      adjustedBeta: Math.round(adjustedBeta * 100) / 100,
      category,
      valAtual: p.valAtual || 0,
      riskWeight: weight * adjustedBeta
    };
  });

  const totalRiskWeight = items.reduce((s, i) => s + i.riskWeight, 0) || 1;

  for (const item of items) {
    item.riskContribution = Math.round((item.riskWeight / totalRiskWeight) * 1000) / 10;
    item.riskRatio = item.weight > 0 ? Math.round((item.riskContribution / item.weight) * 100) / 100 : 0;
    item.isCore = item.category === "Broad Market ETF";
    item.isDisproportionate = item.isCore
      ? item.riskRatio > 1.6 && item.riskContribution > item.weight + 15
      : item.riskRatio > 2.0 && item.riskContribution > item.weight + 8;
    item.contributionContext = item.isDisproportionate ? "disproportionate" : "weight_driven";
  }

  items.sort((a, b) => b.riskContribution - a.riskContribution);

  const portfolioBeta = items.reduce((s, i) => s + (i.adjustedBeta * (i.weight / 100)), 0);
  const top1Risk = items[0]?.riskContribution || 0;
  const top3Risk = items.slice(0, 3).reduce((s, i) => s + i.riskContribution, 0);
  const top5Risk = items.slice(0, 5).reduce((s, i) => s + i.riskContribution, 0);

  const riskConcentration = {
    top1: { ticker: items[0]?.ticker, pct: top1Risk },
    top3Pct: Math.round(top3Risk * 10) / 10,
    top5Pct: Math.round(top5Risk * 10) / 10
  };

  for (const item of items) {
    if (item.isDisproportionate) {
      warnings.push(`${item.ticker}: contribuicao de risco acima do peso (${item.riskContribution}% vs ${item.weight}%; ratio ${item.riskRatio}x).`);
    }
  }

  const top = items[0];
  if (top && top1Risk > 65 && top.isCore && !top.isDisproportionate) {
    warnings.push(`${top.ticker}: principal fonte de volatilidade por ser a ancora CORE (${top.weight}% do valor; ${top1Risk.toFixed(1)}% do risco estimado). Nao e desproporcional pelo beta.`);
  } else if (top && top1Risk > 45) {
    warnings.push(`${top.ticker} concentra ${top1Risk.toFixed(1)}% do risco estimado do portfolio.`);
  }

  if (items.length >= 6 && top3Risk > 75) {
    warnings.push(`Top 3 contribuintes representam ${top3Risk.toFixed(0)}% do risco estimado; diversificacao de risco limitada.`);
  }

  let riskDistScore;
  if (top1Risk < 20 && top3Risk < 50) riskDistScore = 100;
  else if (top1Risk < 30 && top3Risk < 65) riskDistScore = 80;
  else if (top1Risk < 45) riskDistScore = 60;
  else if (top?.isCore && !top.isDisproportionate) riskDistScore = 55;
  else if (top1Risk < 60) riskDistScore = 40;
  else riskDistScore = 25;

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
    category: c.category,
    isDisproportionate: c.isDisproportionate
  }));
}
