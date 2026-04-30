// js/utils/scoring.js

import { INDICATOR_INFO } from './indicator-info.js';

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

/**
 * Faz o parsing do valor da SMA (Simple Moving Average).
 * O valor na BD pode ser um preço absoluto ou uma percentagem (ex: "-5%", "+12.5%").
 * Se for percentagem, significa a distância do preço à SMA: Delta = (Price - SMA) / SMA.
 * @param {string|number} smaVal 
 * @param {number} currentPrice 
 * @returns {number|null} O preço absoluto da SMA
 */
export function parseSma(smaVal, currentPrice) {
  if (smaVal == null || smaVal === '') return null;
  if (typeof smaVal === 'number') return smaVal;
  
  // Remove spaces completely just in case
  const str = String(smaVal).replace(/\s/g, '');
  
  if (str.includes('%')) {
    const pct = parseFloat(str.replace('%', '').replace(',', '.'));
    if (isNaN(pct)) return null;
    if (currentPrice && currentPrice > 0) {
      return currentPrice / (1 + (pct / 100));
    }
    return null;
  }

  const n = parseFloat(str.replace(',', '.'));
  return isNaN(n) ? null : n;
}

export const SCORING_CFG = {
  MAX_ANNUAL_RETURN: 0.45, // Cap mais realista para retorno anual (45%)
  MIN_ANNUAL_RETURN: -0.6, // -60%
  WEIGHTS: { R: 0.1, V: 0.25, T: 0.15, D: 0.15, E: 0.25, S: 0.1 }, 
  BLEND_WEIGHTS: {
    "1s": { w: 0.75, m: 0.15, y: 0.1 },
    "1m": { w: 0.1, m: 0.75, y: 0.15 },
    "1a": { w: 0.1, m: 0.15, y: 0.75 }, // unificado com a chave de periodo
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
  TYPE_WEIGHTS: {
    stock: { R: 0.1, V: 0.25, T: 0.15, D: 0.15, E: 0.25, S: 0.1 },
    etf: { R: 0, V: 0, T: 0.6, D: 0.2, E: 0, S: 0.2 },
    crypto: { R: 0.4, V: 0, T: 0.5, D: 0, E: 0, S: 0.1 },
  }
};

/**
 * Detecta o tipo de ativo (stock, etf, crypto) com base em várias fontes.
 */
export function getAssetType(ticker, info, grupo) {
  const t = String(ticker || "").toUpperCase();
  const s = String(info?.setor || info?.sector || grupo?.setor || "").toLowerCase();
  const m = String(info?.mercado || info?.market || grupo?.mercado || "").toLowerCase();
  const n = String(info?.nome || grupo?.nome || "").toUpperCase();

  if (s.includes("cripto") || s.includes("crypto") || m.includes("cripto") || m.includes("crypto") || m.includes("binance") || m.includes("coinbase")) {
    return "crypto";
  }
  if (s.includes("etf") || n.includes(" ETF") || t.endsWith(".EU") || t.endsWith(".DE") || t.includes("ISHRS") || t.includes("VANGUARD") || t.includes("LYXOR") || t.includes("AMUNDI") || t.includes("INVESCO") || t.includes("XTRACKERS") || t.includes("ISHARES")) {
    return "etf";
  }
  return "stock";
}

function asRate(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) > 1 ? n / 100 : n;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** 
 * Score genérico baseado em âncoras (lo, hi).
 * Se invertido=true, valores baixos ganham mais score.
 */
function scoreGeneric(val, config) {
  const v = Number(val);
  if (!Number.isFinite(v)) return 0.5; // Neutral
  const { lo, hi, invertido } = config;
  
  if (invertido) {
    if (v <= lo) return 1.0;
    if (v >= hi) return 0.1;
    const t = (v - lo) / (hi - lo);
    return clamp(0.1 + 0.9 * (1 - Math.pow(t, 0.8)), 0.1, 1);
  } else {
    if (v >= hi) return 1.0;
    if (v <= lo) return 0.1;
    const t = (v - lo) / (hi - lo);
    return clamp(0.1 + 0.9 * Math.pow(t, 0.8), 0.1, 1);
  }
}

/** Converte uma entrada do INDICATOR_INFO no formato plano que scoreGeneric espera. */
function infoToConfig(info) {
  if (!info || !info.ancoras) return { lo: 0, hi: 1, invertido: false };
  return { lo: info.ancoras.lo, hi: info.ancoras.hi, invertido: !!info.invertido };
}

export function annualizeRate(row, periodoSel) {
  const w = asRate(
    row.priceChange_1w || row.taxaCrescimento_1semana || row.g1w,
  );
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
  const info = INDICATOR_INFO.p_e;
  if (info && info.ancoras) return scoreGeneric(pe, { lo: info.ancoras.lo, hi: info.ancoras.hi, invertido: info.invertido });
  return scoreGeneric(pe, { lo: 10, hi: 30, invertido: true });
}

export function scoreTrend(preco, sma50, sma200, rsi = 50) {
  let t = 0;
  const p = Number(preco),
    s50 = Number(sma50),
    s200 = Number(sma200),
    r14 = Number(rsi);
    
  if (Number.isFinite(p) && Number.isFinite(s50) && p > s50) t += 0.2;
  if (Number.isFinite(p) && Number.isFinite(s200) && p > s200) t += 0.3;
  if (Number.isFinite(s50) && Number.isFinite(s200) && s50 > s200) t += 0.1;
  
  if (Number.isFinite(p) && Number.isFinite(s50) && s50 > 0) {
    const dist = clamp((p - s50) / s50, -0.2, 0.2);
    t += dist * 0.4;
  }
  
  // RSI Adjustment: Penalize extreme overbought (>75), reward oversold (<35)
  if (Number.isFinite(r14)) {
    if (r14 < 35) t += 0.2; // Opportunity
    if (r14 > 75) t -= 0.3; // Risky momentum
  }

  return clamp(t, 0, 1);
}

export function scoreEVEBITDA(evebitda, setor) {
  const v = Number(evebitda);
  if (!Number.isFinite(v) || v <= 0) return 0.5;
  const A =
    SCORING_CFG.EVEBITDA_ANCHORS[String(setor || "—")] ||
    SCORING_CFG.EVEBITDA_ANCHORS.default;
  return scoreGeneric(v, { lo: A.lo, hi: A.hi, invertido: true });
}

export function scoreDividendYield(yPct) {
  const v = Number(yPct);
  if (!Number.isFinite(v)) return 0;
  return clamp(v / 8, 0, 1);
}

export function scoreROIC(roic) {
  const info = INDICATOR_INFO.roic;
  return scoreGeneric(roic, { lo: info.ancoras.lo, hi: info.ancoras.hi, invertido: info.invertido });
}

export function scoreEPS(epsYoY, epsNextY = null, eps5y = null) {
  const v = Number(epsYoY);
  let baseScore = 0.2;
  
  if (Number.isFinite(v)) {
    const frac = Math.abs(v) > 1 ? v / 100 : v;
    baseScore = clamp(0.2 + (frac / 0.4) * 0.8, 0, 1);
  }

  let bonus = 0;
  if (epsNextY !== null && Number.isFinite(epsNextY)) {
    const nextFrac = Math.abs(epsNextY) > 1 ? epsNextY / 100 : epsNextY;
    bonus += nextFrac > 0 ? clamp(nextFrac * 0.5, -0.3, 0.2) : -0.3;
  }
  
  if (eps5y !== null && Number.isFinite(eps5y)) {
    const fiveFrac = Math.abs(eps5y) > 1 ? eps5y / 100 : eps5y;
    bonus += clamp(fiveFrac * 0.3, -0.1, 0.15);
  }

  return clamp(baseScore + bonus, 0, 1);
}

export function scoreSolvency(currentRatio, debtEq, netDebtEbitda) {
  const sCR = scoreGeneric(currentRatio, infoToConfig(INDICATOR_INFO.current_ratio));
  const sDE = scoreGeneric(debtEq, infoToConfig(INDICATOR_INFO.debt_eq));
  
  let sND = 1.0;
  if (Number.isFinite(netDebtEbitda)) {
    if (netDebtEbitda > 4) sND = clamp(1 - (netDebtEbitda - 4) / 6, 0.1, 1);
  }
  
  return (sCR * 0.3 + sDE * 0.3 + sND * 0.4);
}

/** Estima volatilidade proxy a partir da variação semanal/mensal quando o campo direto não existe. */
function proxyVol(acao) {
  const w = Math.abs(asRate(acao.g1w || acao.priceChange_1w || 0));
  const m = Math.abs(asRate(acao.g1m || acao.priceChange_1m || 0));
  if (w > 0) return clamp(w * Math.sqrt(52), 0, 1);
  if (m > 0) return clamp(m * Math.sqrt(12), 0, 1);
  return 0.2; // Fallback neutro
}

export function calculateLucroMaximoScore(acao, periodoSel = "1m") {
  const rAnnual = annualizeRate(acao, periodoSel);
  const p99 = 0.8;
  const R_Price = clamp(rAnnual / p99, 0, 1);
  
  const epsYoY = Number(acao.epsYoY || acao.eps_yoy || 0);
  const epsNextY = Number(acao.eps_next_y || acao.epsNextY || 0);
  const eps5y = Number(acao.eps_next_5y || 0);
  
  const R_Eps = scoreEPS(epsYoY, epsNextY, eps5y);
  const R = R_Price * 0.4 + R_Eps * 0.6;

  // Valuation refined
  const pe = Number(acao.pe || acao.p_e || 0);
  const peg = Number(acao.peg || 0);
  const pfcf = Number(acao.p_fcf || 0);
  
  const V_PE = scorePE(pe);
  const V_PEG = scoreGeneric(peg, infoToConfig(INDICATOR_INFO.peg));
  const V_FCF = scoreGeneric(pfcf, infoToConfig(INDICATOR_INFO.p_fcf));
  const V = V_PE * 0.5 + V_PEG * 0.3 + V_FCF * 0.2;

  // Tendência
  const p = Number(acao.valorStock || acao.price || 0);
  const s50 = parseSma(acao.sma50, p) || 0;
  const s200 = parseSma(acao.sma200, p) || 0;
  const rsi = Number(acao.rsi_14 || 50);

  let T = scoreTrend(p, s50, s200, rsi);
  
  // Ajuste de tendência: Proximidade do Topo 52 semanas
  const h52dist = Number(acao.high_52w_dist || 0);
  if (h52dist > -0.05) {
    // Se estiver a < 5% do topo, confirmamos força técnica (bonus ligeiro)
    T = clamp(T + 0.1, 0, 1);
  } else if (h52dist < -0.30) {
    // Se caiu > 30% do topo, penalizamos a tendência (quebra de estrutura)
    T = clamp(T - 0.2, 0, 1);
  }

  // Dividendos
  let rawYield = Number(acao.yield || acao.dividendValue || 0);
  let yPct = Math.abs(rawYield) > 0 && Math.abs(rawYield) < 1 ? rawYield * 100 : rawYield;
  let D = scoreDividendYield(yPct);
  
  // Ajuste de Qualidade do Dividendo: Crescimento em 5 anos
  const dg5 = Number(acao.div_grow_5y || 0);
  if (dg5 > 0.10) D = clamp(D + 0.15, 0, 1); // Crescimento > 10%/ano é excelente
  else if (dg5 < 0) D = clamp(D - 0.2, 0, 1); // Corte de dividendos é mau sinal

  // Eficiência / Lucratividade
  const eve = Number(acao.ev_ebitda || acao.evEbitda || 0);
  const roic = Number(acao.roic || 0);
  const roe = Number(acao.roe || 0);
  const om = Number(acao.oper_margin || 0);
  
  const setorNormalizado = acao.setor || acao.sector || acao.Setor || "";
  const E_EV = scoreEVEBITDA(eve, setorNormalizado);
  const E_ROIC = scoreROIC(roic);
  const E_ROE = scoreGeneric(roe, infoToConfig(INDICATOR_INFO.roe));
  const E_OM = scoreGeneric(om, infoToConfig(INDICATOR_INFO.oper_margin));
  
  let E = (E_EV * 0.3 + E_ROIC * 0.3 + E_ROE * 0.2 + E_OM * 0.2);
  
  // Ajuste de Qualidade: Consistência do EPS
  const eg5 = Number(acao.eps_grow_5y || 0);
  if (eg5 > 0.15) E = clamp(E + 0.1, 0, 1);
  else if (eg5 < 0) E = clamp(E - 0.15, 0, 1);

  const cr = Number(acao.current_ratio || 0);
  const de = Number(acao.debt_eq || 0);
  
  // scoreSolvency uses INDICATOR_INFO internally via infoToConfig
  const eb = Number(acao.ebitda || 0);
  const nd = Number(acao.dividaLiquida || 0);
  const nd_eb = eb > 0 ? nd / eb : null;
  const S = scoreSolvency(cr, de, nd_eb);

  const W_BASE = getUserWeights() || SCORING_CFG.WEIGHTS;
  const assetType = getAssetType(acao.ticker, acao);
  const W_TYPE = SCORING_CFG.TYPE_WEIGHTS[assetType] || SCORING_CFG.TYPE_WEIGHTS.stock;

  // Mesclar pesos: Se o utilizador definiu pesos personalizados, tentamos respeitar a proporção, 
  // mas zeramos o que não faz sentido para o tipo (ex: V e E em Crypto).
  const W = { ...W_TYPE };
  if (getUserWeights()) {
    // Se houver pesos do user, adaptamos os pesos do tipo para manter a intenção do user onde aplicável
    Object.keys(W).forEach(k => {
      if (W_TYPE[k] === 0) W[k] = 0; // Forçar zero se o tipo não suporta
      else if (W_BASE[k] !== undefined) {
        // Ajuste proporcional simples (heurística)
        W[k] = W_BASE[k];
      }
    });
    // Re-normalizar pesos para somarem 1
    const sum = Object.values(W).reduce((a, b) => a + b, 0) || 1;
    Object.keys(W).forEach(k => W[k] /= sum);
  }

  const vol = Number.isFinite(acao.volatility) ? Math.max(0, Math.min(1, acao.volatility)) : proxyVol(acao);
  const riskAdj = 1 / (1 + 0.6 * vol); // Slightly less aggressive risk damping

  const tickerStr = String(acao.ticker || "").toUpperCase();
  const nomeStr = String(acao.nome || "").toUpperCase();
  const isAcc = tickerStr.includes("ACC") || nomeStr.includes("ACC") || nomeStr.includes("ACUM") || nomeStr.includes("ACCUM");

  let score;
  if (isAcc && W.D > 0) {
    // Para ativos acumulativos, redistribuímos o peso de D pelos outros pilares
    const totalW_NoD = (W.R || 0) + (W.V || 0) + (W.T || 0) + (W.E || 0) + (W.S || 0) + (W.Rsk || 0);
    if (totalW_NoD > 0) {
      const factor = 1 / totalW_NoD;
      const baseScore = (W.R * R + W.V * V + W.T * T + W.E * E + (W.S || 0) * S + (W.Rsk || 0) * 1.0) * factor;
      score = clamp(baseScore, 0, 1);
      // Para o breakdown, mostramos D como neutro (igual ao score final) para não penalizar visualmente
      D = score; 
    } else {
      score = 0.5;
    }
  } else {
    score = clamp(
      W.R * R + W.V * V + W.T * T + W.D * D + W.E * E + (W.S || 0) * S + (W.Rsk || 0) * 1.0,
      0, 1
    );
  }

  score *= riskAdj;

  // Classificação de Valorização baseada no componente V
  let valuationLabel = "Justo";
  if (V > 0.7) valuationLabel = "Subvalorizado";
  else if (V < 0.3) valuationLabel = "Sobrevalorizado";

  return {
    score,
    rAnnual,
    vol,
    riskAdj,
    valuationLabel,
    components: { R, V, T, D, E, S },
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
