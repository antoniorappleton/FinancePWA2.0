/**
 * ENGINE FINANCEIRO V8.6 - TIMEOUT PROTECTION
 * 
 * Novidades:
 * 1. Soft Deadline: O script para aos 5:30m para evitar erro do Google.
 * 2. Lotes de 20 ativos: Mais leve para cada execução.
 * 3. Gatilho 6/6h: Garante 80 ativos/dia (300+ chamadas FMP se necessário).
 */

const ENG_PROPS = PropertiesService.getScriptProperties();
const ENG_FMP_KEY = (ENG_PROPS.getProperty("FMP_API_KEY") || "Altd2Re1BJ5Z8tod4rVIq040c9gWZNTL").trim();
const ENG_AV_KEY = (ENG_PROPS.getProperty("ALPHAVANTAGE_API_KEY") || "").trim();

const ENG_SHEET_NAME = "Firebase";
const ENG_START_ROW = 2;
const ENG_MAX_EXECUTION_MS = 5 * 60 * 1000 + 30 * 1000; // 5 minutos e 30 segundos

const ENG_COL = {
  TICKER: 1,      // B
  DIVIDENDO: 7,   // H
  PE: 12,         // M (P/E)
  SMA50: 13,      // N
  SMA200: 14,     // O
  EPS_YOY: 16,    // Q (EPS YoY)
  EPS_NEXT: 17,   // R (EPS Next Y)
  ROIC: 18,       // S
  EV: 19,         // T
  MARKET_CAP: 20, // U
  NET_DEBT: 21,   // V
  EBITDA: 22,     // W
  EV_EBITDA: 23,  // X
  ULTIMA_ATU: 24  // Y
};

/**
 * 1. CONFIGURAR CHAVE
 */
function setupAPIKeys() {
  ENG_PROPS.setProperty("FMP_API_KEY", "Altd2Re1BJ5Z8tod4rVIq040c9gWZNTL");
  Logger.log("✅ Chave FMP configurada.");
}

/**
 * 2. CONFIGURAR GATILHO (Agora de 6 em 6 horas)
 */
function ENG_setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (["trigger_UpdateFundamentalAPIs", "trigger_SyncToFirebase"].includes(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Correr a cada 6 horas para garantir cobertura total sem timeout
  ScriptApp.newTrigger("trigger_UpdateFundamentalAPIs").timeBased().everyHours(6).create();
  Logger.log("✅ Gatilho de 6/6h configurado para V8.6.");
}

function trigger_UpdateFundamentalAPIs() {
  updateFundamentalDataRotational();
}

/**
 * MOTOR DE ROTAÇÃO V8.6 (ANTI-TIMEOUT)
 */
function updateFundamentalDataRotational() {
  const startTime = Date.now();
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
  const toProcess = candidates.slice(0, 20); // Reduzido para 20 por turno
  Logger.log("🚀 Iniciando Motor V8.6 (Lote de %s ativos)...", toProcess.length);

  for (let item of toProcess) {
    // VERIFICAÇÃO DE TIMEOUT (SOFT DEADLINE)
    if (Date.now() - startTime > ENG_MAX_EXECUTION_MS) {
      Logger.log("⏳ Soft Deadline atingido. Parando para evitar erro do Google.");
      break;
    }

    let success = false;
    if (ENG_FMP_KEY) {
      success = fetchFromFMP_DeepScan(sheet, item.row, item.ticker);
    }
    
    if (!success && ENG_AV_KEY) {
      Logger.log("⚠️ Fallback AV para: %s", item.ticker);
      success = fetchFromAlphaVantage(sheet, item.row, item.ticker);
      Utilities.sleep(13000); 
    }
    sheet.getRange(item.row, ENG_COL.ULTIMA_ATU + 1).setValue(today);
  }
  Logger.log("✅ Rotação concluída ou pausada com segurança.");
}

function fetchFromFMP_DeepScan(sheet, row, ticker) {
  try {
    let hasData = false;
    const apikey = `apikey=${ENG_FMP_KEY}`;

    // 1. KEY METRICS
    const resM = UrlFetchApp.fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm/${ticker}?${apikey}`, {muteHttpExceptions:true});
    if (resM.getResponseCode() === 200) {
      const dataM = JSON.parse(resM.getContentText())[0];
      if (dataM) {
        if (dataM.peRatioTTM) sheet.getRange(row, ENG_COL.PE + 1).setValue(dataM.peRatioTTM);
        if (dataM.roicTTM) sheet.getRange(row, ENG_COL.ROIC + 1).setValue(dataM.roicTTM * 100);
        const ev = dataM.enterpriseValueTTM || dataM.enterpriseValue;
        const mc = dataM.marketCapTTM || dataM.marketCap;
        const evEb = dataM.enterpriseValueOverEbitdaTTM || dataM.evToEbitdaTTM;
        if (ev) sheet.getRange(row, ENG_COL.EV + 1).setValue(ev);
        if (mc) sheet.getRange(row, ENG_COL.MARKET_CAP + 1).setValue(mc);
        if (evEb) {
          sheet.getRange(row, ENG_COL.EV_EBITDA + 1).setValue(evEb);
          if (ev && evEb > 0) sheet.getRange(row, ENG_COL.EBITDA + 1).setValue(ev / evEb);
        }
        if (ev && mc) sheet.getRange(row, ENG_COL.NET_DEBT + 1).setValue(ev - mc);
        hasData = true;
      }
    }

    // 2. PROFILE
    const resP = UrlFetchApp.fetch(`https://financialmodelingprep.com/stable/profile/${ticker}?${apikey}`, {muteHttpExceptions:true});
    if (resP.getResponseCode() === 200) {
      const dataP = JSON.parse(resP.getContentText())[0];
      if (dataP && dataP.lastDiv) {
        sheet.getRange(row, ENG_COL.DIVIDENDO + 1).setValue(dataP.lastDiv);
        hasData = true;
      }
    }

    // 3. FINANCIAL GROWTH
    const resG = UrlFetchApp.fetch(`https://financialmodelingprep.com/stable/financial-growth/${ticker}?limit=1&${apikey}`, {muteHttpExceptions:true});
    if (resG.getResponseCode() === 200) {
      const dataG = JSON.parse(resG.getContentText())[0];
      if (dataG && dataG.epsgrowth) {
        sheet.getRange(row, ENG_COL.EPS_YOY + 1).setValue(dataG.epsgrowth * 100);
        hasData = true;
      }
    }

    // 4. ANALYST ESTIMATES
    const resE = UrlFetchApp.fetch(`https://financialmodelingprep.com/api/v3/analyst-estimates/${ticker}?limit=1&${apikey}`, {muteHttpExceptions:true});
    if (resE.getResponseCode() === 200) {
      const dataE = JSON.parse(resE.getContentText())[0];
      if (dataE && dataE.estimatedEpsAvg) {
        sheet.getRange(row, ENG_COL.EPS_NEXT + 1).setValue(dataE.estimatedEpsAvg);
        hasData = true;
      }
    }

    // 5. HISTORICAL (SMAs)
    const resH = UrlFetchApp.fetch(`https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=200&${apikey}`, {muteHttpExceptions:true});
    if (resH.getResponseCode() === 200) {
      const dataH = JSON.parse(resH.getContentText());
      if (dataH.historical && dataH.historical.length >= 50) {
        const hist = dataH.historical.map(d => d.close);
        const sma50 = hist.slice(0, 50).reduce((a,b)=>a+b,0)/50;
        sheet.getRange(row, ENG_COL.SMA50 + 1).setValue(sma50);
        if (hist.length >= 200) {
          const sma200 = hist.slice(0, 200).reduce((a,b)=>a+b,0)/200;
          sheet.getRange(row, ENG_COL.SMA200 + 1).setValue(sma200);
        }
        hasData = true;
      }
    }

    if (hasData) Logger.log("✅ FMP [%s]: Atualizado", ticker);
    return hasData;
  } catch (e) { return false; }
}

function fetchFromAlphaVantage(sheet, row, ticker) {
  try {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${ENG_AV_KEY}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return false;
    const av = JSON.parse(resp.getContentText());
    if (!av.Symbol) return false;
    if (av.PERatio && av.PERatio !== "None") sheet.getRange(row, ENG_COL.PE + 1).setValue(Number(av.PERatio));
    if (av.DividendPerShare && av.DividendPerShare !== "None") sheet.getRange(row, ENG_COL.DIVIDENDO + 1).setValue(Number(av.DividendPerShare));
    return true;
  } catch (e) { return false; }
}

function normalizeTicker(raw) {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase();
  if (["BTC", "ETH", "EUR", "ADA", "XRP"].includes(clean)) return null;
  return clean.includes(":") ? clean.split(":").pop() : clean;
}
