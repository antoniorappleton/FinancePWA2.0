// js/engines/observations.js
// ═══════════════════════════════════════════════════════════════════
// AI-DRIVEN OBSERVATION ENGINE
// Generates intelligent, contextual observations for assets and portfolio.
// Examples: "ETF excessivamente dependente de Nvidia."
//           "Momentum forte mas valuation esticado."
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, safePercent, isValid } from "../utils/normalize.js";
import { isKnownETF, smartETFAnalysis } from "./etf-overlap.js";

/**
 * Generate observations for a single asset using all available data.
 * @param {Object} asset - Full asset data
 * @param {Object} engines - { quality, momentum, valuation, risk } scores
 * @param {Object} [temporal] - Temporal score results
 * @returns {Array} Array of { type: 'positive'|'warning'|'neutral'|'caution', msg: string, priority: number }
 */
export function generateAssetObservations(asset, engines, temporal = null) {
  const obs = [];
  const ticker = String(asset.ticker || "").toUpperCase();
  const { quality, momentum, valuation, risk } = engines || {};

  // ── Quality observations ──
  const roic = safePercent(asset, "roic");
  const de = safeMetric(asset, "debt_eq");
  
  if (isFinite(roic) && roic > 0.20) {
    obs.push({ type: "positive", msg: `ROIC elevado (${(roic*100).toFixed(1)}%) — empresa com vantagem competitiva forte.`, priority: 9 });
  }
  if (isFinite(roic) && roic < 0) {
    obs.push({ type: "caution", msg: `ROIC negativo — empresa está a destruir valor.`, priority: 10 });
  }
  if (isFinite(de) && de < 0.3 && quality?.score > 65) {
    obs.push({ type: "positive", msg: `Empresa com ROIC elevado e dívida controlada (D/E: ${de.toFixed(2)}).`, priority: 8 });
  }
  if (isFinite(de) && de > 3) {
    obs.push({ type: "warning", msg: `Alavancagem muito alta (D/E: ${de.toFixed(2)}) — risco financeiro elevado.`, priority: 9 });
  }

  // ── Momentum + Valuation combos ──
  if (momentum?.score > 70 && valuation?.score < 35) {
    obs.push({ type: "warning", msg: `Momentum forte mas valuation esticado — cuidado com o timing de entrada.`, priority: 8 });
  }
  if (momentum?.score < 30 && quality?.score > 70) {
    obs.push({ type: "neutral", msg: `Empresa sólida em fase de correção — potencial oportunidade de compra.`, priority: 7 });
  }
  if (quality?.score > 75 && valuation?.score > 70) {
    obs.push({ type: "positive", msg: `Qualidade + Valor: combinação rara de empresa forte a preço atrativo.`, priority: 10 });
  }

  // ── RSI observations ──
  const rsi = safeMetric(asset, "rsi_14");
  if (isFinite(rsi) && rsi > 80) {
    obs.push({ type: "warning", msg: `RSI extremo (${rsi.toFixed(0)}) — sobrecomprado, risco de correção técnica.`, priority: 7 });
  }
  if (isFinite(rsi) && rsi < 25) {
    obs.push({ type: "neutral", msg: `RSI muito baixo (${rsi.toFixed(0)}) — oversold, potencial reversão de curto prazo.`, priority: 7 });
  }

  // ── Dividend observations ──
  const dy = safePercent(asset, "yield");
  if (isFinite(dy) && dy > 0.06) {
    obs.push({ type: "positive", msg: `Yield de dividendo elevado (${(dy*100).toFixed(1)}%) — gerador de fluxo de caixa passivo.`, priority: 6 });
  }
  if (isFinite(dy) && dy > 0.10) {
    obs.push({ type: "caution", msg: `Yield muito alto (${(dy*100).toFixed(1)}%) — verificar sustentabilidade do dividendo.`, priority: 8 });
  }

  // ── Growth observations ──
  const eps5y = safePercent(asset, "eps_next_5y");
  const salesG = safePercent(asset, "sales_y_y_ttm");
  if (isFinite(eps5y) && eps5y > 0.15) {
    obs.push({ type: "positive", msg: `Crescimento projetado de EPS a 5 anos muito forte (${(eps5y*100).toFixed(1)}% anual).`, priority: 7 });
  }
  if (isFinite(salesG) && salesG > 0.20) {
    obs.push({ type: "positive", msg: `Receita a crescer ${(salesG*100).toFixed(0)}% YoY — expansão orgânica sólida.`, priority: 6 });
  }
  if (isFinite(salesG) && salesG < -0.10) {
    obs.push({ type: "warning", msg: `Receita em queda (${(salesG*100).toFixed(0)}% YoY) — negócio em contração.`, priority: 8 });
  }

  // ── ETF-specific ──
  if (isKnownETF(ticker)) {
    const etfData = smartETFAnalysis(ticker);
    if (etfData) {
      if (etfData.top10Concentration > 50) {
        obs.push({ type: "warning", msg: `ETF muito concentrado: top 10 holdings = ${etfData.top10Concentration.toFixed(0)}%.`, priority: 7 });
      }
      const topHolding = etfData.topHoldings[0];
      if (topHolding && topHolding.weight > 15) {
        obs.push({ type: "caution", msg: `ETF excessivamente dependente de ${topHolding.ticker} (${topHolding.weight}%).`, priority: 8 });
      }
    }
  }

  // ── Temporal divergence ──
  if (temporal?.divergence) {
    obs.push({ type: "neutral", msg: temporal.divergence, priority: 6 });
  }

  // ── Risk classification ──
  if (risk?.score < 25) {
    obs.push({ type: "caution", msg: `Perfil de risco especulativo — limitar a 2-5% do portfólio.`, priority: 9 });
  }
  if (risk?.score > 80) {
    obs.push({ type: "positive", msg: `Perfil de risco muito estável — beta baixo e volatilidade controlada.`, priority: 5 });
  }

  // ── Sector-specific observations ──
  const sector = String(asset.setor || asset.sector || "").toLowerCase();
  if (sector === "commodities") {
    obs.push({ type: "neutral", msg: `${ticker}: Exposição a Commodities — proteção estrutural contra inflação e escassez de recursos.`, priority: 8 });
  }

  // Sort by priority (highest first)
  obs.sort((a, b) => b.priority - a.priority);

  return obs;
}

/**
 * Generate portfolio-level observations.
 * @param {Object} portfolioAnalysis - { health, correlation, stressTest, factors, dna, etfOverlap }
 * @returns {Array}
 */
export function generatePortfolioObservations(analysis) {
  const obs = [];
  const { health, correlation, stressTest, factors, dna, etfOverlap } = analysis || {};

  if (health) {
    if (health.score < 40) obs.push({ type: "warning", msg: `Saúde do portfólio em ${health.score}/100 — necessita reestruturação.`, priority: 10 });
    if (health.hiddenRiskScore > 60) obs.push({ type: "caution", msg: `Risco escondido elevado (${health.hiddenRiskScore}/100) — concentração não óbvia.`, priority: 9 });
  }

  if (correlation) {
    if (correlation.avgCorrelation > 0.6) {
      obs.push({ type: "warning", msg: `Boa diversificação setorial mas alta correlação (${correlation.avgCorrelation}) — diversificação pode ser ilusória.`, priority: 8 });
    }
    for (const cluster of (correlation.clusters || [])) {
      if (cluster.assets.length >= 3) {
        obs.push({ type: "neutral", msg: `Cluster correlacionado detetado: ${cluster.assets.join(", ")}`, priority: 6 });
      }
    }
  }

  if (stressTest?.worstCase) {
    const wc = stressTest.worstCase;
    obs.push({ type: "neutral", msg: `Pior cenário (${wc.name}): perda estimada de ${wc.portfolioDropPct}% (${wc.estimatedLoss?.toLocaleString()}€)`, priority: 7 });
  }

  if (dna?.primary) {
    obs.push({ type: "positive", msg: `${dna.primary.emoji} DNA: ${dna.primary.name}`, priority: 3 });
  }

  if (etfOverlap) {
    for (const w of (etfOverlap.warnings || []).slice(0, 3)) {
      obs.push({ type: "caution", msg: w, priority: 7 });
    }
  }

  obs.sort((a, b) => b.priority - a.priority);
  return obs;
}
