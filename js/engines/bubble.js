// js/engines/bubble.js
// ═══════════════════════════════════════════════════════════════════
// BUBBLE / EUPHORIA INDEX (D9.3)
// 0–100 per asset and aggregated at portfolio level, combining:
//   - valuation esticado vs próprio histórico (D9.2 pe_percentil)
//   - preço parabólico (distância extrema acima da SMA200, retorno 1y)
//   - RSI extremo
//   - concentração temática num único tema "quente" (via thematicExposure)
// Aditivo: um ativo sem dados suficientes simplesmente não contribui para o
// peso do score (nunca é penalizado por falta de dados).
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, safePercent, clamp } from "../utils/normalize.js";
import { valuationScore } from "./valuation.js";

const WEIGHTS = { valuationStretch: 0.35, priceParabolic: 0.25, yoyReturn: 0.15, rsi: 0.25 };

/**
 * Bubble/euphoria score for a single asset (0–100, higher = more euphoric).
 * @param {Object} asset - market data (mkt) for the asset
 * @returns {{ score: number|null, available: boolean, breakdown: Object }}
 */
export function assetBubbleScore(asset) {
  if (!asset) return { score: null, available: false, breakdown: {} };

  const parts = {};
  let weighted = 0, weightSum = 0;

  // 1. Valuation esticado vs próprio histórico (D9.2) — degrada silenciosamente sem dados.
  const val = valuationScore(asset);
  const percentile = val.breakdown?.historical?.value;
  if (val.historicalConfidence === "alta" && isFinite(percentile)) {
    parts.valuationStretch = clamp(percentile, 0, 100);
    weighted += parts.valuationStretch * WEIGHTS.valuationStretch;
    weightSum += WEIGHTS.valuationStretch;
  }

  // 2. Preço parabólico — distância extrema acima da SMA200.
  const price = safeMetric(asset, "valorStock", "price");
  const sma200 = safeMetric(asset, "sma200");
  if (isFinite(price) && isFinite(sma200) && sma200 > 0) {
    const dist = (price - sma200) / sma200; // 0.60 (60% acima da SMA200) satura o score
    parts.priceParabolic = clamp((dist / 0.60) * 100, 0, 100);
    weighted += parts.priceParabolic * WEIGHTS.priceParabolic;
    weightSum += WEIGHTS.priceParabolic;
  }

  // 2b. Retorno 1y muito acima do normal (>30% começa a contar, satura aos 100%).
  const change1y = safePercent(asset, "priceChange_1y");
  if (isFinite(change1y)) {
    parts.yoyReturn = clamp(((change1y - 0.30) / 0.70) * 100, 0, 100);
    weighted += parts.yoyReturn * WEIGHTS.yoyReturn;
    weightSum += WEIGHTS.yoyReturn;
  }

  // 3. RSI extremo (RSI 50 = neutro, RSI 85+ satura o score).
  const rsi = safeMetric(asset, "rsi_14");
  if (isFinite(rsi)) {
    parts.rsi = clamp(((rsi - 50) / 35) * 100, 0, 100);
    weighted += parts.rsi * WEIGHTS.rsi;
    weightSum += WEIGHTS.rsi;
  }

  if (weightSum === 0) return { score: null, available: false, breakdown: parts };
  return { score: Math.round(weighted / weightSum), available: true, breakdown: parts };
}

/**
 * Portfolio-level bubble/euphoria index.
 * @param {Array} portfolio - Array of { ticker, valAtual, mkt }
 * @param {number} totalValue
 * @param {Object} [themes] - output of engines/thematic.js thematicExposure()
 * @param {number} [warnThresholdPct=70] - config/strategy.bubbleWarnPct
 * @returns {{ overall: number, warning: boolean, warnThresholdPct: number,
 *             assetLevelScore: number, thematicBonus: number, hotTheme: Object|null, assets: Array }}
 */
export function portfolioBubbleIndex(portfolio, totalValue, themes = null, warnThresholdPct = 70) {
  if (!portfolio || !portfolio.length) {
    return { overall: 0, warning: false, warnThresholdPct, assetLevelScore: 0, thematicBonus: 0, hotTheme: null, assets: [] };
  }

  const total = Math.max(totalValue, 1);
  const assets = portfolio.map(p => {
    const b = assetBubbleScore(p.mkt || p);
    return { ticker: p.ticker, weight: (p.valAtual || 0) / total, ...b };
  });

  const scored = assets.filter(a => a.available);
  const wSum = scored.reduce((s, a) => s + a.weight, 0);
  const assetLevelScore = wSum > 0 ? scored.reduce((s, a) => s + a.score * a.weight, 0) / wSum : 0;

  // Concentração temática num tema quente amplifica o risco de bolha ao nível da carteira,
  // mesmo que nenhum activo isolado pareça extremo.
  let thematicBonus = 0;
  let hotTheme = null;
  const dominant = themes?.dominant || [];
  if (dominant.length) {
    const top = dominant[0];
    if (top.exposure >= 30) {
      const themeTickers = new Set((top.assets || []).map(a => a.ticker));
      const themeScores = scored.filter(a => themeTickers.has(a.ticker));
      const avgThemeScore = themeScores.length ? themeScores.reduce((s, a) => s + a.score, 0) / themeScores.length : 0;
      if (avgThemeScore >= 60) {
        thematicBonus = clamp(((top.exposure - 30) / 40) * 20, 0, 20);
        hotTheme = { key: top.key, name: top.name, exposure: top.exposure, avgScore: Math.round(avgThemeScore) };
      }
    }
  }

  const overall = Math.round(clamp(assetLevelScore + thematicBonus, 0, 100));

  return {
    overall,
    warning: overall >= warnThresholdPct,
    warnThresholdPct,
    assetLevelScore: Math.round(assetLevelScore),
    thematicBonus: Math.round(thematicBonus),
    hotTheme,
    assets
  };
}
