import { safeMetric, safePercent, clamp, isValid, getAssetCategory, HEALTHY_LIMITS, validBeta, normalizeSector } from "../utils/normalize.js";

function _sectorKey(p) {
  return normalizeSector(p.mkt || p) || "Outros";
}

/**
 * Calculate Concentration Risk with contextual awareness.
 * Healthy: Diversified broad ETFs. Risky: Heavy single stock positions.
 */
export function calculateConcentrationRisk(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) return { score: 100, warnings: [] };

  const total = Math.max(totalValue, 1);
  let penaltyTotal = 0;
  const warnings = [];

  for (const p of portfolio) {
    const category = getAssetCategory(p.mkt || p);
    const weight = (p.valAtual || 0) / total;
    const limit = HEALTHY_LIMITS[category] || 0.10;

    if (weight > limit) {
      const excess = weight - limit;
      // Penalty is quadratic to punish extreme concentration
      penaltyTotal += Math.pow(excess * 10, 2);
      
      const ticker = String(p.ticker || "").toUpperCase();
      warnings.push(`Concentração excessiva em ${ticker} (${category}): ${(weight * 100).toFixed(1)}% (Limite ideal: ${limit * 100}%)`);
    }
  }

  // 100 is perfect, 0 is extreme concentration
  const score = Math.round(clamp(100 - penaltyTotal, 0, 100));
  return { score, warnings };
}

/**
 * Decomposed Risk Analysis for a portfolio.
 * @param {Object} [options={}]
 * @param {number} [options.sectorConcentrationLimitPct=35] - Limite setorial em % (D3)
 */
export function portfolioRiskDecomposition(portfolio, totalValue, avgCorrelation, options = {}) {
  const conc = calculateConcentrationRisk(portfolio, totalValue);
  
  // 1. Volatility Risk (Weighted Beta)
  // Skip assets without valid beta — do not assume 1.0 (D7.2)
  let weightedBeta = 0, betaWeightSum = 0;
  for (const p of portfolio) {
    const w = (p.valAtual || 0) / totalValue;
    const b = validBeta(p.mkt || p);
    if (b !== null) { weightedBeta += b * w; betaWeightSum += w; }
  }
  const avgBeta = betaWeightSum > 0 ? weightedBeta / betaWeightSum : null;
  const volatilityRisk = avgBeta !== null ? Math.round(clamp(avgBeta * 40, 0, 100)) : 50;

  // 2. Correlation/Diversification Risk
  const correlationRisk = Math.round(avgCorrelation * 100);

  // 3. Macro/Sector Risk — look-through for ETFs (D8.5)
  // ETFs with _etfSectors are disaggregated by actual holdings; others use top-level sector.
  const sectorMap = {};
  for (const p of portfolio) {
    const asset = p.mkt || p;
    const w = (p.valAtual || 0) / totalValue;
    if (asset._etfSectors && typeof asset._etfSectors === "object") {
      const pctValues = Object.values(asset._etfSectors);
      const total = pctValues.reduce((a, b) => a + Number(b), 0) || 100;
      for (const [sec, pct] of Object.entries(asset._etfSectors)) {
        const sKey = normalizeSector({ sector: sec });
        sectorMap[sKey] = (sectorMap[sKey] || 0) + w * (Number(pct) / total);
      }
    } else {
      const s = _sectorKey(p);
      sectorMap[s] = (sectorMap[s] || 0) + w;
    }
  }
  const sectorLimit = (Number(options.sectorConcentrationLimitPct) || 35) / 100;
  let macroRisk = 0;
  for (const w of Object.values(sectorMap)) {
    if (w > sectorLimit) macroRisk += (w - sectorLimit) * 100;
  }
  macroRisk = Math.round(clamp(macroRisk, 0, 100));

  // 4. Resilience Score (Higher is better)
  // Weighted: 40% Diversification, 30% Volatility (Beta), 30% Concentration
  const resilienceScore = Math.round(
    (100 - correlationRisk) * 0.4 +
    (100 - volatilityRisk) * 0.3 +
    conc.score * 0.3
  );

  return {
    resilienceScore,
    decomposition: {
      volatility: volatilityRisk,
      concentration: 100 - conc.score,
      macro: macroRisk,
      correlation: correlationRisk
    },
    avgBeta,
    warnings: conc.warnings
  };
}

/**
 * Individual Asset Risk Score.
 */
export function riskScore(asset) {
  if (!asset) return { score: 50, classification: "Unknown", crashSensitivity: {}, warnings: [], breakdown: {} };

  const beta = validBeta(asset);
  const category = getAssetCategory(asset);

  // Beta absent or out of sanity range → indeterminate risk (D7.2)
  if (beta === null) {
    return {
      score: 50,
      classification: "Indeterminado",
      category,
      beta: null,
      betaAvailable: false,
      warnings: ["Beta não disponível — risco indeterminado"],
    };
  }

  // Base score from Beta
  let bScore = 1 - clamp((beta - 0.5) / 1.5, 0, 1); // Beta 0.5=100%, Beta 2.0=0%

  // Category adjustment
  if (category === "Broad Market ETF") bScore = Math.max(bScore, 0.85);
  else if (category === "Speculative Asset") bScore = Math.min(bScore, 0.30);

  const score = Math.round(bScore * 100);

  // Classification
  let classification;
  if (score >= 80) classification = "Stable / Core";
  else if (score >= 65) classification = "Moderate";
  else if (score >= 45) classification = "Aggressive";
  else classification = "Speculative";

  return {
    score,
    classification,
    category,
    beta,
    betaAvailable: true,
    warnings: beta > 1.8 ? ["Volatilidade histórica extrema"] : [],
  };
}
