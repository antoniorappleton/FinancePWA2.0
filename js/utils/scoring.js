// js/utils/scoring.js

const SETTINGS_STORAGE_KEY = "app.settings";

export function getUserWeights() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.weights || null;
  } catch {
    return null;
  }
}

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

export function annualizeRate(row, periodoSel) {
  const w = asRate(row.priceChange_1w || row.taxaCrescimento_1semana || row.g1w);
  const m = asRate(row.priceChange_1m || row.taxaCrescimento_1mes || row.g1m);
  const y = asRate(row.priceChange_1y || row.taxaCrescimento_1ano || row.g1y);

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

export function scorePE(pe) {
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

export function scoreTrend(preco, sma50, sma200) {
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

export function scoreEVEBITDA(evebitda, setor) {
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

export function scoreDividendYield(yPct) {
  const v = Number(yPct);
  if (!Number.isFinite(v)) return 0;
  return clamp(v / 8, 0, 1);
}

export function scoreROIC(roic) {
  const v = Number(roic);
  if (!Number.isFinite(v)) return 0;
  // 0% -> score 0; 20% -> score 1
  return clamp(v / 20, 0, 1);
}

export function scoreEPS(epsYoY) {
  const v = Number(epsYoY);
  if (!Number.isFinite(v)) return 0;
  // Aceita fração ou percentagem
  const frac = Math.abs(v) > 1 ? v / 100 : v;
  // 0% growth -> 0.2 score; 40% growth -> 1.0 score
  return clamp(0.2 + (frac / 0.4) * 0.8, 0, 1);
}

/** Proxy muito simples de volatilidade [0..1] se não houver `row.volatility`. */
export function proxyVol(row) {
  const w = Math.min(
    1,
    Math.abs(asRate(row.taxaCrescimento_1semana || row.g1w)) * 10,
  );
  const m = Math.min(
    1,
    Math.abs(asRate(row.taxaCrescimento_1mes || row.g1m)) * 3,
  );
  const y = Math.min(1, Math.abs(asRate(row.taxaCrescimento_1ano || row.g1y)));
  return Math.max(0, Math.min(1, (w + m + y) / 3));
}

export function calculateLucroMaximoScore(acao, periodoSel = "1m") {
  const rAnnual = annualizeRate(acao, periodoSel);
  const p99 = 0.8; // Normalization factor
  const R_Price = clamp(rAnnual / p99, 0, 1);
  const epsYoY = Number(acao.eps_yoy || acao.EPS_YoY || 0);
  const R_Eps = scoreEPS(epsYoY);
  // Pilar R: 40% Preço, 60% Lucros (EPS)
  const R = R_Price * 0.4 + R_Eps * 0.6;

  const pe = Number(
    acao["P/E ratio (Preço/Lucro)"] || acao.pe || acao.peRatio || 0,
  );
  let eve = Number(acao["EV/Ebitda"] || acao.evEbitda || 0);

  // Fallback para EV / Ebitda se o rácio direto não existir
  if (eve === 0) {
    const ev = Number(acao.EV || acao.ev || 0);
    const ebitda = Number(acao.Ebitda || acao.ebitda || 0);
    if (ebitda > 0) eve = ev / ebitda;
  }

  const p = Number(acao.valorStock || 0);
  const s50 = Number(acao.SMA50 || acao.sma50 || 0);
  const s200 = Number(acao.SMA200 || acao.sma200 || 0);

  // Calculate yield
  let rawYield = Number(acao["Dividend Yield"] || acao.yield || 0);
  // Se for uma fração muito pequena (ex: 0.042), converte para percentagem (4.22)
  let yPct =
    Math.abs(rawYield) > 0 && Math.abs(rawYield) < 1
      ? rawYield * 100
      : rawYield;

  if (yPct === 0 && p > 0) {
    const div = Number(acao.dividendoMedio24m || acao.dividendo || 0);
    yPct = (div / p) * 100;
  }

  const V = scorePE(pe);
  const T = scoreTrend(p, s50, s200);
  const D = scoreDividendYield(yPct);

  // Pilar E: 50% EV/Ebitda, 50% ROIC
  const E_Ratio = scoreEVEBITDA(eve, acao.setor);
  const roic = Number(acao.roic || acao.ROIC || 0);
  const E_Roic = scoreROIC(roic);
  const E = E_Ratio * 0.5 + E_Roic * 0.5;

  const W = getUserWeights() || SCORING_CFG.WEIGHTS;

  // Ajuste de risco via volatilidade (ou proxy)
  const vol = Number.isFinite(acao.volatility)
    ? Math.max(0, Math.min(1, acao.volatility))
    : proxyVol(acao);
  const riskAdj = 1 / (1 + 0.75 * vol); // 0.57..1

  let score = clamp(
    W.R * R + W.V * V + W.T * T + W.D * D + W.E * E + (W.Rsk || 0.05) * 1.0,
    0,
    1,
  );
  score *= riskAdj;

  return {
    score,
    rAnnual,
    vol,
    riskAdj,
    components: { R, V, T, D, E },
  };
}
/** Converte dividendos para valor anual com base na periodicidade. */
export function anualizarDividendo(dividendoPorPagamento, periodicidade) {
  const d = Number(dividendoPorPagamento || 0);
  const p = String(periodicidade || "").toLowerCase();
  if (d <= 0) return 0;
  if (p === "mensal" || p === "monthly") return d * 12;
  if (p === "trimestral" || p === "quarterly") return d * 4;
  if (p === "semestral" || p === "semi-annual") return d * 2;
  return d; // anual (ou n/a)
}

/** Retorna o dividendo anual preferido (prioriza média 24m, depois anualiza o atual). */
export function anualPreferido(doc) {
  const d24 = Number(doc.dividendoMedio24m || 0);
  if (d24 > 0) return d24;
  return anualizarDividendo(doc.dividendo, doc.periodicidade);
}
