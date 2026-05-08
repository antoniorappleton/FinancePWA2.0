// js/utils/num.js

/**
 * Convert a value to a strict number.
 * Mirrors the implementation previously used in atividade.js.
 * Returns 0 for falsy or non‑numeric inputs.
 */
export function toNumStrict(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  // Remove whitespace and replace comma decimal separator with dot
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/**
 * Generic numeric conversion used elsewhere (non‑strict).
 * This function already exists in utils/scoring.js but we expose it here for consistency.
 */
export function toNum(v) {
  if (typeof v === "number") return v;
  if (v === undefined || v === null || v === "") return NaN;
  let s = String(v).trim();
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}
