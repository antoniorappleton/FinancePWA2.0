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

  const quedaAbs = -drawdown * 100; // positive %, ex: drawdown=-0.15 → quedaAbs=15
  // Escada alinhada com D5.2 (crisisLadder): limiares em %, frações do investido.
  let pctReforco = 0;
  if (quedaAbs >= 50) pctReforco = 1.00;
  else if (quedaAbs >= 25) pctReforco = 0.75;
  else if (quedaAbs >= 15) pctReforco = 0.50;
  else if (quedaAbs >= 10) pctReforco = 0.25;
  else if (quedaAbs >= 5)  pctReforco = 0.10;

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
 * Gets strategy alternative (venda parcial/total + reentrada) data.
 *
 * Simula vender uma fração `pctVenda` da posição ao preço atual (realizando
 * prejuízo proporcional) e recomprar exatamente essa mesma quantidade mais
 * barato. O preço de reentrada é o ponto ao qual, ao recomprar a quantidade
 * vendida, o dinheiro que fica "por gastar" (face ao que se recebeu na venda)
 * equivale exatamente ao prejuízo realizado nessa fração — por isso o preço
 * de reentrada e a queda % necessária NÃO dependem de `pctVenda` (é uma
 * relação por unidade); o que varia com a fração vendida é o valor em euros
 * em jogo e a quantidade a recomprar.
 *
 * @param {number} lucroAtual - P/L total não realizado da posição (negativo se prejuízo)
 * @param {number} precoAtual
 * @param {number} qtd - Quantidade total da posição
 * @param {number} [pctVenda=1] - Fração da posição a simular vender (0-1, ex: 0.5 = 50%)
 * @returns {Object|null} {pctVenda, qtdVendida, prejuizo, valorVenda, precoReentrada, dropNeededStr, qtdRecompra, valorRecompra}
 */
export function getEstrategiaAlternativa(lucroAtual, precoAtual, qtd, pctVenda = 1) {
  if (lucroAtual >= 0 || !Number.isFinite(precoAtual) || qtd <= 0) {
    return null;
  }

  const pct = Math.min(1, Math.max(0, Number(pctVenda) || 0));
  if (pct <= 0) return null;

  const precoMedio = precoAtual - lucroAtual / qtd;
  const qtdVendida = qtd * pct;
  const prejuizo = (precoMedio - precoAtual) * qtdVendida; // > 0 = perda realizada nesta fração
  const valorVenda = precoAtual * qtdVendida;

  const precoReentrada = precoAtual - prejuizo / qtdVendida; // = 2*precoAtual - precoMedio
  const dropNeeded = (precoReentrada / precoAtual - 1) * 100;
  const valorRecompra = qtdVendida * precoReentrada;

  return {
    pctVenda: pct,
    qtdVendida,
    prejuizo,
    valorVenda,
    precoReentrada,
    dropNeededStr: `${dropNeeded < 0 ? '-' : '+'}${Math.abs(dropNeeded).toFixed(1)}%`,
    qtdRecompra: qtdVendida,
    valorRecompra
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

