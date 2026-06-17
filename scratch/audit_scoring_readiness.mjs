const PROJECT_ID = "appfinance-812b2";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const WRITE_FILES = process.argv.includes("--write");
const READINESS_THRESHOLD = Number(process.env.SCORING_V2_THRESHOLD || 0.6);

const EMPTY_STRINGS = new Set(["", "-", "—", "–", "n/a", "na", "#n/a", "nan", "null", "undefined"]);

const FIELD_GROUPS = {
  common: [
    ["ticker"],
    ["nome", "name"],
    ["valorStock", "price"],
    ["setor", "sector", "mercado", "market"],
    ["sources_used", "source_used"],
    ["lastFullSync", "updatedAt", "ultimaAtu"],
  ],
  technical: [
    ["priceChange_1w", "taxaCrescimento_1semana", "g1w"],
    ["priceChange_1m", "taxaCrescimento_1mes", "g1m"],
    ["priceChange_1y", "taxaCrescimento_1ano", "g1y"],
    ["sma50"],
    ["sma200"],
    ["rsi", "rsi_14", "rsi14"],
    ["above_sma50"],
    ["above_sma200"],
    ["golden_cross"],
  ],
  stockValuation: [
    ["pe"],
    ["forward_pe", "forward_p_e"],
    ["peg"],
    ["ev_ebitda", "evEbitda"],
    ["p_fcf", "priceToFCF"],
    ["fcfYield"],
  ],
  stockQuality: [
    ["roic"],
    ["roe"],
    ["roa"],
    ["roi"],
    ["operatingMargin", "oper_margin", "operMargin"],
    ["freeCashflow"],
    ["revenueGrowth", "revenue_growth", "salesGrowth"],
  ],
  stockRisk: [
    ["totalDebt"],
    ["totalCash"],
    ["netDebt"],
    ["netDebtEbitda"],
    ["current_ratio", "currentRatio"],
    ["debt_eq", "debtEquity"],
    ["beta"],
    ["bidAskSpread"],
  ],
  dividend: [
    ["yield"],
    ["dividendo"],
    ["dividendoMedio24m"],
    ["periodicidade"],
    ["payoutRatio"],
  ],
  etf: [
    ["holdings"],
    ["holdings_count", "num_holdings"],
    ["top10Weight"],
    ["ter", "expense_ratio"],
    ["isin"],
    ["marketCap", "fundSize"],
    ["bidAskSpread"],
    ["yield"],
  ],
};

function fromFirestoreValue(v) {
  if (!v || typeof v !== "object") return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return Boolean(v.booleanValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return undefined;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromFirestoreValue(v)]));
}

function isValid(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  const s = String(v).trim().toLowerCase();
  return !EMPTY_STRINGS.has(s);
}

function firstValid(row, aliases) {
  for (const key of aliases) {
    if (isValid(row[key])) return { key, value: row[key] };
  }
  return null;
}

function coverage(row, groups) {
  const total = groups.reduce((sum, group) => sum + FIELD_GROUPS[group].length, 0);
  const present = [];
  const missing = [];

  for (const group of groups) {
    for (const aliases of FIELD_GROUPS[group]) {
      const hit = firstValid(row, aliases);
      if (hit) present.push({ group, field: aliases[0], sourceField: hit.key });
      else missing.push({ group, field: aliases[0], aliases });
    }
  }

  return {
    presentCount: present.length,
    total,
    ratio: total ? present.length / total : 0,
    present,
    missing,
  };
}

function cleanTicker(ticker) {
  const t = String(ticker || "").toUpperCase().trim();
  if (t.includes(":")) {
    const parts = t.split(":").filter(Boolean);
    const currencyCodes = new Set(["EUR", "USD", "GBP", "CHF"]);
    return parts.length >= 3 && currencyCodes.has(parts.at(-1)) ? parts[0] : parts.at(-1);
  }
  return t.split(".")[0];
}

function getAssetType(row) {
  const ticker = cleanTicker(row.ticker || row.id);
  const name = String(row.nome || row.name || "").toLowerCase();
  const sector = String(row.setor || row.sector || row.mercado || row.market || "").toLowerCase();
  const etfTickers = new Set([
    "VWCE", "IWDA", "SWDA", "VUSA", "VOO", "SPY", "VTI", "VT", "VEU", "VXUS", "VHYL", "VWRL",
    "QDVE", "IITU", "SMH", "SOXX", "ROBO", "NUKL", "URNM", "GRID", "VVMX", "WCLD", "ESPO", "QDVF", "QDVK",
  ]);
  const cryptoTickers = new Set(["BTC", "ETH", "SOL", "DOT", "ADA", "XRP", "AVAX", "LINK", "MATIC"]);

  if (cryptoTickers.has(ticker) || sector.includes("crypto") || sector.includes("cripto")) return "crypto";
  if (etfTickers.has(ticker) || name.includes("etf") || name.includes("ucits") || sector.includes("etf")) return "etf";
  return "stock";
}

function scoreDecision(row) {
  const assetType = getAssetType(row);
  const common = coverage(row, ["common"]);
  const technical = coverage(row, ["technical"]);

  if (assetType === "etf") {
    const etf = coverage(row, ["etf"]);
    const all = coverage(row, ["common", "technical", "etf"]);
    const hasPrice = Boolean(firstValid(row, ["valorStock", "price"]));
    const hasIdentity = Boolean(firstValid(row, ["ticker"])) && Boolean(firstValid(row, ["nome", "name", "setor", "sector"]));
    const ready = hasPrice && hasIdentity && all.ratio >= READINESS_THRESHOLD && etf.ratio >= 0.4;
    return {
      assetType,
      scoringMode: ready ? "scoreV2" : "legacy",
      readiness: ready ? "ready" : "partial",
      coveragePct: Math.round(all.ratio * 100),
      groupCoverage: {
        common: Math.round(common.ratio * 100),
        technical: Math.round(technical.ratio * 100),
        etf: Math.round(etf.ratio * 100),
      },
      missingCore: [...etf.missing, ...technical.missing].slice(0, 8).map((m) => m.field),
    };
  }

  if (assetType === "crypto") {
    const all = coverage(row, ["common", "technical"]);
    const ready = Boolean(firstValid(row, ["valorStock", "price"])) && all.ratio >= READINESS_THRESHOLD && technical.ratio >= 0.35;
    return {
      assetType,
      scoringMode: ready ? "scoreV2" : "legacy",
      readiness: ready ? "ready" : "partial",
      coveragePct: Math.round(all.ratio * 100),
      groupCoverage: {
        common: Math.round(common.ratio * 100),
        technical: Math.round(technical.ratio * 100),
      },
      missingCore: technical.missing.slice(0, 8).map((m) => m.field),
    };
  }

  const valuation = coverage(row, ["stockValuation"]);
  const quality = coverage(row, ["stockQuality"]);
  const risk = coverage(row, ["stockRisk"]);
  const dividend = coverage(row, ["dividend"]);
  const all = coverage(row, ["common", "technical", "stockValuation", "stockQuality", "stockRisk", "dividend"]);
  const hasPrice = Boolean(firstValid(row, ["valorStock", "price"]));
  const hasIdentity = Boolean(firstValid(row, ["ticker"])) && Boolean(firstValid(row, ["nome", "name", "setor", "sector"]));
  const ready = hasPrice && hasIdentity && all.ratio >= READINESS_THRESHOLD;

  return {
    assetType,
    scoringMode: ready ? "scoreV2" : "legacy",
    readiness: ready ? "ready" : "partial",
    coveragePct: Math.round(all.ratio * 100),
    groupCoverage: {
      common: Math.round(common.ratio * 100),
      technical: Math.round(technical.ratio * 100),
      valuation: Math.round(valuation.ratio * 100),
      quality: Math.round(quality.ratio * 100),
      risk: Math.round(risk.ratio * 100),
      dividend: Math.round(dividend.ratio * 100),
    },
    missingCore: [...valuation.missing, ...quality.missing, ...risk.missing, ...technical.missing].slice(0, 10).map((m) => m.field),
  };
}

async function fetchCollection(collection) {
  const docs = [];
  let pageToken = "";
  do {
    const url = new URL(`${BASE}/${collection}`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${collection}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    docs.push(...(data.documents || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return docs.map((doc) => ({
    id: String(doc.name || "").split("/").pop(),
    ...decodeFields(doc.fields || {}),
  }));
}

function summarizeRows(rows) {
  const byMode = rows.reduce((acc, row) => {
    const key = `${row.assetType}:${row.scoringMode}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byType = rows.reduce((acc, row) => {
    acc[row.assetType] = (acc[row.assetType] || 0) + 1;
    return acc;
  }, {});

  const avgCoverage = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.coveragePct, 0) / rows.length)
    : 0;

  return { total: rows.length, avgCoverage, byType, byMode };
}

const rows = (await fetchCollection("acoesDividendos"))
  .map((row) => {
    const decision = scoreDecision(row);
    return {
      id: row.id,
      ticker: row.ticker || row.id,
      nome: row.nome || row.name || "",
      setor: row.setor || row.sector || row.mercado || row.market || "",
      ...decision,
    };
  })
  .sort((a, b) => a.assetType.localeCompare(b.assetType) || b.coveragePct - a.coveragePct || String(a.ticker).localeCompare(String(b.ticker)));

const report = {
  generatedAt: new Date().toISOString(),
  threshold: READINESS_THRESHOLD,
  summary: summarizeRows(rows),
  ready: rows.filter((row) => row.scoringMode === "scoreV2"),
  legacy: rows.filter((row) => row.scoringMode === "legacy"),
  rows,
};

if (WRITE_FILES) {
  const fs = await import("node:fs/promises");
  const jsonPath = "scratch/scoring_readiness_report.json";
  const csvPath = "scratch/scoring_readiness_report.csv";
  const csvHeader = [
    "ticker",
    "id",
    "assetType",
    "scoringMode",
    "coveragePct",
    "commonPct",
    "technicalPct",
    "valuationPct",
    "qualityPct",
    "riskPct",
    "dividendPct",
    "etfPct",
    "missingCore",
  ];
  const csvRows = rows.map((row) => [
    row.ticker,
    row.id,
    row.assetType,
    row.scoringMode,
    row.coveragePct,
    row.groupCoverage.common ?? "",
    row.groupCoverage.technical ?? "",
    row.groupCoverage.valuation ?? "",
    row.groupCoverage.quality ?? "",
    row.groupCoverage.risk ?? "",
    row.groupCoverage.dividend ?? "",
    row.groupCoverage.etf ?? "",
    row.missingCore.join("|"),
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(csvPath, `${csvHeader.join(",")}\n${csvRows.join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ ...report.summary, jsonPath, csvPath }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
