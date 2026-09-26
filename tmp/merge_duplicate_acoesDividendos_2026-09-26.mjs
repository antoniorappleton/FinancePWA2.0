// One-off: funde documentos duplicados em acoesDividendos (mesma empresa/ETF
// guardada com IDs diferentes, ex.: "ELI:SON" e "ELI_SON").
//
// Origem: um processo externo escreveu a 2026-09-21 ~50 docs com o ticker cru
// como ID ("ELI:SON", "LON:JEDI", "XETR_VVMX", ...), enquanto o sync da Sheet
// (upload_to_firestore.gs → UP_safeDocId_) usa IDs higienizados ("ELI_SON").
// A app lista um doc por entrada → a empresa aparecia duas vezes.
//
// Regras de fusão ("melhor modelo"):
//  - Sobrevivente = o doc que o sync da Sheet mantém vivo (ID higienizado) ou,
//    quando nenhum está vivo, o que segue a convenção de ID "_" / ticker simples.
//  - Sobrevivente vivo: os valores dele ganham sempre (o sync reescreve-os de
//    30 em 30 min); dos duplicados só se copiam campos que lhe faltam.
//  - Nenhum vivo: a base é o doc mais recente (valores coerentes entre si,
//    evita misturar % com frações), completada com o que falta do mais antigo.
//  - Nunca se copiam ticker/nome/timestamps; valores 0 ou vazios dos
//    duplicados não contam (são placeholders no lote de 21/09).
//  - Docs com dados de outro instrumento são apagados sem fusão (LON_XDWF).
//
// Uso:
//   node tmp/merge_duplicate_acoesDividendos_2026-09-26.mjs --dry-run
//   node tmp/merge_duplicate_acoesDividendos_2026-09-26.mjs

import fs from "node:fs";

const PROJECT = "appfinance-812b2";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/acoesDividendos`;
const DRY_RUN = process.argv.includes("--dry-run");
const BACKUP = new URL("./acoesDividendos_duplicates_backup_2026-09-26.json", import.meta.url);

// survivor: doc que fica | merge: duplicados fundidos e apagados | drop: apagados sem fusão
const GROUPS = [
  { survivor: "ELI_SON", merge: ["ELI:SON"] },
  { survivor: "ELI_BCP", merge: ["ELI:BCP"] },
  { survivor: "ELI_CTT", merge: ["ELI:CTT"] },
  { survivor: "ELI_EGL", merge: ["ELI:EGL"] },
  { survivor: "ELI_JMT", merge: ["ELI:JMT"] },
  { survivor: "EPA_SU", merge: ["EPA:SU"] },
  { survivor: "EPA_CS", merge: ["EPA:CS"] },
  { survivor: "LON_VOD", merge: ["LON:VOD"] },
  { survivor: "LYM9_FRA_EUR", merge: ["LYM9:FRA:EUR"] },
  // JEDI (doc) tinha nome errado ("Defiance Drone...") mas holdings/ISIN do VanEck Space Innovators
  { survivor: "LON_JEDI", merge: ["LON:JEDI", "JEDI"] },
  // LON_XDWF tinha dados de outro fundo ("iShares MSCI Europe Financials")
  { survivor: "XDWF", merge: ["LON:XDWF"], drop: ["LON_XDWF"] },
  { survivor: "VZLC", merge: ["LSE_VZLC"] },
  { survivor: "VVMX", merge: ["XETR_VVMX"] },
  { survivor: "G2X", merge: ["LON_G2X"] },
  { survivor: "UNV0_F", merge: ["UNV0", "UNV0.F"] },
  // doc "GOOGL" tinha ticker "GOOG" → colidia com o doc GOOG
  { survivor: "GOOG", merge: ["GOOGL"] },
];

const NEVER_COPY = new Set(["ticker", "nome", "updatedAt", "ultimaAtu", "lastFullSync"]);
const EMPTY_STRINGS = new Set(["", "-", "—", "n/a", "na", "#n/a", "nan", "null", "undefined"]);

function isEmptyFs(v) {
  if (!v || "nullValue" in v) return true;
  if ("stringValue" in v) return EMPTY_STRINGS.has(v.stringValue.trim().toLowerCase());
  if ("arrayValue" in v) return !(v.arrayValue.values || []).length;
  if ("mapValue" in v) return !Object.keys(v.mapValue.fields || {}).length;
  return false;
}

// Valor de um duplicado só conta se tiver conteúdo real (0 = placeholder).
function isUsefulFs(v) {
  if (isEmptyFs(v)) return false;
  if ("integerValue" in v) return Number(v.integerValue) !== 0;
  if ("doubleValue" in v) return Number(v.doubleValue) !== 0 && Number.isFinite(Number(v.doubleValue));
  return true;
}

// O lote externo de 2026-09-21 guarda priceChange_* em % (2.56 = 2,56%); a Sheet
// e os IDs sobreviventes usam fração (0.0256). Converte ao copiar.
const PCT_FIELDS = new Set(["priceChange_1d", "priceChange_1w", "priceChange_1m", "priceChange_1y"]);
const isPercentBatch = (d) => String(d?.fields?.updatedAt?.timestampValue || "").startsWith("2026-09-21");
function adapt(k, v, srcDoc) {
  if (!PCT_FIELDS.has(k) || !isPercentBatch(srcDoc)) return v;
  const n = Number(v.doubleValue ?? v.integerValue);
  return Number.isFinite(n) ? { doubleValue: Number((n / 100).toFixed(6)) } : v;
}

const updatedAt = (d) => Date.parse(d?.fields?.updatedAt?.timestampValue || d?.fields?.ultimaAtu?.timestampValue || 0) || 0;

async function req(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

const getDoc = async (id) => {
  try { return await req(`${BASE}/${encodeURIComponent(id)}`); }
  catch (e) { if (String(e.message).includes("404")) return null; throw e; }
};

const LIVE_MS = Date.now() - 3 * 24 * 3600 * 1000; // atualizado pelo sync nos últimos 3 dias

const backup = {};
const plan = [];

for (const g of GROUPS) {
  const survivor = await getDoc(g.survivor);
  if (!survivor) { console.log(`⚠️  ${g.survivor}: sobrevivente não existe — grupo ignorado`); continue; }
  const dups = [];
  for (const id of g.merge) { const d = await getDoc(id); if (d) dups.push({ id, d }); }
  const drops = [];
  for (const id of g.drop || []) { const d = await getDoc(id); if (d) drops.push({ id, d }); }
  if (!dups.length && !drops.length) { console.log(`✓  ${g.survivor}: sem duplicados (já limpo)`); continue; }

  backup[g.survivor] = survivor;
  for (const { id, d } of [...dups, ...drops]) backup[id] = d;

  const sFields = survivor.fields || {};
  const survivorLive = updatedAt(survivor) >= LIVE_MS;
  const patch = {};
  const changes = [];

  if (!survivorLive) {
    // Base = doc mais recente do grupo (valores internamente coerentes).
    const freshest = dups.reduce((best, x) => (updatedAt(x.d) > updatedAt(best.d) ? x : best), { id: g.survivor, d: survivor });
    if (freshest.id !== g.survivor) {
      for (const [k, v] of Object.entries(freshest.d.fields || {})) {
        if (k === "ticker" || k === "nome") continue;
        if (!isUsefulFs(v)) continue;
        const nv = adapt(k, v, freshest.d);
        if (JSON.stringify(sFields[k]) === JSON.stringify(nv)) continue;
        patch[k] = nv;
        changes.push(`${k} ← ${freshest.id} (mais recente)`);
      }
    }
  }

  // Completar lacunas com os duplicados (mais recentes primeiro).
  for (const { id, d } of [...dups].sort((a, b) => updatedAt(b.d) - updatedAt(a.d))) {
    for (const [k, v] of Object.entries(d.fields || {})) {
      if (NEVER_COPY.has(k) || k in patch) continue;
      if (!isEmptyFs(sFields[k])) continue;
      if (!isUsefulFs(v)) continue;
      patch[k] = adapt(k, v, d);
      changes.push(`${k} ← ${id}`);
    }
  }

  plan.push({ survivor: g.survivor, live: survivorLive, patch, changes, deletes: [...dups, ...drops].map((x) => x.id) });
}

for (const p of plan) {
  console.log(`\n■ ${p.survivor} ${p.live ? "(vivo, sync da Sheet)" : "(sem sync)"}`);
  console.log(`   campos a completar (${p.changes.length}): ${p.changes.join(", ") || "—"}`);
  const pct = Object.entries(p.patch).filter(([k]) => PCT_FIELDS.has(k) || k === "valorStock");
  if (pct.length) console.log(`   valores: ${pct.map(([k, v]) => `${k}=${v.doubleValue ?? v.integerValue}`).join(" ")}`);
  console.log(`   apagar: ${p.deletes.join(", ")}`);
}

if (DRY_RUN) { console.log("\n(dry-run: nada escrito)"); process.exit(0); }

fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 1));
console.log(`\nBackup: ${BACKUP.pathname}`);

for (const p of plan) {
  const keys = Object.keys(p.patch);
  if (keys.length) {
    const mask = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    await req(`${BASE}/${encodeURIComponent(p.survivor)}?${mask}&currentDocument.exists=true`, "PATCH", { fields: p.patch });
  }
  for (const id of p.deletes) await req(`${BASE}/${encodeURIComponent(id)}`, "DELETE");
  console.log(`✅ ${p.survivor}: +${keys.length} campos, apagados ${p.deletes.length}`);
}
