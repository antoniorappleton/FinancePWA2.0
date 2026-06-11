const PROJECT_ID = "appfinance-812b2";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const CANON_ALIASES = {
  VUSA: "VOO",
  DAPP: "DAVV",
  DAGB: "DAVV",
};

const IMPORTANT_FIELDS = [
  "ticker", "nome", "valorStock", "setor", "mercado", "beta",
  "pe", "forward_p_e", "peg", "roic", "roe", "current_ratio", "debt_eq",
  "sma50", "sma200", "rsi_14", "priceChange_1w", "priceChange_1m", "priceChange_1y",
  "yield", "dividendo", "dividendoMedio24m", "periodicidade", "mes",
  "ter", "holdings_count", "isin",
];

const EMPTY_STRINGS = new Set(["", "-", "—", "n/a", "na", "#n/a", "nan", "null", "undefined"]);

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
  const s = String(v).trim().toLowerCase();
  return !EMPTY_STRINGS.has(s);
}

function cleanTicker(ticker) {
  const t = String(ticker || "").toUpperCase().trim();
  if (t.includes(":")) {
    const parts = t.split(":").filter(Boolean);
    const currencyCodes = new Set(["EUR", "USD", "GBP", "CHF"]);
    if (parts.length >= 3 && currencyCodes.has(parts.at(-1))) return parts[0];
    return parts.at(-1);
  }
  return t;
}

function canonicalTicker(ticker) {
  let t = cleanTicker(ticker);
  t = t.split(".")[0];
  return CANON_ALIASES[t] || t;
}

function docId(name) {
  return String(name || "").split("/").pop();
}

function confidence(row) {
  const present = IMPORTANT_FIELDS.filter((field) => isValid(row[field]));
  return present.length / IMPORTANT_FIELDS.length;
}

function completeness(row) {
  return IMPORTANT_FIELDS.reduce((sum, field) => sum + (isValid(row[field]) ? 1 : 0), 0);
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
    id: docId(doc.name),
    path: doc.name,
    ...decodeFields(doc.fields || {}),
  }));
}

function bestDoc(group) {
  return [...group].sort((a, b) => {
    const score = completeness(b) - completeness(a);
    if (score) return score;
    return String(a.ticker).length - String(b.ticker).length;
  })[0];
}

function summarizeDoc(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    nome: row.nome || row.name || "",
    setor: row.setor || row.sector || "",
    mercado: row.mercado || row.market || "",
    isin: row.isin || row.ISIN || "",
    completeness: completeness(row),
    confidence: Number(confidence(row).toFixed(2)),
  };
}

function missingFillCandidates(target, source) {
  return IMPORTANT_FIELDS
    .filter((field) => !isValid(target[field]) && isValid(source[field]))
    .map((field) => ({ field, value: source[field] }));
}

const [acoes, ativos] = await Promise.all([
  fetchCollection("acoesDividendos"),
  fetchCollection("ativos"),
]);

const activeTickers = new Set(ativos.map((row) => canonicalTicker(row.ticker)).filter(Boolean));
const byCanon = new Map();
for (const row of acoes) {
  const canon = canonicalTicker(row.ticker);
  if (!canon) continue;
  if (!byCanon.has(canon)) byCanon.set(canon, []);
  byCanon.get(canon).push(row);
}

const duplicateGroups = [];
const emptyDocs = [];
const fillSuggestions = [];
const eurReplicas = [];

for (const [canon, group] of byCanon.entries()) {
  const best = bestDoc(group);
  if (group.length > 1) {
    duplicateGroups.push({
      canonical: canon,
      inPortfolio: activeTickers.has(canon),
      keep: summarizeDoc(best),
      duplicates: group.filter((row) => row.id !== best.id).map(summarizeDoc),
    });
  }

  for (const row of group) {
    const comp = completeness(row);
    if (comp <= 3 && !activeTickers.has(canon)) {
      emptyDocs.push(summarizeDoc(row));
    }
    if (row.id !== best.id) {
      const fills = missingFillCandidates(row, best);
      if (fills.length >= 3) {
        fillSuggestions.push({
          target: summarizeDoc(row),
          source: summarizeDoc(best),
          fields: fills.slice(0, 15),
          totalFields: fills.length,
        });
      }
    }
  }

  const tickers = new Set(group.map((row) => cleanTicker(row.ticker)));
  const suffixOrAlias = [...tickers].filter((ticker) =>
    ticker.includes(".") ||
    ticker.includes(":") ||
    CANON_ALIASES[ticker] === canon ||
    ticker !== canon
  );
  if (suffixOrAlias.length) {
    eurReplicas.push({
      canonical: canon,
      tickers: [...tickers].sort(),
      best: summarizeDoc(best),
    });
  }
}

const report = {
  counts: {
    acoesDividendos: acoes.length,
    ativos: ativos.length,
    canonicalGroups: byCanon.size,
    duplicateGroups: duplicateGroups.length,
    emptyDocs: emptyDocs.length,
    fillSuggestions: fillSuggestions.length,
    eurReplicas: eurReplicas.length,
  },
  duplicateGroups: duplicateGroups
    .sort((a, b) => b.duplicates.length - a.duplicates.length || a.canonical.localeCompare(b.canonical))
    .slice(0, 50),
  emptyDocs: emptyDocs.sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, 80),
  fillSuggestions: fillSuggestions.slice(0, 50),
  eurReplicas: eurReplicas.sort((a, b) => a.canonical.localeCompare(b.canonical)).slice(0, 80),
};

console.log(JSON.stringify(report, null, 2));
