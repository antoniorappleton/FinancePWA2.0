// js/engines/etf-overlap.js
// ═══════════════════════════════════════════════════════════════════
// ETF OVERLAP & HIDDEN CONCENTRATION ENGINE
// Detects: duplicate holdings, indirect exposure, hidden concentration.
// Example: VWCE + SEC0 + QDVE = massive exposure to MSFT, NVDA, AAPL
// ═══════════════════════════════════════════════════════════════════
import { qualityScore } from "./quality.js";

// ── Known ETF Holdings (top holdings with approximate weights) ──
// In production, this would come from an API. For now, static top-20 per ETF.
const ETF_HOLDINGS = {
  "VWCE": {
    name: "Vanguard FTSE All-World UCITS ETF",
    type: "Global Equity",
    top: [
      { ticker: "AAPL", weight: 4.8 }, { ticker: "MSFT", weight: 4.2 },
      { ticker: "NVDA", weight: 3.8 }, { ticker: "AMZN", weight: 2.5 },
      { ticker: "META", weight: 1.8 }, { ticker: "GOOGL", weight: 1.6 },
      { ticker: "TSLA", weight: 1.2 }, { ticker: "BRK.B", weight: 1.0 },
      { ticker: "JPM", weight: 0.9 },  { ticker: "V", weight: 0.8 }
    ],
    sectors: { Technology: 26, Financials: 16, Healthcare: 12, "Consumer Cyclical": 11, Industrials: 10, "Consumer Defensive": 6, Energy: 5, Telecom: 4, Utilities: 3, "Real Estate": 3, "Basic Materials": 4 },
    geography: { US: 62, Europe: 16, Japan: 6, UK: 4, China: 3, Other: 9 }
  },
  "IWDA": {
    name: "iShares Core MSCI World UCITS ETF",
    type: "Developed World Equity",
    top: [
      { ticker: "AAPL", weight: 5.2 }, { ticker: "MSFT", weight: 4.5 },
      { ticker: "NVDA", weight: 4.0 }, { ticker: "AMZN", weight: 2.7 },
      { ticker: "META", weight: 1.9 }, { ticker: "GOOGL", weight: 1.7 },
      { ticker: "TSLA", weight: 1.3 }, { ticker: "BRK.B", weight: 1.1 },
      { ticker: "JPM", weight: 1.0 },  { ticker: "UNH", weight: 0.9 }
    ],
    sectors: { Technology: 24, Financials: 15, Healthcare: 13, "Consumer Cyclical": 11, Industrials: 11 },
    geography: { US: 70, Japan: 6, UK: 4, France: 3, Canada: 3, Other: 14 }
  },
  "VUSA": {
    name: "Vanguard S&P 500 UCITS ETF",
    type: "US Large Cap",
    top: [
      { ticker: "AAPL", weight: 7.0 }, { ticker: "MSFT", weight: 6.5 },
      { ticker: "NVDA", weight: 5.8 }, { ticker: "AMZN", weight: 3.6 },
      { ticker: "META", weight: 2.5 }, { ticker: "GOOGL", weight: 2.0 },
      { ticker: "BRK.B", weight: 1.7 }, { ticker: "TSLA", weight: 1.6 },
      { ticker: "JPM", weight: 1.3 },  { ticker: "V", weight: 1.2 }
    ],
    sectors: { Technology: 31, Healthcare: 13, Financials: 13, "Consumer Cyclical": 10, Industrials: 9 },
    geography: { US: 100 }
  },
  "CSPX": {
    name: "iShares Core S&P 500 UCITS ETF",
    type: "US Large Cap",
    top: [
      { ticker: "AAPL", weight: 7.0 }, { ticker: "MSFT", weight: 6.5 },
      { ticker: "NVDA", weight: 5.8 }, { ticker: "AMZN", weight: 3.6 },
      { ticker: "META", weight: 2.5 }, { ticker: "GOOGL", weight: 2.0 },
      { ticker: "BRK.B", weight: 1.7 }, { ticker: "TSLA", weight: 1.6 },
      { ticker: "JPM", weight: 1.3 },  { ticker: "V", weight: 1.2 }
    ],
    sectors: { Technology: 31, Healthcare: 13, Financials: 13, "Consumer Cyclical": 10, Industrials: 9 },
    geography: { US: 100 }
  },
  "QDVE": {
    name: "iShares S&P 500 IT Sector UCITS ETF",
    type: "US Tech Sector",
    top: [
      { ticker: "AAPL", weight: 22 }, { ticker: "MSFT", weight: 20 },
      { ticker: "NVDA", weight: 18 }, { ticker: "AVGO", weight: 5 },
      { ticker: "ADBE", weight: 3 },  { ticker: "CRM", weight: 3 },
      { ticker: "AMD", weight: 2.5 }, { ticker: "ORCL", weight: 2 },
      { ticker: "ACN", weight: 1.8 }, { ticker: "CSCO", weight: 1.5 }
    ],
    sectors: { Technology: 100 },
    geography: { US: 100 }
  },
  "EUNL": {
    name: "iShares Core MSCI World UCITS ETF (EUR)",
    type: "Developed World Equity",
    top: [
      { ticker: "AAPL", weight: 5.2 }, { ticker: "MSFT", weight: 4.5 },
      { ticker: "NVDA", weight: 4.0 }, { ticker: "AMZN", weight: 2.7 },
      { ticker: "META", weight: 1.9 }, { ticker: "GOOGL", weight: 1.7 }
    ],
    sectors: { Technology: 24, Financials: 15, Healthcare: 13, Industrials: 11 },
    geography: { US: 70, Japan: 6, UK: 4, Other: 20 }
  }
};

// ── HHI-based diversity score (0 = 1 dominant, 1 = perfectly spread) ──
function hhiDiversityScore(weights) {
  const vals = Object.values(weights).map(Number).filter(v => v > 0);
  if (vals.length === 0) return null;
  const total = vals.reduce((a, b) => a + b, 0);
  const hhi = vals.reduce((sum, v) => sum + Math.pow(v / total, 2), 0);
  const n = vals.length;
  if (n === 1) return 0;
  return (1 - hhi) / (1 - 1 / n);
}

/**
 * Enrich an ETF asset object with sector diversity, geographic diversity,
 * and holdings quality scores derived from the acoesDividendos data map.
 * Attaches results as _etf* fields so the quality engine can consume them.
 *
 * @param {Object} etfAsset - The ETF document from acoesDividendos
 * @param {Map<string,Object>} allAssetsMap - Map of ticker → asset from acoesDividendos
 * @returns {Object} The same etfAsset object (mutated in-place)
 */
export function enrichETFAsset(etfAsset, allAssetsMap) {
  const ticker = String(etfAsset?.ticker || "").toUpperCase();
  const holdingsData = ETF_HOLDINGS[ticker];
  if (!holdingsData) return etfAsset;

  // 1. Sector diversification
  if (holdingsData.sectors && Object.keys(holdingsData.sectors).length > 0) {
    const score = hhiDiversityScore(holdingsData.sectors);
    if (score !== null) {
      etfAsset._etfSectorScore = Math.round(score * 100) / 100;
      etfAsset._etfSectorCount = Object.keys(holdingsData.sectors).length;
      etfAsset._etfDominantSector = Object.entries(holdingsData.sectors)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
  }

  // 2. Geographic diversification
  if (holdingsData.geography && Object.keys(holdingsData.geography).length > 0) {
    const score = hhiDiversityScore(holdingsData.geography);
    if (score !== null) {
      etfAsset._etfGeoScore = Math.round(score * 100) / 100;
      etfAsset._etfGeoCount = Object.keys(holdingsData.geography).length;
      etfAsset._etfDominantRegion = Object.entries(holdingsData.geography)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
  }

  // 3. Holdings quality — look up each top holding in acoesDividendos
  if (allAssetsMap && holdingsData.top?.length > 0) {
    let weightedQuality = 0;
    let totalCoveredWeight = 0;
    const details = [];

    for (const h of holdingsData.top) {
      const holdingAsset = allAssetsMap.get(h.ticker.toUpperCase());
      if (holdingAsset) {
        const q = qualityScore(holdingAsset);
        const w = h.weight / 100;
        weightedQuality += q.score * w;
        totalCoveredWeight += w;
        details.push({ ticker: h.ticker, weight: h.weight, quality: q.score, classification: q.classification });
      }
    }

    if (totalCoveredWeight > 0) {
      etfAsset._etfHoldingsQuality = Math.round(weightedQuality / totalCoveredWeight);
      etfAsset._etfHoldingsCoverage = Math.round(totalCoveredWeight * 100) / 100;
      etfAsset._etfHoldingsDetails = details;
    }
  }

  return etfAsset;
}

/**
 * Analyze overlap between ETFs in the portfolio.
 * @param {Array} portfolio - Array of { ticker, valAtual }
 * @returns {{ overlaps: Array, effectiveExposure: Object, hiddenConcentration: Array, warnings: Array }}
 */
export function analyzeETFOverlap(portfolio) {
  const etfPositions = [];
  const stockPositions = [];
  const totalValue = portfolio.reduce((s, p) => s + (p.valAtual || 0), 0) || 1;

  for (const p of portfolio) {
    const ticker = String(p.ticker || "").toUpperCase();
    if (ETF_HOLDINGS[ticker]) {
      etfPositions.push({ ...p, ticker, holdings: ETF_HOLDINGS[ticker] });
    } else {
      stockPositions.push({ ...p, ticker });
    }
  }

  if (etfPositions.length === 0) {
    return { overlaps: [], effectiveExposure: {}, hiddenConcentration: [], warnings: ["Nenhum ETF reconhecido no portfólio"] };
  }

  // ── 1. Calculate effective exposure per holding ──
  const effectiveExposure = {};

  for (const etf of etfPositions) {
    const etfWeight = (etf.valAtual || 0) / totalValue;
    for (const h of etf.holdings.top) {
      const key = h.ticker;
      if (!effectiveExposure[key]) effectiveExposure[key] = { ticker: key, directPct: 0, indirectPct: 0, sources: [] };
      effectiveExposure[key].indirectPct += (h.weight / 100) * etfWeight * 100;
      effectiveExposure[key].sources.push({ via: etf.ticker, weight: h.weight });
    }
  }

  // Add direct stock positions
  for (const stock of stockPositions) {
    const key = stock.ticker;
    if (!effectiveExposure[key]) effectiveExposure[key] = { ticker: key, directPct: 0, indirectPct: 0, sources: [] };
    effectiveExposure[key].directPct += ((stock.valAtual || 0) / totalValue) * 100;
    effectiveExposure[key].sources.push({ via: "Direto", weight: null });
  }

  // Calculate total and sort
  for (const key of Object.keys(effectiveExposure)) {
    const e = effectiveExposure[key];
    e.totalPct = Math.round((e.directPct + e.indirectPct) * 100) / 100;
  }

  const exposureSorted = Object.values(effectiveExposure)
    .filter(e => e.totalPct > 0.1)
    .sort((a, b) => b.totalPct - a.totalPct);

  // ── 2. Detect pairwise ETF overlap ──
  const overlaps = [];
  for (let i = 0; i < etfPositions.length; i++) {
    for (let j = i + 1; j < etfPositions.length; j++) {
      const a = etfPositions[i], b = etfPositions[j];
      const aHoldings = new Set(a.holdings.top.map(h => h.ticker));
      const bHoldings = new Set(b.holdings.top.map(h => h.ticker));
      const common = [...aHoldings].filter(t => bHoldings.has(t));
      const overlapPct = Math.round((common.length / Math.min(aHoldings.size, bHoldings.size)) * 100);

      if (common.length > 0) {
        overlaps.push({
          etf1: a.ticker, etf2: b.ticker,
          commonHoldings: common,
          overlapPct,
          severity: overlapPct > 70 ? "high" : overlapPct > 40 ? "medium" : "low"
        });
      }
    }
  }

  // ── 3. Hidden concentration warnings ──
  const hiddenConcentration = exposureSorted
    .filter(e => e.totalPct > 3.0)
    .map(e => ({
      ticker: e.ticker,
      totalPct: e.totalPct,
      directPct: Math.round(e.directPct * 100) / 100,
      indirectPct: Math.round(e.indirectPct * 100) / 100,
      sources: e.sources
    }));

  // ── 4. Warnings ──
  const warnings = [];
  for (const h of hiddenConcentration) {
    if (h.totalPct > 8) {
      warnings.push(`⚠️ ${h.ticker}: exposição total de ${h.totalPct.toFixed(1)}% (${h.directPct.toFixed(1)}% direto + ${h.indirectPct.toFixed(1)}% via ETFs)`);
    }
  }
  for (const o of overlaps) {
    if (o.overlapPct > 60) {
      warnings.push(`ETFs ${o.etf1} e ${o.etf2} têm ${o.overlapPct}% de sobreposição — considerar consolidar`);
    }
  }

  return {
    overlaps,
    effectiveExposure: exposureSorted.slice(0, 20),
    hiddenConcentration,
    warnings,
    etfCount: etfPositions.length,
    knownETFs: etfPositions.map(e => e.ticker)
  };
}

/**
 * Get smart ETF analysis for a single ETF.
 */
export function smartETFAnalysis(ticker) {
  const t = String(ticker || "").toUpperCase();
  const data = ETF_HOLDINGS[t];
  if (!data) return null;

  const top10Weight = data.top.reduce((s, h) => s + h.weight, 0);

  return {
    ticker: t,
    name: data.name,
    type: data.type,
    topHoldings: data.top,
    top10Concentration: Math.round(top10Weight * 10) / 10,
    sectors: data.sectors,
    geography: data.geography,
    warnings: top10Weight > 40
      ? [`Top 10 holdings representam ${top10Weight.toFixed(1)}% — ETF muito concentrado`]
      : []
  };
}

/**
 * Check if ETF_HOLDINGS has data for a given ticker.
 */
export function isKnownETF(ticker) {
  return !!ETF_HOLDINGS[String(ticker || "").toUpperCase()];
}
