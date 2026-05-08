import { getAssetCategory, canonicalTicker } from "../utils/normalize.js";

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
 * Infer thematic exposure for specialized ETFs based on index composition.
 */
function getETFThematicDecomposition(asset) {
  const ticker = canonicalTicker(asset.ticker);
  const name = String(asset.nome || asset.name || "").toLowerCase();

  // ── Specialized ETFs ──
  if (ticker === "QDVE" || ticker === "IITU") {
    return { ai_infrastructure: 0.65, semiconductors: 0.30, quantum_cloud: 0.25 };
  }
  if (ticker === "SMH" || ticker === "SOXX") {
    return { semiconductors: 1.0, ai_infrastructure: 0.85 };
  }
  if (name.includes("robotics") || ticker === "ROBO") {
    return { robotics: 0.80, ai_infrastructure: 0.30 };
  }
  if (ticker === "NUKL" || ticker === "URNM") {
    return { electrification: 0.70, resource_scarcity: 0.40 };
  }

  // ── Broad Market ETFs ──
  if (getAssetCategory(asset) === "Broad Market ETF") {
    if (name.includes("s&p 500") || ticker === "VUSA" || ticker === "VOO") {
      return { ai_infrastructure: 0.22, semiconductors: 0.12, financial_infra: 0.15, quantum_cloud: 0.18 };
    }
    return { ai_infrastructure: 0.15, semiconductors: 0.08, financial_infra: 0.18, electrification: 0.06 };
  }

  return null;
}

/**
 * Classify a single asset's thematic exposure.
 */
export function classifyAssetThemes(asset) {
  const ticker = canonicalTicker(asset.ticker);
  const nome = String(asset.nome || asset.name || "").toLowerCase();
  const sector = String(asset.setor || asset.sector || "").toLowerCase();
  const combined = `${nome} ${sector}`;
  
  const themes = [];

  // 1. Direct Rule-based detection
  for (const [key, theme] of Object.entries(THEMES)) {
    let confidence = 0;
    if (theme.tickers.has(ticker)) confidence = 1.0;
    else {
      for (const kw of theme.keywords) {
        if (combined.includes(kw)) { confidence = 0.75; break; }
      }
    }

    if (confidence > 0) {
      themes.push({ key, name: theme.name, icon: theme.icon, confidence: Math.round(confidence * 100) });
    }
  }

  // 2. Recursive Decomposition for ETFs
  const decomp = getETFThematicDecomposition(asset);
  if (decomp) {
    for (const [key, purity] of Object.entries(decomp)) {
      const existing = themes.find(t => t.key === key);
      if (existing) existing.confidence = Math.max(existing.confidence, Math.round(purity * 100));
      else themes.push({ key, name: THEMES[key].name, icon: THEMES[key].icon, confidence: Math.round(purity * 100), isIndirect: true });
    }
  }

  return themes.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Calculate portfolio-level thematic exposure.
 */
export function thematicExposure(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) return { themes: {}, dominant: [], warnings: [] };

  const total = Math.max(totalValue, 1);
  const themeMap = {};

  // Deduplicate and Aggregate
  const aggregated = {};
  for (const p of portfolio) {
    const t = canonicalTicker(p.ticker);
    if (!aggregated[t]) aggregated[t] = { ...p, valAtual: 0 };
    aggregated[t].valAtual += (p.valAtual || 0);
  }

  for (const p of Object.values(aggregated)) {
    const weight = p.valAtual / total;
    const assetThemes = classifyAssetThemes({ ...p, ...(p.mkt || {}) });

    for (const t of assetThemes) {
      if (!themeMap[t.key]) themeMap[t.key] = { name: t.name, icon: t.icon, exposure: 0, directPct: 0, indirectPct: 0, assets: [] };
      
      const contribution = weight * (t.confidence / 100);
      themeMap[t.key].exposure += contribution;
      
      if (t.isIndirect) themeMap[t.key].indirectPct += contribution;
      else themeMap[t.key].directPct += contribution;

      themeMap[t.key].assets.push({ ticker: p.ticker, weight: Math.round(weight * 100), purity: t.confidence });
    }
  }

  const themes = {};
  for (const [key, data] of Object.entries(themeMap)) {
    themes[key] = {
      ...data,
      exposure: Math.round(data.exposure * 100),
      directPct: Math.round(data.directPct * 100),
      indirectPct: Math.round(data.indirectPct * 100)
    };
  }

  const dominant = Object.entries(themes)
    .sort((a, b) => b[1].exposure - a[1].exposure)
    .slice(0, 8)
    .map(([key, data]) => ({ key, ...data }));

  return { themes, dominant };
}

