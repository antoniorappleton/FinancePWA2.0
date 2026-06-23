// js/engines/stress-test.js
// ═══════════════════════════════════════════════════════════════════
// DRAWDOWN & STRESS TEST ENGINE
// Simulates: COVID, 2008, tech bear, rate hikes, energy crisis, recession
// Shows: expected drawdown, recovery time, stress survivability
// ═══════════════════════════════════════════════════════════════════

import { safeMetric, clamp } from "../utils/normalize.js";
import { normalizeSector, cleanTicker } from "../utils/scoring.js";

// ── Historical crisis scenarios with sector-level impacts ──
const SCENARIOS = {
  covid_2020: {
    name: "COVID-19 Crash (Mar 2020)",
    duration: "5 semanas",
    recoveryMonths: 5,
    sectorDrops: {
      "Tecnologia": -0.28, "Saúde": -0.15, "Financeiros": -0.38,
      "Energia": -0.55, "Consumo Cíclico": -0.35, "Consumo Defensivo": -0.12,
      "Industriais": -0.35, "Materiais": -0.30, "Imobiliário": -0.30, "Commodities": -0.25
    },
    defaultDrop: -0.34
  },
  gfc_2008: {
    name: "Crise Financeira Global (2008)",
    duration: "16 meses",
    recoveryMonths: 48,
    sectorDrops: {
      "Tecnologia": -0.52, "Saúde": -0.35, "Financeiros": -0.72,
      "Energia": -0.48, "Consumo Cíclico": -0.55, "Consumo Defensivo": -0.22,
      "Industriais": -0.50, "Materiais": -0.55, "Imobiliário": -0.65, "Commodities": -0.40
    },
    defaultDrop: -0.56
  },
  dotcom_2000: {
    name: "Bolha Dotcom (2000-2002)",
    duration: "30 meses",
    recoveryMonths: 84,
    sectorDrops: {
      "Tecnologia": -0.78, "Saúde": -0.30, "Financeiros": -0.25,
      "Energia": -0.15, "Consumo Cíclico": -0.40, "Consumo Defensivo": -0.10,
      "Industriais": -0.35, "Materiais": -0.20, "Imobiliário": -0.10, "Commodities": -0.10
    },
    defaultDrop: -0.49
  },
  rate_hike_2022: {
    name: "Subida de Taxas de Juro (2022)",
    duration: "10 meses",
    recoveryMonths: 14,
    sectorDrops: {
      "Tecnologia": -0.33, "Saúde": -0.12, "Financeiros": -0.18,
      "Energia": 0.15, "Consumo Cíclico": -0.30, "Consumo Defensivo": -0.05,
      "Industriais": -0.15, "Materiais": -0.10, "Imobiliário": -0.28, "Commodities": 0.25
    },
    defaultDrop: -0.24
  },
  tech_bear: {
    name: "Bear Market Tech (estilo NASDAQ -40%)",
    duration: "8 meses",
    recoveryMonths: 18,
    sectorDrops: {
      "Tecnologia": -0.45, "Saúde": -0.15, "Financeiros": -0.15,
      "Energia": 0.05, "Consumo Cíclico": -0.25, "Consumo Defensivo": -0.05,
      "Industriais": -0.20, "Materiais": -0.10, "Imobiliário": -0.12, "Commodities": 0.05
    },
    defaultDrop: -0.25
  },
  energy_crisis: {
    name: "Crise Energética (estilo 2022 Europa)",
    duration: "6 meses",
    recoveryMonths: 12,
    sectorDrops: {
      "Tecnologia": -0.15, "Saúde": -0.08, "Financeiros": -0.20,
      "Energia": -0.35, "Consumo Cíclico": -0.25, "Consumo Defensivo": -0.10,
      "Industriais": -0.30, "Materiais": -0.25, "Imobiliário": -0.15, "Commodities": -0.20
    },
    defaultDrop: -0.20
  },
  global_recession: {
    name: "Recessão Global Profunda",
    duration: "12 meses",
    recoveryMonths: 36,
    sectorDrops: {
      "Tecnologia": -0.40, "Saúde": -0.20, "Financeiros": -0.50,
      "Energia": -0.45, "Consumo Cíclico": -0.45, "Consumo Defensivo": -0.15,
      "Industriais": -0.40, "Materiais": -0.40, "Imobiliário": -0.45, "Commodities": -0.30
    },
    defaultDrop: -0.40
  }
};

const SECTOR_ALIASES = {
  "Technology": "Tecnologia", "Healthcare": "Saúde", "Health Care": "Saúde",
  "Financial Services": "Financeiros", "Financials": "Financeiros",
  "Energy": "Energia", "Consumer Cyclical": "Consumo Cíclico",
  "Consumer Defensive": "Consumo Defensivo", "Industrials": "Industriais",
  "Basic Materials": "Materiais", "Real Estate": "Imobiliário",
  "Communication Services": "Tecnologia", "Utilities": "Consumo Defensivo",
  "Commodities": "Commodities"
};

function normSector(s) {
  const raw = String(s || "").trim();
  return SECTOR_ALIASES[raw] || raw;
}
const PRECIOUS_METAL_SHOCKS = {
  gold: {
    covid_2020: -0.08,
    gfc_2008: 0.12,
    dotcom_2000: 0.05,
    rate_hike_2022: -0.08,
    tech_bear: 0.02,
    energy_crisis: 0.10,
    global_recession: 0.06
  },
  silver: {
    covid_2020: -0.18,
    gfc_2008: -0.18,
    dotcom_2000: -0.05,
    rate_hike_2022: -0.14,
    tech_bear: -0.06,
    energy_crisis: 0.06,
    global_recession: -0.08
  }
};

function getPreciousMetalKind(asset) {
  const ticker = cleanTicker(asset.ticker || asset.mkt?.ticker || "");
  const name = String(asset.nome || asset.name || asset.mkt?.nome || asset.mkt?.name || "").toLowerCase();
  const sector = String(asset.setor || asset.sector || asset.mkt?.setor || asset.mkt?.sector || "").toLowerCase();

  if (["GZUR", "PHAU", "SGLN", "IGLN", "GLD", "IAU"].includes(ticker) || name.includes("gold") || name.includes("ouro")) return "gold";
  if (["VZLC", "PHAG", "SSLV", "SLV"].includes(ticker) || name.includes("silver") || name.includes("prata")) return "silver";
  if (sector.includes("gold") || sector.includes("ouro")) return "gold";
  if (sector.includes("silver") || sector.includes("prata")) return "silver";
  return null;
}

/**
 * Simulate an asset's expected drawdown in a given scenario.
 */
function simulateAsset(asset, scenario) {
  const sector = normSector(normalizeSector(asset.mkt || asset));
  const beta = safeMetric(asset.mkt || asset, "beta") || 1.0;
  
  const metalKind = getPreciousMetalKind(asset);
  const baseDrop = metalKind
    ? (PRECIOUS_METAL_SHOCKS[metalKind]?.[asset.__scenarioKey] ?? scenario.sectorDrops[sector] ?? scenario.defaultDrop)
    : (scenario.sectorDrops[sector] ?? scenario.defaultDrop);
  
  // Beta-adjust: higher beta = more sensitive to market drops
  const adjustedDrop = baseDrop * Math.max(0.5, beta);
  
  return {
    expectedDrop: Math.round(adjustedDrop * 100) / 100,
    expectedDropPct: Math.round(adjustedDrop * 100),
    sector,
    beta: Math.round(beta * 100) / 100
  };
}

/**
 * Run stress tests on the entire portfolio.
 * @param {Array} portfolio - Array of { ticker, valAtual, mkt }
 * @param {number} totalValue
 * @returns {{ scenarios: Object, worstCase: Object, resilience: number, summary: string }}
 */
export function stressTest(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) {
    return { scenarios: {}, worstCase: null, resilience: 0, summary: "Portfólio vazio" };
  }

  const total = Math.max(totalValue, 1);
  const results = {};

  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    let portfolioDrop = 0;
    const assetDrops = [];

    for (const p of portfolio) {
      const weight = (p.valAtual || 0) / total;
      const sim = simulateAsset({ ...p, __scenarioKey: key }, scenario);
      portfolioDrop += sim.expectedDrop * weight;
      
      assetDrops.push({
        ticker: cleanTicker(p.ticker),
        drop: sim.expectedDropPct,
        lossEUR: Math.round((p.valAtual || 0) * Math.abs(sim.expectedDrop)),
        sector: sim.sector
      });
    }

    // Sort by worst hit
    assetDrops.sort((a, b) => a.drop - b.drop);

    const totalLoss = Math.round(total * Math.abs(portfolioDrop));

    results[key] = {
      name: scenario.name,
      duration: scenario.duration,
      recoveryMonths: scenario.recoveryMonths,
      portfolioDropPct: Math.round(portfolioDrop * 100),
      estimatedLoss: totalLoss,
      worstHit: assetDrops.slice(0, 3),
      bestSurvivors: assetDrops.filter(a => a.drop > -10).slice(0, 3),
      severity: portfolioDrop < -0.40 ? "Extreme" : portfolioDrop < -0.25 ? "High" : portfolioDrop < -0.15 ? "Moderate" : "Low"
    };
  }

  // Find worst case
  const worstKey = Object.entries(results).sort((a, b) => a[1].portfolioDropPct - b[1].portfolioDropPct)[0];
  const worstCase = worstKey ? { scenario: worstKey[0], ...worstKey[1] } : null;

  // Average drop across all scenarios
  const avgDrop = Object.values(results).reduce((s, r) => s + r.portfolioDropPct, 0) / Object.keys(results).length;
  
  // Resilience: 0 = very fragile, 100 = fortress
  const resilience = Math.round(clamp(100 + avgDrop * 2, 0, 100));

  // Summary
  let summary;
  if (resilience >= 75) summary = "Portfólio resiliente — sobrevive bem à maioria dos cenários de stress";
  else if (resilience >= 55) summary = "Portfólio moderado — vulnerável a crises severas mas recuperável";
  else if (resilience >= 35) summary = "Portfólio agressivo — perdas significativas esperadas em cenários de stress";
  else summary = "Portfólio muito exposto — risco extremo em crises de mercado";

  return { scenarios: results, worstCase, resilience, summary };
}
