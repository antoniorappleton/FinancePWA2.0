import { getAssetCategory } from "../utils/normalize.js";

// ── Refined Thematic classification with Decomposition ──
const THEMES = {
  ai_infrastructure: {
    name: "AI Infrastructure & Compute",
    icon: "🤖",
    tickers: new Set(["NVDA", "AMD", "AVGO", "MRVL", "INTC", "MSFT", "GOOGL", "GOOG", "META", "AMZN", "CRM", "PLTR", "SNOW", "ORCL", "IBM", "SMCI", "VRT", "ANET"]),
    keywords: ["artificial intelligence", "ai ", "machine learning", "neural", "gpu", "data center", "compute"]
  },
  semiconductors: {
    name: "Semiconductors",
    icon: "💾",
    tickers: new Set(["NVDA", "AMD", "INTC", "AVGO", "QCOM", "TSM", "ASML", "MRVL", "TXN", "KLAC", "LRCX", "AMAT", "MU", "ON", "ARM", "ADI", "MCHP"]),
    keywords: ["semiconductor", "chip", "semicondutor", "foundry", "wafer"]
  },
  electrification: {
    name: "Electrification & Energy Transition",
    icon: "⚡",
    tickers: new Set(["TSLA", "ENPH", "SEDG", "FSLR", "NEE", "BEP", "PLUG", "RUN", "RIVN", "LCID", "NIO", "CHPT", "ALB", "LTHM", "VWS", "ORSTED"]),
    keywords: ["solar", "wind", "battery", "electric vehicle", "ev ", "renewable", "clean energy", "hydrogen", "grid", "copper", "lithium"]
  },
  defense_tech: {
    name: "Defense & Space Economy",
    icon: "🛡️",
    tickers: new Set(["LMT", "RTX", "NOC", "GD", "BA", "LHX", "PLTR", "BAH", "RKLB", "ASTS", "SPCE", "LUNR", "HWM"]),
    keywords: ["defense", "military", "aerospace", "defesa", "segurança", "space", "satellite", "orbital"]
  },
  financial_infra: {
    name: "Financial Infrastructure",
    icon: "🏦",
    tickers: new Set(["V", "MA", "PYPL", "SQ", "ADYEN", "NU", "COIN", "AFRM", "SOFI", "MCO", "SPGI", "MS", "GS", "JPM"]),
    keywords: ["payment", "fintech", "pagamento", "digital bank", "asset management", "credit rating"]
  },
  robotics: {
    name: "Robotics & Industrial Automation",
    icon: "🦾",
    tickers: new Set(["ISRG", "ROK", "ABB", "FANUY", "TER", "IRBT", "KUKA", "ZBRA", "TKR"]),
    keywords: ["robot", "automation", "autonomous", "automação", "industrial software"]
  },
  quantum_cloud: {
    name: "Quantum Computing & Cloud",
    icon: "⚛️",
    tickers: new Set(["GOOGL", "GOOG", "IBM", "IONQ", "RGTI", "QBTS", "MSFT", "AMZN", "SNOW", "NET"]),
    keywords: ["quantum", "qubit", "cloud infrastructure", "edge computing"]
  },
  resource_scarcity: {
    name: "Resource Scarcity & Materials",
    icon: "💎",
    tickers: new Set(["BHP", "RIO", "VALE", "FCX", "NEM", "GOLD", "WPM", "LIN", "APD", "CTVA"]),
    keywords: ["mining", "mineração", "commodities", "agriculture", "scarcity", "water", "rare earth"]
  }
};

/**
 * Infer thematic exposure for diversified ETFs based on index composition.
 * Example: SPY (S&P 500) has high tech weight, which contributes to AI/Semis.
 */
function getETFThematicDecomposition(asset) {
  const category = getAssetCategory(asset);
  const name = String(asset.nome || asset.name || "").toLowerCase();
  const ticker = String(asset.ticker || "").toUpperCase();

  if (category !== "Broad Market ETF") return null;

  // Typical SP500 / World Index decomposition
  // Values represent "purity" contribution to each theme
  const worldWeights = {
    ai_infrastructure: 0.12,
    semiconductors: 0.08,
    financial_infra: 0.15,
    electrification: 0.05,
    quantum_cloud: 0.10
  };

  const sp500Weights = {
    ai_infrastructure: 0.18,
    semiconductors: 0.10,
    financial_infra: 0.12,
    electrification: 0.04,
    quantum_cloud: 0.15
  };

  if (name.includes("s&p 500") || ticker === "VUSA" || ticker === "VOO" || ticker === "SPY") {
    return sp500Weights;
  }
  
  return worldWeights; // Default World/Global ETF
}

/**
 * Classify a single asset's thematic exposure.
 */
export function classifyAssetThemes(asset) {
  const ticker = String(asset.ticker || "").toUpperCase();
  const nome = String(asset.nome || asset.name || "").toLowerCase();
  const sector = String(asset.setor || asset.sector || "").toLowerCase();
  const combined = `${nome} ${sector}`;
  
  const themes = [];

  // 1. Direct Rule-based detection
  for (const [key, theme] of Object.entries(THEMES)) {
    let confidence = 0;

    if (theme.tickers.has(ticker)) {
      confidence = 0.9;
    }

    for (const kw of theme.keywords) {
      if (combined.includes(kw)) {
        confidence = Math.max(confidence, 0.7);
        break;
      }
    }

    if (confidence > 0) {
      themes.push({ key, name: theme.name, icon: theme.icon, confidence: Math.round(confidence * 100) });
    }
  }

  // 2. Decomposition for Broad ETFs
  const decomp = getETFThematicDecomposition(asset);
  if (decomp) {
    for (const [key, purity] of Object.entries(decomp)) {
      if (!themes.find(t => t.key === key)) {
        themes.push({ 
          key, 
          name: THEMES[key].name, 
          icon: THEMES[key].icon, 
          confidence: Math.round(purity * 100),
          isIndirect: true 
        });
      }
    }
  }

  return themes.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Calculate portfolio-level thematic exposure.
 */
export function thematicExposure(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) {
    return { themes: {}, dominant: [], warnings: [] };
  }

  const total = Math.max(totalValue, 1);
  const themeMap = {};

  for (const p of portfolio) {
    const weight = (p.valAtual || 0) / total;
    const assetThemes = classifyAssetThemes({ ...p, ...(p.mkt || {}) });

    for (const t of assetThemes) {
      if (!themeMap[t.key]) {
        themeMap[t.key] = { name: t.name, icon: t.icon, exposure: 0, assetCount: 0, assets: [] };
      }
      // Weight exposure by confidence/purity
      const contribution = weight * (t.confidence / 100);
      themeMap[t.key].exposure += contribution;
      themeMap[t.key].assetCount++;
      themeMap[t.key].assets.push({ 
        ticker: String(p.ticker || "").toUpperCase(), 
        weight: Math.round(weight * 100),
        purity: t.confidence
      });
    }
  }

  const themes = {};
  for (const [key, data] of Object.entries(themeMap)) {
    themes[key] = {
      ...data,
      exposure: Math.round(data.exposure * 100)
    };
  }

  const sorted = Object.entries(themes).sort((a, b) => b[1].exposure - a[1].exposure);
  const dominant = sorted.slice(0, 6).map(([key, data]) => ({ key, ...data }));

  const warnings = [];
  for (const [key, data] of sorted) {
    if (data.exposure > 50) {
      warnings.push(`Concentração estrutural: ${data.name} representa ${data.exposure}% da economia do portfólio.`);
    }
  }

  return { themes, dominant, warnings };
}
