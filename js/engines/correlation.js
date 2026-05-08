// js/engines/correlation.js
// ═══════════════════════════════════════════════════════════════════
// CORRELATION ENGINE
// Proxy-based correlation using sector, factor, and beta similarity.
// Detects false diversification and hidden clusters.
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, clamp } from "../utils/normalize.js";
import { normalizeSector } from "../utils/scoring.js";

// ── Sector correlation matrix (0=uncorrelated, 1=identical) ──
const SECTOR_CORR = {
  "Tecnologia":        { "Tecnologia": 1.0, "Saúde": 0.3, "Financeiros": 0.4, "Energia": 0.15, "Consumo Cíclico": 0.5, "Consumo Defensivo": 0.2, "Industriais": 0.4, "Materiais": 0.2, "Imobiliário": 0.15 },
  "Saúde":             { "Tecnologia": 0.3, "Saúde": 1.0, "Financeiros": 0.25, "Energia": 0.1, "Consumo Cíclico": 0.3, "Consumo Defensivo": 0.5, "Industriais": 0.3, "Materiais": 0.15, "Imobiliário": 0.2 },
  "Financeiros":       { "Tecnologia": 0.4, "Saúde": 0.25, "Financeiros": 1.0, "Energia": 0.35, "Consumo Cíclico": 0.5, "Consumo Defensivo": 0.3, "Industriais": 0.5, "Materiais": 0.4, "Imobiliário": 0.6 },
  "Energia":           { "Tecnologia": 0.15, "Saúde": 0.1, "Financeiros": 0.35, "Energia": 1.0, "Consumo Cíclico": 0.3, "Consumo Defensivo": 0.15, "Industriais": 0.4, "Materiais": 0.6, "Imobiliário": 0.2 },
  "Consumo Cíclico":   { "Tecnologia": 0.5, "Saúde": 0.3, "Financeiros": 0.5, "Energia": 0.3, "Consumo Cíclico": 1.0, "Consumo Defensivo": 0.35, "Industriais": 0.55, "Materiais": 0.4, "Imobiliário": 0.35 },
  "Consumo Defensivo":  { "Tecnologia": 0.2, "Saúde": 0.5, "Financeiros": 0.3, "Energia": 0.15, "Consumo Cíclico": 0.35, "Consumo Defensivo": 1.0, "Industriais": 0.3, "Materiais": 0.25, "Imobiliário": 0.35 },
  "Industriais":       { "Tecnologia": 0.4, "Saúde": 0.3, "Financeiros": 0.5, "Energia": 0.4, "Consumo Cíclico": 0.55, "Consumo Defensivo": 0.3, "Industriais": 1.0, "Materiais": 0.55, "Imobiliário": 0.35 },
  "Materiais":         { "Tecnologia": 0.2, "Saúde": 0.15, "Financeiros": 0.4, "Energia": 0.6, "Consumo Cíclico": 0.4, "Consumo Defensivo": 0.25, "Industriais": 0.55, "Materiais": 1.0, "Imobiliário": 0.3 },
  "Imobiliário":       { "Tecnologia": 0.15, "Saúde": 0.2, "Financeiros": 0.6, "Energia": 0.2, "Consumo Cíclico": 0.35, "Consumo Defensivo": 0.35, "Industriais": 0.35, "Materiais": 0.3, "Imobiliário": 1.0 }
};

const SECTOR_ALIASES = {
  "Technology": "Tecnologia", "Healthcare": "Saúde", "Health Care": "Saúde",
  "Financial Services": "Financeiros", "Financials": "Financeiros",
  "Energy": "Energia", "Consumer Cyclical": "Consumo Cíclico",
  "Consumer Defensive": "Consumo Defensivo", "Industrials": "Industriais",
  "Basic Materials": "Materiais", "Real Estate": "Imobiliário",
  "Communication Services": "Tecnologia", "Utilities": "Consumo Defensivo"
};

function normSector(s) {
  const raw = String(s || "").trim();
  return SECTOR_ALIASES[raw] || raw;
}

function getSectorCorrelation(s1, s2) {
  const a = normSector(s1), b = normSector(s2);
  return SECTOR_CORR[a]?.[b] ?? SECTOR_CORR[b]?.[a] ?? 0.3;
}

/**
 * Calculate pairwise correlation proxy between two assets.
 * Uses sector + beta similarity as proxy (no price history needed).
 */
function pairCorrelation(assetA, assetB) {
  const sA = normalizeSector(assetA.mkt || assetA);
  const sB = normalizeSector(assetB.mkt || assetB);
  const sectorCorr = getSectorCorrelation(sA, sB);

  const betaA = safeMetric(assetA.mkt || assetA, "beta") || 1;
  const betaB = safeMetric(assetB.mkt || assetB, "beta") || 1;
  const betaSimilarity = 1 - Math.min(Math.abs(betaA - betaB) / 2, 1);

  // Weighted: sector is more important than beta similarity
  return sectorCorr * 0.7 + betaSimilarity * 0.3;
}

/**
 * Generate a correlation matrix for the portfolio.
 * @param {Array} portfolio - Array of { ticker, valAtual, mkt }
 * @returns {{ matrix: Object, clusters: Array, avgCorrelation: number, diversificationScore: number, warnings: Array }}
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

  // ── Detect clusters (groups with high correlation) ──
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

      if (matrix[tA][tB] >= 0.65) {
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
  // Lower avg correlation = better diversification
  const diversificationScore = Math.round(clamp((1 - avgCorrelation) * 100, 0, 100));

  // ── Warnings ──
  if (avgCorrelation > 0.6) {
    warnings.push(`Correlação média elevada (${avgCorrelation}) — falsa diversificação`);
  }

  for (const cluster of clusters) {
    if (cluster.assets.length >= 3) {
      warnings.push(`Cluster correlacionado: ${cluster.assets.join(", ")} (corr. ~${cluster.avgCorrelation})`);
    }
  }

  // Heatmap data (for visualization)
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
