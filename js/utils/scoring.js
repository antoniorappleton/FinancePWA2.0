// js/utils/scoring.js

import { scoreAssetV2, styleToMultipliers } from "../engines/score-v2.js";
import { canonicalTicker, ASSET_REGISTRY } from "./normalize.js";
export { canon, normalizeSector } from "./normalize.js";

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

const SCORING_READINESS_THRESHOLD = 0.6;

const READINESS_FIELDS = {
  common: [
    ["ticker"],
    ["nome", "name"],
    ["valorStock", "price"],
    ["setor", "sector", "mercado", "market"],
    ["sources_used", "source_used"],
    ["lastFullSync", "updatedAt", "ultimaAtu"],
  ],
  technical: [
    ["priceChange_1w", "taxaCrescimento_1semana", "g1w"],
    ["priceChange_1m", "taxaCrescimento_1mes", "g1m"],
    ["priceChange_1y", "taxaCrescimento_1ano", "g1y"],
    ["sma50"],
    ["sma200"],
    ["rsi", "rsi_14", "rsi14"],
    ["above_sma50"],
    ["above_sma200"],
    ["golden_cross"],
  ],
  stockValuation: [
    ["pe"],
    ["forward_pe", "forward_p_e"],
    ["peg"],
    ["ev_ebitda", "evEbitda"],
    ["p_fcf", "priceToFCF"],
    ["fcfYield"],
  ],
  stockQuality: [
    ["roic"],
    ["roe"],
    ["roa"],
    ["roi"],
    ["operatingMargin", "oper_margin", "operMargin"],
    ["freeCashflow"],
    ["revenueGrowth", "revenue_growth", "salesGrowth"],
  ],
  stockRisk: [
    ["totalDebt"],
    ["totalCash"],
    ["netDebt"],
    ["netDebtEbitda"],
    ["current_ratio", "currentRatio"],
    ["debt_eq", "debtEquity"],
    ["beta"],
    ["bidAskSpread"],
  ],
  dividend: [
    ["yield"],
    ["dividendo"],
    ["dividendoMedio24m"],
    ["periodicidade"],
    ["payoutRatio"],
  ],
  etf: [
    ["holdings"],
    ["holdings_count", "num_holdings"],
    ["top10Weight"],
    ["ter", "expense_ratio"],
    ["isin"],
    ["marketCap", "fundSize"],
    ["bidAskSpread"],
    ["yield"],
  ],
};

const EMPTY_STRINGS = new Set(["", "-", "—", "–", "n/a", "na", "#n/a", "nan", "null", "undefined"]);

function toNum(v) {
  if (typeof v === "number") return v;
  if (v === undefined || v === null || v === "") return NaN;
  let s = String(v).trim();
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function clamp(v, min, max) {
  const val = Number(v) || 0;
  return Math.max(min, Math.min(max, val));
}

function hasValidValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return !EMPTY_STRINGS.has(String(v).trim().toLowerCase());
}

function firstValidField(asset, aliases) {
  return aliases.some((key) => hasValidValue(asset?.[key]));
}

function coverageFor(asset, groups) {
  let present = 0;
  let total = 0;
  for (const group of groups) {
    for (const aliases of READINESS_FIELDS[group] || []) {
      total += 1;
      if (firstValidField(asset, aliases)) present += 1;
    }
  }
  return { present, total, ratio: total ? present / total : 0 };
}

export function getScoringReadiness(asset) {
  const type = getAssetType(asset?.ticker, asset);
  const common = coverageFor(asset, ["common"]);
  const technical = coverageFor(asset, ["technical"]);
  const hasPrice = firstValidField(asset, ["valorStock", "price"]);
  const hasTicker = firstValidField(asset, ["ticker"]);
  const hasIdentity = hasTicker && firstValidField(asset, ["nome", "name", "setor", "sector", "mercado", "market"]);

  if (type === "etf") {
    const etf = coverageFor(asset, ["etf"]);
    const all = coverageFor(asset, ["common", "technical", "etf"]);
    const ready = hasPrice && hasIdentity && all.ratio >= SCORING_READINESS_THRESHOLD && etf.ratio >= 0.4;
    return { type, ready, coverage: all.ratio, groups: { common, technical, etf } };
  }

  if (type === "crypto") {
    const all = coverageFor(asset, ["common", "technical"]);
    const ready = hasPrice && hasIdentity && all.ratio >= SCORING_READINESS_THRESHOLD && technical.ratio >= 0.35;
    return { type, ready, coverage: all.ratio, groups: { common, technical } };
  }

  const valuation = coverageFor(asset, ["stockValuation"]);
  const quality = coverageFor(asset, ["stockQuality"]);
  const risk = coverageFor(asset, ["stockRisk"]);
  const dividend = coverageFor(asset, ["dividend"]);
  const all = coverageFor(asset, ["common", "technical", "stockValuation", "stockQuality", "stockRisk", "dividend"]);
  const ready = hasPrice && hasIdentity && all.ratio >= SCORING_READINESS_THRESHOLD;
  return { type, ready, coverage: all.ratio, groups: { common, technical, valuation, quality, risk, dividend } };
}

// Dividendo sem motor dedicado em V2 — mantido como fallback para campo D.
function scoreDividendYield(y) {
  const v = Number(y) || 0;
  if (v > 8) return 0.6;
  if (v > 4) return 1.0;
  if (v > 2) return 0.8;
  if (v > 0.5) return 0.4;
  return 0.1;
}

/**
 * Adaptador fino para scoreAssetV2.
 * @param {Object} acao - Dados de mercado do ativo
 * @param {string} [period="1y"] - Período de referência para annualizeRate
 * @param {Object|null} [styleAlloc] - {growth,value,div,qual} em escala 0-100
 * @param {string|null} [regime] - Regime macro (ex: "high_rates", "risk_on")
 */
export function calculateLucroMaximoScore(acao, period = "1y", styleAlloc = null, regime = null) {
  if (!acao) return { score: 0.5, components: { R: 0, V: 0, T: 0, D: 0, E: 0, S: 0 } };

  const effectiveRegime = regime ?? "high_rates";
  const styleMult = styleToMultipliers(styleAlloc);
  const rAnnual = annualizeRate(acao, period);

  let v2;
  try {
    v2 = scoreAssetV2(acao, styleMult, effectiveRegime);
  } catch (err) {
    console.warn("[scoring] scoreAssetV2 falhou:", err);
    return { score: 0.5, rAnnual, components: { R: 0.5, V: 0.5, T: 0.5, D: 0.5, E: 0.5, S: 0.5 }, mode: "erro" };
  }

  const eng = v2.engines || {};
  const D = scoreDividendYield(acao.yield);

  return {
    score: clamp((v2.finalScore ?? 50) / 100, 0, 1),
    rAnnual,
    components: {
      R: clamp((eng.momentum?.score  ?? 50) / 100, 0, 1),
      V: clamp((eng.valuation?.score ?? 50) / 100, 0, 1),
      T: clamp((eng.momentum?.score  ?? 50) / 100, 0, 1),
      D,
      E: clamp((eng.quality?.score   ?? 50) / 100, 0, 1),
      S: clamp((eng.risk?.score      ?? 50) / 100, 0, 1),
    },
    mode: "v2",
    v2,
    readiness: getScoringReadiness(acao),
  };
}

export function annualizeRate(acao, period = "1y") {
  if (!acao) return 0.1;

  let val = undefined;
  if (period === "1w" || period === "1s") {
    val = acao.priceChange_1w ?? acao.taxaCrescimento_1semana ?? acao.g1w ?? acao.price_change_1w;
  } else if (period === "1m") {
    val = acao.priceChange_1m ?? acao.taxaCrescimento_1mes ?? acao.g1m ?? acao.price_change_1m;
  } else if (period === "1y" || period === "1a") {
    val = acao.priceChange_1y ?? acao.taxaCrescimento_1ano ?? acao.g1y ?? acao.price_change_1y ?? acao.taxa_crescimento_anual;
  }

  const nVal = toNum(val);
  if (!isNaN(nVal)) {
    return Math.abs(nVal) > 1 ? nVal / 100 : nVal;
  }

  const pClose = toNum(acao.valorStock || acao.price);
  const pOpen = toNum(acao.price_open_1y || acao.price_1y_ago);

  if (isNaN(pClose) || pClose <= 0) return 0.1;
  if (isNaN(pOpen) || pOpen <= 0) return 0.1;

  return (pClose - pOpen) / pOpen;
}

export function parseSma(sma, currentPrice) {
  if (sma === undefined || sma === null || sma === "") return null;
  const s = Number(sma);
  if (isNaN(s) || s <= 0) return null;
  return s;
}

export function getAssetType(ticker, acao) {
  const cleanT = canonicalTicker(ticker);
  const n = String(acao?.nome || acao?.name || "").toUpperCase();
  const s = String(acao?.setor || acao?.sector || acao?.Setor || acao?.Sector || "").toUpperCase();

  // Registry takes precedence (D7.4)
  if (ASSET_REGISTRY[cleanT]) return ASSET_REGISTRY[cleanT].type;

  const cryptoTickers = new Set(["BTC", "ETH", "SOL", "DOT", "ADA", "XRP", "AVAX", "LINK", "MATIC"]);
  const commodityTickers = new Set(["GZUR", "VZLC", "PHAG", "PHAU", "SGLN", "IGLN", "SSLV", "GLD", "SLV", "IAU", "PPLT", "PALL"]);

  if (cryptoTickers.has(cleanT) || n.includes("BITCOIN") || n.includes("ETHEREUM") || s.includes("CRIPTO")) return "crypto";
  if (commodityTickers.has(cleanT) || n.includes("PHYSICAL") || n.includes("SILVER") || n.includes("GOLD") || s === "COMMODITIES" || s === "COMMODITY") return "commodity";
  if (n.includes("ETF") || n.includes("UCITS") || n.includes("VANGUARD") || n.includes("ISHARES") || n.includes("LYXOR") || n.includes("AMUNDI") || s.includes("ETF")) return "etf";

  return "stock";
}

export function anualizarDividendo(d, p) {
  const val = Number(d) || 0; const per = String(p || "").toLowerCase();
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


export function cleanTicker(t) {
  return canonicalTicker(t);
}
