/****************************************************
 * Upload_Firestore_Robust.gs
 *
 * MOTOR DE ENVIO OTIMIZADO (V1.1 - 10 MINUTOS)
 * 
 * Melhoras:
 * 1. Ciclo de 10 min com trava de segurança de 8 min.
 * 2. Usa prefixos UP_ para evitar conflitos globais.
 * 3. Sanitização robusta de tickers e campos.
 ****************************************************/

const UP_PROPS = PropertiesService.getScriptProperties();
const UP_FIREBASE_PROJECT = "appfinance-812b2";
const UP_FIREBASE_COLL = "acoesDividendos";
const UP_SHEET_NAME = "Firebase";

const UP_BASE_TRIGGER_MIN = 10; 
const UP_MIN_INTERVAL_MS = 8 * 60 * 1000; // Margem para bater com o trigger
const UP_LAST_RUN_PROP = "UP_FS_LAST_RUN_MS";
const UP_CHUNK_ROWS = 60;
const UP_FLUSH_EVERY = 50;
const UP_LAST_ROW_PROP = "UP_FS_LAST_ROW";
const UP_SOFT_DEADLINE_MS = 5 * 60 * 1000 - 20000;
const UP_PRE_READ_FLUSH = true;
const UP_PRE_READ_SLEEP_MS = 500;
const UP_USE_DISPLAY_VALUES = true;

/**
 * CONFIGURAÇÃO (Executar uma vez no editor)
 */
function UP_setupTriggers() {
  UP_removeTriggers_();
  ScriptApp.newTrigger("UP_runIfDue")
    .timeBased().everyMinutes(UP_BASE_TRIGGER_MIN).create();
  Logger.log(`✅ Trigger de Upload configurado: a cada ${UP_BASE_TRIGGER_MIN} min`);
}

function UP_removeTriggers_() {
  const targets = ["UP_runIfDue", "enviarParaFirebase"];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (targets.includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
}

/**
 * FUNÇÃO CHAMADA PELO GATILHO
 */
function UP_runIfDue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const now = Date.now();
    const last = parseInt(UP_PROPS.getProperty(UP_LAST_RUN_PROP) || "0", 10);
    if (Number.isFinite(last) && (now - last < UP_MIN_INTERVAL_MS)) return;
    
    UP_enviarParaFirebase_Logic();
    UP_PROPS.setProperty(UP_LAST_RUN_PROP, String(now));
  } finally { lock.releaseLock(); }
}

function UP_enviarParaFirebase_Logic() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log("⏳ Upload já em curso...");
    return;
  }
  const startMs = Date.now();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(UP_SHEET_NAME);
    if (!sh) return;
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) return;

    if (UP_PRE_READ_FLUSH) { SpreadsheetApp.flush(); Utilities.sleep(UP_PRE_READ_SLEEP_MS); }

    const headerRaw = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(x => String(x || "").trim());
    const headerNorm = headerRaw.map(UP_normKey_);
    const iTicker = headerNorm.findIndex(h => h === "ticker");
    if (iTicker < 0) return;

    let startRow = parseInt(UP_PROPS.getProperty(UP_LAST_ROW_PROP) || "2", 10);
    if (startRow < 2 || startRow > lastRow) startRow = 2;

    const dataRange = sh.getRange(startRow, 1, Math.min(UP_CHUNK_ROWS, lastRow - startRow + 1), lastCol);
    const dataValues = dataRange.getValues();
    const dataDisplay = UP_USE_DISPLAY_VALUES ? dataRange.getDisplayValues() : null;

    const headersAuth = { "Authorization": "Bearer " + ScriptApp.getOAuthToken() };
    let updateWrites = [];
    const seenDocPaths = new Set();
    let sent = 0;

    for (let r = 0; r < dataValues.length; r++) {
      if (Date.now() - startMs > UP_SOFT_DEADLINE_MS) break;
      const ticker = String(dataValues[r][iTicker] || "").trim().toUpperCase();
      if (!ticker) continue;

      const docId = ticker.replace(/\//g, "_");
      const docName = `projects/${UP_FIREBASE_PROJECT}/databases/(default)/documents/${UP_FIREBASE_COLL}/${docId}`;
      if (seenDocPaths.has(docName)) continue;

      const fields = {};
      for (let c = 0; c < lastCol; c++) {
        const norm = headerNorm[c];
        const key = UP_FIELD_MAP[norm] || headerRaw[c];
        const cel = UP_sanitizeCell_(dataValues[r][c], dataDisplay ? dataDisplay[r][c] : null);
        if (cel.ok) {
          const fsVal = UP_toFirestoreValue_(cel.value);
          if (fsVal) fields[key] = fsVal;
        }
      }
      fields["updatedAt"] = { timestampValue: new Date().toISOString() };
      updateWrites.push({ update: { name: docName, fields }, updateMask: { fieldPaths: Object.keys(fields) } });
      seenDocPaths.add(docName);
      sent++;

      if (updateWrites.length >= UP_FLUSH_EVERY) { UP_batchUpsert_(updateWrites, headersAuth); updateWrites = []; }
    }
    if (updateWrites.length) UP_batchUpsert_(updateWrites, headersAuth);

    let nextRow = startRow + dataValues.length;
    if (nextRow > lastRow) nextRow = 2;
    UP_PROPS.setProperty(UP_LAST_ROW_PROP, String(nextRow));
    Logger.log(`✅ Upload Firestore: Enviadas ${sent} linhas.`);
  } finally { lock.releaseLock(); }
}

const UP_FIELD_MAP = {
  ticker: "ticker", nome: "nome", name: "nome", setor: "setor", sector: "setor",
  mercado: "mercado", market: "mercado", valorstock: "valorStock", preco: "valorStock",
  periodicidade: "periodicidade", mes: "mes", dividendo: "dividendo", yield: "yield",
  "dividendo medio 24m": "divMedio24m", "1w": "priceChange_1w", "1m": "priceChange_1m",
  "1y": "priceChange_1y", pe: "pe", sma50: "sma50", sma200: "sma200",
  eps_yoy: "epsYoY", roic: "roic", "market cap": "marketCap",
  "divida liquida": "dividaLiquida", ebitda: "ebitda", "ev/ebitda": "evEbitda"
};

function UP_normKey_(s) {
  return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function UP_sanitizeCell_(v, d) {
  if (typeof v === "string" && v.startsWith("#")) return { ok: false };
  if (d && typeof d === "string" && d.startsWith("#")) return { ok: false };
  if (v === null || v || v === 0) return { ok: true, value: v }; // Aceita 0
  return { ok: false };
}
function UP_toFirestoreValue_(v) {
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  return { stringValue: String(v) };
}
function UP_batchUpsert_(writes, auth) {
  const url = `https://firestore.googleapis.com/v1/projects/${UP_FIREBASE_PROJECT}/databases/(default)/documents:batchWrite`;
  UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify({ writes }), headers: auth, muteHttpExceptions: true });
}
