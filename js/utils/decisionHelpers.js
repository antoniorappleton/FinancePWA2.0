// js/utils/decisionHelpers.js - Investment Decision Logic for Atividade Cards

import { parseSma } from "./scoring.js";

/**
 * Computes Reinforcement Score (0-100) for position.
 * @param {Object} g - Position group (qtd, custoMedio=precoMedio, investido, precoAtual from g.precoAtual)
 * @param {Object} info - Market data (sma200, priceChange_1y, priceChange_1m)
 * @returns {Object} {score, breakdown: {descontoPts, tendenciaPts, momentumPts}}
 */
export function computeReinforcementScore(g, info) {
  const precoAtual = g.precoAtual;
  const precoMedio = g.qtd > 0 ? g.investido / g.qtd : 0;
  if (!Number.isFinite(precoAtual) || !Number.isFinite(precoMedio) || precoMedio <= 0) {
    return { score: 0, breakdown: { descontoPts: 0, tendenciaPts: 0, momentumPts: 0 } };
  }

  const drawdown = (precoAtual - precoMedio) / precoMedio; // negative if loss

  // 1. Desconto points (0-50)
  let descontoPts = 0;
  if (drawdown <= 0) {
    if (drawdown > -0.05) descontoPts = 10;
    else if (drawdown > -0.10) descontoPts = 25;
    else if (drawdown > -0.20) descontoPts = 40;
    else descontoPts = 50;
  }

  // 2. Tendencia (0-30)
  let tendenciaPts = 0;
  const sma200 = parseSma(info.sma200 || info.SMA200, precoAtual);
  const sma50  = parseSma(info.sma50 || info.SMA50, precoAtual);

  if (Number.isFinite(precoAtual) && Number.isFinite(sma200) && sma200 > 0) {
    if (precoAtual > sma200) tendenciaPts += 15;
    if (Number.isFinite(sma50) && sma50 > 0) {
      if (precoAtual > sma50) tendenciaPts += 10;
      if (sma50 > sma200) tendenciaPts += 5; // Golden Cross bonus
    } else {
      // Se não houver SMA50, damos os restantes pontos baseados na SMA200 ou histórico
      if (precoAtual > sma200) tendenciaPts += 15; 
    }
  } else {
    const ch1y = Number(info.priceChange_1y || info.taxaCrescimento_1ano || 0);
    tendenciaPts = ch1y > 0 ? 30 : 10;
  }

  // 3. Momentum (0-20)
  const ch1m = Number(info.priceChange_1m || info.taxaCrescimento_1mes || 0);
  const momentumPts = ch1m > 0 ? 20 : 5;

  const score = Math.round(descontoPts + tendenciaPts + momentumPts);

  return {
    score,
    breakdown: { descontoPts, tendenciaPts, momentumPts, drawdown }
  };
}

/**
 * Gets reforço suggestion based on drawdown.
 * @param {number} drawdown - (precoAtual - precoMedio)/precoMedio
 * @param {number} investido - Current invested amount
 * @param {number} precoAtual
 * @param {number} qtd - Current quantity
 * @returns {Object} {quedaAtualStr, rangeMin, rangeMax, newMedioEst}
 */
export function getReforcoSuggestion(drawdown, investido, precoAtual, qtd) {
  if (!Number.isFinite(drawdown) || drawdown >= 0 || investido <= 0) {
    return { quedaAtualStr: 'Sem queda', rangeMin: 0, rangeMax: 0, newMedioEst: 0 };
  }

  const quedaAbs = -drawdown * 100; // positive %
  let pctReforco = 0.25;
  if (quedaAbs >= 0.30) pctReforco = 1.0;
  else if (quedaAbs >= 0.20) pctReforco = 0.75;
  else if (quedaAbs >= 0.10) pctReforco = 0.50;
  else if (quedaAbs >= 0.05) pctReforco = 0.25;

  const midReforco = investido * pctReforco;
  const rangeMin = Math.round(midReforco * 0.5);
  const rangeMax = Math.round(midReforco * 1.5);

  // New medio est: weighted avg
  const qtdNova = midReforco / precoAtual;
  const newMedioEst = (investido + midReforco) / (qtd + qtdNova);

  return {
    quedaAtualStr: `${quedaAbs.toFixed(1)}%`,
    rangeMin,
    rangeMax,
    newMedioEst: Number.isFinite(newMedioEst) ? newMedioEst : 0
  };
}

/**
 * Gets strategy alternative (venda reentrada) data.
 * @param {number} lucroAtual - Negative if loss
 * @param {number} precoAtual
 * @param {number} qtd
 * @returns {Object} {precoReentrada, dropNeededStr}
 */
export function getEstrategiaAlternativa(lucroAtual, precoAtual, qtd) {
  if (lucroAtual >= 0 || !Number.isFinite(precoAtual) || qtd <= 0) {
    return null;
  }

  const prejuizo = -lucroAtual;
  const precoReentrada = (precoAtual * qtd - prejuizo) / qtd;
  const dropNeeded = (precoReentrada / precoAtual - 1) * 100;
  return {
    precoReentrada,
    dropNeededStr: `${dropNeeded < 0 ? '-' : '+'}${Math.abs(dropNeeded).toFixed(1)}%`,
    prejuizo
  };
}

/**
 * Gets estado position color class.
 * @param {number} resultadoPct
 * @returns {string} 'success' | 'neutral' | 'danger'
 */
export function getEstadoColor(resultadoPct) {
  if (resultadoPct > 0.10) return 'success';
  if (resultadoPct < -0.10) return 'danger';
  return 'neutral';
}

/**
 * Gets score badge class/text.
 * @param {number} score
 * @returns {Object} {badgeClass, label}
 */
export function getScoreBadge(score) {
  if (score >= 80) return { badgeClass: 'strong', label: '🟢 Reforço forte' };
  if (score >= 60) return { badgeClass: 'interesting', label: '🟢 Reforço interessante' };
  if (score >= 40) return { badgeClass: 'wait', label: '🟡 Aguardar' };
  return { badgeClass: 'avoid', label: '🔴 Evitar reforço' };
}

