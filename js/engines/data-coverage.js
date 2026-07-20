// js/engines/data-coverage.js
// ═══════════════════════════════════════════════════════════════════
// DATA COVERAGE REPORT (D9.6)
// Per-asset audit of which critical fields are missing (beta, stock
// fundamentals, ETF composition, historical multiples). Purely informational —
// never blocks or penalizes scoring; only tells the user where the risk
// analysis is resting on placeholders.
// ═══════════════════════════════════════════════════════════════════

import { validBeta, getAssetCategory, isValid } from "../utils/normalize.js";

const STOCK_FUNDAMENTAL_FIELDS = ["pe", "roic", "roe", "debt_eq", "epsYoY"];
const ETF_COMPOSITION_FIELDS = ["ter", "holdings_count"];
// D9.2 not yet shipped — these fields don't exist in acoesDividendos yet, so every
// asset degrades to "missing" here until the historical-valuation ingestion lands.
const HISTORICAL_MULTIPLE_FIELDS = ["pe_hist_median_5y", "pe_percentil"];

/**
 * Audit a single asset's market data for missing critical fields.
 * @returns {{ ticker: string, category: string, checks: number, missingCount: number,
 *             coveragePct: number, missing: string[] }}
 */
function auditAsset(asset) {
  const ticker = asset?.ticker || "—";
  const category = getAssetCategory(asset || {});
  const missing = [];
  let checks = 0;

  // Beta — every asset needs it for stress-test/factor projections.
  checks++;
  if (validBeta(asset) === null) missing.push("Beta");

  // Category-specific fundamentals.
  if (category === "Commodity") {
    // No fundamentals or composition applicable — skip those checks entirely.
  } else if (category.includes("ETF")) {
    checks += ETF_COMPOSITION_FIELDS.length;
    const missingEtf = ETF_COMPOSITION_FIELDS.filter(k => !isValid(asset?.[k]));
    if (missingEtf.length) missing.push("Composição de ETF");
  } else {
    checks += STOCK_FUNDAMENTAL_FIELDS.length;
    const missingStock = STOCK_FUNDAMENTAL_FIELDS.filter(k => !isValid(asset?.[k]));
    if (missingStock.length) missing.push("Fundamentais de stock");
  }

  // Historical multiples (time-series valuation — D9.2).
  checks += HISTORICAL_MULTIPLE_FIELDS.length;
  const missingHist = HISTORICAL_MULTIPLE_FIELDS.filter(k => !isValid(asset?.[k]));
  if (missingHist.length) missing.push("Histórico de múltiplos");

  const missingCount = missing.reduce((sum, label) => {
    if (label === "Beta") return sum + 1;
    if (label === "Composição de ETF") return sum + ETF_COMPOSITION_FIELDS.filter(k => !isValid(asset?.[k])).length;
    if (label === "Fundamentais de stock") return sum + STOCK_FUNDAMENTAL_FIELDS.filter(k => !isValid(asset?.[k])).length;
    if (label === "Histórico de múltiplos") return sum + HISTORICAL_MULTIPLE_FIELDS.length;
    return sum;
  }, 0);

  const coveragePct = checks > 0 ? Math.round(((checks - missingCount) / checks) * 100) : 100;

  return { ticker, category, checks, missingCount, coveragePct, missing };
}

/**
 * Build a portfolio-wide data coverage report.
 * @param {Array} portfolio - Array of { ticker, valAtual, mkt }
 * @returns {{ overallPct: number, assets: Array, worstAssets: Array }}
 */
export function dataCoverageReport(portfolio) {
  if (!portfolio || !portfolio.length) return { overallPct: 100, assets: [], worstAssets: [] };

  const totalValue = portfolio.reduce((s, p) => s + (p.valAtual || 0), 0) || 1;

  const assets = portfolio.map(p => {
    const audit = auditAsset(p.mkt || p);
    return { ...audit, ticker: p.ticker || audit.ticker, weight: (p.valAtual || 0) / totalValue };
  });

  const overallPct = Math.round(
    assets.reduce((sum, a) => sum + a.coveragePct * a.weight, 0)
  );

  const worstAssets = assets
    .filter(a => a.missing.length > 0)
    .sort((a, b) => a.coveragePct - b.coveragePct || b.weight - a.weight);

  return { overallPct, assets, worstAssets };
}
