// js/engines/valuation.js
// ═══════════════════════════════════════════════════════════════════
// VALUATION ENGINE (0–100)
// Sector-relative valuation: PE, Forward PE, PEG, EV/EBITDA,
// P/S, P/FCF, P/B — each scored relative to sector norms.
// "PE 30 em software ≠ PE 30 em bancos"
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, clamp, isValid, getAssetCategory, normalizeSector } from "../utils/normalize.js";

// ── Sector-relative PE ranges (PT canonical names only — D8.2) ──
const SECTOR_PE = {
  "Tecnologia":        { cheap: 18, fair: 28, expensive: 45 },
  "Saúde":             { cheap: 15, fair: 25, expensive: 40 },
  "Financeiros":       { cheap: 8,  fair: 13, expensive: 20 },
  "Energia":           { cheap: 8,  fair: 14, expensive: 22 },
  "Consumo Cíclico":   { cheap: 12, fair: 20, expensive: 35 },
  "Consumo Defensivo": { cheap: 14, fair: 20, expensive: 28 },
  "Industriais":       { cheap: 12, fair: 20, expensive: 30 },
  "Imobiliário":       { cheap: 15, fair: 30, expensive: 50 },
  "Materiais":         { cheap: 10, fair: 16, expensive: 25 },
  "Comunicações":      { cheap: 12, fair: 22, expensive: 35 },
  "Utilidades":        { cheap: 14, fair: 22, expensive: 32 },
  default:             { cheap: 12, fair: 20, expensive: 35 }
};

function getSectorPE(asset) {
  const sector = normalizeSector(asset);
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

// ── D9.2: Valuation relativa ao histórico da própria empresa (time-series) ──
// pe_percentil: onde o múltiplo actual se situa na distribuição dos últimos 5–10 anos
// da própria empresa (0 = mais barato de sempre, 100 = mais caro de sempre).
// Campos ainda não existem em acoesDividendos nesta base de dados (D9.2 audit,
// nenhuma ferramenta de reconstrução P/E encontrada no repo) — a função degrada
// automaticamente para "unavailable" até a ingestão desses campos ser construída.
function scoreHistoricalPE(asset) {
  const percentile = safeMetric(asset, "pe_percentil", "pe_hist_percentile");
  const median5y = safeMetric(asset, "pe_hist_median_5y", "pe_hist_median");
  if (!isFinite(percentile)) return { score: null, available: false };

  let s;
  if (percentile <= 20) s = 1.0;       // mais barato que o seu próprio histórico
  else if (percentile <= 40) s = 0.75;
  else if (percentile <= 60) s = 0.5;
  else if (percentile <= 80) s = 0.3;
  else s = 0.1;                        // mais caro que o seu próprio histórico

  return {
    score: s,
    value: percentile,
    medianPE: isFinite(median5y) ? median5y : null,
    available: true
  };
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

  const category = getAssetCategory(asset);

  // D8.1: ETFs must not be valued as stocks. A single metric (PE of fund wrapper)
  // does not represent look-through value. Return 50 with low confidence.
  if (category.includes("ETF")) {
    return {
      score: 50,
      classification: "Sem dados de valuation agregados",
      available: false,
      breakdown: { etf: true }
    };
  }

  if (category === "Commodity") {
    return {
      score: 50,
      classification: "Intrinsic Value / Hedge",
      breakdown: { commodity: true }
    };
  }

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

  const sectionalRaw = weightTotal > 0 ? weightedSum / weightTotal : 0.5;

  // D9.2: blend cross-sectional (vs setor) with time-series (vs próprio histórico), 60/40.
  // Sem histórico → 100% sectional, sem penalizar (rule D9 #1: degrada, nunca falha).
  const hist = scoreHistoricalPE(asset);
  const raw = hist.available ? (sectionalRaw * 0.6 + hist.score * 0.4) : sectionalRaw;
  const score = Math.round(clamp(raw * 100, 0, 100));

  // "Esticado vs histórico": percentil alto no próprio histórico, independente do setor —
  // pode passar despercebido se só se olhar ao PE setorial.
  const stretchedVsHistory = hist.available && hist.value >= 80;
  const cheapVsHistory = hist.available && hist.value <= 20;
  const cheapVsSector = sectionalRaw >= 0.65;
  const expensiveVsSector = sectionalRaw <= 0.35;

  let flag = null;
  if (cheapVsSector && stretchedVsHistory) flag = "value_trap";       // barato vs setor, caro vs próprio histórico
  else if (expensiveVsSector && cheapVsHistory) flag = "re_rating";   // caro vs setor, barato vs próprio histórico

  let classification;
  if (score >= 80) classification = "Deep Value / Bargain";
  else if (score >= 65) classification = "Undervalued";
  else if (score >= 45) classification = "Fairly Valued";
  else if (score >= 30) classification = "Overvalued";
  else classification = "Extremely Overvalued";
  if (stretchedVsHistory) classification += " — esticado vs histórico";

  return {
    score,
    classification,
    flag,
    historicalConfidence: hist.available ? "alta" : "reduzida (sem histórico próprio de múltiplos)",
    sectorBenchmark: sectorBounds,
    breakdown: {
      pe:     { ...pe, weight: W.pe },
      fpe:    { ...fpe, weight: W.fpe },
      peg:    { ...peg, weight: W.peg },
      eveb:   { ...eveb, weight: W.eveb },
      ps:     { ...ps, weight: W.ps },
      pfcf:   { ...pfcf, weight: W.pfcf },
      pb:     { ...pb, weight: W.pb },
      historical: hist
    }
  };
}
