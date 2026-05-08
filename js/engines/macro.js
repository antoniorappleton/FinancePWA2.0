// js/engines/macro.js
// ═══════════════════════════════════════════════════════════════════
// MACRO REGIME ENGINE
// Detects current market regime and adjusts scoring weights.
// Regimes: Risk-On, Risk-Off, Inflationary, Recession,
//          High Rates, Liquidity Expansion, Commodity Supercycle
// ═══════════════════════════════════════════════════════════════════

// ── Regime definitions with scoring weight adjustments ──
const REGIMES = {
  risk_on: {
    name: "Risk-On",
    icon: "🟢",
    description: "Mercado em expansão, apetite por risco elevado.",
    weightAdjust: { quality: 0.8, momentum: 1.5, valuation: 0.7, risk: 0.6 },
    sectorBias: { "Tecnologia": 1.3, "Consumo Cíclico": 1.2, "Financeiros": 1.1, "Consumo Defensivo": 0.7, "Energia": 0.9 },
    factorBias: { growth: 1.4, momentum: 1.3, quality: 0.8, defensive: 0.6, cyclical: 1.3 }
  },
  risk_off: {
    name: "Risk-Off",
    icon: "🔴",
    description: "Mercado em contração, fuga para qualidade e segurança.",
    weightAdjust: { quality: 1.5, momentum: 0.6, valuation: 1.0, risk: 1.5 },
    sectorBias: { "Tecnologia": 0.7, "Consumo Cíclico": 0.6, "Consumo Defensivo": 1.4, "Saúde": 1.3, "Energia": 0.8 },
    factorBias: { growth: 0.6, momentum: 0.5, quality: 1.5, defensive: 1.5, cyclical: 0.5 }
  },
  inflationary: {
    name: "Inflacionário",
    icon: "🔥",
    description: "Inflação elevada, favorece ativos reais e commodities.",
    weightAdjust: { quality: 1.0, momentum: 1.0, valuation: 1.3, risk: 1.0 },
    sectorBias: { "Energia": 1.5, "Materiais": 1.4, "Consumo Defensivo": 1.1, "Tecnologia": 0.8, "Imobiliário": 0.7 },
    factorBias: { growth: 0.7, momentum: 1.0, quality: 1.1, defensive: 1.2, cyclical: 1.3 }
  },
  recession: {
    name: "Recessão",
    icon: "📉",
    description: "Contração económica. Qualidade e dividendos são prioritários.",
    weightAdjust: { quality: 1.8, momentum: 0.5, valuation: 1.2, risk: 1.5 },
    sectorBias: { "Saúde": 1.4, "Consumo Defensivo": 1.5, "Financeiros": 0.6, "Consumo Cíclico": 0.5, "Energia": 0.7 },
    factorBias: { growth: 0.4, momentum: 0.4, quality: 1.6, defensive: 1.6, cyclical: 0.3 }
  },
  high_rates: {
    name: "Taxas de Juro Altas",
    icon: "📊",
    description: "Taxas elevadas favorecem value e penalizam growth.",
    weightAdjust: { quality: 1.2, momentum: 0.8, valuation: 1.5, risk: 1.0 },
    sectorBias: { "Financeiros": 1.3, "Energia": 1.1, "Tecnologia": 0.7, "Imobiliário": 0.5, "Consumo Defensivo": 1.1 },
    factorBias: { growth: 0.6, momentum: 0.8, quality: 1.3, defensive: 1.1, cyclical: 0.9 }
  },
  liquidity_expansion: {
    name: "Expansão de Liquidez",
    icon: "💧",
    description: "QE/flexibilização. Favorece risk-on agressivo.",
    weightAdjust: { quality: 0.7, momentum: 1.5, valuation: 0.5, risk: 0.5 },
    sectorBias: { "Tecnologia": 1.5, "Consumo Cíclico": 1.3, "Imobiliário": 1.3, "Financeiros": 1.1, "Energia": 0.8 },
    factorBias: { growth: 1.5, momentum: 1.4, quality: 0.7, defensive: 0.5, cyclical: 1.3 }
  },
  commodity_super: {
    name: "Commodity Supercycle",
    icon: "⛏️",
    description: "Commodities em alta estrutural. Energia e materiais lideram.",
    weightAdjust: { quality: 1.0, momentum: 1.2, valuation: 1.0, risk: 0.8 },
    sectorBias: { "Energia": 1.6, "Materiais": 1.5, "Industriais": 1.2, "Tecnologia": 0.7, "Consumo Cíclico": 0.9 },
    factorBias: { growth: 0.8, momentum: 1.2, quality: 1.0, defensive: 0.7, cyclical: 1.5 }
  }
};

/**
 * Get a regime definition by key.
 */
export function getRegime(key) {
  return REGIMES[key] || null;
}

/**
 * Get all available regimes.
 */
export function getAllRegimes() {
  return Object.entries(REGIMES).map(([key, r]) => ({
    key, name: r.name, icon: r.icon, description: r.description
  }));
}

/**
 * Apply macro regime adjustments to scoring weights.
 * @param {Object} baseWeights - { quality, momentum, valuation, risk }
 * @param {string} regimeKey - One of the REGIMES keys
 * @returns {Object} Adjusted weights (re-normalized to sum=1)
 */
export function applyRegimeWeights(baseWeights, regimeKey) {
  const regime = REGIMES[regimeKey];
  if (!regime) return { ...baseWeights };

  const adjusted = {
    quality:   (baseWeights.quality || 0.30) * (regime.weightAdjust.quality || 1),
    momentum:  (baseWeights.momentum || 0.20) * (regime.weightAdjust.momentum || 1),
    valuation: (baseWeights.valuation || 0.30) * (regime.weightAdjust.valuation || 1),
    risk:      (baseWeights.risk || 0.20) * (regime.weightAdjust.risk || 1)
  };

  // Re-normalize
  const sum = adjusted.quality + adjusted.momentum + adjusted.valuation + adjusted.risk;
  if (sum > 0) {
    adjusted.quality /= sum;
    adjusted.momentum /= sum;
    adjusted.valuation /= sum;
    adjusted.risk /= sum;
  }

  return adjusted;
}

/**
 * Get sector bias multiplier for a given regime and sector.
 */
export function getSectorBias(regimeKey, sector) {
  const regime = REGIMES[regimeKey];
  if (!regime) return 1.0;
  return regime.sectorBias[sector] ?? 1.0;
}

/**
 * Get factor bias for the current regime.
 */
export function getFactorBias(regimeKey) {
  const regime = REGIMES[regimeKey];
  if (!regime) return { growth: 1, momentum: 1, quality: 1, defensive: 1, cyclical: 1 };
  return { ...regime.factorBias };
}

/**
 * Auto-detect regime from market signals (simplified heuristic).
 * In production, this would use VIX, yield curve, PMI, etc.
 * For now, it's user-selectable with a basic heuristic.
 * @param {Object} signals - { vix, yieldCurve, pmi, inflation, fedRate }
 * @returns {string} Detected regime key
 */
export function detectRegime(signals = {}) {
  const { vix, inflation, fedRate } = signals;
  
  // Basic heuristic — to be expanded with real data
  if (vix && vix > 30) return "risk_off";
  if (inflation && inflation > 5) return "inflationary";
  if (fedRate && fedRate > 4) return "high_rates";
  
  // Default: neutral/risk-on
  return "risk_on";
}
