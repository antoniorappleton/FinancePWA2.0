import { getAssetCategory } from "../utils/normalize.js";

/**
 * ECONOMIC DRIVER ENGINE
 * Maps traditional sectors to structural future economy drivers.
 */

const DRIVERS = {
  ai_compute: {
    name: "AI & Computing Power",
    icon: "🧠",
    sectors: ["Tecnologia"],
    keywords: ["ai", "gpu", "semiconductor", "cloud", "data center"]
  },
  electrification: {
    name: "Electrification & Net Zero",
    icon: "🔋",
    sectors: ["Energia", "Industriais", "Materiais"],
    keywords: ["ev", "battery", "solar", "wind", "grid", "copper", "lithium"]
  },
  global_finance: {
    name: "Global Financial Systems",
    icon: "💳",
    sectors: ["Financeiros"],
    keywords: ["payment", "bank", "credit", "fintech"]
  },
  industrial_automation: {
    name: "Industrial Automation",
    icon: "🦾",
    sectors: ["Industriais", "Tecnologia"],
    keywords: ["robot", "automation", "manufacturing"]
  },
  healthcare_innovation: {
    name: "Healthcare Innovation",
    icon: "🧬",
    sectors: ["Saúde"],
    keywords: ["biotech", "genomic", "pharmaceutical"]
  },
  resilience_scarcity: {
    name: "Resource Scarcity",
    icon: "🌍",
    sectors: ["Materiais", "Energia"],
    keywords: ["mining", "oil", "gas", "rare earth"]
  }
};

export function calculateEconomicDrivers(portfolio, totalValue) {
  if (!portfolio || portfolio.length === 0) return null;

  const total = Math.max(totalValue, 1);
  const driverMap = {};

  for (const p of portfolio) {
    const weight = (p.valAtual || 0) / total;
    const m = p.mkt || p;
    const sector = String(m.setor || m.sector || "");
    const name = String(m.nome || m.name || "").toLowerCase();
    
    let matched = false;
    for (const [key, d] of Object.entries(DRIVERS)) {
      const sectorMatch = d.sectors.includes(sector);
      const keywordMatch = d.keywords.some(k => name.includes(k));

      if (sectorMatch || keywordMatch) {
        if (!driverMap[key]) driverMap[key] = { name: d.name, icon: d.icon, exposure: 0 };
        driverMap[key].exposure += weight;
        matched = true;
      }
    }

    if (!matched) {
      if (!driverMap.others) driverMap.others = { name: "Other Drivers", icon: "🌐", exposure: 0 };
      driverMap.others.exposure += weight;
    }
  }

  return Object.values(driverMap)
    .map(d => ({ ...d, exposure: Math.round(d.exposure * 100) }))
    .sort((a, b) => b.exposure - a.exposure);
}
