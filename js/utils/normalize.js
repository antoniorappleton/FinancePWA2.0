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
 * Ticker Normalization / Deduplication
 * Resolves aliases and exchanges to a canonical ID.
 * Examples: "VWCE.DE" -> "VWCE", "QDVF.DE" -> "QDVE", "VOO.US" -> "VOO"
 */
export function canonicalTicker(ticker) {
  if (!ticker) return "";
  let t = String(ticker).toUpperCase().trim();
  
  // Remove exchange suffixes: .DE, .AS, .LS, .US, :EUR, :USD
  t = t.split(".")[0].split(":")[0];

  // Alias Mapping (Deduplication)
  const ALIASES = {
    "QDVF": "QDVE", // iShares S&P 500 Info Tech (different listings)
    "QDVK": "QDVE",
    "IS0D": "IS3N", // Emerging Markets variations
    "IWVL": "IWVL", // World Value
    "VUSA": "VOO",  // S&P 500
    "VUSA:LS": "VOO"
  };

  return ALIASES[t] || t;
}

// ── Contextual Concentration Limits ──
export const HEALTHY_LIMITS = {
  "Broad Market ETF": 0.70, // 70% max for a core anchor
  "Sector ETF":       0.25, // 25% max
  "Thematic ETF":     0.15, // 15% max
  "Single Stock":     0.10, // 10% max
  "Speculative Asset": 0.05, // 5% max
  "Satellite Asset":  0.08,
  "Crypto":           0.05,
  "Commodity":        0.12  // 12% max for physical assets/ETC
};

/**
 * Asset Classification Layer
 * Categorizes assets into: Broad Market ETF, Sector ETF, Thematic ETF, Single Stock, Speculative, Satellite.
 */
export function getAssetCategory(asset) {
  const ticker = canonicalTicker(asset.ticker);
  const name = String(asset.nome || asset.name || "").toLowerCase();
  const sector = String(asset.setor || asset.sector || "").toLowerCase();
  
  // ── 0. Commodities & Physical Assets (ETCs / Physical Metals) ──
  const commTickers = new Set(["VZLC", "PHAG", "PHAU", "SGLN", "IGLN", "SSLV", "GLD", "SLV", "IAU", "PPLT", "PALL"]);
  if (commTickers.has(ticker) || sector.includes("commodit") || name.includes("physical") || name.includes("silver") || name.includes("gold") || name.includes("copper") || name.includes("platinum")) {
    return "Commodity";
  }

  // ── 1. Broad Market ETFs (Diversified Core) ──
  const broadTickers = new Set(["VWCE", "VOO", "SPY", "IWDA", "VTI", "VT", "VEU", "VXUS", "VHYL", "VWRL", "IWVL", "SWDA"]);
  if (broadTickers.has(ticker)) return "Broad Market ETF";
  
  if (name.includes("world") || name.includes("s&p 500") || name.includes("all-world") || name.includes("acwi")) {
    if (sector.includes("etf") || sector.includes("múltiplos") || name.includes("core")) return "Broad Market ETF";
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

