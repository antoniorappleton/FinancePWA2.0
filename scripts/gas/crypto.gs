/*********************************************************
 * CRYPTO (Coinbase Exchange) → Preço EUR + variação 1s/1m/1Y
 * Sheet: "crypto"
 * Lê:  B2:B8   (símbolos: BTC, ETH, SOL, ADA, XRP, DOGE, AVAX…)
 * Escreve: C2:G? → Nome | Preço(EUR) | 1s% | 1m% | 1Y%
 *
 * Correção (06/11/2026): o trigger de tempo falhava com
 * "We're sorry, a server error occurred" — a Coinbase Exchange
 * API responde de forma lenta/intermitente a partir dos IPs
 * partilhados da Google, e o script não tinha lock, limite de
 * tempo próprio nem try/catch; os retries em cadeia (7 tickers
 * × 2 endpoints × até 4 tentativas) podiam arrastar-se até o
 * runtime do Apps Script matar a execução a meio, o que aparece
 * como esse erro genérico em vez de uma exceção com mensagem útil.
 * Agora: lock para evitar execuções sobrepostas, orçamento de
 * tempo (MAX_EXECUTION_MS) que corta o ciclo de tickers antes do
 * limite da plataforma, try/catch com log à volta de toda a
 * função, e 1 retry na escrita final na sheet.
 *
 * Também foram adicionadas CR_setupTriggers / CR_removeTriggers_ /
 * CR_runIfDue — o menu "Crypto" (Botões.gs) já chamava estes nomes
 * mas nunca existiram, pelo que esses botões estavam partidos.
 *********************************************************/

const CRYPTO_CB = {
  SHEET_NAME: "crypto",
  TICKER_RANGE: "B2:B8",
  OUT_START_ROW: 2,      // C2:G?
  OUT_ROWS_MAX: 7,
  VS: "EUR",
  MAX_RETRIES: 3,
  SLEEP_MS: 250,
  MAX_EXECUTION_MS: 4 * 60 * 1000, // corta antes do limite de 6min do Apps Script
  SHEET_ID: "",          // se o script for standalone, põe aqui o ID da folha
  SYMBOL_NAME: {
    BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana",
    ADA: "Cardano", XRP: "XRP", DOGE: "Dogecoin", AVAX: "Avalanche"
  }
};

// ---- Scheduler (mesmo padrão do Upload_Firestore_Robust.gs) ----
const CR_BASE_TRIGGER_MIN = 30;
const CR_MIN_INTERVAL_MS = 25 * 60 * 1000;
const CR_PROPS = PropertiesService.getScriptProperties();
const CR_LAST_RUN_PROP = "CR_LAST_RUN_MS";

function updateCryptoSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log("⏳ updateCryptoSheet já em curso noutra execução, a saltar.");
    return;
  }

  try {
    updateCryptoSheet_run_();
  } catch (e) {
    Logger.log("❌ updateCryptoSheet falhou: %s\n%s", e.message, e.stack);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function updateCryptoSheet_run_() {
  const startMs = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet() || (CRYPTO_CB.SHEET_ID ? SpreadsheetApp.openById(CRYPTO_CB.SHEET_ID) : null);
  if (!ss) throw new Error("Spreadsheet não encontrada. Define CRYPTO_CB.SHEET_ID ou usa script bound.");
  const sh = ss.getSheetByName(CRYPTO_CB.SHEET_NAME);
  if (!sh) throw new Error("Folha não encontrada: " + CRYPTO_CB.SHEET_NAME);

  const tickers = sh.getRange(CRYPTO_CB.TICKER_RANGE).getValues()
    .map(r => String(r[0] ?? "").trim().toUpperCase())
    .slice(0, CRYPTO_CB.OUT_ROWS_MAX);

  // Datas de referência (UTC): 1 semana / 1 mês / 1 ano atrás (calendário)
  const now = new Date();
  const dWeek  = floorUTCToDate_(shiftDaysUTC_(now,  -7));  // YYYY-MM-DD 00:00Z
  const dMonth = floorUTCToDate_(shiftMonthsUTC_(now, -1));
  const dYear  = floorUTCToDate_(shiftYearsUTC_(now,  -1));

  const rows = tickers.length || CRYPTO_CB.OUT_ROWS_MAX;
  const out = Array(rows).fill(0).map(_ => ["", "", "", "", ""]); // C..G

  for (let i = 0; i < rows; i++) {
    if (Date.now() - startMs > CRYPTO_CB.MAX_EXECUTION_MS) {
      Logger.log("⏳ Orçamento de tempo atingido, a parar no ticker %s/%s.", i + 1, rows);
      break;
    }

    const sym = tickers[i];
    if (!sym) continue;

    const product = `${sym}-${CRYPTO_CB.VS}`;
    const pretty  = CRYPTO_CB.SYMBOL_NAME[sym] || sym;

    // 1) Preço atual via /ticker
    const pNow = fetchTickerPrice_(product);
    Utilities.sleep(CRYPTO_CB.SLEEP_MS);
    if (pNow == null) {
      out[i] = [`${pretty} (sem preço)`, "", "", "", ""];
      continue;
    }

    // 2) Candles diários recentes (sem start/end), até 300 dias
    const daily = fetchDailyCandles_(product); // [{ts, close, dateStr}, ...] mais recente primeiro
    Utilities.sleep(CRYPTO_CB.SLEEP_MS);

    // 3) Fecha em 1s/1m/1Y (close do dia alvo; se não existir exatamente, escolher o anterior mais próximo)
    const pW = pickCloseOnOrBefore_(daily, dWeek);
    const pM = pickCloseOnOrBefore_(daily, dMonth);
    const pY = pickCloseOnOrBefore_(daily, dYear);

    const pctW = pctChange_(pW, pNow);
    const pctM = pctChange_(pM, pNow);
    const pctY = pctChange_(pY, pNow);

    out[i] = [pretty, pNow, pctW, pctM, pctY];
  }

  writeCryptoOutput_(sh, rows, out);
}

/** Escreve os resultados com 1 retry em caso de erro transitório do Sheets. */
function writeCryptoOutput_(sh, rows, out) {
  try {
    sh.getRange(CRYPTO_CB.OUT_START_ROW, 3, rows, 5).setValues(out);
  } catch (e) {
    Logger.log("⚠️ Falha a escrever na sheet, a tentar novamente em 2s: %s", e.message);
    Utilities.sleep(2000);
    sh.getRange(CRYPTO_CB.OUT_START_ROW, 3, rows, 5).setValues(out);
  }

  // formatos
  sh.getRange(CRYPTO_CB.OUT_START_ROW, 4, rows, 1).setNumberFormat('€#,##0.00'); // preço
  sh.getRange(CRYPTO_CB.OUT_START_ROW, 5, rows, 3).setNumberFormat('0.00%');     // percentagens
}

/** --- Trigger management (usado pelo menu "Crypto" em Botões.gs) --- */

function CR_setupTriggers() {
  CR_removeTriggers_();
  ScriptApp.newTrigger("CR_runIfDue")
    .timeBased()
    .everyMinutes(CR_BASE_TRIGGER_MIN)
    .create();
  Logger.log(`✅ Trigger de Crypto configurado: a cada ${CR_BASE_TRIGGER_MIN} min`);
}

function CR_removeTriggers_() {
  const targets = ["CR_runIfDue", "updateCryptoSheet"];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (targets.includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  Logger.log("✅ Triggers de Crypto removidos (se existiam).");
}

function CR_runIfDue() {
  const now = Date.now();
  const last = parseInt(CR_PROPS.getProperty(CR_LAST_RUN_PROP) || "0", 10);
  if (Number.isFinite(last) && now - last < CR_MIN_INTERVAL_MS) return;

  updateCryptoSheet();
  CR_PROPS.setProperty(CR_LAST_RUN_PROP, String(now));
}

/** --- HTTP helpers --- */

/** Preço atual (ticker) via Coinbase Exchange. */
function fetchTickerPrice_(product) {
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/ticker`;
  let wait = 250;
  for (let t = 0; t < CRYPTO_CB.MAX_RETRIES; t++) {
    try {
      const r = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true, followRedirects: true,
        headers: { "Accept":"application/json", "User-Agent":"Mozilla/5.0 (AppsScript)" }
      });
      if (r.getResponseCode() === 200) {
        const j = JSON.parse(r.getContentText());
        const amt = Number(j.price ?? j.last ?? NaN);
        return Number.isFinite(amt) ? amt : null;
      }
    } catch (e) {}
    Utilities.sleep(wait); wait = Math.min(wait * 2, 8000);
  }
  return null;
}

/** Candles diários recentes (granularity=86400), sem start/end. Máx ~300 dias. */
function fetchDailyCandles_(product) {
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=86400`;
  let wait = 250;
  for (let t = 0; t < CRYPTO_CB.MAX_RETRIES; t++) {
    try {
      const r = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true, followRedirects: true,
        headers: { "Accept":"application/json", "User-Agent":"Mozilla/5.0 (AppsScript)" }
      });
      if (r.getResponseCode() === 200) {
        const arr = JSON.parse(r.getContentText()); // [[time, low, high, open, close, volume], ...] (mais recente primeiro)
        if (Array.isArray(arr)) {
          return arr.map(c => {
            const ts = Number(c[0]); // epoch seconds UTC
            const close = Number(c[4]);
            const d = new Date(ts * 1000);
            return { ts, close, dateStr: fmtDateUTC_(d) };
          });
        }
      }
    } catch (e) {}
    Utilities.sleep(wait); wait = Math.min(wait * 2, 8000);
  }
  return [];
}

/** Escolhe o close do dia igual ao alvo; se não houver, pega o candle anterior mais próximo. */
function pickCloseOnOrBefore_(candles, targetDate /*Date à meia-noite UTC*/) {
  if (!candles || !candles.length) return null;
  const targetStr = fmtDateUTC_(targetDate);
  // procurar match direto primeiro
  for (let k = 0; k < candles.length; k++) {
    if (candles[k].dateStr === targetStr) {
      return Number.isFinite(candles[k].close) ? candles[k].close : null;
    }
  }
  // senão, procurar candle com ts <= target 23:59:59Z
  const targetEnd = (targetDate.getTime() / 1000) + (24*60*60) - 1; // fim do dia alvo em epoch s
  let best = null, bestTs = -Infinity;
  for (let k = 0; k < candles.length; k++) {
    const ts = candles[k].ts;
    if (ts <= targetEnd && ts > bestTs) {
      bestTs = ts; best = candles[k];
    }
  }
  return best && Number.isFinite(best.close) ? best.close : null;
}

/** --- Cálculo % --- */
function pctChange_(oldPrice, nowPrice) {
  const a = Number(oldPrice), b = Number(nowPrice);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  return (b / a) - 1;
}

/** --- Datas (UTC) --- */
function shiftDaysUTC_(d, delta) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + delta);
  return x;
}
function shiftMonthsUTC_(d, delta) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCMonth(x.getUTCMonth() + delta);
  return x;
}
function shiftYearsUTC_(d, delta) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCFullYear(x.getUTCFullYear() + delta);
  return x;
}
function floorUTCToDate_(d) { // força 00:00:00Z
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function fmtDateUTC_(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2,"0");
  const da= String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}
