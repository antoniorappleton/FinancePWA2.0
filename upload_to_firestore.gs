/****************************************************
 * Upload_Firestore_Robust.gs  (V2.1 - Atualizado)
 *
 * Faz UPSERT (create/update) para Firestore a partir da sheet "Firebase"
 * Coleção: acoesDividendos
 *
 * ✅ Envia TODAS as tabelas e conteúdos (como #N/A, ou vazios como null).
 * ✅ Processamento contínuo em massa (envia tudo dentro do limite de tempo).
 * ✅ Resolve o bloqueio/lentidão de enviar poucas linhas de cada vez.
 ****************************************************/

const UP_PROPS = PropertiesService.getScriptProperties();

// ---- Config base ----
const UP_FIREBASE_PROJECT = "appfinance-812b2";
const UP_FIREBASE_COLL = "acoesDividendos";   // Verifica se é mesmo este nome na tua BD!
const UP_SHEET_NAME = "Firebase";

// ---- Scheduler ----
const UP_BASE_TRIGGER_MIN = 10;
const UP_MIN_INTERVAL_MS = 8 * 60 * 1000; // gate
const UP_LAST_RUN_PROP = "UP_FS_LAST_RUN_MS";

// ---- Chunk/tempo ----
const UP_CHUNK_ROWS = 500; // Lê imensas linhas de uma vez para ser ágil (era 60)
const UP_FLUSH_EVERY = 300; // Máximo do firestore batchWrite é 500
const UP_LAST_ROW_PROP = "UP_FS_LAST_ROW";
const UP_SOFT_DEADLINE_MS = 5 * 60 * 1000 - 20000; // ~4m40s tolerância do google
const UP_PRE_READ_FLUSH = true;
const UP_PRE_READ_SLEEP_MS = 500;
const UP_USE_DISPLAY_VALUES = true;

// ---- Eliminação de “stale tickers” ----
const UP_DELETE_STALE_TICKERS = false;       
const UP_DELETE_MAX_PER_RUN = 150;           
const UP_DELETE_RUN_ONLY_WHEN_CYCLE_RESTARTS = true; 

// ---- Opções de escrita ----
const UP_ADD_UPDATED_AT = true;
const UP_UPDATED_AT_FIELD = "updatedAt";

/**
 * Mapeamento de headers (normalizados) -> nomes de campos no Firestore.
 */
const UP_FIELD_MAP = {
  // base
  "nome": "nome",
  "name": "nome",
  "ticker": "ticker",
  "setor": "setor",
  "sector": "setor",
  "mercado": "mercado",
  "market": "mercado",
  "valorstock": "valorStock",
  "valor stock": "valorStock",
  "preco": "valorStock",
  "price": "valorStock",
  "periodicidade": "periodicidade",
  "mes": "mes",
  "mês": "mes",
  "dividendo": "dividendo",

  // yield
  "yield": "yield",
  "dividend yield": "yield",
  "dividend yield (%)": "yield",

  // changes
  "1w": "priceChange_1w",
  "1m": "priceChange_1m",
  "1y": "priceChange_1y",
  "pricechange 1w": "priceChange_1w",
  "pricechange 1m": "priceChange_1m",
  "pricechange 1y": "priceChange_1y",

  // valuation/tech
  "pe": "pe",
  "p/e": "pe",
  "p e": "pe",
  "p/e ratio": "pe",
  "p/e ratio (preco/lucro)": "pe",
  "sma50": "sma50",
  "sma 50": "sma50",
  "sma200": "sma200",
  "sma 200": "sma200",

  // dividendos
  "dividendo medio 24m": "dividendoMedio24m",
  "dividendo medio 24 m": "dividendoMedio24m",
  "dividendomedio24m": "dividendoMedio24m",
  "divmedo24m": "dividendoMedio24m",
  "divmedio24m": "dividendoMedio24m",

  // earnings/quality
  "eps_yoy": "epsYoY",
  "eps yoy": "epsYoY",
  "eps_yoy (%)": "epsYoY",
  "eps next y": "epsNextY",
  "eps next year": "epsNextY",
  "roic": "roic",

  // enterprise/value
  "ev": "ev",
  "market cap": "marketCap",
  "marketcap": "marketCap",
  "divida liquida": "dividaLiquida",
  "divida líquida": "dividaLiquida",
  "dividaliquida": "dividaLiquida",
  "ebitda": "ebitda",
  "ev/ebitda": "evEbitda",
  "ev ebitda": "evEbitda",
  "high_52w": "52w_high",
  "52w high": "52w_high",
  "low_52w": "52w_low",
  "52w low": "52w_low",
  "atr 14": "atr_14",
  "avg volume": "avg_volume",
  "beta": "beta",
  "book sh": "book_sh",
  "cash sh": "cash_sh",
  "current ratio": "current_ratio",
  "debt eq": "debt_eq",
  "dividend est": "dividend_est",
  "dividend ex date": "dividend_ex_date",
  "dividend gr 3 5y": "dividend_gr_3_5y",
  "dividend ttm": "dividend_ttm",
  "earnings": "earnings",
  "enterprise value": "enterprise_value",
  "eps next q": "eps_next_q",
  "eps next 5y": "eps_next_5y",
  "eps past 3 5y": "eps_past_3_5y",
  "eps q q": "eps_q_q",
  "eps sales surpr": "eps_sales_surpr",
  "eps this y": "eps_this_y",
  "eps ttm": "eps_ttm",
  "eps y y ttm": "eps_y_y_ttm",
  "ev sales": "ev_sales",
  "forward p e": "forward_p_e",
  "gross margin": "gross_margin",
  "income": "income",
  "insider own": "insider_own",
  "inst own": "inst_own",
  "lt debt eq": "lt_debt_eq",
  "oper margin": "oper_margin",
  "p b": "p_b",
  "p c": "p_c",
  "p s": "p_s",
  "p fcf": "p_fcf",
  "payout": "payout",
  "profit margin": "profit_margin",
  "quick ratio": "quick_ratio",
  "roa": "roa",
  "roe": "roe",
  "roi": "roi",
  "rsi 14": "rsi_14",
  "sales q q": "sales_q_q",
  "sales y y ttm": "sales_y_y_ttm",
  "short float": "short_float",
  "short interest": "short_interest",
  "short ratio": "short_ratio",
  "shs float": "shs_float",
  "shs outstand": "shs_outstand",
  "target price": "target_price",
  "volatility": "volatility",
  "rel volume": "rel_volume",

  // extras
  "ultima atu": "ultimaAtu",
  "última atu": "ultimaAtu",
  "ultima atualizacao": "ultimaAtu",
  "ultima atualização": "ultimaAtu",
  "observacoes": "observacoes",
  "observações": "observacoes"
};

/** Função wrapper do menu / execução manual. */
function UP_enviarParaFirebase() {
  UP_enviarParaFirebase_Logic();
}

/** CONFIGURAÇÃO (Executares no editor manualmente caso não esteja a correr sozínho) */
function UP_setupTriggers() {
  UP_removeTriggers_();
  ScriptApp.newTrigger("UP_runIfDue")
    .timeBased()
    .everyMinutes(UP_BASE_TRIGGER_MIN)
    .create();
  Logger.log(`✅ Trigger de Upload configurado: a cada ${UP_BASE_TRIGGER_MIN} min`);
}

function UP_removeTriggers_() {
  const targets = ["UP_runIfDue"];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (targets.includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  Logger.log("✅ Triggers removidos (se existiam).");
}

/** Função chamada de 10 em 10 min pelo trigger */
function UP_runIfDue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const now = Date.now();
    const last = parseInt(UP_PROPS.getProperty(UP_LAST_RUN_PROP) || "0", 10);
    if (Number.isFinite(last) && now - last < UP_MIN_INTERVAL_MS) return;

    UP_enviarParaFirebase_Logic();
    UP_PROPS.setProperty(UP_LAST_RUN_PROP, String(now));
  } finally {
    lock.releaseLock();
  }
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
    if (!ss) return;

    const sh = ss.getSheetByName(UP_SHEET_NAME);
    if (!sh) {
      Logger.log(`❌ Sheet não encontrada: ${UP_SHEET_NAME}`);
      return;
    }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      Logger.log("ℹ️ Nada para enviar (sheet vazia).");
      return;
    }

    if (UP_PRE_READ_FLUSH) {
      SpreadsheetApp.flush();
      Utilities.sleep(UP_PRE_READ_SLEEP_MS);
    }

    // headers
    const headerRaw = sh
      .getRange(1, 1, 1, lastCol)
      .getValues()[0]
      .map(x => String(x || "").trim());

    const headerNorm = headerRaw.map(UP_normKey_);

    const iTicker = headerNorm.findIndex(h => h === "ticker");
    if (iTicker < 0) {
      Logger.log("❌ Coluna 'ticker' não encontrada (linha 1).");
      return;
    }

    let startRow = parseInt(UP_PROPS.getProperty(UP_LAST_ROW_PROP) || "2", 10);
    if (startRow < 2 || startRow > lastRow) startRow = 2;

    const headersAuth = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
    let writes = [];
    const seenDocPaths = new Set();
    let sent = 0;

    let currentRow = startRow;
    let cycleRestarted = false;

    // NOVO LOOP: Processa o máximo de dados que conseguir nesse intervalo!
    while (currentRow <= lastRow) {
      if (Date.now() - startMs > UP_SOFT_DEADLINE_MS) break;

      const numRowsToFetch = Math.min(UP_CHUNK_ROWS, lastRow - currentRow + 1);
      const dataRange = sh.getRange(currentRow, 1, numRowsToFetch, lastCol);
      const dataValues = dataRange.getValues();
      const dataDisplay = UP_USE_DISPLAY_VALUES ? dataRange.getDisplayValues() : null;

      for (let r = 0; r < dataValues.length; r++) {
        const tickerRaw = String(dataValues[r][iTicker] || "").trim().toUpperCase();
        if (!tickerRaw) continue; // Sem ticket é impossivrl iterar.

        const docId = UP_safeDocId_(tickerRaw);
        if (!docId) continue;

        const docName = `projects/${UP_FIREBASE_PROJECT}/databases/(default)/documents/${UP_FIREBASE_COLL}/${docId}`;

        if (seenDocPaths.has(docName)) continue;

        const fields = {};
        for (let c = 0; c < lastCol; c++) {
          const norm = headerNorm[c];
          const rawHeader = headerRaw[c];

          if (!rawHeader || !String(rawHeader).trim()) continue;

          const key = UP_FIELD_MAP[norm] || rawHeader;

          const cel = UP_sanitizeCell_(
            dataValues[r][c],
            dataDisplay ? dataDisplay[r][c] : null
          );

          if (!cel.ok) continue;

          const fsVal = UP_toFirestoreValue_(cel.value);
          if (fsVal) fields[key] = fsVal;
        }

        fields["ticker"] = { stringValue: String(tickerRaw) };

        if (UP_ADD_UPDATED_AT) {
          fields[UP_UPDATED_AT_FIELD] = { timestampValue: new Date().toISOString() };
        }

        // NOVO: Processamento de campos complexos (52w, Growth, etc)
        UP_processComplexFields_(fields);

        writes.push({
          update: { name: docName, fields },
          updateMask: { fieldPaths: Object.keys(fields) }
        });

        seenDocPaths.add(docName);
        sent++;

        if (writes.length >= UP_FLUSH_EVERY) {
          UP_batchWriteChecked_(writes, headersAuth);
          writes = [];
        }
      }

      currentRow += numRowsToFetch;
      
      let nextRow = currentRow;
      cycleRestarted = nextRow > lastRow;
      if (cycleRestarted) nextRow = 2; // Volta ao recomeço caso finalize as linhas
      
      UP_PROPS.setProperty(UP_LAST_ROW_PROP, String(nextRow));
    }

    if (writes.length > 0) {
      UP_batchWriteChecked_(writes, headersAuth);
    }

    Logger.log(`✅ Upload Firestore: Enviadas ${sent} linhas. Próxima linha no próximo trigger: ${(currentRow > lastRow) ? 2 : currentRow}`);

    if (
      UP_DELETE_STALE_TICKERS &&
      (!UP_DELETE_RUN_ONLY_WHEN_CYCLE_RESTARTS || cycleRestarted) &&
      (Date.now() - startMs < UP_SOFT_DEADLINE_MS)
    ) {
      UP_deleteStaleTickers_(sh, lastRow, iTicker, headersAuth, startMs);
    }
  } finally {
    lock.releaseLock();
  }
}

/** ===== Helpers ===== */

function UP_normKey_(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function UP_safeDocId_(ticker) {
  return String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/\//g, "_")
    .replace(/[^A-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function UP_sanitizeCell_(v, d) {
  // Alterado para capturar sempre a célula:
  const raw = (d !== null && d !== undefined && String(d).trim() !== "") ? d : v;

  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { ok: true, value: "" }; // Guarda string vazia
  }

  if (raw instanceof Date) return { ok: true, value: raw };
  if (typeof raw === "number") return { ok: true, value: raw };
  if (typeof raw === "boolean") return { ok: true, value: raw };

  const s = String(raw).trim();
  
  // Se for #N/A, NA, etc, enviaremos a string original em vez de omitir
  if (s.startsWith("#") || ["n/a", "na", "n.a.", "não aplicável", "nao aplicavel", "-", "—", "--"].includes(s.toLowerCase())) {
    return { ok: true, value: s };
  }

  // Tenta extrair percentagens, valores pt, datas - se não der, envia como string
  const pct = UP_parsePercent_(s);
  if (pct !== null) return { ok: true, value: pct };

  const num = UP_parsePtNumber_(s);
  if (num !== null) return { ok: true, value: num };

  const dt = UP_parseDate_(s);
  if (dt !== null) return { ok: true, value: dt };

  return { ok: true, value: s };
}

function UP_parsePercent_(s) {
  const m = String(s).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*%$/);
  if (!m) return null;
  const n = UP_parsePtNumber_(m[1]);
  if (n === null) return null;
  return n / 100;
}

function UP_parsePtNumber_(s) {
  let x = String(s).trim();
  if (!x) return null;

  // remove espaços internos
  x = x.replace(/\s+/g, "");
  // remove apóstrofos de milhar
  x = x.replace(/'/g, "");

  // Se tem vírgula, assume vírgula decimal (PT) e remove pontos de milhar
  if (x.includes(",")) {
    x = x.replace(/\./g, "");
    x = x.replace(",", ".");
  }

  if (!/^[-+]?\d+(\.\d+)?$/.test(x)) return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function UP_parseDate_(s) {
  const m = String(s).trim().match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

function UP_toFirestoreValue_(v) {
  if (v === null) return { nullValue: null };

  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };

  return { stringValue: String(v) };
}

function UP_batchWriteChecked_(writes, auth) {
  const url = `https://firestore.googleapis.com/v1/projects/${UP_FIREBASE_PROJECT}/databases/(default)/documents:batchWrite`;

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ writes }),
    headers: auth,
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const txt = res.getContentText() || "";

  if (code < 200 || code >= 300) {
    Logger.log(`❌ batchWrite HTTP ${code}: ${txt.substring(0, 1500)}`);
    return;
  }

  // Se a API devolver status por write, pode ter erros parciais
  try {
    const obj = JSON.parse(txt);
    if (obj && Array.isArray(obj.status)) {
      const bad = obj.status
        .map((st, i) => ({ st, i }))
        .filter(x => x.st && x.st.code && x.st.code !== 0);

      if (bad.length) {
        Logger.log(`⚠️ batchWrite: ${bad.length} writes com erro. Exemplo: ${JSON.stringify(bad[0]).substring(0, 1500)}`);
      }
    }
  } catch (_) {
    // ignore parse
  }
}

/** ===== Eliminação de tickers “stale” (opcional) ===== */

function UP_deleteStaleTickers_(sh, lastRow, iTicker, auth, startMs) {
  // Se já estamos perto do deadline, não inicia delete
  if (Date.now() - startMs > UP_SOFT_DEADLINE_MS - 30000) {
    Logger.log("ℹ️ Skip delete stale: perto do deadline.");
    return;
  }

  // 1) Tickers presentes na sheet
  const rng = sh.getRange(2, iTicker + 1, Math.max(0, lastRow - 1), 1);
  const vals = rng.getValues();

  const sheetTickers = new Set();
  for (let i = 0; i < vals.length; i++) {
    const t = String(vals[i][0] || "").trim().toUpperCase();
    if (!t) continue;
    const docId = UP_safeDocId_(t);
    if (docId) sheetTickers.add(docId);
  }

  // 2) Listar documentos na coleção (paginado)
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${UP_FIREBASE_PROJECT}/databases/(default)/documents/${UP_FIREBASE_COLL}`;
  let pageToken = null;

  let deletes = [];
  let deleted = 0;

  while (true) {
    if (Date.now() - startMs > UP_SOFT_DEADLINE_MS - 20000) break;
    if (deleted >= UP_DELETE_MAX_PER_RUN) break;

    const url = pageToken ? `${baseUrl}?pageSize=200&pageToken=${encodeURIComponent(pageToken)}`
                          : `${baseUrl}?pageSize=200`;

    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: auth,
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    const txt = res.getContentText() || "";

    if (code < 200 || code >= 300) {
      Logger.log(`❌ list docs HTTP ${code}: ${txt.substring(0, 1500)}`);
      break;
    }

    let obj;
    try { obj = JSON.parse(txt); } catch (e) { break; }
    const docs = Array.isArray(obj.documents) ? obj.documents : [];

    for (let i = 0; i < docs.length; i++) {
      if (deleted >= UP_DELETE_MAX_PER_RUN) break;
      if (Date.now() - startMs > UP_SOFT_DEADLINE_MS - 20000) break;

      const name = docs[i].name; // .../documents/acoesDividendos/<docId>
      const docId = String(name || "").split("/").pop();
      if (!docId) continue;

      if (!sheetTickers.has(docId)) {
        deletes.push({ delete: name });
        deleted++;

        if (deletes.length >= 50) {
          UP_batchWriteChecked_(deletes, auth);
          deletes = [];
        }
      }
    }

    pageToken = obj.nextPageToken || null;
    if (!pageToken) break;
  }

  if (deletes.length) UP_batchWriteChecked_(deletes, auth);

  Logger.log(`🧹 Delete stale tickers: apagados ${deleted} docs (máx/run=${UP_DELETE_MAX_PER_RUN}).`);
}

/**
 * Processa campos de string complexos (ex: "288.62 -14.26%") e gera campos numéricos atómicos no Firestore.
 * Ajuda o frontend a fazer cálculos sem ter de fazer parsing de strings.
 */
function UP_processComplexFields_(fields) {
  const getS = (k) => fields[k] && fields[k].stringValue ? fields[k].stringValue : null;
  const setD = (k, v) => { if (v !== null) fields[k] = { doubleValue: v }; };

  // 1. 52w High / Low
  // Format: "288.62 -14.26%"
  const high52 = getS("52w_high");
  if (high52) {
    const parts = high52.split(/\s+/);
    if (parts.length >= 2) {
      setD("high_52w_price", UP_parsePtNumber_(parts[0]));
      setD("high_52w_dist", UP_parsePercent_(parts[1]));
    }
  }

  const low52 = getS("52w_low");
  if (low52) {
    const parts = low52.split(/\s+/);
    if (parts.length >= 2) {
      setD("low_52w_price", UP_parsePtNumber_(parts[0]));
      setD("low_52w_dist", UP_parsePercent_(parts[1]));
    }
  }

  // 2. Dividend Growth 3/5y
  // Format: "4.26% 4.98%"
  const divGr = getS("dividend_gr_3_5y");
  if (divGr) {
    const parts = divGr.split(/\s+/);
    if (parts.length >= 2) {
      setD("div_grow_3y", UP_parsePercent_(parts[0]));
      setD("div_grow_5y", UP_parsePercent_(parts[1]));
    }
  }

  // 3. EPS Growth Past 3/5y
  // Format: "6.89% 17.91%"
  const epsGr = getS("eps_past_3_5y");
  if (epsGr) {
    const parts = epsGr.split(/\s+/);
    if (parts.length >= 2) {
      setD("eps_grow_3y", UP_parsePercent_(parts[0]));
      setD("eps_grow_5y", UP_parsePercent_(parts[1]));
    }
  }

  // 4. Volatility
  // Format: "1.94% 2.09%"
  const vol = getS("volatility");
  if (vol) {
    const parts = vol.split(/\s+/);
    if (parts.length >= 2) {
      setD("vol_week", UP_parsePercent_(parts[0]));
      setD("vol_month", UP_parsePercent_(parts[1]));
    }
  }

  // 5. Dividend Estimate
  // Format: "1.07 (0.43%)"
  const divEst = getS("dividend_est");
  if (divEst) {
    const m = divEst.match(/^([\d.,]+)\s*\(([\d.,]+)%\)$/);
    if (m) {
      setD("div_est_value", UP_parsePtNumber_(m[1]));
      setD("div_est_yield", UP_parsePtNumber_(m[2]) / 100);
    }
  }
}

