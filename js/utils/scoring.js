// js/utils/scoring.js

export const SCORING_CFG = {
  MAX_ANNUAL_RETURN: 0.8,
  MIN_ANNUAL_RETURN: -0.8,
  WEIGHTS: { R: 0.35, V: 0.15, T: 0.2, D: 0.15, E: 0.1, Rsk: 0.05 },
  BLEND_WEIGHTS: {
    "1s": { w: 0.75, m: 0.15, y: 0.1 },
    "1m": { w: 0.1, m: 0.75, y: 0.15 },
    "1ano": { w: 0.1, m: 0.15, y: 0.75 },
  },
  REALISM_CAP: { enabled: false, trigger: 0.9, cap: 0.95 },
  EVEBITDA_ANCHORS: {
    default: { lo: 6, hi: 20 },
    Tecnologia: { lo: 8, hi: 25 },
    Saúde: { lo: 7, hi: 22 },
    "Consumo Cíclico": { lo: 7, hi: 22 },
    Consumo: { lo: 7, hi: 22 },
    Indústria: { lo: 6, hi: 20 },
    Financeiro: { lo: 5, hi: 16 },
    Utilities: { lo: 5, hi: 14 },
    Energia: { lo: 5, hi: 14 },
    Imobiliário: { lo: 6, hi: 18 },
  },
};

function asRate(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) > 1 ? n / 100 : n;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function annualizeRate(row, periodoSel) {
  const w = asRate(row.taxaCrescimento_1semana || row.g1w);
  const m = asRate(row.taxaCrescimento_1mes || row.g1m);
  const y = asRate(row.taxaCrescimento_1ano || row.g1y);

  const rw = Math.pow(1 + w, 52) - 1;
  const rm = Math.pow(1 + m, 12) - 1;
  const ry = y || 0;

  const clampRate = (r) =>
    clamp(r, SCORING_CFG.MIN_ANNUAL_RETURN, SCORING_CFG.MAX_ANNUAL_RETURN);
  const Rw = clampRate(rw),
    Rm = clampRate(rm),
    Ry = clampRate(ry);

  const BW =
    SCORING_CFG.BLEND_WEIGHTS[periodoSel] || SCORING_CFG.BLEND_WEIGHTS["1m"];
  let r_blend = BW.w * Rw + BW.m * Rm + BW.y * Ry;

  // Reduced damping for better accuracy in high-growth scenarios
  const r_primary = periodoSel === "1s" ? Rw : periodoSel === "1m" ? Rm : Ry;
  const RC = SCORING_CFG.REALISM_CAP;
  if (RC.enabled && r_primary > RC.trigger) {
    const over = Math.max(0, r_primary - RC.trigger);
    const damp =
      1 -
      Math.pow(Math.max(0, Math.min(1, over / (RC.cap - RC.trigger))), 0.75);
    r_blend = Math.min(r_blend, RC.cap * Math.max(0.5, damp));
  }

  return clamp(
    r_blend,
    SCORING_CFG.MIN_ANNUAL_RETURN,
    SCORING_CFG.MAX_ANNUAL_RETURN,
  );
}

function scorePE(pe) {
  const v = Number(pe);
  if (!Number.isFinite(v) || v <= 0) return 0.5; // Neutral default
  const lo = 10,
    hi = 30;
  if (v <= lo * 0.6) return 1.0;
  if (v >= hi * 2) return 0.1;
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const curve = 1 - Math.pow(t, 0.8);
  return clamp(0.1 + 0.9 * curve, 0, 1);
}

function scoreTrend(preco, sma50, sma200) {
  let t = 0;
  const p = Number(preco),
    s50 = Number(sma50),
    s200 = Number(sma200);
  if (Number.isFinite(p) && Number.isFinite(s50) && p > s50) t += 0.2;
  if (Number.isFinite(p) && Number.isFinite(s200) && p > s200) t += 0.3;
  if (Number.isFinite(s50) && Number.isFinite(s200) && s50 > s200) t += 0.1;
  if (Number.isFinite(p) && Number.isFinite(s50) && s50 > 0) {
    const dist = clamp((p - s50) / s50, -0.2, 0.2);
    t += dist * 0.5;
  }
  return clamp(t, 0, 1);
}

function scoreEVEBITDA(evebitda, setor) {
  const v = Number(evebitda);
  if (!Number.isFinite(v) || v <= 0) return 0.5; // Neutral default
  const A =
    SCORING_CFG.EVEBITDA_ANCHORS[String(setor || "—")] ||
    SCORING_CFG.EVEBITDA_ANCHORS.default;
  const lo = Math.max(1, Number(A.lo) || 6);
  const hi = Math.max(lo + 1, Number(A.hi) || 20);
  if (v <= lo * 0.6) return 1.0;
  if (v >= hi * 2) return 0.1;
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const curve = 1 - Math.pow(t, 0.75);
  return clamp(0.1 + 0.9 * curve, 0, 1);
}

function scoreDividendYield(yPct) {
  const v = Number(yPct);
  if (!Number.isFinite(v)) return 0;
  return clamp(v / 8, 0, 1);
}

export function calculateLucroMaximoScore(acao, periodoSel = "1m") {
  const rAnnual = annualizeRate(acao, periodoSel);
  const p99 = 0.8; // Normalization factor
  const R = clamp(rAnnual / p99, 0, 1);

  const pe = Number(
    acao["P/E ratio (Preço/Lucro)"] || acao.pe || acao.peRatio || 0,
  );
  const eve = Number(acao["EV/Ebitda"] || acao.evEbitda || 0);
  const p = Number(acao.valorStock || 0);
  const s50 = Number(acao.SMA50 || acao.sma50 || 0);
  const s200 = Number(acao.SMA200 || acao.sma200 || 0);

  // Calculate yield
  let yPct = Number(acao["Dividend Yield"] || acao.yield || 0);
  if (yPct === 0 && p > 0) {
    const div = Number(acao.dividendoMedio24m || acao.dividendo || 0);
    yPct = (div / p) * 100;
  }

  const V = scorePE(pe);
  const T = scoreTrend(p, s50, s200);
  const D = scoreDividendYield(yPct);
  const E = scoreEVEBITDA(eve, acao.setor);

  const W = SCORING_CFG.WEIGHTS;

  // Risk adj
  const w = asRate(acao.taxaCrescimento_1semana || acao.g1w);
  const m = asRate(acao.taxaCrescimento_1mes || acao.g1m);
  const y = asRate(acao.taxaCrescimento_1ano || acao.g1y);
  let score = clamp(
    W.R * R + W.V * V + W.T * T + W.D * D + W.E * E + W.Rsk * 1.0,
    0,
    1,
  );

  return {
    score,
    rAnnual,
    components: { R, V, T, D, E },
  };
}
