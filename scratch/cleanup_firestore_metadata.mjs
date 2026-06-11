const PROJECT_ID = "appfinance-812b2";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/acoesDividendos`;
const APPLY = process.argv.includes("--apply");

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  return { stringValue: String(value) };
}

function toFirestoreFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]));
}

async function patchDoc(id, fields) {
  const url = new URL(`${BASE}/${encodeURIComponent(id)}`);
  Object.keys(fields).forEach((field) => url.searchParams.append("updateMask.fieldPaths", field));
  const body = JSON.stringify({ fields: toFirestoreFields(fields) });
  if (!APPLY) {
    console.log(`[DRY-RUN] PATCH ${id}`, fields);
    return;
  }
  const res = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`PATCH ${id}: ${res.status} ${await res.text()}`);
  console.log(`[OK] PATCH ${id}`);
}

async function deleteDoc(id) {
  if (!APPLY) {
    console.log(`[DRY-RUN] DELETE ${id}`);
    return;
  }
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${id}: ${res.status} ${await res.text()}`);
  console.log(`[OK] DELETE ${id}`);
}

const operations = [
  {
    type: "patch",
    id: "DAVV",
    fields: {
      ticker: "DAVV",
      nome: "VanEck Crypto and Blockchain Innovators UCITS ETF",
      setor: "ETF Blockchain Innovators",
      mercado: "Europeu",
      isin: "IE00BMDKNW35",
    },
    reason: "Canonical EUR ticker for VanEck Crypto & Blockchain; fills missing ISIN and corrects market.",
  },
  {
    type: "delete",
    id: "DAVV_FRA_EUR",
    reason: "Replica of DAVV using ticker:exchange:currency notation.",
  },
  {
    type: "delete",
    id: "XETR_DAVV",
    reason: "Near-empty replica of DAVV using exchange:ticker notation.",
  },
  {
    type: "patch",
    id: "EUNK",
    fields: {
      ticker: "EUNK",
      setor: "ETF Multiplos setores",
      mercado: "Europeu",
      priceChange_1w: -0.0229,
      priceChange_1m: 0.134,
      priceChange_1y: 0.1283,
    },
    reason: "Canonical ticker with ISIN; fills momentum fields from EUNK:GER:EUR replica.",
  },
  {
    type: "delete",
    id: "EUNK_GER_EUR",
    reason: "Replica of EUNK using ticker:exchange:currency notation after merging useful fields.",
  },
  {
    type: "delete",
    id: "XETR_EUNK",
    reason: "Replica of EUNK using exchange:ticker notation after preserving canonical EUNK.",
  },
];

console.log(APPLY ? "[APPLY] Firestore cleanup" : "[DRY-RUN] Firestore cleanup");
for (const op of operations) {
  console.log(`- ${op.type.toUpperCase()} ${op.id}: ${op.reason}`);
  if (op.type === "patch") await patchDoc(op.id, op.fields);
  if (op.type === "delete") await deleteDoc(op.id);
}
