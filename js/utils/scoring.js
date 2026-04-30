// js/utils/scoring.js

export function getUserWeights() {
  try {
    const saved = localStorage.getItem("userWeights");
    return saved ? JSON.parse(saved) : null;
  } catch (e) { return null; }
}

export const SCORING_CFG = {
  WEIGHTS: { R: 0.1, V: 0.25, T: 0.15, D: 0.15, E: 0.25, S: 0.1 },
  TYPE_WEIGHTS: {
    stock: { R: 0.1, V: 0.25, T: 0.15, D: 0.15, E: 0.25, S: 0.1 },
    etf: { T: 0.4, Diversification: 0.25, Cost: 0.15, Liquidity: 0.10, Volatility: 0.10 },
    crypto: { T: 0.45, Momentum: 0.2, Volatility: 0.25, Weight: 0.10 }
  }
};

const INDICATOR_INFO = {
  pe: { min: 5, target: 15, max: 35, inverse: true },
  peg: { min: 0.5, target: 1.0, max: 2.5, inverse: true },
  p_fcf: { min: 5, target: 15, max: 40, inverse: true },
  roe: { min: 0.05, target: 0.15, max: 0.35, inverse: false },
  roic: { min: 0.05, target: 0.12, max: 0.30, inverse: false },
  oper_margin: { min: 0.05, target: 0.15, max: 0.40, inverse: false }
};

function clamp(v, min, max) { 
  const val = Number(v) || 0;
  return Math.max(min, Math.min(max, val)); 
}

function infoToConfig(info) { return { min: info.min, target: info.target, max: info.max, inverse: info.inverse }; }

// --- FUNÇÕES DE SCORING ESPECIALIZADAS ---

function scoreStock(acao, metrics) {
  const { R, V, T, D, E, S } = metrics;
  const W = SCORING_CFG.TYPE_WEIGHTS.stock;
  const res = (W.R * (R||0)) + (W.V * (V||0)) + (W.T * (T||0)) + (W.D * (D||0)) + (W.E * (E||0)) + (W.S * (S||0));
  return clamp(res, 0, 1);
}

function scoreETF(acao, metrics) {
  const ticker = String(acao.ticker || "").toUpperCase();
  const { T, R_Price } = metrics;
  const isCore = ["VWCE", "IWDA", "VUSA", "CSPX", "EUNL", "VGWL"].includes(ticker);
  const isThematic = ["QDVE", "GRID", "NUKL", "VVMX", "WCLD", "ESPO"].includes(ticker);
  const divScore = isCore ? 0.9 : (isThematic ? 0.5 : 0.7);
  const costScore = isCore ? 0.9 : 0.6;
  const liqScore = isCore ? 0.95 : 0.7;
  const volScore = isThematic ? 0.5 : 0.8;
  const W = SCORING_CFG.TYPE_WEIGHTS.etf;
  const T_Final = clamp((Number(T)||0) * 0.7 + (Number(R_Price)||0) * 0.3, 0, 1);
  const res = (W.T * T_Final) + (W.Diversification * divScore) + (W.Cost * costScore) + (W.Liquidity * liqScore) + (W.Volatility * volScore);
  return clamp(res, 0, 1);
}

function scoreCrypto(acao, metrics) {
  const { T, R_Price } = metrics;
  const W = SCORING_CFG.TYPE_WEIGHTS.crypto;
  const res = (W.T * (Number(T)||0)) + (W.Momentum * (Number(R_Price)||0)) + (W.Volatility * 0.4);
  return clamp(res, 0, 1);
}

function scoreEPS(yoy, next, fiv) {
  let s = 0;
  if (yoy > 0.20) s += 0.4; else if (yoy > 0.05) s += 0.2;
  if (next > 0.15) s += 0.3; else if (next > 0.05) s += 0.15;
  if (fiv > 0.12) s += 0.3; else if (fiv > 0.05) s += 0.15;
  return clamp(s, 0, 1);
}

function scorePE(pe) {
  const v = Number(pe) || 0;
  if (v <= 0) return 0.1;
  if (v < 15) return 1.0;
  if (v < 25) return 0.6;
  if (v < 40) return 0.3;
  return 0.1;
}

function scoreTrend(p, s50, s200, rsi) {
  const price = Number(p)||0, sma50 = Number(s50)||0, sma200 = Number(s200)||0, r = Number(rsi)||50;
  let s = 0;
  if (price > sma200) s += 0.4;
  if (price > sma50) s += 0.3;
  if (sma50 > sma200) s += 0.1;
  if (r > 40 && r < 70) s += 0.2;
  else if (r >= 70) s += 0.1;
  return clamp(s, 0, 1);
}

function scoreDividendYield(y) {
  const v = Number(y) || 0;
  if (v > 8) return 0.6;
  if (v > 4) return 1.0;
  if (v > 2) return 0.8;
  if (v > 0.5) return 0.4;
  return 0.1;
}

function scoreSolvency(cr, de, nd_eb) {
  const current = Number(cr)||0, debt = Number(de)||0;
  let s = 0;
  if (current > 1.5) s += 0.3; else if (current > 1.0) s += 0.15;
  if (debt < 0.8) s += 0.3; else if (debt < 1.5) s += 0.15;
  if (nd_eb !== null) {
    const v = Number(nd_eb)||0;
    if (v < 2.0) s += 0.4; else if (v < 4.0) s += 0.2;
  } else s += 0.2;
  return clamp(s, 0, 1);
}

function scoreGeneric(v, cfg) {
  const val = Number(v) || 0;
  const { min, target, max, inverse } = cfg;
  if (!inverse) {
    if (val >= target) return 0.8 + clamp((val - target) / (max - target), 0, 0.2);
    return clamp((val - min) / (target - min), 0, 0.8);
  } else {
    if (val <= target) return 0.8 + clamp((target - val) / (target - min), 0, 0.2);
    return clamp((max - val) / (max - target), 0, 0.8);
  }
}

function annualizeRate(acao) {
  const pClose = Number(acao.valorStock || acao.price || 0);
  const pOpen = Number(acao.price_open_1y || acao.price_1y_ago || pClose * 0.9);
  if (pOpen <= 0) return 0.1;
  return (pClose - pOpen) / pOpen;
}

export function calculateLucroMaximoScore(acao, period = "1y") {
  if (!acao) return { score: 0.5, components: { R: 0, V: 0, T: 0, D: 0, E: 0, S: 0 } };
  const assetType = getAssetType(acao.ticker, acao);
  const rAnnual = annualizeRate(acao);
  const R_Price = clamp(rAnnual / 0.5, 0, 1);
  const R_Eps = scoreEPS(Number(acao.epsYoY)||0, Number(acao.epsNextY)||0, Number(acao.eps_next_5y)||0);
  const R = clamp(R_Price * 0.4 + R_Eps * 0.6, 0, 1);
  const V = clamp(scorePE(acao.pe) * 0.5 + scoreGeneric(acao.peg, infoToConfig(INDICATOR_INFO.peg)) * 0.3 + scoreGeneric(acao.p_fcf, infoToConfig(INDICATOR_INFO.p_fcf)) * 0.2, 0, 1);
  const p = Number(acao.valorStock || acao.price || 0);
  const T = scoreTrend(p, acao.sma50, acao.sma200, acao.rsi_14);
  const D = scoreDividendYield(acao.yield);
  const E = clamp(scoreGeneric(acao.roic, infoToConfig(INDICATOR_INFO.roic)) * 0.4 + scoreGeneric(acao.roe, infoToConfig(INDICATOR_INFO.roe)) * 0.3 + scoreGeneric(acao.oper_margin, infoToConfig(INDICATOR_INFO.oper_margin)) * 0.3, 0, 1);
  const S = scoreSolvency(acao.current_ratio, acao.debt_eq, null);
  const metrics = { R, V, T, D, E, S, R_Price };
  let finalScore = 0.5;
  if (assetType === "etf") finalScore = scoreETF(acao, metrics);
  else if (assetType === "crypto") finalScore = scoreCrypto(acao, metrics);
  else finalScore = scoreStock(acao, metrics);
  return { score: Number(finalScore)||0.5, assetType, components: { R, V, T, D, E, S }, finalWeights: SCORING_CFG.TYPE_WEIGHTS[assetType] || SCORING_CFG.TYPE_WEIGHTS.stock };
}

export function parseSma(sma, currentPrice) {
  if (sma === undefined || sma === null || sma === "") return null;
  const s = Number(sma);
  if (isNaN(s) || s <= 0) return null;
  return s;
}

export function getAssetType(ticker, acao) {
  const t = String(ticker || "").toUpperCase();
  const n = String(acao?.nome || "").toUpperCase();
  if (["BTC", "ETH", "SOL", "DOT", "ADA"].includes(t) || n.includes("BITCOIN") || n.includes("ETHEREUM")) return "crypto";
  if (n.includes("ETF") || n.includes("UCITS") || n.includes("VANGUARD") || n.includes("ISHARES") || n.includes("LYXOR") || n.includes("AMUNDI")) return "etf";
  return "stock";
}

export function anualizarDividendo(d, p) {
  const val = Number(d)||0; const per = String(p||"").toLowerCase();
  if (val <= 0) return 0;
  if (per === "mensal" || per === "monthly") return val * 12;
  if (per === "trimestral" || per === "quarterly") return val * 4;
  if (per === "semestral" || per === "semi-annual") return val * 2;
  return val;
}

export function anualPreferido(doc) {
  const d24 = Number(doc.dividendoMedio24m || 0);
  if (d24 > 0) return d24;
  return anualizarDividendo(doc.dividendo, doc.periodicidade);
}
