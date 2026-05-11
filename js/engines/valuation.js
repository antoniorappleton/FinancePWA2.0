// js/engines/valuation.js
// ═══════════════════════════════════════════════════════════════════
// VALUATION ENGINE (0–100)
// Sector-relative valuation: PE, Forward PE, PEG, EV/EBITDA,
// P/S, P/FCF, P/B — each scored relative to sector norms.
// "PE 30 em software ≠ PE 30 em bancos"
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, clamp, isValid } from "../utils/normalize.js";

// ── Sector-relative PE ranges ──
// { median, cheap, expensive } — where cheap is a good score
const SECTOR_PE = {
  "Technology":         { cheap: 18, fair: 28, expensive: 45 },
  "Tecnologia":         { cheap: 18, fair: 28, expensive: 45 },
  "Healthcare":         { cheap: 15, fair: 25, expensive: 40 },
  "Saúde":              { cheap: 15, fair: 25, expensive: 40 },
  "Financials":         { cheap: 8,  fair: 13, expensive: 20 },
  "Financeiros":        { cheap: 8,  fair: 13, expensive: 20 },
  "Energy":             { cheap: 8,  fair: 14, expensive: 22 },
  "Energia":            { cheap: 8,  fair: 14, expensive: 22 },
  "Consumer Cyclical":  { cheap: 12, fair: 20, expensive: 35 },
  "Consumo Cíclico":    { cheap: 12, fair: 20, expensive: 35 },
  "Consumer Defensive": { cheap: 14, fair: 20, expensive: 28 },
  "Consumo Defensivo":  { cheap: 14, fair: 20, expensive: 28 },
  "Industrials":        { cheap: 12, fair: 20, expensive: 30 },
  "Industriais":        { cheap: 12, fair: 20, expensive: 30 },
  "Real Estate":        { cheap: 15, fair: 30, expensive: 50 },
  "Imobiliário":        { cheap: 15, fair: 30, expensive: 50 },
  "Materials":          { cheap: 10, fair: 16, expensive: 25 },
  "Materiais":          { cheap: 10, fair: 16, expensive: 25 },
  default:              { cheap: 12, fair: 20, expensive: 35 }
};

function getSectorPE(asset) {
  const sector = asset.setor || asset.sector || "";
  return SECTOR_PE[sector] || SECTOR_PE.default;
}

// ── Sub-scorers ──

function scorePE(asset, sectorBounds) {
  const pe = safeMetric(asset, "pe", "p_e", "PE", "forward_pe", "forward_p_e");
  if (!isFinite(pe) || pe <= 0) return { score: 0.3, available: pe <= 0, value: pe, note: pe < 0 ? "EPS negativo" : "N/A" };

  const { cheap, fair, expensive } = sectorBounds;
  let s;
  if (pe <= cheap) s = 1.0;          // Bargain for sector
  else if (pe <= fair) s = 0.7;      // Fair value
  else if (pe <= expensive) s = 0.4; // Getting expensive
  else s = 0.1;                      // Overvalued

  return { score: s, value: pe, available: true, sectorBounds };
}

function scoreForwardPE(asset, sectorBounds) {
  const fpe = safeMetric(asset, "forward_pe", "forwardPE", "fpe", "forward_p_e");
  const pe = safeMetric(asset, "pe", "p_e");
  if (!isFinite(fpe) || fpe <= 0) return { score: 0.5, available: false };

  const { cheap, fair, expensive } = sectorBounds;
  // Forward PE discount is a strong positive signal
  let s;
  if (fpe <= cheap * 0.9) s = 1.0;
  else if (fpe <= fair) s = 0.7;
  else if (fpe <= expensive) s = 0.4;
  else s = 0.15;

  // Bonus if Forward PE < trailing PE (earnings acceleration)
  const bonus = (isFinite(pe) && pe > 0 && fpe < pe) ? 0.1 : 0;

  return { score: clamp(s + bonus, 0, 1), value: fpe, available: true, earningsAccelerating: fpe < pe };
}

function scorePEG(asset) {
  const peg = safeMetric(asset, "peg", "PEG");
  if (!isFinite(peg) || peg <= 0) return { score: 0.5, available: false };

  let s;
  if (peg < 0.5) s = 1.0;       // Outstanding value-growth
  else if (peg < 1.0) s = 0.85; // Excellent
  else if (peg < 1.5) s = 0.6;  // Fair
  else if (peg < 2.5) s = 0.35; // Expensive
  else s = 0.1;                  // Very expensive growth

  return { score: s, value: peg, available: true };
}

function scoreEVEBITDA(asset) {
  const ev = safeMetric(asset, "ev_ebitda", "evEbitda", "EV_EBITDA", "EV/Ebitda", "ev_ebitda_ttm");
  if (!isFinite(ev) || ev <= 0) return { score: 0.5, available: false };

  let s;
  if (ev < 8) s = 1.0;          // Very cheap
  else if (ev < 12) s = 0.8;    // Fair
  else if (ev < 18) s = 0.5;    // Getting expensive
  else if (ev < 25) s = 0.3;
  else s = 0.1;

  return { score: s, value: ev, available: true };
}

function scorePriceSales(asset) {
  const ps = safeMetric(asset, "p_s", "priceToSales", "PS");
  if (!isFinite(ps) || ps <= 0) return { score: 0.5, available: false };

  let s;
  if (ps < 1.0) s = 1.0;
  else if (ps < 3.0) s = 0.75;
  else if (ps < 8.0) s = 0.45;
  else if (ps < 15) s = 0.2;
  else s = 0.05;

  return { score: s, value: ps, available: true };
}

function scorePriceFCF(asset) {
  const pfcf = safeMetric(asset, "p_fcf", "priceToFCF", "PFCF", "p_fcf_ttm", "price_fcf");
  if (!isFinite(pfcf) || pfcf <= 0) return { score: 0.5, available: false };

  let s;
  if (pfcf < 10) s = 1.0;
  else if (pfcf < 18) s = 0.75;
  else if (pfcf < 30) s = 0.45;
  else s = 0.15;

  return { score: s, value: pfcf, available: true };
}

function scorePriceBook(asset) {
  const pb = safeMetric(asset, "p_b", "priceToBook", "PB");
  if (!isFinite(pb) || pb <= 0) return { score: 0.5, available: false };

  let s;
  if (pb < 1.0) s = 1.0;        // Below book value
  else if (pb < 2.0) s = 0.7;
  else if (pb < 4.0) s = 0.45;
  else if (pb < 8.0) s = 0.25;
  else s = 0.1;

  return { score: s, value: pb, available: true };
}

// ══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════

/**
 * Calculate Valuation Score for a single asset, sector-adjusted.
 * @param {Object} asset
 * @returns {{ score: number, classification: string, breakdown: Object }}
 */
export function valuationScore(asset) {
  if (!asset) return { score: 50, classification: "Unknown", breakdown: {} };

  const sectorBounds = getSectorPE(asset);

  const pe      = scorePE(asset, sectorBounds);
  const fpe     = scoreForwardPE(asset, sectorBounds);
  const peg     = scorePEG(asset);
  const eveb    = scoreEVEBITDA(asset);
  const ps      = scorePriceSales(asset);
  const pfcf    = scorePriceFCF(asset);
  const pb      = scorePriceBook(asset);

  // Weighted: PE and PEG are most important for stocks
  const W = { pe: 0.25, fpe: 0.15, peg: 0.20, eveb: 0.15, ps: 0.05, pfcf: 0.10, pb: 0.10 };
  const components = { pe, fpe, peg, eveb, ps, pfcf, pb };

  let weightedSum = 0, weightTotal = 0;

  for (const [key, comp] of Object.entries(components)) {
    const w = W[key];
    if (comp.available !== false) {
      weightedSum += comp.score * w;
      weightTotal += w;
    }
  }

  const raw = weightTotal > 0 ? weightedSum / weightTotal : 0.5;
  const score = Math.round(clamp(raw * 100, 0, 100));

  let classification;
  if (score >= 80) classification = "Deep Value / Bargain";
  else if (score >= 65) classification = "Undervalued";
  else if (score >= 45) classification = "Fairly Valued";
  else if (score >= 30) classification = "Overvalued";
  else classification = "Extremely Overvalued";

  return {
    score,
    classification,
    sectorBenchmark: sectorBounds,
    breakdown: {
      pe:     { ...pe, weight: W.pe },
      fpe:    { ...fpe, weight: W.fpe },
      peg:    { ...peg, weight: W.peg },
      eveb:   { ...eveb, weight: W.eveb },
      ps:     { ...ps, weight: W.ps },
      pfcf:   { ...pfcf, weight: W.pfcf },
      pb:     { ...pb, weight: W.pb }
    }
  };
}
