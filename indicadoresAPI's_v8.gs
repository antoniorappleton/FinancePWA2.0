/**
 * ENGINE FINANCEIRO V8.1 - HÍBRIDO (CORREÇÃO DE CONFLITOS)
 * 
 * Melhoras:
 * 1. Usa o endpoint /stable/ recomendado pela FMP.
 * 2. Verifica múltiplos nomes de campos para EV/Ebitda.
 * 3. Usa prefixos ENG_ para evitar conflitos globais de variáveis.
 */

const ENG_PROPS = PropertiesService.getScriptProperties();
const ENG_FMP_KEY = (ENG_PROPS.getProperty("FMP_API_KEY") || "Altd2Re1BJ5Z8tod4rVIq040c9gWZNTL").trim();
const ENG_AV_KEY = (ENG_PROPS.getProperty("ALPHAVANTAGE_API_KEY") || "").trim();

const ENG_SHEET_NAME = "Firebase";
const ENG_START_ROW = 2;

const ENG_COL = {
  TICKER: 1,      // B
  PE: 12,         // M
  ROIC: 18,       // S
  EPS_YOY: 16,    // Q
  EV_EBITDA: 23,  // X
  ULTIMA_ATU: 24  // Y
};

/**
 * 1. CONFIGURAR CHAVE (Executar uma vez no editor)
 */
function setupAPIKeys() {
  ENG_PROPS.setProperty("FMP_API_KEY", "Altd2Re1BJ5Z8tod4rVIq040c9gWZNTL");
  Logger.log("✅ Chave FMP configurada nas propriedades.");
}

/**
 * 2. CONFIGURAR GATILHO DIÁRIO (Executar uma vez no editor)
 */
function ENG_setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const handler = t.getHandlerFunction();
    if (["trigger_UpdateFundamentalAPIs", "trigger_SyncToFirebase"].includes(handler)) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("trigger_UpdateFundamentalAPIs")
    .timeBased().everyDays(1).atHour(3).create();

  Logger.log("✅ Gatilho diário de fundamentais configurado (03:00 AM).");
}

function trigger_UpdateFundamentalAPIs() {
  updateFundamentalDataRotational();
}

/**
 * MOTOR DE ROTAÇÃO HÍBRIDO
 */
function updateFundamentalDataRotational() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ENG_SHEET_NAME);
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  const today = new Date();
  
  let candidates = [];
  for (let i = ENG_START_ROW - 1; i < data.length; i++) {
    const ticker = normalizeTicker(String(data[i][ENG_COL.TICKER]));
    if (!ticker) continue;
    
    candidates.push({
      row: i + 1,
      ticker: ticker,
      lastUpdate: data[i][ENG_COL.ULTIMA_ATU] ? new Date(data[i][ENG_COL.ULTIMA_ATU]) : new Date(0)
    });
  }
  
  candidates.sort((a, b) => a.lastUpdate - b.lastUpdate);
  const toProcess = candidates.slice(0, 40); 
  Logger.log("🚀 Iniciando rotação para %s ativos...", toProcess.length);

  for (let item of toProcess) {
    let success = false;
    if (ENG_FMP_KEY) success = fetchFromFMP(sheet, item.row, item.ticker);
    
    if (!success && ENG_AV_KEY) {
      Logger.log("⚠️ Fallback Alpha Vantage para: %s", item.ticker);
      success = fetchFromAlphaVantage(sheet, item.row, item.ticker);
      Utilities.sleep(13000); 
    }
    sheet.getRange(item.row, ENG_COL.ULTIMA_ATU + 1).setValue(today);
  }
  Logger.log("✅ Fim da rotação.");
}

function fetchFromFMP(sheet, row, ticker) {
  try {
    const url = `https://financialmodelingprep.com/stable/key-metrics-ttm/${ticker}?apikey=${ENG_FMP_KEY}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return false;
    
    const data = JSON.parse(resp.getContentText());
    if (!data || !data.length) return false;

    const metrics = data[0];
    let updated = [];

    if (metrics.roicTTM) {
      sheet.getRange(row, ENG_COL.ROIC + 1).setValue(metrics.roicTTM * 100);
      updated.push("ROIC");
    }
    
    const evVal = metrics.enterpriseValueOverEbitdaTTM || metrics.evToEbitdaTTM;
    if (evVal) {
      sheet.getRange(row, ENG_COL.EV_EBITDA + 1).setValue(evVal);
      updated.push("EV/Ebitda");
    }

    if (metrics.peRatioTTM) {
      sheet.getRange(row, ENG_COL.PE + 1).setValue(metrics.peRatioTTM);
      updated.push("P/E");
    }

    if (updated.length > 0) {
      Logger.log("✅ FMP [%s]: Atualizou %s", ticker, updated.join(", "));
      return true;
    }
    return false;
  } catch (e) { return false; }
}

function fetchFromAlphaVantage(sheet, row, ticker) {
  try {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${ENG_AV_KEY}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return false;
    const avData = JSON.parse(resp.getContentText());
    if (!avData || !avData.Symbol) return false;

    let updated = [];
    if (avData.EVToEBITDA && avData.EVToEBITDA !== "None") {
      sheet.getRange(row, ENG_COL.EV_EBITDA + 1).setValue(Number(avData.EVToEBITDA));
      updated.push("EV/Ebitda");
    }
    if (avData.ProfitMargin && avData.ProfitMargin !== "None") {
      sheet.getRange(row, ENG_COL.ROIC + 1).setValue(Number(avData.ProfitMargin) * 100);
      updated.push("ROIC (Proxy)");
    }
    return updated.length > 0;
  } catch (e) { return false; }
}

function normalizeTicker(raw) {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase();
  if (["BTC", "ETH", "EUR", "ADA", "XRP"].includes(clean)) return null;
  return clean.includes(":") ? clean.split(":").pop() : clean;
}
