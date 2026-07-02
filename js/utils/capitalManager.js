// js/utils/capitalManager.js
import { calculateLucroMaximoScore, cleanTicker } from "./scoring.js";

// Escada canónica de crise (D5.2) — usada por default se crisisLadder não vier da strategy.
export const DEFAULT_CRISIS_LADDER = [
  { drawdownPct: 5,  deployPct: 10  },
  { drawdownPct: 10, deployPct: 25  },
  { drawdownPct: 15, deployPct: 50  },
  { drawdownPct: 25, deployPct: 75  },
  { drawdownPct: 50, deployPct: 100 },
];

// Labels/cores/mensagens estáticos (independentes de cashReservePct).
const _STRATEGY_LABELS = {
  OVERVALUED: {
    label: "Sobrevalorizada",
    color: "var(--destructive)",
    message: "⚠️ Mercado caro. É prudente reduzir as compras agora e acumular liquidez (War Chest) para quando os preços baixarem."
  },
  NEUTRAL: {
    label: "Justa / Neutra",
    color: "var(--premium)",
    message: "⚖️ Carteira em equilíbrio. Mantém o teu plano base de investimento mensal sem grandes desvios."
  },
  UNDERVALUED: {
    label: "Subvalorizada",
    color: "var(--success)",
    message: "✅ Oportunidade: Ativos com desconto! Podes acelerar os teus investimentos e usar parte da tua reserva para comprar mais agora."
  }
};

/**
 * Gera as bandas de reserva a partir de cashReservePct (D5).
 * @param {number} [cashReservePct=22] - % de reserva alvo (config/strategy.cashReservePct)
 */
export function buildCapitalStrategy(cashReservePct = 22) {
  const base = cashReservePct / 100;
  return {
    OVERVALUED:  { reserveMin: base * 1.4, reserveMax: base * 1.8, dcaFactor: 0.5, ..._STRATEGY_LABELS.OVERVALUED },
    NEUTRAL:     { reserveMin: base * 0.9, reserveMax: base * 1.1, dcaFactor: 1.0, ..._STRATEGY_LABELS.NEUTRAL    },
    UNDERVALUED: { reserveMin: base * 0.4, reserveMax: base * 0.7, dcaFactor: 1.5, ..._STRATEGY_LABELS.UNDERVALUED }
  };
}

// Exportado para backward compat (callers que lêem CAPITAL_STRATEGY.NEUTRAL.reserveMin directamente).
// Substitui os valores anteriores pelo default cashReservePct=22.
export const CAPITAL_STRATEGY = buildCapitalStrategy(22);

/**
 * Calcula o estado agregado da carteira.
 * @param {Array} positions
 * @param {Map|Array} acoesData
 * @param {number} [cashReservePct=22] - de config/strategy.cashReservePct
 */
export function calculatePortfolioState(positions, acoesData, cashReservePct = 22) {
  const strategy = buildCapitalStrategy(cashReservePct);
  const acoesMap = Array.isArray(acoesData)
    ? new Map(acoesData.map(a => [cleanTicker(a.ticker), a]))
    : acoesData;

  let totalValue = 0;
  let weightedValuationScore = 0;

  positions.forEach(p => {
    const ticker = cleanTicker(p.ticker);
    const mkt = acoesMap.get(p.canonical || ticker);
    if (!mkt) return;

    const precoAtual = Number(mkt.valorStock || mkt.price || mkt.preco || 0);
    const valAtual = (p.quantidade || p.qtd || 0) * precoAtual;
    if (valAtual <= 0) return;

    const scoreObj = calculateLucroMaximoScore(mkt);
    const vScore = scoreObj.components.V || 0.5;

    weightedValuationScore += vScore * valAtual;
    totalValue += valAtual;
  });

  const avgValuation = totalValue > 0 ? (weightedValuationScore / totalValue) : 0.5;

  let state;
  if (avgValuation > 0.65) state = strategy.UNDERVALUED;
  else if (avgValuation < 0.35) state = strategy.OVERVALUED;
  else state = strategy.NEUTRAL;

  return { score: avgValuation, ...state, totalValue };
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
    totalInvestable: availableCash - recommendedReserveAmount
  };
}

/**
 * Calcula a posição de cash em relação à reserva estratégica definida pelo utilizador.
 */
export function calculateCashPosition(portfolioValue, strategy) {
  const cashReservePct = Number(strategy?.cashReservePct || 0);
  const currentCash    = Number(strategy?.availableCash  || 0);
  const monthlyBase    = Number(strategy?.monthlyBase    || 0);
  const totalWealth    = portfolioValue + currentCash;
  const targetReserve  = totalWealth * (cashReservePct / 100);
  const gapToReserve   = targetReserve - currentCash;
  const availableToInvest = Math.max(0, currentCash + monthlyBase - targetReserve);
  return { targetReserve, currentCash, gapToReserve, monthlyBase, availableToInvest, cashReservePct, totalWealth };
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
 * Plano de crise escalonado (D5.2).
 * @param {number} drawdown - Queda em fração (ex: 0.15 para -15%)
 * @param {number} currentWarChest - Reserva disponível em €
 * @param {Array} [crisisLadder] - Escada de crise (default: DEFAULT_CRISIS_LADDER)
 */
export function getCrisisDeployment(drawdown, currentWarChest, crisisLadder) {
  const ladder = Array.isArray(crisisLadder) && crisisLadder.length > 0
    ? crisisLadder
    : DEFAULT_CRISIS_LADDER;

  const quedaPct = drawdown * 100;
  let deployPct = 0;

  for (const rung of ladder) {
    if (quedaPct >= rung.drawdownPct) deployPct = rung.deployPct;
  }

  const percentageToUse = deployPct / 100;

  return {
    drawdown: quedaPct,
    amountToDeploy: currentWarChest * percentageToUse,
    remainingChest: currentWarChest * (1 - percentageToUse)
  };
}

/**
 * Priorização de ativos para reforço.
 */
export function prioritizeReinforcements(enrichedAtivos) {
  return [...enrichedAtivos].sort((a, b) => {
    const scoreA = (a.desvioTarget || 0) * 0.4 + (a.scoreQuality || 0) * 0.3 + (a.scoreValuation || 0) * 0.2 + (a.scoreTrend || 0) * 0.1;
    const scoreB = (b.desvioTarget || 0) * 0.4 + (b.scoreQuality || 0) * 0.3 + (b.scoreValuation || 0) * 0.2 + (b.scoreTrend || 0) * 0.1;
    return scoreB - scoreA;
  });
}
