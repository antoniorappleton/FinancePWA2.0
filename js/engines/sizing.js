// js/engines/sizing.js
// ═══════════════════════════════════════════════════════════════════
// POSITION SIZING ENGINE
// Prevents: over-concentration, thematic overlap, excessive risk.
// Generates: max position rules, volatility-adjusted sizing, alerts.
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, clamp } from "../utils/normalize.js";
import { normalizeSector } from "../utils/scoring.js";

// ── Config ──
const RULES = {
  maxSinglePosition:   0.10,  // 10% max per asset
  maxSectorExposure:   0.30,  // 30% max per sector
  maxTypeExposure:     0.60,  // 60% max per type (stocks, etfs)
  maxSpeculativeTotal: 0.10,  // 10% max for speculative assets (crypto, meme)
  minPositions:        5,     // Minimum recommended positions
  idealPositions:      12,    // Ideal number of positions
};

/**
 * Calculate optimal position size for a NEW purchase.
 * @param {Object} params
 * @param {Object} params.asset - Asset to buy (from acoesDividendos)
 * @param {number} params.totalPortfolioValue - Current total portfolio value
 * @param {number} params.availableCash - Cash available to invest
 * @param {Array}  params.currentPositions - Array of { ticker, valAtual, mkt, ... }
 * @returns {{ recommendedSize: number, maxSize: number, warnings: Array, reasoning: Array }}
 */
export function calculatePositionSize(params) {
  const { asset, totalPortfolioValue, availableCash, currentPositions = [] } = params;
  if (!asset) return { recommendedSize: 0, maxSize: 0, warnings: ["Ativo inválido"], reasoning: [] };

  const totalVal = Math.max(totalPortfolioValue, 1);
  const ticker = String(asset.ticker || "").toUpperCase();
  const warnings = [];
  const reasoning = [];

  // ── 1. Base max from single position rule ──
  let maxPct = RULES.maxSinglePosition;
  reasoning.push(`Regra base: máx. ${(maxPct * 100).toFixed(0)}% por posição`);

  // ── 2. Volatility adjustment ──
  const beta = safeMetric(asset, "beta", "Beta") || 1.0;
  if (beta > 1.5) {
    maxPct *= 0.6;  // Reduce size for high-beta assets
    reasoning.push(`Beta alto (${beta.toFixed(2)}) → tamanho reduzido para ${(maxPct * 100).toFixed(1)}%`);
  } else if (beta > 1.2) {
    maxPct *= 0.8;
    reasoning.push(`Beta moderado (${beta.toFixed(2)}) → redução ligeira`);
  } else if (beta < 0.7) {
    maxPct *= 1.2;  // Can increase for defensive assets
    reasoning.push(`Beta defensivo (${beta.toFixed(2)}) → margem aumentada`);
  }

  // ── 3. Check existing position ──
  const existingPos = currentPositions.find(p => String(p.ticker || "").toUpperCase() === ticker);
  const existingPct = existingPos ? (existingPos.valAtual || 0) / totalVal : 0;

  if (existingPct >= RULES.maxSinglePosition) {
    warnings.push(`Já tens ${(existingPct * 100).toFixed(1)}% em ${ticker} — acima do máximo recomendado`);
    maxPct = Math.max(0, maxPct - existingPct);
  } else if (existingPct > 0) {
    maxPct = Math.max(0, maxPct - existingPct);
    reasoning.push(`Posição existente: ${(existingPct * 100).toFixed(1)}% → margem restante: ${(maxPct * 100).toFixed(1)}%`);
  }

  // ── 4. Sector concentration check ──
  const assetSector = normalizeSector(asset);
  let sectorPct = 0;
  currentPositions.forEach(p => {
    const pSec = normalizeSector(p.mkt || p);
    if (pSec === assetSector) sectorPct += (p.valAtual || 0) / totalVal;
  });

  if (sectorPct >= RULES.maxSectorExposure) {
    warnings.push(`Setor "${assetSector}" já tem ${(sectorPct * 100).toFixed(0)}% — limite atingido`);
    maxPct = Math.min(maxPct, Math.max(0, RULES.maxSectorExposure - sectorPct));
  }

  // ── 5. Speculative asset cap ──
  const nome = String(asset.nome || "").toUpperCase();
  const isSpeculative = beta > 2.0 || nome.includes("BITCOIN") || nome.includes("ETHEREUM") || nome.includes("CRYPTO");
  if (isSpeculative) {
    let currentSpecPct = 0;
    currentPositions.forEach(p => {
      const n = String(p.nome || p.mkt?.nome || "").toUpperCase();
      const b = safeMetric(p.mkt || p, "beta") || 1;
      if (b > 2 || n.includes("BITCOIN") || n.includes("ETHEREUM") || n.includes("CRYPTO")) {
        currentSpecPct += (p.valAtual || 0) / totalVal;
      }
    });
    if (currentSpecPct >= RULES.maxSpeculativeTotal) {
      warnings.push(`Exposição especulativa já no limite (${(currentSpecPct * 100).toFixed(0)}%)`);
      maxPct = 0;
    } else {
      maxPct = Math.min(maxPct, RULES.maxSpeculativeTotal - currentSpecPct);
      reasoning.push(`Ativo especulativo → limite especial de ${(RULES.maxSpeculativeTotal * 100)}%`);
    }
  }

  // ── Final calculation ──
  maxPct = clamp(maxPct, 0, RULES.maxSinglePosition);
  const maxEUR = maxPct * totalVal;
  const recommended = Math.min(maxEUR, availableCash * 0.8); // Never use 100% of cash in one trade

  return {
    recommendedSize: Math.round(recommended * 100) / 100,
    recommendedPct: Math.round(maxPct * 1000) / 10,
    maxSize: Math.round(maxEUR * 100) / 100,
    existingPct: Math.round(existingPct * 1000) / 10,
    sectorExposure: Math.round(sectorPct * 100),
    warnings,
    reasoning
  };
}

/**
 * Analyze all positions for sizing violations.
 * @param {Array} positions - Array of { ticker, valAtual, mkt }
 * @param {number} totalValue
 * @returns {{ violations: Array, suggestions: Array }}
 */
export function auditPositionSizes(positions, totalValue) {
  const violations = [];
  const suggestions = [];
  const total = Math.max(totalValue, 1);

  // Check individual positions
  for (const p of positions) {
    const pct = (p.valAtual || 0) / total;
    const ticker = String(p.ticker || "").toUpperCase();

    if (pct > RULES.maxSinglePosition * 1.5) {
      violations.push({ ticker, pct: Math.round(pct * 100), msg: `${ticker} está em ${(pct * 100).toFixed(1)}% — recomendado reduzir para <${RULES.maxSinglePosition * 100}%`, severity: "high" });
    } else if (pct > RULES.maxSinglePosition) {
      violations.push({ ticker, pct: Math.round(pct * 100), msg: `${ticker} acima do limite recomendado (${(pct * 100).toFixed(1)}%)`, severity: "medium" });
    }
  }

  // Check sector concentration
  const sectorMap = {};
  positions.forEach(p => {
    const s = normalizeSector(p.mkt || p) || "Outros";
    sectorMap[s] = (sectorMap[s] || 0) + (p.valAtual || 0);
  });

  for (const [sector, value] of Object.entries(sectorMap)) {
    const pct = value / total;
    if (pct > RULES.maxSectorExposure) {
      violations.push({ sector, pct: Math.round(pct * 100), msg: `Setor "${sector}" com ${(pct * 100).toFixed(0)}% — acima do limite de ${RULES.maxSectorExposure * 100}%`, severity: "medium" });
    }
  }

  // Suggest better diversification
  if (positions.length < RULES.minPositions) {
    suggestions.push(`Portfólio com apenas ${positions.length} posições — recomendado mínimo ${RULES.minPositions}`);
  }
  if (positions.length < RULES.idealPositions) {
    suggestions.push(`Considerar aumentar para ${RULES.idealPositions}+ posições para melhor diversificação`);
  }

  return { violations, suggestions, rules: RULES };
}
