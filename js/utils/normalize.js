// js/utils/normalize.js
// ═══════════════════════════════════════════════════════════════════
// DATA NORMALIZATION ENGINE
// Handles dirty data from scrapers: "#N/A", "24.42bn USD", mixed %, etc.
// Every engine imports from here — this is the single source of truth.
// ═══════════════════════════════════════════════════════════════════

const NA_STRINGS = new Set([
  "#N/A", "N/A", "n/a", "-", "—", "–", "", "null", "undefined",
  "#VALUE!", "#REF!", "#DIV/0!", "NaN", "nan"
]);

const MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/**
 * Parse any financial number: "24.42bn USD" → 24420000000
 * Handles: commas, dots, magnitude suffixes, currency symbols, parentheses (negative).
 */
export function parseFinancialNumber(raw) {
  if (raw === undefined || raw === null) return NaN;
  if (typeof raw === "number") return isFinite(raw) ? raw : NaN;

  let s = String(raw).trim();
  if (NA_STRINGS.has(s)) return NaN;

  // Remove currency symbols and whitespace
  s = s.replace(/[€$£¥₹\s]/g, "");

  // Parentheses = negative: (1,234.56) → -1234.56
  const isNeg = s.startsWith("(") && s.endsWith(")");
  if (isNeg) s = s.slice(1, -1);

  // Detect magnitude suffix: 24.42B, 1.5M, 300K, 2.1T
  let multiplier = 1;
  const suffixMatch = s.match(/([kmbt])(?:\s|$)/i);
  if (suffixMatch) {
    multiplier = MULTIPLIERS[suffixMatch[1]] || 1;
    s = s.replace(/[kmbt].*$/i, "");
  }
  // Also handle "billion", "million", etc.
  if (/billion/i.test(s)) { multiplier = 1e9; s = s.replace(/billion/i, ""); }
  if (/million/i.test(s)) { multiplier = 1e6; s = s.replace(/million/i, ""); }
  if (/trillion/i.test(s)) { multiplier = 1e12; s = s.replace(/trillion/i, ""); }

  // Normalize decimal separators
  // "1.234,56" → PT format → 1234.56
  // "1,234.56" → EN format → 1234.56
  if (s.includes(",") && s.includes(".")) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      // PT format: 1.234,56
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // EN format: 1,234.56
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    // Single comma — could be decimal or thousands
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      s = s.replace(",", "."); // Decimal: "3,50"
    } else {
      s = s.replace(/,/g, ""); // Thousands: "1,234"
    }
  }

  // Remove trailing % — caller should use parsePercentage for that
  s = s.replace(/%$/, "");

  const n = parseFloat(s);
  if (!isFinite(n)) return NaN;
  return (isNeg ? -n : n) * multiplier;
}

/**
 * Parse a percentage value, always returning a decimal fraction.
 * "5.4%" → 0.054, "0.054" → 0.054, 5.4 → 0.054 (heuristic)
 */
export function parsePercentage(raw) {
  if (raw === undefined || raw === null) return NaN;
  if (typeof raw === "number") {
    // Heuristic: |v| > 1 probably means it's already a percentage (5.4 → 0.054)
    return Math.abs(raw) > 1 ? raw / 100 : raw;
  }
  const s = String(raw).trim();
  if (NA_STRINGS.has(s)) return NaN;

  const hasPercent = s.includes("%");
  const n = parseFinancialNumber(s.replace(/%/g, ""));
  if (!isFinite(n)) return NaN;

  // If it had a % sign, divide by 100
  if (hasPercent) return n / 100;
  // If |n| > 1, assume percentage
  return Math.abs(n) > 1 ? n / 100 : n;
}

/**
 * Safe metric extraction with fallback chain.
 * safeMetric(asset, "roic", "return_on_capital", "ROIC") → first valid number
 */
export function safeMetric(asset, ...keys) {
  for (const k of keys) {
    const raw = asset[k];
    const n = parseFinancialNumber(raw);
    if (isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Same as safeMetric but treats percentage fields.
 */
export function safePercent(asset, ...keys) {
  for (const k of keys) {
    const raw = asset[k];
    const n = parsePercentage(raw);
    if (isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Normalize unicode whitespace and zero-width chars in a string.
 * Used by normalizeSector and anywhere sector/market strings need clean comparison.
 */
export function canon(s) {
  return String(s ?? "")
    .replace(/ /g, " ")
    .replace(/[​-‍]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Canonical EN→PT sector translation table (D8.2) ──
// Single source of truth used by quality, valuation, risk, stress-test, correlation.
const EN_TO_PT_SECTOR = {
  "Technology":             "Tecnologia",
  "Information Technology": "Tecnologia",
  "Healthcare":             "Saúde",
  "Health Care":            "Saúde",
  "Financials":             "Financeiros",
  "Financial Services":     "Financeiros",
  "Energy":                 "Energia",
  "Consumer Cyclical":      "Consumo Cíclico",
  "Consumer Discretionary": "Consumo Cíclico",
  "Consumer Defensive":     "Consumo Defensivo",
  "Consumer Staples":       "Consumo Defensivo",
  "Industrials":            "Industriais",
  "Materials":              "Materiais",
  "Basic Materials":        "Materiais",
  "Real Estate":            "Imobiliário",
  "Communication Services": "Comunicações",
  "Telecom":                "Comunicações",
  "Utilities":              "Utilidades",
  "Commodities":            "Commodities",
};

// ── Raw `setor` values as actually stored in acoesDividendos (D9 audit) ──
// The Firestore data uses many labels that are NOT canonical PT sector names
// ("Finanças" ≠ "Financeiros", "Indústria" ≠ "Industriais", "ETF Energia", "ETF
// Mundial", etc). Before this table, any unmapped value fell through this
// function UNCHANGED (`|| s`) and therefore never matched a key in
// SECTOR_CORR/SECTOR_PE/sectorDrops/SECTOR_PROFILES — every engine silently used
// its generic fallback for these assets instead of the sector-tailored one. This
// affected a large fraction of the universe (10 "Finanças", 7 "Criptomoedas", 7
// "ETF Energia", 6 "ETF iTech", and the sole broad-market label "ETF Mundial" —
// which is usually the single largest position, e.g. VWCE — among others).
// "ETF <Região/Multi>" labels (Mundial, Mercado Europeu/Asiatico, Países
// Emergentes, Multiplo(s)) mark genuinely diversified index funds — mapped to
// "Múltiplos Setores", not to any single sector.
const PT_RAW_SECTOR_ALIASES = {
  "Finanças":                    "Financeiros",
  "ETF Finanças":                "Financeiros",
  "ETF Finance":                 "Financeiros",
  "Indústria":                   "Industriais",
  "Defesa":                      "Industriais", // GICS: Aerospace & Defense é sub-indústria de Industrials
  "Automóvel":                   "Consumo Cíclico", // GICS: Automobiles é sub-indústria de Consumer Discretionary
  "Bens Consumidor":             "Consumo Defensivo",
  "Alimentação":                 "Consumo Defensivo",
  "Telecomunicações":            "Comunicações",
  "ETF Setor Comunicações":      "Comunicações",
  "ETF Energia":                 "Energia",
  "Infraestruturas / Energia":   "Energia",
  "ETF Tecnologia":              "Tecnologia",
  "ETF iTech":                   "Tecnologia",
  "ETF Blockchain Innovators":   "Tecnologia",
  "ETF Materiais":               "Materiais",
  "Mineração (Ouro)":            "Materiais", // mineradoras/ETF de mineradoras ≠ ouro físico (ver getPreciousMetalKind)
  "ETF Mineração (Ouro)":        "Materiais",
  "ETF Saúde":                   "Saúde",
  "ETF Consumo Defensivo":       "Consumo Defensivo",
  "ETF Consumo Ciclico":         "Consumo Cíclico",
  "Ouro":                        "Commodities", // fallback p/ engines sem tratamento especial de bullion físico
  "ETF Mundial":                 "Múltiplos Setores",
  "ETF Multiplo":                "Múltiplos Setores",
  "ETF Multiplos setores":       "Múltiplos Setores",
  "ETF Mercado Europeu":         "Múltiplos Setores",
  "ETF Mercado Asiatico":        "Múltiplos Setores",
  "ETF Países Emergentes":       "Múltiplos Setores",
  // "Criptomoedas" fica deliberadamente por mapear — não existe sector-drop
  // equity-like defensável para cripto; degrada para "Outros"/defaultDrop.
};

const CANONICAL_PT_SECTORS = new Set([
  "Tecnologia", "Saúde", "Financeiros", "Energia", "Consumo Cíclico", "Consumo Defensivo",
  "Industriais", "Materiais", "Imobiliário", "Comunicações", "Utilidades", "Commodities", "Múltiplos Setores"
]);

/** Translate a raw EN or PT sector string to the canonical PT name. */
export function toCanonicalSector(raw) {
  const s = String(raw || "").trim();
  if (CANONICAL_PT_SECTORS.has(s)) return s;
  return EN_TO_PT_SECTOR[s] || PT_RAW_SECTOR_ALIASES[s] || "Outros";
}

/**
 * Extract and normalize the sector string from an asset object.
 * Reads setor/sector/industry/segmento fields, applies canon(), then EN→PT.
 */
export function normalizeSector(d) {
  const sRaw = d.setor || d.sector || d.Setor || d.Sector ||
               d.industry || d.Industry || d.indústria || d.Indústria ||
               d.segmento || d.segment || "";
  let s = canon(sRaw);
  if ((!s || s === "—") && String(d.ticker).includes(":")) {
    const p = String(d.ticker).split(":")[0].trim();
    if (p.length > 2) s = canon(p);
  }
  return toCanonicalSector(s) || "—";
}

/**
 * Ticker Normalization / Deduplication
 * Resolves aliases and exchanges to a canonical ID.
 * Examples: "VWCE.DE" -> "VWCE", "VOO.US" -> "VOO", "XETR:DAVV" -> "DAVV"
 * Note: QDVF (Energy) and QDVE (IT) are distinct assets — not aliased.
 */
export function canonicalTicker(ticker) {
  if (!ticker) return "";
  let t = String(ticker).toUpperCase().trim();

  // Normalize exchange/currency notations:
  // "XETR:DAVV" -> "DAVV"; "DAVV:FRA:EUR" -> "DAVV"; "VWCE.DE" -> "VWCE".
  if (t.includes(":")) {
    const parts = t.split(":").filter(Boolean);
    const currencyCodes = new Set(["EUR", "USD", "GBP", "CHF"]);
    t = parts.length >= 3 && currencyCodes.has(parts.at(-1)) ? parts[0] : parts.at(-1);
  }
  t = t.split(".")[0];

  // Alias Mapping (Deduplication)
  const ALIASES = {
    "IWVL": "IWVL", // World Value
    "VUSA": "VOO",  // S&P 500
    "VUSA:LS": "VOO",
    "DAPP": "DAVV",
    "DAGB": "DAVV"
  };

  return ALIASES[t] || t;
}

// ── Canonical Asset Registry (D7.4) ──
// Source of truth for known tickers. getAssetCategory and getAssetType check this first.
// Heuristics (name patterns) only apply to unknown tickers.
// Note: QDVF (Energy) and QDVE (IT) are distinct — never aliased (D6).
export const ASSET_REGISTRY = {
  // Broad Market ETFs
  "VWCE": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "IWDA": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "SWDA": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "VOO":  { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "SPY":  { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "VTI":  { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "VT":   { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "VEU":  { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "VXUS": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "VHYL": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "VWRL": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "IWVL": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "CSPX": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "VUSA": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "EUNL": { type: "etf", category: "Broad Market ETF", sector: "Europa" },
  "VGWL": { type: "etf", category: "Broad Market ETF", sector: "Múltiplos" },
  "IS3N": { type: "etf", category: "Broad Market ETF", sector: "Mercados Emergentes" }, // iShares Core MSCI EM IMI
  // S&P 500 Sector ETFs — Sector, NOT Broad, despite "S&P 500" in name
  "QDVE": { type: "etf", category: "Sector ETF", sector: "Tecnologia" },       // S&P 500 Information Technology
  "QDVF": { type: "etf", category: "Sector ETF", sector: "Energia" },          // S&P 500 Energy
  "QDVG": { type: "etf", category: "Sector ETF", sector: "Saúde" },            // S&P 500 Health Care
  "QDVK": { type: "etf", category: "Sector ETF", sector: "Utilidades" },       // S&P 500 Utilities
  // Thematic ETFs
  "IITU": { type: "etf", category: "Thematic ETF", sector: "Tecnologia" },
  "SMH":  { type: "etf", category: "Thematic ETF", sector: "Semicondutores" },
  "SOXX": { type: "etf", category: "Thematic ETF", sector: "Semicondutores" },
  "ROBO": { type: "etf", category: "Thematic ETF", sector: "Robótica" },
  "NUKL": { type: "etf", category: "Thematic ETF", sector: "Nuclear" },
  "URNM": { type: "etf", category: "Thematic ETF", sector: "Urânio" },
  "GRID": { type: "etf", category: "Thematic ETF", sector: "Energia Limpa" },
  "VVMX": { type: "etf", category: "Thematic ETF", sector: "Tecnologia" },
  "WCLD": { type: "etf", category: "Thematic ETF", sector: "Cloud" },
  "ESPO": { type: "etf", category: "Thematic ETF", sector: "Gaming" },
  "JEDI": { type: "etf", category: "Thematic ETF", sector: "Aeroespacial" }, // VanEck Space Innovators UCITS ETF
};

// ── Beta Validation (D7.2) ──
// Returns beta if valid (within [0.1, 3.0]), else null.
// Prevents beta=1.0 sentinel from fabricating false stability signals.
export function validBeta(asset) {
  const raw = safeMetric(asset, "beta");
  if (raw === null || raw === undefined || isNaN(raw)) return null;
  return (raw >= 0.1 && raw <= 3.0) ? raw : null;
}

// ── Contextual Concentration Limits ──
// Single source of truth — importado por risk.js, rebalance.js, portfolio-intel.js.
export const HEALTHY_LIMITS = {
  "Broad Market ETF":  0.70,
  "Sector ETF":        0.25,
  "Thematic ETF":      0.15,
  "Single Stock":      0.10, // override via config/strategy.singleStockCapPct
  "Speculative Asset": 0.05,
  "Satellite Asset":   0.08,
  "Commodity":         0.12
};

/**
 * Returns HEALTHY_LIMITS com override de singleStockCapPct vindo da estratégia.
 * @param {Object} [strategy={}] - config/strategy do Firestore
 */
export function getConcentrationLimits(strategy = {}) {
  const cap = Number(strategy.singleStockCapPct || 10) / 100;
  return { ...HEALTHY_LIMITS, "Single Stock": cap };
}

/**
 * Asset Classification Layer
 * Categorizes assets into: Broad Market ETF, Sector ETF, Thematic ETF, Single Stock, Speculative, Satellite.
 */
export function getAssetCategory(asset) {
  const ticker = canonicalTicker(asset.ticker);
  const name = String(asset.nome || asset.name || "").toLowerCase();
  const sector = String(asset.setor || asset.sector || "").toLowerCase();

  // ── Registry takes precedence (D7.4) — avoids heuristic misclassification ──
  if (ASSET_REGISTRY[ticker]) return ASSET_REGISTRY[ticker].category;

  // ── 0. Commodities & Physical Assets (ETCs / Physical Metals) ──
  const commTickers = new Set(["GZUR", "VZLC", "PHAG", "PHAU", "SGLN", "IGLN", "SSLV", "GLD", "SLV", "IAU", "PPLT", "PALL"]);
  if (commTickers.has(ticker) || sector.includes("commodit") || name.includes("physical") || name.includes("silver") || name.includes("gold") || name.includes("copper") || name.includes("platinum")) {
    return "Commodity";
  }

  // ── 1. Broad Market ETFs ──
  // "S&P 500" in name only promotes to Broad if name has no sector qualifier
  // (prevents QDVF/QDVG-style misclassification for unknown tickers)
  const SECTOR_QUALIFIERS = ["energy", "health", "financ", "tech", "utilit", "consumer", "industri", "material", "real estate", "communic"];
  const nameHasSectorWord = SECTOR_QUALIFIERS.some(w => name.includes(w));
  if ((name.includes("world") || name.includes("all-world") || name.includes("acwi") ||
       name.includes("msci em") || name.includes("em imi") || name.includes("emerging market") ||
       (name.includes("s&p 500") && !nameHasSectorWord)) &&
      (sector.includes("etf") || sector.includes("múltiplos") || name.includes("core") || name.includes("ucits"))) {
    return "Broad Market ETF";
  }

  // ── 2. Specialized ETFs ──
  const thematicTickers = new Set(["QDVE", "IITU", "SMH", "SOXX", "ROBO", "NUKL", "URNM", "GRID", "VVMX", "WCLD", "ESPO", "QDVF", "QDVK"]);
  if (thematicTickers.has(ticker) || sector.includes("etf") || name.includes("etf")) {
    const thematicKeywords = ["ai", "robotics", "automation", "cyber", "clean energy", "semiconductor", "cloud", "blockchain", "space", "quantum", "defense", "lithium", "battery", "water", "aging", "tech", "digital", "grid"];
    const cryptoKeywords = ["crypto", "bitcoin", "ethereum", "blockchain"];
    
    if (cryptoKeywords.some(k => name.includes(k))) return "Speculative Asset";
    if (thematicKeywords.some(k => name.includes(k) || ticker.toLowerCase().includes(k))) return "Thematic ETF";
    
    // Check if it's a specific sector (Tech, Finance, etc)
    if (sector.includes("tech") || sector.includes("finan") || sector.includes("ener") || sector.includes("health") || sector.includes("utilit")) {
      return "Sector ETF";
    }
    
    return "Sector ETF"; // Default for other ETFs
  }

  // ── 3. Speculative / Crypto ──
  if (sector.includes("cripto") || sector.includes("crypto") || ticker === "BTC" || ticker === "ETH" || ticker === "SOL") return "Speculative Asset";
  
  // ── 4. Single Stocks ──
  if (sector && !sector.includes("etf")) return "Single Stock";

  return "Satellite Asset";
}

/**
 * Data confidence score (0–1) for an asset.
 * Measures how many critical fields are present and valid.
 */
export function confidenceScore(asset) {
  const category = getAssetCategory(asset);
  
  let CRITICAL = [
    "valorStock", "price",           // price
    "setor", "sector",                // classification
    "beta"                            // risk
  ];

  if (category === "Single Stock") {
    CRITICAL.push("pe", "roic", "roe", "debt_eq", "epsYoY", "yield");
  } else if (category.includes("ETF")) {
    CRITICAL.push("ter", "holdings_count");
  }

  const NICE = [
    "peg", "p_fcf", "p_s", "p_b", "ev_ebitda", "forward_pe",
    "gross_margin", "oper_margin", "profit_margin",
    "roa", "quick_ratio", "current_ratio",
    "sma50", "sma200", "rsi_14",
    "priceChange_1w", "priceChange_1m", "priceChange_1y"
  ];

  let criticalPresent = 0;
  let nicePresent = 0;

  for (const k of CRITICAL) {
    if (isValid(asset[k])) criticalPresent++;
  }

  for (const k of NICE) {
    if (isValid(asset[k])) nicePresent++;
  }

  const critScore = CRITICAL.length > 0 ? criticalPresent / CRITICAL.length : 0;
  const niceScore = NICE.length > 0 ? nicePresent / NICE.length : 0;

  // Impact: Critical fields represent 70% of the confidence
  return Math.min(1, critScore * 0.7 + niceScore * 0.3);
}

/**
 * Clamp a value to [min, max].
 */
export function clamp(v, min, max) {
  const val = Number(v) || 0;
  return Math.max(min, Math.min(max, val));
}

/**
 * Check if a value is valid (not NaN, not null, not N/A string).
 */
export function isValid(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "number") return isFinite(v);
  const s = String(v).trim();
  if (s === "" || NA_STRINGS.has(s)) return false;
  return true;
}
