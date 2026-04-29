// js/utils/capitalManager.js
import { calculateLucroMaximoScore } from "./scoring.js";

/**
 * Define as regras dinâmicas de reserva (War Chest) baseadas no estado da carteira.
 */
export const CAPITAL_STRATEGY = {
  OVERVALUED: {
    label: "Sobrevalorizada",
    color: "var(--destructive)",
    reserveMin: 0.60,
    reserveMax: 0.80,
    dcaFactor: 0.5, // Investir apenas metade do habitual
    message: "⚠️ Mercado caro. É prudente reduzir as compras agora e acumular liquidez (War Chest) para quando os preços baixarem."
  },
  NEUTRAL: {
    label: "Justa / Neutra",
    color: "var(--premium)",
    reserveMin: 0.30,
    reserveMax: 0.50,
    dcaFactor: 1.0, // Investimento normal
    message: "⚖️ Carteira em equilíbrio. Mantém o teu plano base de investimento mensal sem grandes desvios."
  },
  UNDERVALUED: {
    label: "Subvalorizada",
    color: "var(--success)",
    reserveMin: 0.10,
    reserveMax: 0.25,
    dcaFactor: 1.5, // Investir mais agressivamente
    message: "✅ Oportunidade: Ativos com desconto! Podes acelerar os teus investimentos e usar parte da tua reserva para comprar mais agora."
  }
};

/**
 * Calcula o estado agregado da carteira.
 * @param {Array} positions - Ativos atuais (da coleção 'ativos')
 * @param {Map|Array} acoesData - Dados de mercado (da coleção 'acoesDividendos')
 */
export function calculatePortfolioState(positions, acoesData) {
  const acoesMap = Array.isArray(acoesData) 
    ? new Map(acoesData.map(a => [String(a.ticker).toUpperCase(), a]))
    : acoesData;

  let totalValue = 0;
  let weightedValuationScore = 0;
  let count = 0;

  positions.forEach(p => {
    const ticker = String(p.ticker).toUpperCase();
    const mkt = acoesMap.get(ticker);
    if (!mkt) return;

    const precoAtual = Number(mkt.valorStock || mkt.price || 0);
    const valAtual = (p.quantidade || p.qtd || 0) * precoAtual;
    if (valAtual <= 0) return;

    // Obter o componente de Valuation (V) do score
    const scoreObj = calculateLucroMaximoScore(mkt);
    const vScore = scoreObj.components.V || 0.5;

    weightedValuationScore += vScore * valAtual;
    totalValue += valAtual;
    count++;
  });

  const avgValuation = totalValue > 0 ? (weightedValuationScore / totalValue) : 0.5;

  let state;
  if (avgValuation > 0.65) state = CAPITAL_STRATEGY.UNDERVALUED;
  else if (avgValuation < 0.35) state = CAPITAL_STRATEGY.OVERVALUED;
  else state = CAPITAL_STRATEGY.NEUTRAL;

  return {
    score: avgValuation,
    ...state,
    totalValue
  };
}

/**
 * Calcula a recomendação de reserva atual.
 */
export function getWarChestRecommendation(portfolioState, availableCash) {
  const targetReserve = (portfolioState.reserveMin + portfolioState.reserveMax) / 2;
  const recommendedReserveAmount = availableCash * targetReserve;
  
  return {
    percentage: targetReserve * 100,
    amount: recommendedReserveAmount,
    totalInvestable: availableCash - recommendedReserveAmount // Bolo total disponível para ser alocado via DCA ou Oportunidades
  };
}

/**
 * Ajusta o plano DCA mensal.
 */
export function getSmartDCA(baseMonthly, portfolioState) {
  const adjustedValue = baseMonthly * portfolioState.dcaFactor;
  const toReserve = Math.max(0, baseMonthly - adjustedValue);
  
  return {
    original: baseMonthly,
    adjusted: adjustedValue,
    toReserve: toReserve > 0 ? toReserve : 0,
    fromReserve: adjustedValue > baseMonthly ? adjustedValue - baseMonthly : 0
  };
}

/**
 * Plano de crise escalonado para uso da reserva.
 */
export function getCrisisDeployment(drawdown, currentWarChest) {
  let percentageToUse = 0;
  
  if (drawdown >= 0.30) percentageToUse = 1.0;      // Usar restante
  else if (drawdown >= 0.20) percentageToUse = 0.6; // +30% (acumulado 60%)
  else if (drawdown >= 0.10) percentageToUse = 0.3; // +20% (acumulado 30%)
  else if (drawdown >= 0.05) percentageToUse = 0.1; // 10%
  
  return {
    drawdown: drawdown * 100,
    amountToDeploy: currentWarChest * percentageToUse,
    remainingChest: currentWarChest * (1 - percentageToUse)
  };
}

/**
 * Priorização de ativos para reforço.
 * Ordena por: 1) Desvio Target, 2) Qualidade, 3) Valuation, 4) Tendência
 */
export function prioritizeReinforcements(enrichedAtivos) {
  return [...enrichedAtivos].sort((a, b) => {
    // 1. Prioridade absoluta: Qualidade (fundamental) e Valuation se estiverem bons
    // Mas o critério #1 do utilizador é desvio ao target.
    
    // Supondo que 'desvioTarget' é positivo se estiver ABAIXO do target
    const scoreA = (a.desvioTarget || 0) * 0.4 + (a.scoreQuality || 0) * 0.3 + (a.scoreValuation || 0) * 0.2 + (a.scoreTrend || 0) * 0.1;
    const scoreB = (b.desvioTarget || 0) * 0.4 + (b.scoreQuality || 0) * 0.3 + (b.scoreValuation || 0) * 0.2 + (b.scoreTrend || 0) * 0.1;
    
    return scoreB - scoreA;
  });
}
