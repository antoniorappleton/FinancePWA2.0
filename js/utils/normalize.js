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
 * Data confidence score (0–1) for an asset.
 * Measures how many critical fields are present and valid.
 */
export function confidenceScore(asset) {
  const CRITICAL = [
    "valorStock", "price",           // price
    "pe",                             // valuation
    "roic", "roe",                    // efficiency
    "debt_eq", "current_ratio",       // solvency
    "sma50", "sma200", "rsi_14",      // technical
    "epsYoY", "epsNextY",             // growth
    "yield",                          // dividends
    "setor", "sector",                // classification
    "beta"                            // risk
  ];

  const NICE = [
    "peg", "p_fcf", "p_s", "p_b", "ev_ebitda", "forward_pe",
    "gross_margin", "oper_margin", "profit_margin",
    "roa", "quick_ratio",
    "priceChange_1w", "priceChange_1m", "priceChange_1y",
    "eps_next_5y", "sales_y_y_ttm"
  ];

  let criticalPresent = 0;
  let nicePresent = 0;

  for (const k of CRITICAL) {
    const v = asset[k];
    if (v !== undefined && v !== null && v !== "" && !NA_STRINGS.has(String(v).trim())) {
      criticalPresent++;
    }
  }

  for (const k of NICE) {
    const v = asset[k];
    if (v !== undefined && v !== null && v !== "" && !NA_STRINGS.has(String(v).trim())) {
      nicePresent++;
    }
  }

  // Critical fields worth 70%, nice-to-have worth 30%
  const critScore = CRITICAL.length > 0 ? criticalPresent / CRITICAL.length : 0;
  const niceScore = NICE.length > 0 ? nicePresent / NICE.length : 0;

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
  return !NA_STRINGS.has(String(v).trim());
}
