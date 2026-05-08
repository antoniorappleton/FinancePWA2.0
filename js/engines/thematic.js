// js/engines/thematic.js
// ═══════════════════════════════════════════════════════════════════
// THEMATIC EXPOSURE ENGINE
// Detects portfolio exposure to megatrends:
// AI Infrastructure, Electrification, Semiconductors, Defense Tech, etc.
// ═══════════════════════════════════════════════════════════════════

// ── Thematic classification rules ──
const THEMES = {
  ai_infrastructure: {
    name: "AI Infrastructure",
    icon: "🤖",
    tickers: new Set(["NVDA", "AMD", "AVGO", "MRVL", "INTC", "MSFT", "GOOGL", "GOOG", "META", "AMZN", "CRM", "PLTR", "SNOW", "ORCL", "IBM"]),
    keywords: ["artificial intelligence", "ai ", "machine learning", "neural", "gpu", "data center"]
  },
  semiconductors: {
    name: "Semicondutores",
    icon: "💾",
    tickers: new Set(["NVDA", "AMD", "INTC", "AVGO", "QCOM", "TSM", "ASML", "MRVL", "TXN", "KLAC", "LRCX", "AMAT", "MU", "ON"]),
    keywords: ["semiconductor", "chip", "semicondutor"]
  },
  electrification: {
    name: "Eletrificação & Clean Energy",
    icon: "⚡",
    tickers: new Set(["TSLA", "ENPH", "SEDG", "FSLR", "NEE", "BEP", "PLUG", "RUN", "RIVN", "LCID", "NIO"]),
    keywords: ["solar", "wind", "battery", "electric vehicle", "ev ", "renewable", "clean energy", "hydrogen"]
  },
  defense_tech: {
    name: "Defesa & Segurança",
    icon: "🛡️",
    tickers: new Set(["LMT", "RTX", "NOC", "GD", "BA", "LHX", "PLTR", "BAH"]),
    keywords: ["defense", "military", "aerospace", "defesa", "segurança"]
  },
  digital_payments: {
    name: "Pagamentos Digitais",
    icon: "💳",
    tickers: new Set(["V", "MA", "PYPL", "SQ", "ADYEN", "NU", "COIN", "AFRM", "SOFI"]),
    keywords: ["payment", "fintech", "pagamento", "digital bank"]
  },
  biotech: {
    name: "Biotecnologia",
    icon: "🧬",
    tickers: new Set(["MRNA", "BNTX", "REGN", "VRTX", "GILD", "BIIB", "AMGN", "ILMN", "CRSP", "NTLA", "BEAM"]),
    keywords: ["biotech", "genomic", "gene therapy", "crispr", "mrna"]
  },
  robotics: {
    name: "Robótica & Automação",
    icon: "🦾",
    tickers: new Set(["ISRG", "ROK", "ABB", "FANUY", "TER", "IRBT", "NVDA", "KUKA"]),
    keywords: ["robot", "automation", "autonomous", "automação"]
  },
  space: {
    name: "Economia Espacial",
    icon: "🚀",
    tickers: new Set(["RKLB", "BA", "LMT", "RTX", "ASTS", "SPCE", "LUNR"]),
    keywords: ["space", "satellite", "launch", "orbital"]
  },
  quantum: {
    name: "Computação Quântica",
    icon: "⚛️",
    tickers: new Set(["GOOGL", "GOOG", "IBM", "IONQ", "RGTI", "QBTS", "MSFT"]),
    keywords: ["quantum", "qubit"]
  },
  cybersecurity: {
    name: "Cibersegurança",
    icon: "🔐",
    tickers: new Set(["CRWD", "PANW", "FTNT", "ZS", "S", "NET", "OKTA", "CYBR"]),
    keywords: ["cybersecurity", "security", "firewall", "threat"]
  }
};

/**
 * Classify a single asset's thematic exposure.
 * @param {Object} asset - { ticker, nome, ... }
 * @returns {Array} Array of { theme, confidence }
 */
export function classifyAssetThemes(asset) {
  const ticker = String(asset.ticker || "").toUpperCase();
  const nome = String(asset.nome || "").toLowerCase();
  const sector = String(asset.setor || asset.sector || "").toLowerCase();
  const combined = `${nome} ${sector}`;
  
  const themes = [];

  for (const [key, theme] of Object.entries(THEMES)) {
    let confidence = 0;

    // Direct ticker match = high confidence
    if (theme.tickers.has(ticker)) {
      confidence = 0.85;
    }

    // Keyword match in name/sector
    for (const kw of theme.keywords) {
      if (combined.includes(kw)) {
        confidence = Math.max(confidence, 0.6);
        break;
      }
    }

    if (confidence > 0) {
      themes.push({ key, name: theme.name, icon: theme.icon, confidence: Math.round(confidence * 100) });
    }
  }

  return themes.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Calculate portfolio-level thematic exposure.
 * @param {Array} portfolio - Array of { ticker, valAtual, mkt, ... }
 * @param {number} totalValue
 * @returns {{ themes: Object, dominant: Array, warnings: Array }}
 */
export function thematicExposure(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) {
    return { themes: {}, dominant: [], warnings: [] };
  }

  const total = Math.max(totalValue, 1);
  const themeMap = {};
  const warnings = [];

  for (const p of portfolio) {
    const weight = (p.valAtual || 0) / total;
    const assetThemes = classifyAssetThemes({ ...p, ...(p.mkt || {}) });

    for (const t of assetThemes) {
      if (!themeMap[t.key]) {
        themeMap[t.key] = { name: t.name, icon: t.icon, exposure: 0, assetCount: 0, assets: [] };
      }
      themeMap[t.key].exposure += weight * (t.confidence / 100);
      themeMap[t.key].assetCount++;
      themeMap[t.key].assets.push({ ticker: String(p.ticker || "").toUpperCase(), weight: Math.round(weight * 100) });
    }
  }

  // Convert to percentages and sort
  const themes = {};
  for (const [key, data] of Object.entries(themeMap)) {
    themes[key] = {
      ...data,
      exposure: Math.round(data.exposure * 100)
    };
  }

  const sorted = Object.entries(themes).sort((a, b) => b[1].exposure - a[1].exposure);
  const dominant = sorted.slice(0, 5).map(([key, data]) => ({ key, ...data }));

  // Warnings
  for (const [key, data] of sorted) {
    if (data.exposure > 40) {
      warnings.push(`Exposição temática elevada a ${data.name}: ${data.exposure}% — concentração de risco temático`);
    }
  }

  return { themes, dominant, warnings };
}
