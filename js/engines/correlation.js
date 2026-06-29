import { safeMetric, safePercent, clamp, getAssetCategory, canonicalTicker, toCanonicalSector } from "../utils/normalize.js";
import { normalizeSector } from "../utils/scoring.js";

// ── Refined Sector correlation matrix (PT canonical names — D8.2) ──
const SECTOR_CORR = {
  "Tecnologia":        { "Tecnologia": 1.0, "Saúde": 0.25, "Financeiros": 0.35, "Energia": 0.1, "Consumo Cíclico": 0.55, "Consumo Defensivo": 0.15, "Industriais": 0.45, "Materiais": 0.25, "Imobiliário": 0.1,  "Comunicações": 0.60, "Utilidades": 0.10 },
  "Saúde":             { "Tecnologia": 0.25, "Saúde": 1.0, "Financeiros": 0.2, "Energia": 0.05, "Consumo Cíclico": 0.25, "Consumo Defensivo": 0.45, "Industriais": 0.25, "Materiais": 0.1,  "Imobiliário": 0.15, "Comunicações": 0.20, "Utilidades": 0.30 },
  "Financeiros":       { "Tecnologia": 0.35, "Saúde": 0.2, "Financeiros": 1.0, "Energia": 0.4,  "Consumo Cíclico": 0.5,  "Consumo Defensivo": 0.25, "Industriais": 0.55, "Materiais": 0.45, "Imobiliário": 0.65, "Comunicações": 0.30, "Utilidades": 0.35 },
  "Energia":           { "Tecnologia": 0.1,  "Saúde": 0.05,"Financeiros": 0.4, "Energia": 1.0,  "Consumo Cíclico": 0.2,  "Consumo Defensivo": 0.1,  "Industriais": 0.45, "Materiais": 0.65, "Imobiliário": 0.15, "Comunicações": 0.10, "Utilidades": 0.45 },
  "Consumo Cíclico":   { "Tecnologia": 0.55, "Saúde": 0.25,"Financeiros": 0.5, "Energia": 0.2,  "Consumo Cíclico": 1.0,  "Consumo Defensivo": 0.3,  "Industriais": 0.6,  "Materiais": 0.45, "Imobiliário": 0.4,  "Comunicações": 0.45, "Utilidades": 0.15 },
  "Consumo Defensivo": { "Tecnologia": 0.15, "Saúde": 0.45,"Financeiros": 0.25,"Energia": 0.1,  "Consumo Cíclico": 0.3,  "Consumo Defensivo": 1.0,  "Industriais": 0.35, "Materiais": 0.2,  "Imobiliário": 0.3,  "Comunicações": 0.20, "Utilidades": 0.40 },
  "Industriais":       { "Tecnologia": 0.45, "Saúde": 0.25,"Financeiros": 0.55,"Energia": 0.45, "Consumo Cíclico": 0.6,  "Consumo Defensivo": 0.35, "Industriais": 1.0,  "Materiais": 0.6,  "Imobiliário": 0.4,  "Comunicações": 0.35, "Utilidades": 0.30 },
  "Materiais":         { "Tecnologia": 0.25, "Saúde": 0.1, "Financeiros": 0.45,"Energia": 0.65, "Consumo Cíclico": 0.45, "Consumo Defensivo": 0.2,  "Industriais": 0.6,  "Materiais": 1.0,  "Imobiliário": 0.35, "Comunicações": 0.20, "Utilidades": 0.25 },
  "Imobiliário":       { "Tecnologia": 0.1,  "Saúde": 0.15,"Financeiros": 0.65,"Energia": 0.15, "Consumo Cíclico": 0.4,  "Consumo Defensivo": 0.3,  "Industriais": 0.4,  "Materiais": 0.35, "Imobiliário": 1.0,  "Comunicações": 0.20, "Utilidades": 0.55 },
  "Commodities":       { "Tecnologia": 0.1,  "Saúde": 0.1, "Financeiros": 0.45,"Energia": 0.65, "Consumo Cíclico": 0.45, "Consumo Defensivo": 0.2,  "Industriais": 0.6,  "Materiais": 0.8,  "Imobiliário": 0.35, "Comunicações": 0.10, "Utilidades": 0.20 },
  "Comunicações":      { "Tecnologia": 0.60, "Saúde": 0.20,"Financeiros": 0.30,"Energia": 0.10, "Consumo Cíclico": 0.45, "Consumo Defensivo": 0.20, "Industriais": 0.35, "Materiais": 0.20, "Imobiliário": 0.20, "Comunicações": 1.0,  "Utilidades": 0.15 },
  "Utilidades":        { "Tecnologia": 0.10, "Saúde": 0.30,"Financeiros": 0.35,"Energia": 0.45, "Consumo Cíclico": 0.15, "Consumo Defensivo": 0.40, "Industriais": 0.30, "Materiais": 0.25, "Imobiliário": 0.55, "Comunicações": 0.15, "Utilidades": 1.0  },
  "Múltiplos Setores": { "Tecnologia": 0.4,  "Saúde": 0.4, "Financeiros": 0.4, "Energia": 0.3,  "Consumo Cíclico": 0.4,  "Consumo Defensivo": 0.4,  "Industriais": 0.4,  "Materiais": 0.3,  "Imobiliário": 0.3,  "Comunicações": 0.35, "Utilidades": 0.35, "Múltiplos Setores": 1.0 }
};

function normSector(s) {
  return toCanonicalSector(String(s || "").trim());
}

function getSectorCorrelation(s1, s2) {
  const a = normSector(s1), b = normSector(s2);
  const base = SECTOR_CORR[a]?.[b] ?? SECTOR_CORR[b]?.[a] ?? 0.3;
  return base;
}

/**
 * Pairs correlation proxy between two assets.
 */
function pairCorrelation(assetA, assetB) {
  const catA = getAssetCategory(assetA.mkt || assetA);
  const catB = getAssetCategory(assetB.mkt || assetB);

  let baseMultiplier = 1.0;
  if (catA === "Broad Market ETF" || catB === "Broad Market ETF") {
    baseMultiplier = 0.55; 
    if (catA === "Broad Market ETF" && catB === "Broad Market ETF") baseMultiplier = 0.9;
  } else if (catA === "Commodity" || catB === "Commodity") {
    // Commodities (Gold, Silver) typically have low correlation with equities
    baseMultiplier = 0.3;
    if (catA === "Commodity" && catB === "Commodity") baseMultiplier = 0.8;
  }

  const sA = normalizeSector(assetA.mkt || assetA);
  const sB = normalizeSector(assetB.mkt || assetB);
  const sectorCorr = getSectorCorrelation(sA, sB);

  const betaA = safeMetric(assetA.mkt || assetA, "beta") || 1;
  const betaB = safeMetric(assetB.mkt || assetB, "beta") || 1;
  const betaSimilarity = 1 - Math.min(Math.abs(betaA - betaB) / 2, 1);

  return clamp((sectorCorr * 0.7 + betaSimilarity * 0.3) * baseMultiplier, -1, 1);
}

/**
 * Generate a correlation matrix and detect structural clusters.
 */
export function correlationMatrix(portfolio) {
  if (!portfolio || portfolio.length === 0) return { matrix: {}, tickers: [], clusters: [], avgCorrelation: 0, warnings: [] };

  // 1. Deduplicate by canonical ticker
  const dedup = {};
  for (const p of portfolio) {
    const t = canonicalTicker(p.ticker);
    if (!dedup[t]) dedup[t] = p;
    else if (p.valAtual > dedup[t].valAtual) dedup[t] = p; // Keep largest position
  }
  const positions = Object.values(dedup);
  const tickers = positions.map(p => canonicalTicker(p.ticker));
  const n = tickers.length;

  const matrix = {};
  let totalCorr = 0, pairCount = 0;

  for (let i = 0; i < n; i++) {
    const tA = tickers[i];
    matrix[tA] = {};
    for (let j = 0; j < n; j++) {
      const tB = tickers[j];
      if (i === j) {
        matrix[tA][tB] = 1.0;
      } else {
        const corr = Math.round(pairCorrelation(positions[i], positions[j]) * 100) / 100;
        matrix[tA][tB] = corr;
        if (j > i) { totalCorr += corr; pairCount++; }
      }
    }
  }

  // 2. Detect Clusters (Agglomerative style)
  const CLUSTER_THRESHOLD = 0.65;
  const clusters = [];
  const visited = new Set();

  for (let i = 0; i < n; i++) {
    const tA = tickers[i];
    if (visited.has(tA)) continue;

    const cluster = [tA];
    visited.add(tA);

    for (let j = i + 1; j < n; j++) {
      const tB = tickers[j];
      if (visited.has(tB)) continue;
      if (matrix[tA][tB] >= CLUSTER_THRESHOLD) {
        cluster.push(tB);
        visited.add(tB);
      }
    }

    if (cluster.length >= 2) {
      // Name cluster by dominant sector or assets
      const mainAsset = positions.find(p => canonicalTicker(p.ticker) === cluster[0]);
      const sector = normalizeSector(mainAsset?.mkt || mainAsset);
      clusters.push({
        name: `${sector} Cluster`,
        assets: cluster,
        avgCorr: Math.round(cluster.reduce((s, a) => s + cluster.reduce((s2, b) => s2 + (a===b?0:matrix[a][b]), 0), 0) / (cluster.length*(cluster.length-1)) * 100) / 100
      });
    }
  }

  const avgCorrelation = pairCount > 0 ? Math.round((totalCorr / pairCount) * 100) / 100 : 0;
  const warnings = [];
  if (avgCorrelation > 0.6) warnings.push("Elevada correlação sistémica — diversificação pode ser ilusória.");
  for (const c of clusters) {
    if (c.assets.length >= 3) warnings.push(`Cluster detetado: ${c.name} (${c.assets.join(", ")}). Risco de acoplamento.`);
  }

  return {
    matrix,
    tickers,
    clusters,
    avgCorrelation,
    warnings
  };
}

