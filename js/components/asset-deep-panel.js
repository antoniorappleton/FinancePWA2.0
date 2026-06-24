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

// ── Decision box helpers ──────────────────────────────────
function _decisionBox(score, grade, isETF) {
  const a   = _asset;
  const pos = _position;
  const ops = a._estadoOp || a.estadoOp || "";

  let icon, label, color, rationale;

  if (score >= 75) {
    icon = "🟢"; label = "REFORÇAR"; color = "#16a34a";
    rationale = isETF
      ? `Score ${score} — ETF com boa eficiência de custo e diversificação. Manter DCA regular.`
      : `Score ${score} — Fundamentos sólidos com momentum positivo. Bom ponto de reforço.`;
  } else if (score >= 60) {
    icon = "🔵"; label = "MANTER"; color = "#2563eb";
    rationale = `Score ${score} — Ativo equilibrado. Mantém posição, aguarda catalisador antes de reforçar.`;
  } else if (score >= 40) {
    icon = "🟡"; label = "MONITORIZAR"; color = "#d97706";
    rationale = `Score ${score} — Qualidade mista. Revê fundamentais e aguarda melhoria antes de adicionar exposição.`;
  } else {
    icon = "🔴"; label = "REDUZIR / SAIR"; color = "#dc2626";
    rationale = `Score ${score} — Score baixo, sinais negativos. Considera reduzir ou sair da posição.`;
  }

  if (ops === "REFORÇAR" || ops === "COMPRAR") { icon = "🟢"; label = ops; color = "#16a34a"; }
  else if (ops === "VENDER")                   { icon = "🔴"; label = "VENDER";  color = "#dc2626"; }
  else if (ops === "REDUZIR")                  { icon = "🟠"; label = "REDUZIR"; color = "#ea580c"; }
  else if (ops === "ESPERAR")                  { icon = "🟡"; label = "ESPERAR"; color = "#d97706"; }

  const inPortfolio = pos ? `<span style="font-size:.7rem;color:var(--muted-foreground)">Em carteira · ${pos.category || "—"}</span>` : "";

  return `
    <div style="border:1.5px solid ${color}40;border-radius:12px;padding:14px 16px;background:${color}08;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.05rem">${icon}</span>
          <strong style="color:${color};font-size:1rem;letter-spacing:.03em">${label}</strong>
        </div>
        ${inPortfolio}
      </div>
      <p style="font-size:.75rem;color:var(--muted-foreground);margin:0;line-height:1.45">${rationale}</p>
    </div>`;
}

// ── Engine micro-context ──────────────────────────────────
function _qualityMicroCtx(a) {
  const fmt1 = v => (v !== null && v !== undefined && isFinite(v)) ? v : null;
  const roic = fmt1(Number(a.roic));
  const de   = fmt1(Number(a.debt_eq || a.debtEquity));
  const om   = fmt1(Number(a.oper_margin || a.operMargin));
  const parts = [];
  if (roic !== null && roic !== 0) parts.push(`ROIC ${(roic * (Math.abs(roic) > 1 ? 1 : 100)).toFixed(0)}%`);
  if (de   !== null && de   !== 0) parts.push(`D/E ${de.toFixed(1)}`);
  if (om   !== null && om   !== 0) parts.push(`Mg.Op. ${(om * (Math.abs(om) > 1 ? 1 : 100)).toFixed(0)}%`);
  return parts.length ? parts.slice(0, 3).join(" · ") : "";
}

function _momentumMicroCtx(a) {
  const p1m = Number(a.priceChange_1m || a.taxaCrescimento_1mes || 0);
  const p1y = Number(a.priceChange_1y || a.taxaCrescimento_1ano || 0);
  const toP = v => { const n = Math.abs(v) > 1 ? v : v * 100; return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; };
  const parts = [];
  if (p1m) parts.push(`1m ${toP(p1m)}`);
  if (p1y) parts.push(`1a ${toP(p1y)}`);
  const rsi = Number(a.rsi_14 || a.rsi || 0);
  if (rsi) parts.push(`RSI ${rsi.toFixed(0)}`);
  return parts.slice(0, 3).join(" · ");
}

function _valuationMicroCtx(a) {
  const pe   = Number(a.pe);
  const peg  = Number(a.peg);
  const pfcf = Number(a.p_fcf || a.priceToFCF);
  const parts = [];
  if (pe   > 0 && isFinite(pe))   parts.push(`P/E ${pe.toFixed(0)}x`);
  if (peg  > 0 && isFinite(peg))  parts.push(`PEG ${peg.toFixed(2)}`);
  if (pfcf > 0 && isFinite(pfcf)) parts.push(`P/FCF ${pfcf.toFixed(0)}x`);
  return parts.slice(0, 3).join(" · ");
}

function _riskMicroCtx(a) {
  const beta = Number(a.beta);
  const cr   = Number(a.current_ratio || a.currentRatio);
  const sma200 = Number(a.sma200);
  const price  = Number(a.valorStock || a.price || 0);
  const parts = [];
  if (beta  > 0 && isFinite(beta))   parts.push(`Beta ${beta.toFixed(2)}`);
  if (cr    > 0 && isFinite(cr))     parts.push(`CR ${cr.toFixed(1)}`);
  if (sma200 > 0 && price > 0)       parts.push(`vs SMA200 ${((price / sma200 - 1) * 100).toFixed(0)}%`);
  return parts.slice(0, 3).join(" · ");
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

  // ETF: replace generic engine bars with ETF-specific diversity bars
  let engineBarsHTML;
  if (isETF) {
    const sectorS  = typeof a._etfSectorScore     === "number" ? Math.round(a._etfSectorScore * 100) : null;
    const geoS     = typeof a._etfGeoScore        === "number" ? Math.round(a._etfGeoScore * 100)    : null;
    const holdingQ = typeof a._etfHoldingsQuality === "number" ? a._etfHoldingsQuality               : null;
    const ter      = Number(a.ter || a.expense_ratio || 0);
    const terScore = ter > 0 ? Math.max(0, Math.round(100 - (ter / 0.006) * 100)) : null;
    const terSub   = ter > 0 ? `TER ${ter < 1 ? (ter * 100).toFixed(2) : ter.toFixed(2)}%` : "";

    engineBarsHTML = `
      ${_bar("Custo (TER)", terScore ?? qS, "#6366f1", terSub)}
      ${sectorS  !== null ? _bar("Diversif. Sectorial", sectorS,  "#0f766e",
          a._etfDominantSector ? `Dominante: ${a._etfDominantSector}` : "") : _bar("Diversif. Sectorial", 50, "#0f766e", "Dados não disponíveis")}
      ${geoS     !== null ? _bar("Diversif. Geográfica", geoS,    "#2563eb",
          a._etfDominantRegion ? `Dominante: ${a._etfDominantRegion}` : "") : _bar("Diversif. Geográfica", 50, "#2563eb", "Dados não disponíveis")}
      ${holdingQ !== null ? _bar("Qualidade Holdings", holdingQ,  "#7c3aed",
          a._etfHoldingsCoverage ? `${(a._etfHoldingsCoverage * 100).toFixed(0)}% das holdings avaliadas` : "") : ""}
      ${_bar("Risco / Volatilidade", rS, "#ef4444", _riskMicroCtx(a))}
    `;
  } else {
    engineBarsHTML = `
      ${_bar("Quality",      qS, "#6366f1", _qualityMicroCtx(a))}
      ${_bar("Momentum",     mS, "#f59e0b", _momentumMicroCtx(a))}
      ${_bar("Valuation",    vS, "#10b981", _valuationMicroCtx(a))}
      ${_bar("Risco",        rS, "#ef4444", _riskMicroCtx(a))}
    `;
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
    ${_decisionBox(score, grade, isETF)}

    <div class="adp-score-hero" style="border-color:${gColor}30">
      <div class="adp-grade-big" style="color:${gColor}">${grade}</div>
      <div class="adp-score-big">${score}<span style="font-size:.85rem;opacity:.55"> / 100</span></div>
      <div class="adp-conf">Confiança dos dados: ${conf}%</div>
    </div>

    <div class="adp-section-title">${isETF ? "Análise ETF" : "Motores de Score"}</div>
    <div class="adp-engines">
      ${engineBarsHTML}
    </div>

    <div class="adp-section-title" style="margin-top:16px">Observações</div>
    <div class="adp-obs-list">${obsHTML}</div>
    ${sigHTML}
  `;
}

// ── Strategy editor (CORE/SATÉLITE) ──────────────────────
function _strategyEditor(ticker, pos) {
  const dynTickers = window._dynamicStrategyTickers || {};
  const saved = dynTickers[ticker];
  const cat = saved?.category || pos?.category || "NONE";
  const tgt = saved?.target ?? (pos?.targetAlloc ?? 0);

  const id = `adpStrat_${ticker}`;
  const catId  = `${id}_cat`;
  const tgtId  = `${id}_tgt`;
  const btnId  = `${id}_save`;
  const statusId = `${id}_status`;

  // Wire after render
  setTimeout(() => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.onclick = async () => {
      const newCat = document.getElementById(catId)?.value || "NONE";
      const newTgt = parseFloat(document.getElementById(tgtId)?.value) || 0;
      const statusEl = document.getElementById(statusId);
      btn.disabled = true;
      btn.textContent = "A guardar…";
      if (typeof window.saveAssetStrategy === "function") {
        await window.saveAssetStrategy(ticker, newCat, newTgt);
        if (statusEl) {
          statusEl.textContent = "Guardado!";
          statusEl.style.color = "var(--success)";
          setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
        }
      } else {
        if (statusEl) { statusEl.textContent = "Abre Atividade primeiro."; statusEl.style.color = "var(--destructive)"; }
      }
      btn.disabled = false;
      btn.textContent = "Guardar";
    };

    // Live category toggle: show/hide target input
    document.getElementById(catId)?.addEventListener("change", (e) => {
      const tgtWrap = document.getElementById(`${id}_tgtwrap`);
      if (tgtWrap) tgtWrap.style.display = e.target.value === "NONE" ? "none" : "";
    });
  }, 0);

  const showTarget = cat !== "NONE";

  return `
    <div class="adp-section-title" style="margin-top:18px">Estratégia do Ativo</div>
    <div style="background:rgba(var(--primary-rgb,99,102,241),.06);border:1px solid rgba(var(--primary-rgb,99,102,241),.2);border-radius:10px;padding:14px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label style="display:block;font-size:.65rem;color:var(--muted-foreground);margin-bottom:4px;font-weight:700">CATEGORIA</label>
          <select id="${catId}" style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid var(--border);background:var(--input);font-size:.82rem;color:var(--foreground)">
            <option value="NONE"      ${cat === "NONE"      ? "selected" : ""}>Nenhuma</option>
            <option value="CORE"      ${cat === "CORE"      ? "selected" : ""}>Core</option>
            <option value="SATELLITE" ${cat === "SATELLITE" ? "selected" : ""}>Satélite</option>
          </select>
        </div>
        <div id="${id}_tgtwrap" style="${showTarget ? "" : "display:none"}">
          <label style="display:block;font-size:.65rem;color:var(--muted-foreground);margin-bottom:4px;font-weight:700">ALVO (%)</label>
          <div style="position:relative">
            <input id="${tgtId}" type="number" min="0" max="100" step="0.5" value="${Number(tgt).toFixed(1)}"
              style="width:100%;padding:7px 28px 7px 8px;border-radius:6px;border:1px solid var(--border);background:var(--input);font-size:.82rem;color:var(--foreground)">
            <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);opacity:.5;font-size:.8rem">%</span>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button id="${btnId}" style="flex:1;padding:7px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-size:.8rem;font-weight:700;cursor:pointer">
          Guardar
        </button>
        <span id="${statusId}" style="font-size:.72rem"></span>
      </div>
      <div style="margin-top:8px;font-size:.7rem;color:var(--muted-foreground)">
        A % alvo é usada no cálculo de cobertura estratégica do portfólio.
      </div>
    </div>`;
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

    ${_strategyEditor(_asset.ticker, _position)}

    ${(() => {
      // Quantity calculations
      const monthlyBase  = Number(window._strategyConfig?.monthlyBase || 0);
      const currentQtd   = Number(pos.qtd || 0);
      const isDecimal    = currentQtd > 0 && currentQtd < 1; // fractional (ETFs)
      const fmtQty = (q, price) => {
        if (monthlyBase <= 0 || price <= 0) return null;
        const raw = monthlyBase / price;
        return isDecimal ? raw : Math.floor(raw);
      };
      const sellQty = (frac) => {
        if (currentQtd <= 0) return null;
        const raw = currentQtd * frac;
        return isDecimal ? raw : Math.max(1, Math.floor(raw));
      };

      const p95  = precoAtual * 0.95;
      const p90  = precoAtual * 0.90;
      const p80  = precoAtual * 0.80;
      const tp1  = precoMedio * 1.05;
      const tp2  = precoMedio * 1.10;
      const tp3  = precoMedio * 1.15;
      const stop = precoMedio * 0.90;

      const qtyNote = monthlyBase > 0
        ? `<div style="font-size:.7rem;color:var(--muted-foreground);margin-bottom:4px">com aporte mensal de ${new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR"}).format(monthlyBase)}</div>`
        : `<div style="font-size:.7rem;color:var(--muted-foreground);margin-bottom:4px">Define o aporte mensal em Definições para ver quantidades</div>`;

      return `
    <div class="adp-section-title" style="margin-top:16px">Níveis de Entrada</div>
    ${qtyNote}
    ${_priceRow("Reforço −5%",  p95,  "var(--foreground)", fmtQty(null, p95),  "ações")}
    ${_priceRow("Reforço −10%", p90,  "var(--foreground)", fmtQty(null, p90),  "ações")}
    ${_priceRow("Reforço −20%", p80,  "var(--foreground)", fmtQty(null, p80),  "ações")}

    <div class="adp-section-title" style="margin-top:16px">Plano de Saída</div>
    <div style="font-size:.7rem;color:var(--muted-foreground);margin-bottom:4px">da posição atual de ${currentQtd % 1 === 0 ? currentQtd : currentQtd.toFixed(4)} ações</div>
    ${_priceRow("TP1 +5%",   tp1,  "#16a34a", sellQty(1/3),  "ações")}
    ${_priceRow("TP2 +10%",  tp2,  "#16a34a", sellQty(1/3),  "ações")}
    ${_priceRow("TP3 +15%",  tp3,  "#16a34a", sellQty(1/3),  "ações")}
    ${_priceRow("Stop −10%", stop, "#dc2626", currentQtd > 0 ? currentQtd : null, "ações (tudo)")}`;
    })()}

    <div style="margin-top:20px;display:flex;gap:8px">
      <button class="adp-action-btn adp-action-btn--buy"
        onclick="window.openActionModal?.('compra','${pos.ticker}');window.closeAssetPanel?.()">
        + Comprar
      </button>
      <button class="adp-action-btn adp-action-btn--sell"
        onclick="window.openActionModal?.('venda','${pos.ticker}');window.closeAssetPanel?.()">
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

  // Cross-reference: which ETF holdings overlap with portfolio direct positions
  const portfolioTickers = window._portfolioPositions
    ? new Set([...window._portfolioPositions.keys()])
    : new Set();
  const overlaps = topList.filter(h => portfolioTickers.has(h.ticker));
  const overlapHTML = overlaps.length > 0 ? `
    <div class="adp-section-title" style="margin-top:14px;color:#7c3aed">Sobreposição com Carteira</div>
    <div style="font-size:.73rem;color:var(--muted-foreground);margin-bottom:6px">
      Holdings deste ETF que também tens em carteira direta:
    </div>
    <div class="adp-holdings-list" style="background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.2);border-radius:8px;padding:6px 8px;">
      ${overlaps.map(h => {
        const pos = window._portfolioPositions.get(h.ticker);
        const inv = pos?.investido > 0 ? new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(pos.investido) : null;
        return `
          <div class="adp-holding-row">
            <span class="adp-holding-ticker" style="color:#7c3aed">${h.ticker}</span>
            <span class="adp-holding-weight">${h.weight}% no ETF</span>
            ${inv ? `<span style="font-size:.72rem;color:var(--muted-foreground)">${inv} direto</span>` : "<span></span>"}
          </div>`;
      }).join("")}
    </div>` : "";

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
    ${overlapHTML}
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

function _priceRow(label, price, color = "var(--foreground)", qty = null, qtyLabel = "") {
  const fmtEUR = v => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v ?? 0);
  const qtyStr = qty !== null && qty > 0
    ? `<span style="font-size:.72rem;color:var(--muted-foreground);margin-left:6px">${qty % 1 === 0 ? qty : qty.toFixed(4)} ${qtyLabel}</span>`
    : "";
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:.82rem;padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--muted-foreground)">${label}</span>
      <span style="display:flex;align-items:center;gap:0">
        <span style="font-weight:700;color:${color}">${fmtEUR(price)}</span>
        ${qtyStr}
      </span>
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
