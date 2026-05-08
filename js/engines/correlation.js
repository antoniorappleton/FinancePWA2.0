// js/engines/correlation.js
// ═══════════════════════════════════════════════════════════════════
// CORRELATION ENGINE
// Proxy-based correlation using sector, factor, and beta similarity.
// Detects false diversification and hidden clusters.
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, safePercent, clamp, getAssetCategory } from "../utils/normalize.js";
import { normalizeSector } from "../utils/scoring.js";

// ── Refined Sector correlation matrix (Institutional standard) ──
const SECTOR_CORR = {
  "Tecnologia":        { "Tecnologia": 1.0, "Saúde": 0.25, "Financeiros": 0.35, "Energia": 0.1, "Consumo Cíclico": 0.55, "Consumo Defensivo": 0.15, "Industriais": 0.45, "Materiais": 0.25, "Imobiliário": 0.1 },
  "Saúde":             { "Tecnologia": 0.25, "Saúde": 1.0, "Financeiros": 0.2, "Energia": 0.05, "Consumo Cíclico": 0.25, "Consumo Defensivo": 0.45, "Industriais": 0.25, "Materiais": 0.1, "Imobiliário": 0.15 },
  "Financeiros":       { "Tecnologia": 0.35, "Saúde": 0.2, "Financeiros": 1.0, "Energia": 0.4, "Consumo Cíclico": 0.5, "Consumo Defensivo": 0.25, "Industriais": 0.55, "Materiais": 0.45, "Imobiliário": 0.65 },
  "Energia":           { "Tecnologia": 0.1, "Saúde": 0.05, "Financeiros": 0.4, "Energia": 1.0, "Consumo Cíclico": 0.2, "Consumo Defensivo": 0.1, "Industriais": 0.45, "Materiais": 0.65, "Imobiliário": 0.15 },
  "Consumo Cíclico":   { "Tecnologia": 0.55, "Saúde": 0.25, "Financeiros": 0.5, "Energia": 0.2, "Consumo Cíclico": 1.0, "Consumo Defensivo": 0.3, "Industriais": 0.6, "Materiais": 0.45, "Imobiliário": 0.4 },
  "Consumo Defensivo":  { "Tecnologia": 0.15, "Saúde": 0.45, "Financeiros": 0.25, "Energia": 0.1, "Consumo Cíclico": 0.3, "Consumo Defensivo": 1.0, "Industriais": 0.35, "Materiais": 0.2, "Imobiliário": 0.3 },
  "Industriais":       { "Tecnologia": 0.45, "Saúde": 0.25, "Financeiros": 0.55, "Energia": 0.45, "Consumo Cíclico": 0.6, "Consumo Defensivo": 0.35, "Industriais": 1.0, "Materiais": 0.6, "Imobiliário": 0.4 },
  "Materiais":         { "Tecnologia": 0.25, "Saúde": 0.1, "Financeiros": 0.45, "Energia": 0.65, "Consumo Cíclico": 0.45, "Consumo Defensivo": 0.2, "Industriais": 0.6, "Materiais": 1.0, "Imobiliário": 0.35 },
  "Imobiliário":       { "Tecnologia": 0.1, "Saúde": 0.15, "Financeiros": 0.65, "Energia": 0.15, "Consumo Cíclico": 0.4, "Consumo Defensivo": 0.3, "Industriais": 0.4, "Materiais": 0.35, "Imobiliário": 1.0 },
  "Múltiplos Setores": { "Tecnologia": 0.4, "Saúde": 0.4, "Financeiros": 0.4, "Energia": 0.3, "Consumo Cíclico": 0.4, "Consumo Defensivo": 0.4, "Industriais": 0.4, "Materiais": 0.3, "Imobiliário": 0.3, "Múltiplos Setores": 1.0 }
};

const SECTOR_ALIASES = {
  "Technology": "Tecnologia", "Healthcare": "Saúde", "Health Care": "Saúde",
  "Financial Services": "Financeiros", "Financials": "Financeiros",
  "Energy": "Energia", "Consumer Cyclical": "Consumo Cíclico",
  "Consumer Defensive": "Consumo Defensivo", "Industrials": "Industriais",
  "Basic Materials": "Materiais", "Real Estate": "Imobiliário",
  "Communication Services": "Tecnologia", "Utilities": "Consumo Defensivo",
  "ETF": "Múltiplos Setores", "Multi-Sector": "Múltiplos Setores"
};

function normSector(s) {
  const raw = String(s || "").trim();
  return SECTOR_ALIASES[raw] || raw;
}

function getSectorCorrelation(s1, s2) {
  const a = normSector(s1), b = normSector(s2);
  const base = SECTOR_CORR[a]?.[b] ?? SECTOR_CORR[b]?.[a] ?? 0.3;
  return base;
}

/**
 * Historical Proxy Correlation (Pseudo-Pearson)
 * Uses 1w, 1m, 1y price changes to detect coupling.
 */
function getHistoricalCorrelation(assetA, assetB) {
  const changesA = [
    safePercent(assetA.mkt || assetA, "priceChange_1w"),
    safePercent(assetA.mkt || assetA, "priceChange_1m"),
    safePercent(assetA.mkt || assetA, "priceChange_1y")
  ].filter(v => isFinite(v));

  const changesB = [
    safePercent(assetB.mkt || assetB, "priceChange_1w"),
    safePercent(assetB.mkt || assetB, "priceChange_1m"),
    safePercent(assetB.mkt || assetB, "priceChange_1y")
  ].filter(v => isFinite(v));

  if (changesA.length < 2 || changesB.length < 2) return NaN;

  // Correlation of direction
  let score = 0, count = 0;
  for (let i = 0; i < Math.min(changesA.length, changesB.length); i++) {
    const dirA = Math.sign(changesA[i]);
    const dirB = Math.sign(changesB[i]);
    if (dirA === dirB) score += 1;
    else if (dirA === -dirB) score -= 0.5;
    count++;
  }
  
  return count > 0 ? score / count : NaN;
}

/**
 * Calculate pairwise correlation proxy between two assets.
 */
function pairCorrelation(assetA, assetB) {
  const catA = getAssetCategory(assetA.mkt || assetA);
  const catB = getAssetCategory(assetB.mkt || assetB);

  // Broad Market ETFs are treated as diversifying anchors (lower specific correlation)
  let baseMultiplier = 1.0;
  if (catA === "Broad Market ETF" || catB === "Broad Market ETF") {
    // If one is VWCE and another is a single stock, correlation is naturally lower
    // unless the stock is a massive part of the ETF (handled in overlap)
    baseMultiplier = 0.6; 
    if (catA === "Broad Market ETF" && catB === "Broad Market ETF") baseMultiplier = 0.9; // Broad ETFs move together
  }

  const histCorr = getHistoricalCorrelation(assetA, assetB);
  const sA = normalizeSector(assetA.mkt || assetA);
  const sB = normalizeSector(assetB.mkt || assetB);
  const sectorCorr = getSectorCorrelation(sA, sB);

  const betaA = safeMetric(assetA.mkt || assetA, "beta") || 1;
  const betaB = safeMetric(assetB.mkt || assetB, "beta") || 1;
  const betaSimilarity = 1 - Math.min(Math.abs(betaA - betaB) / 2, 1);

  let finalCorr;
  if (isFinite(histCorr)) {
    // Hybrid: 50% Historical Proxy, 30% Sector, 20% Beta
    finalCorr = (histCorr * 0.5 + sectorCorr * 0.3 + betaSimilarity * 0.2);
  } else {
    // Proxy only: 70% Sector, 30% Beta
    finalCorr = (sectorCorr * 0.7 + betaSimilarity * 0.3);
  }

  return clamp(finalCorr * baseMultiplier, -1, 1);
}

/**
 * Generate a correlation matrix for the portfolio.
 */
export function correlationMatrix(portfolio) {
  if (!portfolio || portfolio.length < 2) {
    return { matrix: {}, clusters: [], avgCorrelation: 0, diversificationScore: 100, warnings: [] };
  }

  const n = portfolio.length;
  const matrix = {};
  let totalCorr = 0, pairCount = 0;
  const warnings = [];

  // Build matrix
  for (let i = 0; i < n; i++) {
    const a = portfolio[i];
    const tA = String(a.ticker || "").toUpperCase();
    matrix[tA] = {};

    for (let j = 0; j < n; j++) {
      const b = portfolio[j];
      const tB = String(b.ticker || "").toUpperCase();

      if (i === j) {
        matrix[tA][tB] = 1.0;
      } else {
        const corr = Math.round(pairCorrelation(a, b) * 100) / 100;
        matrix[tA][tB] = corr;

        if (j > i) {
          totalCorr += corr;
          pairCount++;
        }
      }
    }
  }

  const avgCorrelation = pairCount > 0 ? Math.round((totalCorr / pairCount) * 100) / 100 : 0;

  // ── Detect clusters ──
  const clusters = [];
  const visited = new Set();

  for (let i = 0; i < n; i++) {
    const tA = String(portfolio[i].ticker || "").toUpperCase();
    if (visited.has(tA)) continue;

    const cluster = [tA];
    visited.add(tA);

    for (let j = i + 1; j < n; j++) {
      const tB = String(portfolio[j].ticker || "").toUpperCase();
      if (visited.has(tB)) continue;

      if (matrix[tA][tB] >= 0.7) { // Higher threshold for cluster detection
        cluster.push(tB);
        visited.add(tB);
      }
    }

    if (cluster.length >= 2) {
      clusters.push({
        assets: cluster,
        avgCorrelation: Math.round(
          cluster.reduce((s, a) =>
            s + cluster.reduce((s2, b) => s2 + (a === b ? 0 : (matrix[a]?.[b] || 0)), 0), 0
          ) / Math.max(1, cluster.length * (cluster.length - 1)) * 100
        ) / 100
      });
    }
  }

  // ── Diversification score ──
  // Lower avg correlation = better diversification. Adjusted for portfolio size.
  const sizeAdjustment = Math.min(n / 10, 1);
  const diversificationScore = Math.round(clamp((1 - avgCorrelation) * 100 * sizeAdjustment, 0, 100));

  // ── Warnings ──
  if (avgCorrelation > 0.65) {
    warnings.push(`Correlação média elevada (${avgCorrelation}) — falsa diversificação`);
  }

  for (const cluster of clusters) {
    if (cluster.assets.length >= 3) {
      warnings.push(`Cluster acoplado: ${cluster.assets.join(", ")} (corr. ~${cluster.avgCorrelation})`);
    }
  }

  const tickers = portfolio.map(p => String(p.ticker || "").toUpperCase());
  const heatmapData = tickers.map(t => tickers.map(t2 => matrix[t]?.[t2] || 0));

  return {
    matrix,
    heatmapData,
    tickers,
    clusters,
    avgCorrelation,
    diversificationScore,
    warnings
  };
}
