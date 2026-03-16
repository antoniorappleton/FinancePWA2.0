/**
 * =============================================================================
 * ENGINE FINANCEIRO V8.7 — ETF AWARE + TICKER FIX
 * Ficheiro: indicadoresAPI's_v8.gs
 * =============================================================================
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║              ORDEM DE EXECUÇÃO (PRIMEIRA CONFIGURAÇÃO)          ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  PASSO 1 — (indicadoresAPI's_v8.gs)                            ║
 * ║    ► Executar: setupAPIKeys()                                   ║
 * ║      Guarda a chave FMP nas PropertiesService do projeto.       ║
 * ║                                                                  ║
 * ║  PASSO 2 — (indicadoresAPI's_v8.gs)                            ║
 * ║    ► Executar: ENG_setupTriggers()                              ║
 * ║      Cria um gatilho automático de 6/6h para ir buscar          ║
 * ║      indicadores fundamentais (PE, ROIC, EPS, SMAs…) à FMP.   ║
 * ║                                                                  ║
 * ║  PASSO 3 — (Upload_Firestore_Robust.gs)                        ║
 * ║    ► Executar: UP_setupTriggers()                               ║
 * ║      Cria um gatilho automático de 10/10min para sincronizar    ║
 * ║      a sheet "Firebase" para a base de dados Firestore.         ║
 * ║                                                                  ║
 * ║  PASSO 4 — Autorizar o script (feito automaticamente)          ║
 * ║      Após executar qualquer função pela 1ª vez, o Google        ║
 * ║      pede autorização. Clica em "Rever autorizações" e aceita.  ║
 * ║                                                                  ║
 * ║  ORDEM DO FLUXO AUTOMÁTICO (após configuração):                 ║
 * ║    [1] FMP busca indicadores → escreve na sheet "Firebase"      ║
 * ║    [2] Upload_Firestore envia a sheet atualizada ao Firestore   ║
 * ║    [3] A PWA lê do Firestore e mostra dados atualizados         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Correções V8.7:
 *  1. normalizeTicker: verifica exclusões APÓS extrair o ticker
 *     do formato EXCHANGE:TICKER (ex: "XETR:EUR" → filtrado ✅)
 *  2. ETF Detection: usa o campo isEtf/isFund do profile FMP
 *  3. EPS_YoY, EPS_Next e ROIC: só se escrevem para ações,
 *     nunca para ETFs (evita valores sem sentido)
 *  4. Profile chamado PRIMEIRO para detetar ETF antes de outros endpoints
 *  5. hasData: um profile válido já conta como sucesso (evita fallback AV desnecessário)
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

// Tickers a ignorar completamente (mesmo que venham depois de ":" em "EXCHANGE:TICKER")
const ENG_SKIP_TICKERS = ["BTC", "ETH", "EUR", "USD", "GBP", "ADA", "XRP", "SOL", "DOT", "MATIC"];

/**
 * PASSO 1 — Guardar chave API da FMP
 */
function setupAPIKeys() {
  ENG_PROPS.setProperty("FMP_API_KEY", "Altd2Re1BJ5Z8tod4rVIq040c9gWZNTL");
  Logger.log("✅ Chave FMP configurada.");
}

/**
 * PASSO 2 — Criar gatilho de 6/6h para buscar indicadores
 */
function ENG_setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (["trigger_UpdateFundamentalAPIs", "trigger_SyncToFirebase"].includes(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("trigger_UpdateFundamentalAPIs").timeBased().everyHours(6).create();
  Logger.log("✅ Gatilho de 6/6h configurado para V8.7.");
}

function trigger_UpdateFundamentalAPIs() {
  updateFundamentalDataRotational();
}

/**
 * MOTOR PRINCIPAL V8.7 — Rotação Anti-Timeout
 * Processa lotes de 20 ativos por execução (os mais antigos primeiro).
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
  const toProcess = candidates.slice(0, 20);
  Logger.log("🚀 Iniciando Motor V8.7 (Lote de %s ativos)...", toProcess.length);

  for (let item of toProcess) {
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

    if (success) {
      sheet.getRange(item.row, ENG_COL.ULTIMA_ATU + 1).setValue(today);
    }
  }
  Logger.log("✅ Rotação concluída ou pausada com segurança.");
}

/**
 * Fetch principal via FMP (Financial Modeling Prep).
 * Ordem de chamadas:
 *   1. Profile  → detecta ETF, obtém lastDiv
 *   2. Key Metrics TTM → PE, ROIC (só ações), EV, MarketCap, EV/EBITDA
 *   3. Financial Growth → EPS YoY (só ações)
 *   4. Analyst Estimates → EPS Next Year (só ações)
 *   5. Historical Prices → SMA50, SMA200 (ações e ETFs)
 */
function fetchFromFMP_DeepScan(sheet, row, ticker) {
  try {
    let hasData = false;
    let isEtf = false;
    const apikey = `apikey=${ENG_FMP_KEY}`;

    // ── 1. PROFILE (primeiro para detectar ETF) ──────────────────────────────
    const resP = UrlFetchApp.fetch(
      `https://financialmodelingprep.com/stable/profile/${ticker}?${apikey}`,
      { muteHttpExceptions: true }
    );
    if (resP.getResponseCode() === 200) {
      const dataP = JSON.parse(resP.getContentText())[0];
      if (dataP) {
        hasData = true;
        isEtf = !!(dataP.isEtf || dataP.isFund);
        if (dataP.lastDiv) {
          sheet.getRange(row, ENG_COL.DIVIDENDO + 1).setValue(dataP.lastDiv);
        }
        if (isEtf) {
          Logger.log("📦 ETF/Fundo detetado: %s — a saltar EPS_YoY e ROIC", ticker);
          // Limpa células de EPS/ROIC em ETFs para evitar lixo de corridas anteriores
          sheet.getRange(row, ENG_COL.EPS_YOY + 1).setValue("");
          sheet.getRange(row, ENG_COL.ROIC + 1).setValue("");
          sheet.getRange(row, ENG_COL.EPS_NEXT + 1).setValue("");
        }
      }
    }

    // ── 2. KEY METRICS TTM ───────────────────────────────────────────────────
    const resM = UrlFetchApp.fetch(
      `https://financialmodelingprep.com/stable/key-metrics-ttm/${ticker}?${apikey}`,
      { muteHttpExceptions: true }
    );
    if (resM.getResponseCode() === 200) {
      const dataM = JSON.parse(resM.getContentText())[0];
      if (dataM) {
        if (dataM.peRatioTTM) sheet.getRange(row, ENG_COL.PE + 1).setValue(dataM.peRatioTTM);
        // ROIC apenas para ações (não ETFs)
        if (!isEtf && dataM.roicTTM) {
          sheet.getRange(row, ENG_COL.ROIC + 1).setValue(dataM.roicTTM * 100);
        }
        const ev   = dataM.enterpriseValueTTM || dataM.enterpriseValue;
        const mc   = dataM.marketCapTTM || dataM.marketCap;
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

    // ── 3 + 4. EPS (só ações) ────────────────────────────────────────────────
    if (!isEtf) {
      // Financial Growth → EPS YoY
      const resG = UrlFetchApp.fetch(
        `https://financialmodelingprep.com/stable/financial-growth/${ticker}?limit=1&${apikey}`,
        { muteHttpExceptions: true }
      );
      if (resG.getResponseCode() === 200) {
        const dataG = JSON.parse(resG.getContentText())[0];
        if (dataG && dataG.epsgrowth != null) {
          sheet.getRange(row, ENG_COL.EPS_YOY + 1).setValue(dataG.epsgrowth * 100);
          hasData = true;
        }
      }

      // Analyst Estimates → EPS Next Year
      const resE = UrlFetchApp.fetch(
        `https://financialmodelingprep.com/api/v3/analyst-estimates/${ticker}?limit=1&${apikey}`,
        { muteHttpExceptions: true }
      );
      if (resE.getResponseCode() === 200) {
        const dataE = JSON.parse(resE.getContentText())[0];
        if (dataE && dataE.estimatedEpsAvg) {
          sheet.getRange(row, ENG_COL.EPS_NEXT + 1).setValue(dataE.estimatedEpsAvg);
          hasData = true;
        }
      }
    }

    // ── 5. HISTORICAL (SMAs) — válido para ações e ETFs ─────────────────────
    const resH = UrlFetchApp.fetch(
      `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=200&${apikey}`,
      { muteHttpExceptions: true }
    );
    if (resH.getResponseCode() === 200) {
      const dataH = JSON.parse(resH.getContentText());
      if (dataH.historical && dataH.historical.length >= 50) {
        const hist = dataH.historical.map(d => d.close);
        const sma50 = hist.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
        sheet.getRange(row, ENG_COL.SMA50 + 1).setValue(sma50);
        if (hist.length >= 200) {
          const sma200 = hist.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
          sheet.getRange(row, ENG_COL.SMA200 + 1).setValue(sma200);
        }
        hasData = true;
      }
    }

    if (hasData) Logger.log("✅ FMP [%s] (ETF=%s): Atualizado", ticker, isEtf);
    return hasData;
  } catch (e) {
    Logger.log("❌ Erro FMP [%s]: %s", ticker, e.message);
    return false;
  }
}

/**
 * Fallback: AlphaVantage (usado apenas se FMP falhar completamente)
 */
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

/**
 * Normaliza um ticker da sheet para o formato esperado pela FMP.
 *
 * CORREÇÃO V8.7: a verificação da lista de exclusão acontece DEPOIS
 * de extrair o ticker limpo. Assim "XETR:EUR" → "EUR" → filtrado ✅
 * (antes ficava "XETR:EUR" → não estava na lista → passava → retornava "EUR" ❌)
 *
 * @param {string} raw  Valor bruto da célula (ex: "AAPL", "XETR:BMW", "EUR")
 * @returns {string|null} Ticker normalizado ou null se deve ser ignorado
 */
function normalizeTicker(raw) {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase();
  // 1. Extrai o ticker PRIMEIRO (parte depois de ":" no formato "EXCHANGE:TICKER")
  const ticker = clean.includes(":") ? clean.split(":").pop() : clean;
  // 2. SÓ DEPOIS verifica se deve ser ignorado (moedas, cripto, vazio)
  if (!ticker || ENG_SKIP_TICKERS.includes(ticker)) return null;
  return ticker;
}
