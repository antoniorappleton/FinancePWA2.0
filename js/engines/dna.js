// js/engines/dna.js
// ═══════════════════════════════════════════════════════════════════
// PORTFOLIO DNA ENGINE
// Automatic portfolio classification based on factor exposure,
// thematic concentration, and risk profile.
// Examples: "AI Infrastructure Portfolio", "Defensive Income", etc.
// ═══════════════════════════════════════════════════════════════════

import { portfolioFactors } from "./factors.js";
import { thematicExposure } from "./thematic.js";

// ── DNA Templates ──
const DNA_TEMPLATES = [
  {
    id: "ai_infrastructure",
    name: "AI Infrastructure Portfolio",
    emoji: "🤖",
    match: (f, t) => t.themes?.ai_infrastructure?.exposure > 30 && t.themes?.semiconductors?.exposure > 15
  },
  {
    id: "aggressive_growth",
    name: "Aggressive Growth",
    emoji: "🚀",
    match: (f) => f.growth > 70 && f.momentum > 60 && f.defensive < 30
  },
  {
    id: "quality_compounder",
    name: "Quality Compounder",
    emoji: "💎",
    match: (f) => f.quality > 65 && f.growth > 50 && f.defensive < 50
  },
  {
    id: "defensive_income",
    name: "Defensive Income",
    emoji: "🛡️",
    match: (f) => f.defensive > 55 && f.value > 50
  },
  {
    id: "macro_industrial",
    name: "Macro Industrial",
    emoji: "🏗️",
    match: (f) => f.cyclical > 55 && f.value > 40
  },
  {
    id: "future_economy",
    name: "Future Economy Portfolio",
    emoji: "🌐",
    match: (f, t) => {
      const themeCount = Object.values(t.themes || {}).filter(th => th.exposure > 10).length;
      return themeCount >= 3 && f.growth > 50;
    }
  },
  {
    id: "value_hunter",
    name: "Value Hunter",
    emoji: "🎯",
    match: (f) => f.value > 65 && f.growth < 40
  },
  {
    id: "momentum_rider",
    name: "Momentum Rider",
    emoji: "⚡",
    match: (f) => f.momentum > 65 && f.quality < 50
  },
  {
    id: "balanced_core",
    name: "Balanced Core",
    emoji: "⚖️",
    match: (f) => {
      const vals = [f.growth, f.value, f.quality, f.momentum, f.defensive];
      const max = Math.max(...vals), min = Math.min(...vals);
      return (max - min) < 25;
    }
  },
  {
    id: "tech_dominant",
    name: "Tech-Dominant Growth",
    emoji: "💻",
    match: (f, t) => t.themes?.ai_infrastructure?.exposure > 20 || t.themes?.semiconductors?.exposure > 20
  },
  {
    id: "resource_scarcity",
    name: "Resource & Commodities",
    emoji: "💎",
    match: (f, t) => t.themes?.resource_scarcity?.exposure > 25
  }
];

/**
 * Classify portfolio DNA.
 */
export function portfolioDNA(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) {
    return { primary: { id: "empty", name: "Empty Portfolio", emoji: "📭" }, secondary: null, factors: {}, themes: {} };
  }

  const factors = portfolioFactors(portfolio, totalValue);
  const themes = thematicExposure(portfolio, totalValue);

  // Match templates
  const matches = [];
  for (const template of DNA_TEMPLATES) {
    try {
      if (template.match(factors, themes)) {
        matches.push(template);
      }
    } catch { /* skip */ }
  }

  const primary = matches[0] || { id: "custom", name: "Custom Portfolio", emoji: "🧩" };
  const secondary = matches[1] || null;

  return {
    primary: { id: primary.id, name: primary.name, emoji: primary.emoji },
    secondary: secondary ? { id: secondary.id, name: secondary.name, emoji: secondary.emoji } : null,
    factors,
    themes: themes.dominant || []
  };
}
