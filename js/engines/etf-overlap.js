// js/engines/etf-overlap.js
// ═══════════════════════════════════════════════════════════════════
// ETF OVERLAP & HIDDEN CONCENTRATION ENGINE
// Detects: duplicate holdings, indirect exposure, hidden concentration.
// Example: VWCE + SEC0 + QDVE = massive exposure to MSFT, NVDA, AAPL
// ═══════════════════════════════════════════════════════════════════
import { qualityScore } from "./quality.js";
import { getConcentrationLimits } from "../utils/normalize.js";

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
  "QDVF": {
    name: "iShares S&P 500 Energy Sector UCITS ETF",
    type: "US Energy Sector",
    top: [
      { ticker: "XOM",  weight: 22 }, { ticker: "CVX",  weight: 15 },
      { ticker: "COP",  weight: 8  }, { ticker: "EOG",  weight: 5  },
      { ticker: "SLB",  weight: 5  }, { ticker: "MPC",  weight: 4  },
      { ticker: "PSX",  weight: 4  }, { ticker: "VLO",  weight: 3.5 },
      { ticker: "PXD",  weight: 3  }, { ticker: "OXY",  weight: 3  }
    ],
    sectors: { Energy: 100 },
    geography: { US: 100 }
  },
  "QDVG": {
    name: "iShares S&P 500 Health Care Sector UCITS ETF",
    type: "US Health Care Sector",
    top: [
      { ticker: "LLY",  weight: 14 }, { ticker: "UNH",  weight: 12 },
      { ticker: "JNJ",  weight: 9  }, { ticker: "ABBV", weight: 7  },
      { ticker: "MRK",  weight: 6  }, { ticker: "ABT",  weight: 5  },
      { ticker: "TMO",  weight: 4  }, { ticker: "DHR",  weight: 3.5 },
      { ticker: "AMGN", weight: 3  }, { ticker: "PFE",  weight: 3  }
    ],
    sectors: { Healthcare: 100 },
    geography: { US: 100 }
  },
  "JEDI": {
    name: "VanEck Space Innovators UCITS ETF",
    type: "Thematic — Space & Aerospace",
    top: [
      { ticker: "RKLB", weight: 8.5 }, { ticker: "ASTS",  weight: 7.2 },
      { ticker: "SPCE", weight: 5.1 }, { ticker: "MAXR",  weight: 4.8 },
      { ticker: "ASTR", weight: 4.2 }, { ticker: "MNTS",  weight: 3.9 },
      { ticker: "LUNR", weight: 3.6 }, { ticker: "BKSY",  weight: 3.2 },
      { ticker: "RDW",  weight: 2.9 }, { ticker: "SATL",  weight: 2.5 }
    ],
    sectors: { Industrials: 45, Technology: 38, "Consumer Cyclical": 10, Materials: 7 },
    geography: { US: 72, Europe: 15, Japan: 7, Other: 6 }
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
  },
  "GRID": {
    name: "iShares Global Clean Energy UCITS ETF",
    type: "Thematic — Clean Energy",
    top: [
      { ticker: "ENPH",  weight: 7.2 }, { ticker: "FSLR",  weight: 6.8 },
      { ticker: "NEE",   weight: 5.9 }, { ticker: "PLUG",  weight: 4.1 },
      { ticker: "BE",    weight: 3.7 }, { ticker: "RUN",   weight: 3.4 },
      { ticker: "SEDG",  weight: 3.2 }, { ticker: "NOVA",  weight: 2.8 },
      { ticker: "ARRY",  weight: 2.5 }, { ticker: "CSIQ",  weight: 2.1 }
    ],
    sectors: { Utilities: 52, Technology: 24, Industrials: 16, "Basic Materials": 8 },
    geography: { US: 42, Europe: 33, China: 9, Canada: 4, Other: 12 }
  },
  "IS3N": {
    name: "iShares Core MSCI EM IMI UCITS ETF",
    type: "Emerging Markets Equity",
    top: [
      { ticker: "TSM",  weight: 6.8 }, { ticker: "BABA",  weight: 3.2 },
      { ticker: "RELIANCE", weight: 2.4 }, { ticker: "VALE", weight: 2.1 },
      { ticker: "ITUB", weight: 1.8 }, { ticker: "PBR",  weight: 1.6 },
      { ticker: "INFY", weight: 1.5 }, { ticker: "TCS",  weight: 1.4 },
      { ticker: "HDFC", weight: 1.2 }, { ticker: "JD",   weight: 1.1 }
    ],
    sectors: { Technology: 25, Financials: 22, "Consumer Cyclical": 14, "Basic Materials": 8, Energy: 7, Industrials: 7, "Consumer Defensive": 6, Healthcare: 5, Utilities: 4, Other: 2 },
    geography: { China: 28, India: 19, Taiwan: 17, "South Korea": 11, Brazil: 5, "South Africa": 4, Other: 16 }
  }
};

// ── HHI-based diversity score (0 = 1 dominant, 1 = perfectly spread) ──
function toPercentWeight(value) {
  let n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 1) return n * 100;
  while (n > 100) n /= 100;
  return n;
}

function normalizeCompositionObject(input) {
  if (!input) return null;
  if (!Array.isArray(input) && typeof input === "object") {
    const out = {};
    Object.entries(input).forEach(([key, value]) => {
      const n = toPercentWeight(value);
      if (key && n > 0) out[key] = Math.round(n * 100) / 100;
    });
    return Object.keys(out).length ? out : null;
  }
  if (!Array.isArray(input)) return null;

  const out = {};
  input.forEach(row => {
    const name = String(row?.name || row?.label || row?.sector || row?.country || "").trim();
    const n = toPercentWeight(row?.weight ?? row?.value);
    if (name && n > 0) out[name] = Math.round(n * 100) / 100;
  });
  return Object.keys(out).length ? out : null;
}

function normalizeTopHoldings(input) {
  if (!Array.isArray(input)) return [];
  return input.map(row => {
    const ticker = String(row?.ticker || row?.symbol || row?.name || "").trim().toUpperCase();
    const name = String(row?.name || row?.symbol || row?.ticker || "").trim();
    const weight = toPercentWeight(row?.weight ?? row?.Weight ?? row?.value);
    return ticker && weight > 0
      ? { ticker, name: name || ticker, weight: Math.round(weight * 100) / 100 }
      : null;
  }).filter(Boolean);
}

function resolveETFHoldings(assetOrTicker) {
  const asset = typeof assetOrTicker === "object" && assetOrTicker !== null ? assetOrTicker : null;
  const ticker = String(asset?.ticker || assetOrTicker || "").toUpperCase();
  const staticData = ETF_HOLDINGS[ticker] || null;
  const manualTop = normalizeTopHoldings(asset?.holdings);
  const manualSectors = normalizeCompositionObject(asset?.sectors || asset?.sector_weights || asset?.sectorAllocation);
  const manualGeography = normalizeCompositionObject(asset?.geography || asset?.geo || asset?.country_weights || asset?.countryAllocation);

  if (!staticData && !manualTop.length && !manualSectors && !manualGeography) return null;

  return {
    ...(staticData || {}),
    name: asset?.nome || asset?.name || staticData?.name || ticker,
    type: staticData?.type || asset?.setor || asset?.assetType || "ETF",
    top: manualTop.length ? manualTop : (staticData?.top || []),
    sectors: manualSectors || staticData?.sectors || null,
    geography: manualGeography || staticData?.geography || null
  };
}
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
  const holdingsData = resolveETFHoldings(etfAsset);
  if (!holdingsData) return etfAsset;

  // 1. Sector diversification
  if (holdingsData.sectors && Object.keys(holdingsData.sectors).length > 0) {
    etfAsset._etfSectors = holdingsData.sectors;
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
    etfAsset._etfGeography = holdingsData.geography;
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
 * @param {Object} [strategy={}] - config/strategy (usa singleStockCapPct para o limiar de concentração efetiva)
 * @returns {{ overlaps: Array, effectiveExposure: Object, hiddenConcentration: Array, warnings: Array }}
 */
export function analyzeETFOverlap(portfolio, strategy = {}) {
  const singleStockLimitPct = getConcentrationLimits(strategy)["Single Stock"] * 100;
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
  // Threshold de aviso fica um pouco abaixo do limite de posição única (D9 audit):
  // sem isso, a mensagem só dizia "X% de exposição" sem indicar se isso é ou não um
  // problema — obrigava o leitor a saber de cor o limite ideal. Agora compara
  // explicitamente com o limite configurado e só soa alarme quando o excede.
  const warnings = [];
  for (const h of hiddenConcentration) {
    if (h.totalPct > singleStockLimitPct * 0.8) {
      const overLimit = h.totalPct > singleStockLimitPct;
      const viaETFs = h.indirectPct > 0.05
        ? ` (${h.directPct.toFixed(1)}% direto + ${h.indirectPct.toFixed(1)}% via ETFs que o replicam)`
        : "";
      const verdict = overLimit
        ? `acima do limite de ${singleStockLimitPct.toFixed(0)}% por posição única — considerar reduzir a posição direta e/ou os ETFs que o sobreponham`
        : `perto do limite de ${singleStockLimitPct.toFixed(0)}% por posição única — vigiar antes de reforçar`;
      warnings.push(`${h.ticker}: exposição efetiva de ${h.totalPct.toFixed(1)}%${viaETFs} — ${verdict}`);
    }
  }
  for (const o of overlaps) {
    if (o.overlapPct > 60) {
      warnings.push(`ETFs ${o.etf1} e ${o.etf2} partilham ${o.overlapPct}% das principais posições (${o.commonHoldings.slice(0, 5).join(", ")}) — a diversificação entre eles é menor do que parece; considerar consolidar num só`);
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
  const t = String((typeof ticker === "object" ? ticker?.ticker : ticker) || "").toUpperCase();
  const data = resolveETFHoldings(ticker);
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
