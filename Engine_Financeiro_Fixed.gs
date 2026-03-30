/**
 * ENGINE FINANCEIRO "FINAL-FINALÍSSIMA" (V7 - HÍBRIDO FMP + ALPHA VANTAGE)
 *
 * Estratégia de Quotas:
 * 1. FMP (Primária): 250 chamadas/dia (Fundamental + Perfil).
 * 2. Alpha Vantage (Fallback): 25 chamadas/dia.
 * 3. Google Finance (Live): Preço e MarketCap via folha (0 chamadas API).
 */

const PROPS = PropertiesService.getScriptProperties();
const AV_KEY = (PROPS.getProperty("ALPHAVANTAGE_API_KEY") || "").trim();
const FMP_KEY = (PROPS.getProperty("FMP_API_KEY") || "").trim();
const FB_PROJECT_ID = "appfinance-812b2";
const SHEET_NAME = "Firebase";
const START_ROW = 2;

const ENGINE_COL = {
  NOME: 0,
  TICKER: 1,
  SETOR: 2,
  MERCADO: 3,
  VALOR_STOCK: 4,
  PERIODICIDADE: 5,
  MES_TIPICO: 6,
  DIVIDENDO: 7,
  YIELD: 8,
  CHANGE_1W: 9,
  CHANGE_1M: 10,
  CHANGE_1Y: 11,
  PE: 12,
  SMA50: 13,
  SMA200: 14,
  DIV24M: 15,
  EPS_YOY: 16,
  EPS_NEXT: 17,
  ROIC: 18,
  EV: 19,
  MARKET_CAP: 20,
  DIVIDA_LIQ: 21,
  EBITDA: 22,
  EV_EBITDA: 23,
  ULTIMA_ATU: 24,
};

/**
 * CONFIGURAÇÃO DE TRIGGERS (EXECUTAR PARA ATIVAR)
 */
function ENG_setupTriggers() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (
      ["trigger_UpdateFundamentalAPIs", "trigger_SyncToFirebase"].includes(
        t.getHandlerFunction(),
      )
    ) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Rotação Fundamental (FMP/AV) - 1x por dia de madrugada
  ScriptApp.newTrigger("trigger_UpdateFundamentalAPIs")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  Logger.log("✅ Triggers do Engine configurados.");
}

function trigger_UpdateFundamentalAPIs() {
  updateFundamentalDataRotational();
}

/**
 * MOTOR DE ROTAÇÃO HÍBRIDO
 */
function updateFundamentalDataRotational() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const today = new Date();

  let candidates = [];
  for (let i = START_ROW - 1; i < data.length; i++) {
    const ticker = normalizeTicker(String(data[i][ENGINE_COL.TICKER]));
    if (!ticker) continue;
    candidates.push({
      row: i + 1,
      ticker: ticker,
      lastUpdate: data[i][ENGINE_COL.ULTIMA_ATU]
        ? new Date(data[i][ENGINE_COL.ULTIMA_ATU])
        : new Date(0),
    });
  }

  candidates.sort((a, b) => a.lastUpdate - b.lastUpdate);

  // Limite: 40 ativos por run (bem dentro dos 250 da FMP)
  const toProcess = candidates.slice(0, 40);
  Logger.log("🚀 Iniciando rotação para %s ativos...", toProcess.length);

  for (let item of toProcess) {
    let success = false;

    // 1. Tentar FMP (Primária)
    if (FMP_KEY) {
      success = fetchFromFMP(sheet, item.row, item.ticker);
    }

    // 2. Fallback para Alpha Vantage
    if (!success && AV_KEY) {
      Logger.log("⚠️ Fallback Alpha Vantage para: %s", item.ticker);
      success = fetchFromAlphaVantage(sheet, item.row, item.ticker);
      Utilities.sleep(13000);
    }

    if (success) {
      sheet.getRange(item.row, ENGINE_COL.ULTIMA_ATU + 1).setValue(today);
    }
  }
  Logger.log("✅ Fim da rotação.");
}

/**
 * BUSCA FMP (Financial Modeling Prep)
 */
function fetchFromFMP(sheet, row, ticker) {
  try {
    const url = `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${ticker}?apikey=${FMP_KEY}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return false;

    const data = JSON.parse(resp.getContentText());
    if (!data || !data.length) return false;

    const metrics = data[0];
    let fieldsUpdated = [];

    if (metrics.evToEbitdaTTM) {
      sheet
        .getRange(row, ENGINE_COL.EV_EBITDA + 1)
        .setValue(metrics.evToEbitdaTTM);
      fieldsUpdated.push("EV/Ebitda");
    }
    if (metrics.roicTTM) {
      sheet.getRange(row, ENGINE_COL.ROIC + 1).setValue(metrics.roicTTM);
      fieldsUpdated.push("ROIC");
    }
    if (metrics.peRatioTTM) {
      sheet.getRange(row, ENGINE_COL.PE + 1).setValue(metrics.peRatioTTM);
      fieldsUpdated.push("P/E");
    }

    if (fieldsUpdated.length > 0) {
      Logger.log("✅ FMP [%s]: Atualizou %s", ticker, fieldsUpdated.join(", "));
      return true;
    } else {
      Logger.log(
        "ℹ️ FMP [%s]: Encontrou o ativo, mas sem os indicadores fundamentais.",
        ticker,
      );
      return false;
    }
  } catch (e) {
    Logger.log("❌ Erro FMP [%s]: %s", ticker, e);
    return false;
  }
}

/**
 * BUSCA ALPHA VANTAGE
 */
function fetchFromAlphaVantage(sheet, row, ticker) {
  try {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${AV_KEY}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return false;

    const avData = JSON.parse(resp.getContentText());
    if (!avData || !avData.Symbol) return false;

    let fieldsUpdated = [];
    if (avData.EVToEBITDA && avData.EVToEBITDA !== "None") {
      sheet
        .getRange(row, ENGINE_COL.EV_EBITDA + 1)
        .setValue(Number(avData.EVToEBITDA));
      fieldsUpdated.push("EV/Ebitda");
    }
    if (avData.ProfitMargin && avData.ProfitMargin !== "None") {
      sheet
        .getRange(row, ENGINE_COL.ROIC + 1)
        .setValue(Number(avData.ProfitMargin));
      fieldsUpdated.push("ROIC (Proxy)");
    }

    if (fieldsUpdated.length > 0) {
      Logger.log("✅ AV [%s]: Atualizou %s", ticker, fieldsUpdated.join(", "));
      return true;
    }
    return false;
  } catch (e) {
    Logger.log("❌ Erro AV [%s]: %s", ticker, e);
    return false;
  }
}

function normalizeTicker(raw) {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase();
  if (["BTC", "ETH", "EUR"].includes(clean)) return null;
  return clean.includes(":") ? clean.split(":").pop() : clean;
}

function getAuthToken() {
  return PROPS.getProperty("FB_ACCESS_TOKEN");
}

function enviarParaFirebase() {
  if (typeof UP_enviarParaFirebase === "function") {
    UP_enviarParaFirebase();
  } else {
    throw new Error("Script de Upload não encontrado.");
  }
}
