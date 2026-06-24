// js/components/asset-deep-panel.js
// ═══════════════════════════════════════════════════════════════════
// ASSET DEEP PANEL — unified per-asset analysis drawer
// Slides up from bottom. 4 tabs: Análise / Posição / Dados / Técnico
// Data pulled from window._portfolioPositions & window._marketDataMap
// ═══════════════════════════════════════════════════════════════════

import { scoreAssetV2 }           from "../engines/score-v2.js";
import { generateAssetObservations } from "../engines/observations.js";
import { enrichETFAsset, isKnownETF, smartETFAnalysis } from "../engines/etf-overlap.js";
import { getAssetCategory }        from "../utils/normalize.js";

// ── Module state ──────────────────────────────────────────
let _panel      = null;
let _overlay    = null;
let _activeTab  = "analysis";
let _asset      = null;   // market data (acoesDividendos doc)
let _position   = null;   // portfolio position (from byTickerGlobal)
let _score      = null;   // scoreAssetV2 result

// ── Public API ────────────────────────────────────────────
export function openAssetPanel(ticker) {
  _ensureDOM();

  ticker = String(ticker || "").toUpperCase().trim();
  if (!ticker) return;

  const position = window._portfolioPositions?.get(ticker) ?? null;
  const market   = { ...(window._marketDataMap?.get(ticker) ?? {}), ticker };

  if (isKnownETF(ticker)) {
    enrichETFAsset(market, window._marketDataMap ?? new Map());
  }

  let scoreResult;
  try {
    scoreResult = scoreAssetV2(market);
  } catch {
    scoreResult = { finalScore: 50, grade: "C", confidence: 0,
      engines: {}, signals: [], warnings: [], observations: [] };
  }

  const engines = {
    quality:   scoreResult.engines?.quality   ?? { score: 50 },
    momentum:  scoreResult.engines?.momentum  ?? { score: 50 },
    valuation: scoreResult.engines?.valuation ?? { score: 50 },
    risk:      scoreResult.engines?.risk      ?? { score: 50 },
  };

  _asset    = market;
  _position = position;
  _score    = {
    ...scoreResult,
    engines,
    observations: generateAssetObservations(market, engines).slice(0, 5),
  };

  _renderHeader();
  _renderTabs();
  _switchTab("analysis");
  _panelOpen();
}

function _panelClose() {
  _panel?.classList.remove("open");
  _overlay?.classList.remove("open");
  document.body.style.overflow = "";
}

function _panelOpen() {
  _panel.classList.add("open");
  _overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

// ── DOM bootstrap (once) ─────────────────────────────────
function _ensureDOM() {
  if (_panel) return;

  _overlay = document.createElement("div");
  _overlay.className = "adp-overlay";
  _overlay.addEventListener("click", _panelClose);
  document.body.appendChild(_overlay);

  _panel = document.createElement("div");
  _panel.className = "adp-panel";
  _panel.innerHTML = `
    <div class="adp-drag-bar"></div>
    <div class="adp-header" id="adpHeader"></div>
    <div class="adp-tabs"   id="adpTabs"></div>
    <div class="adp-body"   id="adpBody"></div>
  `;
  document.body.appendChild(_panel);
}

// ── Header ────────────────────────────────────────────────
function _renderHeader() {
  const a   = _asset;
  const pos = _position;
  const s   = _score;

  const grade  = s.grade ?? "C";
  const score  = s.finalScore ?? 50;
  const gColor = _gradeColor(grade);

  const price = Number(a.valorStock || a.price || 0);
  const fmtEUR = v => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);
  const priceStr = price > 0 ? fmtEUR(price) : "—";

  const raw1m  = Number(a.priceChange_1m || a.taxaCrescimento_1mes || 0);
  const pct1m  = Math.abs(raw1m) > 1 ? raw1m : raw1m * 100;
  const chgStr = raw1m !== 0
    ? `${pct1m >= 0 ? "+" : ""}${pct1m.toFixed(1)}% 1m`
    : "";

  const cat    = getAssetCategory(a);
  const catLabel = cat.includes("ETF") ? "ETF" : cat === "Commodity" ? "Commodity" : "Ação";

  document.getElementById("adpHeader").innerHTML = `
    <div class="adp-header-top">
      <button class="adp-close-btn" id="adpCloseBtn">✕</button>
      <span class="adp-ticker-label">${a.ticker}</span>
      <span class="adp-grade-badge" style="background:${gColor}20;color:${gColor}">${grade}</span>
      <span class="adp-header-score">${score}</span>
    </div>
    <div class="adp-header-sub">
      <span class="adp-name-label">${a.nome || a.ticker}</span>
      <div class="adp-header-badges">
        <span class="adp-badge">${catLabel}</span>
        ${pos?.category ? `<span class="adp-badge adp-badge--strat">${pos.category}</span>` : ""}
        ${pos          ? `<span class="adp-badge adp-badge--pos">Em Carteira</span>` : ""}
      </div>
    </div>
    <div class="adp-header-price">
      <span class="adp-price-val">${priceStr}</span>
      ${chgStr ? `<span class="adp-price-change ${pct1m >= 0 ? "pos" : "neg"}">${chgStr}</span>` : ""}
    </div>
  `;

  document.getElementById("adpCloseBtn").onclick = _panelClose;
}

// ── Tabs ──────────────────────────────────────────────────
function _renderTabs() {
  const cat   = getAssetCategory(_asset);
  const isETF = cat.includes("ETF");
  const tabs  = [
    { id: "analysis",    label: "Análise" },
    ...(_position ? [{ id: "position", label: "Posição" }] : []),
    { id: isETF ? "holdings" : "fundamentals", label: isETF ? "Holdings" : "Fundamentais" },
    { id: "technical", label: "Técnico" },
  ];

  document.getElementById("adpTabs").innerHTML = tabs
    .map(t => `<button class="adp-tab ${_activeTab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`)
    .join("");

  document.getElementById("adpTabs").querySelectorAll(".adp-tab").forEach(btn => {
    btn.onclick = () => _switchTab(btn.dataset.tab);
  });
}

function _switchTab(tabId) {
  _activeTab = tabId;
  document.getElementById("adpTabs")?.querySelectorAll(".adp-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tabId));

  const body = document.getElementById("adpBody");
  if (!body) return;
  body.scrollTop = 0;

  switch (tabId) {
    case "analysis":      body.innerHTML = _tabAnalysis();     break;
    case "position":      body.innerHTML = _tabPosition();     break;
    case "fundamentals":  body.innerHTML = _tabFundamentals(); break;
    case "holdings":      body.innerHTML = _tabHoldings();     break;
    case "technical":     body.innerHTML = _tabTechnical();    break;
    default: body.innerHTML = "";
  }
}

// ════════════════════════════════════════════════════════
// TAB: ANÁLISE
// ════════════════════════════════════════════════════════
function _tabAnalysis() {
  const s     = _score;
  const a     = _asset;
  const cat   = getAssetCategory(a);
  const isETF = cat.includes("ETF");
  const grade  = s.grade ?? "C";
  const score  = s.finalScore ?? 50;
  const conf   = s.confidence ?? 0;
  const gColor = _gradeColor(grade);

  const eng = s.engines;
  const qS  = eng.quality?.score   ?? 50;
  const mS  = eng.momentum?.score  ?? 50;
  const vS  = eng.valuation?.score ?? 50;
  const rS  = eng.risk?.score      ?? 50;

  // ETF-specific enrichment bars
  let etfBarsHTML = "";
  if (isETF) {
    const sectorS  = typeof a._etfSectorScore     === "number" ? Math.round(a._etfSectorScore * 100) : null;
    const geoS     = typeof a._etfGeoScore        === "number" ? Math.round(a._etfGeoScore * 100)    : null;
    const holdingQ = typeof a._etfHoldingsQuality === "number" ? a._etfHoldingsQuality               : null;

    if (sectorS !== null || geoS !== null || holdingQ !== null) {
      etfBarsHTML = `
        <div class="adp-section-title" style="margin-top:16px">Composição ETF</div>
        ${sectorS  !== null ? _bar("Diversif. Sectorial",  sectorS,  "#0f766e", a._etfDominantSector  ? `Dominante: ${a._etfDominantSector}`  : "") : ""}
        ${geoS     !== null ? _bar("Diversif. Geográfica", geoS,     "#2563eb", a._etfDominantRegion  ? `Dominante: ${a._etfDominantRegion}`  : "") : ""}
        ${holdingQ !== null ? _bar("Qualidade Holdings",   holdingQ, "#7c3aed",
            a._etfHoldingsCoverage ? `${(a._etfHoldingsCoverage * 100).toFixed(0)}% cobertura em base de dados` : "") : ""}
      `;
    }
  }

  // Observations
  const obs = s.observations ?? [];
  const obsHTML = obs.length
    ? obs.map(o => `
        <div class="adp-obs adp-obs--${o.type}">
          <span class="adp-obs-icon">${_obsIcon(o.type)}</span>
          <span class="adp-obs-msg">${o.msg}</span>
        </div>`).join("")
    : `<div class="adp-empty">Dados insuficientes para gerar observações.</div>`;

  const signals = [...(s.warnings ?? []), ...(s.signals ?? [])].slice(0, 3);
  const sigHTML = signals.length
    ? `<div class="adp-section-title" style="margin-top:16px">Sinais</div>
       ${signals.map(w => `<div class="adp-signal">${w}</div>`).join("")}`
    : "";

  return `
    <div class="adp-score-hero" style="border-color:${gColor}30">
      <div class="adp-grade-big" style="color:${gColor}">${grade}</div>
      <div class="adp-score-big">${score}<span style="font-size:.85rem;opacity:.55"> / 100</span></div>
      <div class="adp-conf">Confiança dos dados: ${conf}%</div>
    </div>

    <div class="adp-section-title">Motores de Score</div>
    <div class="adp-engines">
      ${_bar("Quality",      qS, "#6366f1")}
      ${_bar("Momentum",     mS, "#f59e0b")}
      ${_bar(isETF ? "Custo / Categoria" : "Valuation", vS, "#10b981")}
      ${_bar("Risco",        rS, "#ef4444")}
    </div>
    ${etfBarsHTML}

    <div class="adp-section-title" style="margin-top:16px">Observações</div>
    <div class="adp-obs-list">${obsHTML}</div>
    ${sigHTML}
  `;
}

// ════════════════════════════════════════════════════════
// TAB: POSIÇÃO
// ════════════════════════════════════════════════════════
function _tabPosition() {
  const pos = _position;
  if (!pos) return `<div class="adp-empty">Este ativo não está em carteira.</div>`;

  const fmtEUR = v => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v ?? 0);
  const fmtPct = v => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`;

  const precoAtual = pos.precoAtual ?? 0;
  const precoMedio = pos.qtd > 0 ? (pos.investido ?? 0) / pos.qtd : 0;
  const lucro      = pos.lucroAtual ?? 0;
  const percL      = pos.investido > 0 ? (lucro / pos.investido) * 100 : 0;
  const objetivo   = pos.objetivo ?? 0;
  const prog       = objetivo > 0 ? Math.min(100, Math.max(0, (lucro / objetivo) * 100)) : 0;
  const progColor  = lucro >= objetivo && objetivo > 0 ? "#16a34a" : lucro > 0 ? "#2563eb" : "#dc2626";
  const tpObj      = pos.qtd > 0 ? ((pos.investido ?? 0) + objetivo) / pos.qtd : 0;

  const valorAtual = precoAtual * (pos.qtd ?? 0);

  return `
    <div class="adp-kpi-grid">
      <div class="adp-kpi">
        <div class="adp-kpi-label">Quantidade</div>
        <div class="adp-kpi-val">${Number(pos.qtd).toFixed(4)}</div>
      </div>
      <div class="adp-kpi">
        <div class="adp-kpi-label">Custo Médio</div>
        <div class="adp-kpi-val">${fmtEUR(precoMedio)}</div>
      </div>
      <div class="adp-kpi">
        <div class="adp-kpi-label">Valor Atual</div>
        <div class="adp-kpi-val">${fmtEUR(valorAtual)}</div>
      </div>
      <div class="adp-kpi">
        <div class="adp-kpi-label">Capital Investido</div>
        <div class="adp-kpi-val">${fmtEUR(pos.investido)}</div>
      </div>
    </div>

    <div class="adp-pl-box ${lucro >= 0 ? "pos" : "neg"}">
      <div>
        <div class="adp-kpi-label">Lucro / Perda</div>
        <div class="adp-pl-val">${fmtEUR(lucro)}</div>
      </div>
      <div class="adp-pl-pct">${fmtPct(percL)}</div>
    </div>

    ${objetivo > 0 ? `
    <div class="adp-section-title" style="margin-top:16px">Objetivo</div>
    <div class="adp-row-spread" style="font-size:.8rem;color:var(--muted-foreground);margin-bottom:6px">
      <span>Progresso</span>
      <span style="font-weight:700;color:${progColor}">${prog.toFixed(1)}%</span>
    </div>
    <div class="adp-progress-track">
      <div class="adp-progress-fill" style="width:${prog}%;background:${progColor}"></div>
    </div>
    <div class="adp-row-spread" style="font-size:.72rem;color:var(--muted-foreground);margin-top:4px">
      <span>Meta: ${fmtEUR(objetivo)}</span>
      <span>TP Objetivo: ${fmtEUR(tpObj)}</span>
    </div>` : ""}

    ${pos.category ? `
    <div class="adp-section-title" style="margin-top:16px">Estratégia</div>
    <div class="adp-row-spread" style="font-size:.85rem;margin-bottom:4px">
      <span>Categoria</span>
      <span class="adp-badge adp-badge--strat">${pos.category}</span>
    </div>
    ${pos.targetAlloc ? `<div class="adp-row-spread" style="font-size:.85rem"><span>Alocação Alvo</span><span>${pos.targetAlloc}%</span></div>` : ""}` : ""}

    <div class="adp-section-title" style="margin-top:16px">Níveis de Entrada</div>
    ${_priceRow("Reforço −5%",  precoAtual * 0.95)}
    ${_priceRow("Reforço −10%", precoAtual * 0.90)}
    ${_priceRow("Reforço −20%", precoAtual * 0.80)}

    <div class="adp-section-title" style="margin-top:16px">Plano de Saída</div>
    ${_priceRow("TP1 +5%",  precoMedio * 1.05, "#16a34a")}
    ${_priceRow("TP2 +10%", precoMedio * 1.10, "#16a34a")}
    ${_priceRow("TP3 +15%", precoMedio * 1.15, "#16a34a")}
    ${_priceRow("Stop −10%", precoMedio * 0.90, "#dc2626")}

    <div style="margin-top:20px;display:flex;gap:8px">
      <button class="adp-action-btn adp-action-btn--buy"
        onclick="window.openActionModal?.('buy','${pos.ticker}');window.closeAssetPanel?.()">
        + Comprar
      </button>
      <button class="adp-action-btn adp-action-btn--sell"
        onclick="window.openActionModal?.('sell','${pos.ticker}');window.closeAssetPanel?.()">
        − Vender
      </button>
    </div>
  `;
}

// ════════════════════════════════════════════════════════
// TAB: FUNDAMENTAIS (stocks)
// ════════════════════════════════════════════════════════
function _tabFundamentals() {
  const a = _asset;

  const n = (field, ...aliases) => {
    for (const k of [field, ...aliases]) {
      const v = Number(a[k]);
      if (isFinite(v) && v !== 0) return v;
    }
    return null;
  };

  const pct = v => v !== null ? `${(v * (Math.abs(v) > 1 ? 1 : 100)).toFixed(1)}%` : "—";
  const x   = v => v !== null && v > 0 ? `${v.toFixed(1)}x` : "—";
  const num  = v => v !== null ? v.toFixed(2) : "—";

  const pe   = n("pe");
  const peg  = n("peg");
  const ev   = n("ev_ebitda", "evEbitda");
  const pfcf = n("p_fcf", "priceToFCF");
  const roic = n("roic");
  const roe  = n("roe", "returnOnEquity");
  const om   = n("oper_margin", "operMargin", "operating_margin");
  const nm   = n("profit_margin", "profitMargin", "net_margin");
  const de   = n("debt_eq", "debtEquity");
  const cr   = n("current_ratio", "currentRatio");
  const yld  = n("yield");
  const eps5 = n("eps_next_5y");
  const revG = n("sales_y_y_ttm", "revenue_growth");

  return `
    <div class="adp-section-title">Valuation</div>
    <div class="adp-fund-grid">
      ${_cell("P/E",       pe  !== null && pe  > 0 ? pe.toFixed(1) + "x" : "—", pe  !== null && pe  < 25 ? "pos" : pe !== null && pe > 40 ? "neg" : "")}
      ${_cell("PEG",       peg !== null && peg > 0 ? peg.toFixed(2)      : "—", peg !== null && peg < 1.5 ? "pos" : peg !== null && peg > 2.5 ? "neg" : "")}
      ${_cell("EV/EBITDA", x(ev),   "")}
      ${_cell("P/FCF",     pfcf !== null && pfcf > 0 ? pfcf.toFixed(1) + "x" : "—", pfcf !== null && pfcf < 20 ? "pos" : pfcf !== null && pfcf > 40 ? "neg" : "")}
    </div>

    <div class="adp-section-title" style="margin-top:12px">Qualidade</div>
    <div class="adp-fund-grid">
      ${_cell("ROIC",      pct(roic), roic !== null && roic > 0.15 ? "pos" : roic !== null && roic < 0 ? "neg" : "")}
      ${_cell("ROE",       pct(roe),  roe  !== null && roe  > 0.15 ? "pos" : roe  !== null && roe  < 0 ? "neg" : "")}
      ${_cell("Mg. Oper.", pct(om),   om   !== null && om   > 0.15 ? "pos" : om   !== null && om   < 0.05 ? "neg" : "")}
      ${_cell("Mg. Líq.",  pct(nm),   nm   !== null && nm   > 0.10 ? "pos" : nm   !== null && nm   < 0 ? "neg" : "")}
    </div>

    <div class="adp-section-title" style="margin-top:12px">Solidez Financeira</div>
    <div class="adp-fund-grid">
      ${_cell("D/E",          de  !== null && de  > 0 ? de.toFixed(2) : "—",  de  !== null && de  < 1.0 ? "pos" : de !== null && de > 2.5 ? "neg" : "")}
      ${_cell("Current R.",   cr  !== null && cr  > 0 ? cr.toFixed(2) : "—",  cr  !== null && cr  > 1.5 ? "pos" : cr !== null && cr < 1.0 ? "neg" : "")}
      ${_cell("Yield",        pct(yld),  yld !== null && yld > 0.03 ? "pos" : "")}
      ${_cell("EPS 5y",       pct(eps5), eps5 !== null && eps5 > 0.10 ? "pos" : eps5 !== null && eps5 < 0 ? "neg" : "")}
    </div>

    ${revG !== null ? `
    <div class="adp-section-title" style="margin-top:12px">Crescimento</div>
    <div class="adp-fund-grid">
      ${_cell("Receita YoY", pct(revG), revG > 0.10 ? "pos" : revG < -0.05 ? "neg" : "")}
    </div>` : ""}
  `;
}

// ════════════════════════════════════════════════════════
// TAB: HOLDINGS (ETFs)
// ════════════════════════════════════════════════════════
function _tabHoldings() {
  const a   = _asset;
  const etf = smartETFAnalysis(a.ticker);

  const ter  = Number(a.ter || a.expense_ratio || 0);
  const terStr = ter > 0
    ? (ter < 1 ? `${(ter * 100).toFixed(2)}%` : `${ter.toFixed(2)}%`)
    : "—";
  const numH = Number(a.holdings_count || a.num_holdings || 0);

  const fmtP = v => `${Number(v).toFixed(1)}%`;

  // Sector bars
  let sectorHTML = "";
  if (etf?.sectors) {
    const entries = Object.entries(etf.sectors).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = entries[0]?.[1] || 1;
    sectorHTML = `
      <div class="adp-section-title" style="margin-top:14px">Distribuição Sectorial</div>
      ${entries.map(([name, val]) => `
        <div class="adp-dist-row">
          <span class="adp-dist-label">${name}</span>
          <div class="adp-dist-track">
            <div class="adp-dist-fill" style="width:${(val / max) * 100}%;background:#0f766e80"></div>
          </div>
          <span class="adp-dist-val">${fmtP(val)}</span>
        </div>`).join("")}
    `;
  }

  // Geo bars
  let geoHTML = "";
  if (etf?.geography) {
    const entries = Object.entries(etf.geography).sort((a, b) => b[1] - a[1]).slice(0, 7);
    const max = entries[0]?.[1] || 1;
    geoHTML = `
      <div class="adp-section-title" style="margin-top:14px">Distribuição Geográfica</div>
      ${entries.map(([name, val]) => `
        <div class="adp-dist-row">
          <span class="adp-dist-label">${name}</span>
          <div class="adp-dist-track">
            <div class="adp-dist-fill" style="width:${(val / max) * 100}%;background:#2563eb80"></div>
          </div>
          <span class="adp-dist-val">${fmtP(val)}</span>
        </div>`).join("")}
    `;
  }

  // Top holdings
  const details   = a._etfHoldingsDetails ?? [];
  const qualMap   = new Map(details.map(d => [d.ticker, d]));
  const topList   = etf?.topHoldings ?? [];
  let holdingsHTML = "";
  if (topList.length > 0) {
    holdingsHTML = `
      <div class="adp-section-title" style="margin-top:14px">Top Holdings</div>
      <div class="adp-holdings-list">
        ${topList.map(h => {
          const q = qualMap.get(h.ticker);
          const qs = q?.quality;
          const qc = qs >= 70 ? "#16a34a" : qs >= 50 ? "#d97706" : qs != null ? "#dc2626" : "#a7b2bd";
          return `
            <div class="adp-holding-row">
              <span class="adp-holding-ticker">${h.ticker}</span>
              <span class="adp-holding-weight">${h.weight}%</span>
              ${qs != null ? `<span class="adp-holding-qual" style="color:${qc}" title="${q.classification}">Q:${qs}</span>` : "<span></span>"}
            </div>`;
        }).join("")}
      </div>
    `;
  }

  const sectorS  = typeof a._etfSectorScore     === "number" ? Math.round(a._etfSectorScore * 100)     : null;
  const geoS     = typeof a._etfGeoScore        === "number" ? Math.round(a._etfGeoScore * 100)         : null;
  const holdingQ = typeof a._etfHoldingsQuality === "number" ? a._etfHoldingsQuality                    : null;
  const cov      = typeof a._etfHoldingsCoverage === "number" ? (a._etfHoldingsCoverage * 100).toFixed(0) : null;

  return `
    <div class="adp-fund-grid">
      ${_cell("TER", terStr, ter > 0 && ter < 0.0025 ? "pos" : ter > 0.006 ? "neg" : "")}
      ${_cell("Nº Holdings", numH > 0 ? numH.toLocaleString("pt-PT") : "—", numH > 1000 ? "pos" : "")}
      ${sectorS !== null ? _cell("Div. Sectorial", `${sectorS}%`, sectorS > 70 ? "pos" : sectorS < 30 ? "neg" : "") : ""}
      ${geoS    !== null ? _cell("Div. Geográfica", `${geoS}%`,   geoS    > 60 ? "pos" : geoS    < 20 ? "neg" : "") : ""}
    </div>

    ${holdingQ !== null ? `
    <div style="margin:10px 0;padding:10px 12px;background:var(--muted);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="adp-kpi-label">Qualidade média das holdings</div>
        ${cov ? `<div style="font-size:.7rem;color:var(--muted-foreground)">${cov}% das holdings avaliadas</div>` : ""}
      </div>
      <div style="font-size:1.35rem;font-weight:800;color:${holdingQ >= 70 ? '#16a34a' : '#d97706'}">${holdingQ}/100</div>
    </div>` : ""}

    ${sectorHTML}
    ${geoHTML}
    ${holdingsHTML}
  `;
}

// ════════════════════════════════════════════════════════
// TAB: TÉCNICO
// ════════════════════════════════════════════════════════
function _tabTechnical() {
  const a = _asset;

  const price  = Number(a.valorStock || a.price || 0);
  const sma50  = Number(a.sma50  || 0);
  const sma200 = Number(a.sma200 || 0);
  const rsi    = Number(a.rsi_14 || a.rsi || 0);

  const rawChange = (field) => Number(a[field] || 0);
  const p1w  = rawChange("priceChange_1w")  || rawChange("taxaCrescimento_1semana");
  const p1m  = rawChange("priceChange_1m")  || rawChange("taxaCrescimento_1mes");
  const p1y  = rawChange("priceChange_1y")  || rawChange("taxaCrescimento_1ano");

  const toPct = v => {
    const n = Number(v);
    if (!n) return "—";
    const p = Math.abs(n) > 1 ? n : n * 100;
    return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  };

  const smaDist = (sma) =>
    sma > 0 && price > 0 ? `${((price / sma - 1) * 100).toFixed(1)}%` : "—";
  const smaDistNum = (sma) =>
    sma > 0 && price > 0 ? (price / sma - 1) * 100 : null;

  const isGolden = sma50 > 0 && sma200 > 0 && sma50 > sma200;
  const isDeath  = sma50 > 0 && sma200 > 0 && sma50 < sma200;
  const crossLabel = isGolden ? "Golden Cross" : isDeath ? "Death Cross" : "Sem tendência de cross";
  const crossColor = isGolden ? "#16a34a" : isDeath ? "#dc2626" : "#64717d";

  const rsiColor = rsi > 70 ? "#dc2626" : rsi < 30 ? "#2563eb" : "#16a34a";
  const rsiLabel = rsi > 70 ? "Sobrecomprado" : rsi < 30 ? "Oversold" : "Zona Neutra";
  const rsiPct   = rsi > 0 ? Math.min(100, Math.max(0, rsi)) : 50;

  const fmtEUR = v => v > 0 ? new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v) : "—";

  return `
    <div class="adp-section-title">Momentum de Preço</div>
    <div class="adp-fund-grid">
      ${_cell("1 Semana",  toPct(p1w), Number(p1w) > 0 ? "pos" : Number(p1w) < 0 ? "neg" : "")}
      ${_cell("1 Mês",     toPct(p1m), Number(p1m) > 0 ? "pos" : Number(p1m) < 0 ? "neg" : "")}
      ${_cell("1 Ano",     toPct(p1y), Number(p1y) > 0 ? "pos" : Number(p1y) < 0 ? "neg" : "")}
    </div>

    <div class="adp-section-title" style="margin-top:14px">RSI (14 períodos)</div>
    <div class="adp-rsi-row">
      <div class="adp-rsi-zones">
        <span>Oversold (&lt;30)</span>
        <span>Overbought (&gt;70)</span>
      </div>
      <div class="adp-rsi-bar-track">
        <div class="adp-rsi-dot" style="left:${rsiPct}%;background:${rsiColor}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <span class="adp-rsi-label" style="color:${rsiColor}">${rsiLabel}</span>
        <span class="adp-rsi-val"   style="color:${rsiColor}">${rsi > 0 ? rsi.toFixed(1) : "—"}</span>
      </div>
    </div>

    <div class="adp-section-title" style="margin-top:14px">Médias Móveis</div>
    <div class="adp-fund-grid">
      ${_cell("vs SMA 50",  smaDist(sma50),  smaDistNum(sma50)  !== null ? (smaDistNum(sma50)  > 0 ? "pos" : "neg") : "")}
      ${_cell("vs SMA 200", smaDist(sma200), smaDistNum(sma200) !== null ? (smaDistNum(sma200) > 0 ? "pos" : "neg") : "")}
      ${sma50  > 0 ? _cell("SMA 50",  fmtEUR(sma50),  "") : ""}
      ${sma200 > 0 ? _cell("SMA 200", fmtEUR(sma200), "") : ""}
    </div>

    <div class="adp-cross-badge" style="background:${crossColor}15;color:${crossColor};border-color:${crossColor}40">
      ${isGolden ? "🚀" : isDeath ? "⚠️" : "○"} ${crossLabel}
    </div>
  `;
}

// ── Micro helpers ─────────────────────────────────────────

function _bar(label, value, color, sub = "") {
  const pct = Math.min(100, Math.max(0, Number(value) || 0));
  return `
    <div class="adp-engine-bar">
      <div class="adp-bar-labels">
        <span>${label}</span>
        <span style="font-weight:700;color:${color}">${pct}</span>
      </div>
      ${sub ? `<div class="adp-bar-sub">${sub}</div>` : ""}
      <div class="adp-bar-track">
        <div class="adp-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
}

function _cell(label, value, modifier = "") {
  return `
    <div class="adp-fund-cell ${modifier ? "adp-fund-cell--" + modifier : ""}">
      <div class="adp-fund-label">${label}</div>
      <div class="adp-fund-val">${value}</div>
    </div>`;
}

function _priceRow(label, price, color = "var(--foreground)") {
  const fmtEUR = v => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v ?? 0);
  return `
    <div class="adp-row-spread" style="font-size:.82rem;padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--muted-foreground)">${label}</span>
      <span style="font-weight:700;color:${color}">${fmtEUR(price)}</span>
    </div>`;
}

function _gradeColor(grade) {
  return { "A+": "#16a34a", A: "#22c55e", "B+": "#0f766e", B: "#2563eb",
           "C+": "#7c3aed", C: "#d97706", D: "#dc2626", F: "#991b1b" }[grade] ?? "#64717d";
}

function _obsIcon(type) {
  return { positive: "✓", warning: "!", caution: "!", neutral: "•" }[type] ?? "•";
}

// ── Expose globally ───────────────────────────────────────
window.openAssetPanel  = openAssetPanel;
window.closeAssetPanel = _panelClose;
