// js/screens/settings.js

// ⚠️ AJUSTA ESTE CAMINHO conforme a estrutura do teu projeto:
// - Se este ficheiro está em js/screens/, usa "../auth.js" (como abaixo).
// - Se estiver lado a lado com auth.js, usa "./auth.js".
import { doLogout } from "./auth.js";
import { db } from "../firebase-config.js";
import { doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { calculateLucroMaximoScore, getAssetType, normalizeSector, cleanTicker } from "../utils/scoring.js";
import { loadAlerts, addAlert, deleteAlert, resetAlert, requestNotificationPermission } from "../utils/alerts.js";
import { getMarketDataList } from "../utils/marketDataStore.js";
import { aggregatePortfolioPositions } from "../utils/portfolioPositions.js";
import { getAllRegimes, detectRegime, getRegime } from "../engines/macro.js";
import { DEFAULT_CRISIS_LADDER } from "../utils/capitalManager.js";

const SETTINGS_STORAGE_KEY = "app.settings";

const defaultSettings = {
  // Notificações
  emailNotifications: true,
  pushNotifications: false,
  weeklyReports: true,

  // Segurança
  twoFactor: false,
  loginNotifications: true,

  // Interface
  darkMode: false, // mantém compat com versões antigas
  language: "pt-PT",
  currency: "EUR",

  // Algoritmo Pesos
  weights: {
    R: 0.1,
    V: 0.2,
    T: 0.25,
    D: 0.2,
    E: 0.2,
    Rsk: 0.05,
  },
};

/* ---------------- helpers de storage ---------------- */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

/* ---------------- tema (light/dark) ---------------- */
function applyTheme(dark) {
  const mode = dark ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", mode);

  // atualizar theme-color do mobile (opcional)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0b0e13" : "#ffffff";

  // notificar a app inteira (outros screens podem ouvir este evento)
  window.dispatchEvent(
    new CustomEvent("app:theme-changed", { detail: { dark } }),
  );
}

/* ---------------- init do screen ---------------- */
export function initScreen() {
  // ⚠️ NUNCA fazer querySelector/getElementById fora do initScreen,
  // porque o HTML do screen só existe depois da navegação injetar o markup.

  // --- Modal "Como usar / configurar" (independente de dados do Firestore) ---
  const btnShowHowToUse = document.getElementById("btnShowHowToUse");
  const howToUseModal = document.getElementById("howToUseModal");
  const howToUseModalClose = document.getElementById("howToUseModalClose");
  const howToUseModalOk = document.getElementById("howToUseModalOk");
  if (btnShowHowToUse && howToUseModal) {
    btnShowHowToUse.addEventListener("click", () => howToUseModal.classList.remove("hidden"));
    howToUseModalClose?.addEventListener("click", () => howToUseModal.classList.add("hidden"));
    howToUseModalOk?.addEventListener("click", () => howToUseModal.classList.add("hidden"));
  }

  // Elementos
  const elLanguage = document.getElementById("cfgLanguage");
  const elCurrency = document.getElementById("cfgCurrency");
  const elDark = document.getElementById("cfgDarkMode");

  const elEmailN = document.getElementById("cfgEmailNotifications");
  const elPush = document.getElementById("cfgPushNotifications");
  const elWeekly = document.getElementById("cfgWeeklyReports");

  const el2FA = document.getElementById("cfgTwoFactor");
  const elLogin = document.getElementById("cfgLoginNotifications");

  const btnSave = document.getElementById("cfgSave");
  const btnCancel = document.getElementById("cfgCancel");
  const btnLogout = document.getElementById("btnLogout");

  const elAvailCash = document.getElementById("cfgAvailableCash");
  const elMonthlyBase = document.getElementById("cfgMonthlyBase");
  const elCashReserveSlider = document.getElementById("cfgCashReservePct");
  const elCashReserveNum    = document.getElementById("cfgCashReservePctNum");
  const valCashReservePct   = document.getElementById("valCashReservePct");
  const valCashReserveCalc  = document.getElementById("valCashReserveCalc");

  const elSingleStockCapPct = document.getElementById("cfgSingleStockCapPct");
  const elSectorConcentrationLimitPct = document.getElementById("cfgSectorConcentrationLimitPct");
  const elMinConfidencePct = document.getElementById("cfgMinConfidencePct");
  const elMacroRegime = document.getElementById("cfgMacroRegime");
  const elMacroRegimeSuggestion = document.getElementById("cfgMacroRegimeSuggestion");
  const elCrisisLadder = document.getElementById("cfgCrisisLadder");
  const elCrisisLadderError = document.getElementById("cfgCrisisLadderError");

  // Estratégia
  const elCoreW = document.getElementById("cfgCoreWeight");
  const elSatW = document.getElementById("cfgSatelliteWeight");
  const elAllocStocks = document.getElementById("cfgAllocStocks");
  const elAllocEtfs = document.getElementById("cfgAllocEtfs");
  const elAllocBonds = document.getElementById("cfgAllocBonds");
  const valAllocStocks = document.getElementById("valAllocStocks");
  const valAllocEtfs = document.getElementById("valAllocEtfs");
  const valAllocBonds = document.getElementById("valAllocBonds");
  const valAllocTotal = document.getElementById("valAllocTotal");
  const btnSaveAlloc = document.getElementById("btnSaveAlloc");
  const allocStatus = document.getElementById("cfgAllocStatus");

  const fmtEUR = (v) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v || 0);
  let currentPortfolioValue = 0;

  function cashShareText(cash, portfolioValue = currentPortfolioValue) {
    const total = Number(cash || 0) + Number(portfolioValue || 0);
    if (total <= 0) return "0.0% do total";
    return `${((Number(cash || 0) / total) * 100).toFixed(1)}% do total`;
  }

  function calculateAllocations() {
    const totalCash = Number(elAvailCash.value) || 0;
    const pStocks = Number(elAllocStocks.value) || 0;
    const pEtfs = Number(elAllocEtfs.value) || 0;
    const pBonds = Number(elAllocBonds.value) || 0;

    const totalPct = pStocks + pEtfs + pBonds;
    if (valAllocTotal) {
      valAllocTotal.textContent = `${totalPct}%`;
      valAllocTotal.style.color = totalPct === 100 ? "var(--success)" : "var(--destructive)";
    }

    if (valAllocStocks) valAllocStocks.textContent = fmtEUR(totalCash * (pStocks / 100));
    if (valAllocEtfs) valAllocEtfs.textContent = fmtEUR(totalCash * (pEtfs / 100));
    if (valAllocBonds) valAllocBonds.textContent = fmtEUR(totalCash * (pBonds / 100));
  }

  function updateCashReserveCalc() {
    const pct  = Number(elCashReserveSlider?.value || 0);
    const cash = Number(elAvailCash?.value || 0);
    const mon  = Number(elMonthlyBase?.value || 0);
    if (valCashReservePct) valCashReservePct.textContent = `${pct}%`;
    if (elCashReserveNum) elCashReserveNum.value = pct;
    if (valCashReserveCalc) {
      if (cash > 0) {
        const fmtEUR = v => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);
        const totalWithCash = currentPortfolioValue + cash;
        const targetCash = totalWithCash > 0 ? totalWithCash * (pct / 100) : 0;
        const gap = targetCash - cash;
        const gapText = Math.abs(gap) < 0.01
          ? "alinhado"
          : gap > 0
            ? `faltam ${fmtEUR(gap)}`
            : `excesso ${fmtEUR(Math.abs(gap))}`;
        valCashReserveCalc.textContent = `Reserva alvo: ${pct}% = ${fmtEUR(targetCash)} em cash · Cash atual: ${fmtEUR(cash)} (${cashShareText(cash)}) · ${gapText} · Aporte: ${fmtEUR(mon)}/mês`;
      } else {
        valCashReserveCalc.textContent = `Define primeiro a Liquidez Disponível para ver o cálculo.`;
      }
    }
  }

  if (elCashReserveSlider) {
    elCashReserveSlider.addEventListener("input", () => {
      if (elCashReserveNum) elCashReserveNum.value = elCashReserveSlider.value;
      updateCashReserveCalc();
    });
  }
  if (elCashReserveNum) {
    elCashReserveNum.addEventListener("input", () => {
      const v = Math.max(0, Math.min(30, Number(elCashReserveNum.value) || 0));
      if (elCashReserveSlider) elCashReserveSlider.value = v;
      updateCashReserveCalc();
    });
  }

  [elAvailCash, elAllocStocks, elAllocEtfs, elAllocBonds].forEach(el => {
    el?.addEventListener("input", calculateAllocations);
  });
  [elAvailCash, elMonthlyBase].forEach(el => el?.addEventListener("input", updateCashReserveCalc));

  if (elMacroRegime) {
    elMacroRegime.innerHTML = `<option value="">Selecione um regime</option>`;
    getAllRegimes().forEach(reg => {
      const opt = document.createElement("option");
      opt.value = reg.key;
      opt.textContent = `${reg.icon} ${reg.name}`;
      elMacroRegime.appendChild(opt);
    });
    elMacroRegime.addEventListener("change", renderMacroRegimeSuggestion);
  }

  // D9.5: sugestão de regime a partir do Painel de Risco (HY OAS/MOVE/VIX), sem
  // nunca substituir automaticamente a escolha do utilizador — apenas um atalho
  // "aplicar" quando os 3 indicadores confirmam stress em simultâneo.
  function renderMacroRegimeSuggestion() {
    if (!elMacroRegimeSuggestion || !elMacroRegime) return;
    let panelState = null;
    try {
      const raw = localStorage.getItem("appfinance-risk-panel-v1");
      if (raw) panelState = JSON.parse(raw)?.state || null;
    } catch { /* painel de risco sem dados válidos — sem sugestão */ }

    const hasPanelData = panelState && isFinite(panelState.hyoas) && isFinite(panelState.move) && isFinite(panelState.vix);
    if (!hasPanelData) { elMacroRegimeSuggestion.innerHTML = ""; return; }

    const suggested = detectRegime({ hyoas: panelState.hyoas, move: panelState.move, vix: panelState.vix });
    if (!suggested || suggested === elMacroRegime.value) { elMacroRegimeSuggestion.innerHTML = ""; return; }

    const reg = getRegime(suggested);
    elMacroRegimeSuggestion.innerHTML = `💡 Painel de Risco sugere <strong>${reg?.icon || ""} ${reg?.name || suggested}</strong> — <a href="#" id="cfgApplyMacroRegimeSuggestion" style="color: var(--primary);">aplicar</a>`;
    document.getElementById("cfgApplyMacroRegimeSuggestion")?.addEventListener("click", (e) => {
      e.preventDefault();
      elMacroRegime.value = suggested;
      renderMacroRegimeSuggestion();
    });
  }
  renderMacroRegimeSuggestion();

  Promise.all([
    getDocs(collection(db, "ativos")),
    getDocs(collection(db, "acoesDividendos"))
  ]).then(([ativosSnap, acoesSnap]) => {
    const priceMap = new Map();
    acoesSnap.forEach(docu => {
      const d = docu.data();
      const ticker = d.ticker ? cleanTicker(String(d.ticker).toUpperCase().trim()) : "";
      const price = Number(d.valorStock || d.price || d.precoAtual || 0);
      if (ticker && price > 0) priceMap.set(ticker, price);
    });
    const { openPositions } = aggregatePortfolioPositions(ativosSnap);
    currentPortfolioValue = openPositions.reduce((sum, p) => {
      const ticker = cleanTicker(String(p.ticker || "").toUpperCase().trim());
      const price = priceMap.get(ticker) || Number(p.custoMedio || 0);
      return sum + Number(p.qtd || 0) * price;
    }, 0);
    updateCashReserveCalc();
  }).catch(err => console.warn("settings: erro ao calcular percentagem de cash", err));

  if (elCoreW && elSatW) {
    elCoreW.addEventListener("input", () => {
       const v = Number(elCoreW.value);
       if (v <= 100 && v >= 0) elSatW.value = 100 - v;
    });
    elSatW.addEventListener("input", () => {
       const v = Number(elSatW.value);
       if (v <= 100 && v >= 0) elCoreW.value = 100 - v;
    });
    
    // Load Strategy from Firebase (single read for class + sector allocations)
    getDoc(doc(db, "config", "strategy")).then(snap => {
       if (snap.exists()) {
          const d = snap.data();
          if (typeof d.coreWeight === "number") elCoreW.value = d.coreWeight;
          if (typeof d.satelliteWeight === "number") elSatW.value = d.satelliteWeight;
          if (typeof d.availableCash === "number") elAvailCash.value = d.availableCash;
          if (typeof d.monthlyBase === "number") elMonthlyBase.value = d.monthlyBase;
          if (typeof d.cashReservePct === "number") {
            if (elCashReserveSlider) elCashReserveSlider.value = d.cashReservePct;
            if (elCashReserveNum)    elCashReserveNum.value    = d.cashReservePct;
          }
          if (typeof d.singleStockCapPct === "number" && elSingleStockCapPct) elSingleStockCapPct.value = d.singleStockCapPct;
          if (typeof d.sectorConcentrationLimitPct === "number" && elSectorConcentrationLimitPct) elSectorConcentrationLimitPct.value = d.sectorConcentrationLimitPct;
          if (typeof d.minConfidencePct === "number" && elMinConfidencePct) elMinConfidencePct.value = d.minConfidencePct;
          if (typeof d.macroRegime === "string" && elMacroRegime) elMacroRegime.value = d.macroRegime;
          renderMacroRegimeSuggestion();
          if (Array.isArray(d.crisisLadder) && elCrisisLadder) elCrisisLadder.value = JSON.stringify(d.crisisLadder, null, 2);
          else if (elCrisisLadder) elCrisisLadder.value = JSON.stringify(DEFAULT_CRISIS_LADDER, null, 2);
          updateCashReserveCalc();
          
          if (typeof d.allocStocks === "number") elAllocStocks.value = d.allocStocks;
          if (typeof d.allocEtfs === "number") elAllocEtfs.value = d.allocEtfs;
          if (typeof d.allocBonds === "number") elAllocBonds.value = d.allocBonds;
          
          // Also load sector allocations from the same snapshot
          const savedSectors = d.sectorAlloc || {};
          SECTORS.forEach(s => {
            if (typeof savedSectors[s.key] === "number") {
              const range = document.getElementById(s.id);
              const numEl = document.getElementById(s.id + "Num");
              if (range) range.value = savedSectors[s.key];
              if (numEl) numEl.value = savedSectors[s.key];
            }
          });
          
          calculateAllocations();
          updateSectorUI();
       }
    }).catch(e => console.error("Strategy load err:", e));

    if (btnSaveAlloc) {
      btnSaveAlloc.addEventListener("click", async () => {
        const origHTML = btnSaveAlloc.innerHTML;
        btnSaveAlloc.disabled = true;
        btnSaveAlloc.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A guardar...`;
        try {
          // --- Alocação por Classe ---
          const classPayload = {
            allocStocks: Number(elAllocStocks.value),
            allocEtfs: Number(elAllocEtfs.value),
            allocBonds: Number(elAllocBonds.value),
            availableCash: Number(elAvailCash.value),
            monthlyBase: Number(elMonthlyBase.value),
            cashReservePct: Number(elCashReserveSlider?.value || 0),
            singleStockCapPct: Number(elSingleStockCapPct?.value || 10),
            sectorConcentrationLimitPct: Number(elSectorConcentrationLimitPct?.value || 35),
            minConfidencePct: Number(elMinConfidencePct?.value || 50),
            macroRegime: elMacroRegime?.value || "high_rates"
          };
          let crisisLadderError = "";
          if (elCrisisLadder) {
            if (elCrisisLadderError) elCrisisLadderError.textContent = "";
            try {
              const parsed = JSON.parse(elCrisisLadder.value);
              if (Array.isArray(parsed)) classPayload.crisisLadder = parsed;
              else crisisLadderError = "Crisis Ladder tem de ser um array JSON — mantido o valor anterior.";
            } catch (err) {
              crisisLadderError = "Crisis Ladder: JSON inválido — mantido o valor anterior (restante configuração foi guardada).";
              console.warn("Invalid crisis ladder JSON, preserving existing config", err);
            }
            if (crisisLadderError && elCrisisLadderError) elCrisisLadderError.textContent = crisisLadderError;
          }

          // --- Alocação por Setor ---
          const sectorAlloc = {};
          SECTORS.forEach(s => {
            const range = document.getElementById(s.id);
            sectorAlloc[s.key] = Number(range?.value || 0);
          });

          // --- Estilo de Investimento ---
          const styleAlloc = {};
          STYLES.forEach(s => {
            styleAlloc[s.key] = Number(document.getElementById(s.id)?.value || 0);
          });

          await setDoc(doc(db, "config", "strategy"), {
            ...classPayload,
            sectorAlloc,
            styleAlloc
          }, { merge: true });

          if (allocStatus) {
            allocStatus.textContent = crisisLadderError
              ? "⚠️ Estratégia guardada, exceto o Crisis Ladder (ver aviso acima)."
              : "✅ Estratégia completa guardada!";
            allocStatus.style.color = crisisLadderError ? "var(--destructive)" : "var(--success)";
            setTimeout(() => { allocStatus.textContent = ""; }, 4000);
          }
          if (window.showToast) window.showToast(crisisLadderError ? "Estratégia guardada, Crisis Ladder ignorado (JSON inválido)" : "Estratégia guardada! ✅");
        } catch(err) {
          if (allocStatus) {
            allocStatus.textContent = "Erro ao guardar";
            allocStatus.style.color = "var(--destructive)";
          }
          console.error(err);
        }
        btnSaveAlloc.disabled = false;
        btnSaveAlloc.innerHTML = origHTML;
      });
    }

    const SECTORS = [
      { key: "tech",       id: "cfgSectorTech",       valId: "valSectorTech",       color: "#6366f1", dbName: "Tecnologia" },
      { key: "health",     id: "cfgSectorHealth",     valId: "valSectorHealth",     color: "#ec4899", dbName: "Saúde" },
      { key: "fin",        id: "cfgSectorFin",        valId: "valSectorFin",        color: "#3b82f6", dbName: "Financeiros" },
      { key: "energy",     id: "cfgSectorEnergy",     valId: "valSectorEnergy",     color: "#f59e0b", dbName: "Energia" },
      { key: "cyclical",   id: "cfgSectorCyclical",   valId: "valSectorCyclical",   color: "#f97316", dbName: "Consumo Cíclico" },
      { key: "defensive",  id: "cfgSectorDefensive",  valId: "valSectorDefensive",  color: "#22c55e", dbName: "Consumo Defensivo" },
      { key: "industrial", id: "cfgSectorIndustrial", valId: "valSectorIndustrial", color: "#14b8a6", dbName: "Industriais" },
      { key: "materials",  id: "cfgSectorMaterials",  valId: "valSectorMaterials",  color: "#84cc16", dbName: "Materiais" },
      { key: "reits",      id: "cfgSectorReits",      valId: "valSectorReits",      color: "#a78bfa", dbName: "Imobiliário" },
    ];

    function updateSectorUI() {
      const totalCash = Number(elAvailCash?.value) || 0;
      let total = 0;

      SECTORS.forEach(s => {
        const range = document.getElementById(s.id);
        const numEl = document.getElementById(s.id + "Num");
        const valEl = document.getElementById(s.valId);
        const pct = Number(range?.value || 0);
        total += pct;

        // Update range fill color
        if (range) {
          const fill = (pct / 40) * 100;
          range.style.background = `linear-gradient(to right, ${s.color} ${fill}%, var(--border) ${fill}%)`;
        }

        // Update EUR value
        if (valEl) {
          if (totalCash > 0) {
            valEl.textContent = fmtEUR(totalCash * (pct / 100));
          } else {
            valEl.textContent = `${pct}%`;
          }
        }
      });

      // Update total label
      const totalEl = document.getElementById("valSectorTotal");
      if (totalEl) {
        totalEl.textContent = `${total}%`;
        totalEl.style.color = total <= 100 ? "var(--success)" : "var(--destructive)";
      }

      // Update segmented progress bar
      const bar = document.getElementById("sectorTotalBar");
      if (bar && total > 0) {
        bar.innerHTML = SECTORS.map(s => {
          const range = document.getElementById(s.id);
          const pct = Number(range?.value || 0);
          const width = (pct / Math.max(total, 100)) * 100;
          return pct > 0 ? `<div style="flex: ${pct}; background: ${s.color}; border-radius: 3px; min-width: 2px; transition: flex 0.3s;"></div>` : "";
        }).join("");
      } else if (bar) {
        bar.innerHTML = "";
      }
    }

    // Wire range <-> number inputs bidirectionally
    SECTORS.forEach(s => {
      const range = document.getElementById(s.id);
      const numEl = document.getElementById(s.id + "Num");

      range?.addEventListener("input", () => {
        if (numEl) numEl.value = range.value;
        updateSectorUI();
      });

      numEl?.addEventListener("input", () => {
        const v = Math.min(40, Math.max(0, Number(numEl.value) || 0));
        numEl.value = v;
        if (range) range.value = v;
        updateSectorUI();
      });
    });

    // Also update sectors when cash changes
    elAvailCash?.addEventListener("input", updateSectorUI);

    // Initial sector UI render (data already loaded from single getDoc above)
    updateSectorUI();

    // Save sectors button
    const btnSaveSectors = document.getElementById("btnSaveSectors");
    const sectorStatus = document.getElementById("cfgSectorStatus");
    btnSaveSectors?.addEventListener("click", async () => {
      btnSaveSectors.disabled = true;
      btnSaveSectors.textContent = "...";
      try {
        const sectorAlloc = {};
        SECTORS.forEach(s => {
          const range = document.getElementById(s.id);
          sectorAlloc[s.key] = Number(range?.value || 0);
        });
        await setDoc(doc(db, "config", "strategy"), { sectorAlloc }, { merge: true });
        if (sectorStatus) {
          sectorStatus.textContent = "Setores guardados! ✅";
          sectorStatus.style.color = "var(--success)";
          setTimeout(() => { sectorStatus.textContent = ""; }, 3000);
        }
      } catch (err) {
        console.error(err);
        if (sectorStatus) {
          sectorStatus.textContent = "Erro ao guardar";
          sectorStatus.style.color = "var(--destructive)";
        }
      }
      btnSaveSectors.disabled = false;
      btnSaveSectors.textContent = "Guardar Setores";
    });

    // --- LÓGICA DE ESTILOS ---
    const STYLES = [
      { key: "growth", id: "cfgStyleGrowth", valId: "valStyleGrowth" },
      { key: "value",  id: "cfgStyleValue",  valId: "valStyleValue" },
      { key: "div",    id: "cfgStyleDiv",    valId: "valStyleDiv" },
      { key: "qual",   id: "cfgStyleQual",   valId: "valStyleQual" },
    ];

    function updateStyleUI() {
      let total = 0;
      STYLES.forEach(s => {
        const range = document.getElementById(s.id);
        const valEl = document.getElementById(s.valId);
        const val = Number(range?.value || 0);
        total += val;
        if (valEl) valEl.textContent = `${val}%`;
        
        // Dynamic track color
        if (range) {
          const accent = range.style.getPropertyValue("--accent") || "#4f46e5";
          range.style.background = `linear-gradient(to right, ${accent} ${val}%, var(--border) ${val}%)`;
        }
      });

      const totalEl = document.getElementById("valStyleTotal");
      if (totalEl) {
        totalEl.textContent = `${total}%`;
        totalEl.style.color = total === 100 ? "var(--success)" : "var(--destructive)";
      }
    }

    STYLES.forEach(s => {
      document.getElementById(s.id)?.addEventListener("input", updateStyleUI);
    });

    // Load styles from Firestore (in the main getDoc)
    getDoc(doc(db, "config", "strategy")).then(snap => {
       if (snap.exists()) {
          const d = snap.data();
          const savedStyles = d.styleAlloc || {};
          STYLES.forEach(s => {
            if (typeof savedStyles[s.key] === "number") {
              const el = document.getElementById(s.id);
              if (el) el.value = savedStyles[s.key];
            }
          });
          updateStyleUI();
       }
    }).catch(() => {});

    updateStyleUI();

    // Local save for styles
    const btnSaveStyle = document.getElementById("btnSaveStyle");
    btnSaveStyle?.addEventListener("click", async () => {
      btnSaveStyle.disabled = true;
      btnSaveStyle.textContent = "...";
      try {
        const styleAlloc = {};
        STYLES.forEach(s => {
          styleAlloc[s.key] = Number(document.getElementById(s.id)?.value || 0);
        });
        await setDoc(doc(db, "config", "strategy"), { styleAlloc }, { merge: true });
        if (window.showToast) window.showToast("Perfil de Estilo guardado! ✅");
      } catch (err) {
        console.error(err);
      }
      btnSaveStyle.disabled = false;
      btnSaveStyle.textContent = "Guardar Perfil de Estilo";
    });

    // --- LOGICA DO PORTFÓLIO SUGERIDO ---
    const btnShowSuggested = document.getElementById("btnShowSuggested");
    const sugModal = document.getElementById("suggestedPortfolioModal");
    const sugClose = document.getElementById("suggestedModalClose");
    const sugOk = document.getElementById("suggestedModalOk");
    const sugLoader = document.getElementById("suggestedLoader");
    const sugContent = document.getElementById("suggestedContent");
    const sugTableBody = document.getElementById("suggestedTableBody");

    let chartClass = null;
    let chartSector = null;

    async function showSuggestedPortfolio() {
      if (!sugModal) return;
      sugModal.classList.remove("hidden");
      sugLoader.classList.remove("hidden");
      sugContent.classList.add("hidden");

      // Destruir gráficos anteriores se existirem
      if (chartClass) { chartClass.destroy(); chartClass = null; }
      if (chartSector) { chartSector.destroy(); chartSector = null; }

      let count = 0;
      let classData = { Stocks: 0, ETFs: 0, Bonds: 0 };
      let sectorData = {};
      let html = "";

      try {
        const allData = await getMarketDataList();

        const totalCash = Number(elAvailCash.value) || 0;
        const targets = {
          stock: Number(elAllocStocks.value) || 0,
          etf: Number(elAllocEtfs.value) || 0,
          bond: Number(elAllocBonds.value) || 0
        };

        // 1. Calcular Pesos dos Setores Definidos
        const userSectors = {};
        let totalSectorWeight = 0;
        SECTORS.forEach(s => {
          const val = Number(document.getElementById(s.id)?.value || 0);
          if (val > 0) {
            userSectors[s.dbName] = val;
            totalSectorWeight += val;
          }
        });

        // Mapeamento de nomes reais da BD → nomes dos setores definidos pelo utilizador
        const SECTOR_ALIASES = {
          "Technology": "Tecnologia", "Tecnologia": "Tecnologia", "Tech": "Tecnologia",
          "Healthcare": "Saúde", "Saúde": "Saúde", "Health Care": "Saúde", "Biotechnology": "Saúde",
          "Financial Services": "Financeiros", "Financeiros": "Financeiros", "Financials": "Financeiros", "Banks": "Financeiros", "Insurance": "Financeiros",
          "Energy": "Energia", "Energia": "Energia", "Oil & Gas": "Energia", "Utilities": "Energia",
          "Consumer Cyclical": "Consumo Cíclico", "Consumo Cíclico": "Consumo Cíclico", "Cyclical": "Consumo Cíclico", "Luxury": "Consumo Cíclico", "Automotive": "Consumo Cíclico",
          "Consumer Defensive": "Consumo Defensivo", "Consumo Defensivo": "Consumo Defensivo", "Consumer Staples": "Consumo Defensivo", "Defensive": "Consumo Defensivo", "Food": "Consumo Defensivo",
          "Industrials": "Industriais", "Industriais": "Industriais", "Industrial": "Industriais", "Aerospace": "Industriais",
          "Basic Materials": "Materiais", "Materiais": "Materiais", "Materials": "Materiais", "Mining": "Materiais", "Chemicals": "Materiais",
          "Real Estate": "Imobiliário", "Imobiliário": "Imobiliário", "REITs": "Imobiliário", "Real Estate Investment Trusts": "Imobiliário",
          "Communication Services": "Tecnologia", "Telecom": "Tecnologia",
        };

        // 1.2 Calcular Pesos de Estilo
        const userStyles = {
          growth: (Number(document.getElementById("cfgStyleGrowth")?.value) || 25) / 100,
          value:  (Number(document.getElementById("cfgStyleValue")?.value) || 25) / 100,
          div:    (Number(document.getElementById("cfgStyleDiv")?.value) || 25) / 100,
          qual:   (Number(document.getElementById("cfgStyleQual")?.value) || 25) / 100,
        };

        // userStyles está em escala 0–1; styleToMultipliers (chamado internamente) espera 0–100
        const styleAllocScaled = {
          growth: userStyles.growth * 100,
          value:  userStyles.value  * 100,
          div:    userStyles.div    * 100,
          qual:   userStyles.qual   * 100,
        };

        const scored = allData.map(d => {
          const res = calculateLucroMaximoScore(d, "1m", styleAllocScaled);
          let type = getAssetType(d.ticker, d);
          const nomeU = String(d.nome || "").toUpperCase();
          if (nomeU.includes("BOND") || nomeU.includes("OBRIGA") || nomeU.includes("TREASURY")) {
            type = "bond";
          }
          const rawSector = normalizeSector(d);
          const mappedSector = SECTOR_ALIASES[rawSector] || rawSector;
          return { ...d, score: res.score, rAnnual: res.rAnnual, type, sector: mappedSector, rawSector };
        });

        let selectedAssets = [];

        // 2. Alocação por Classe
        // ETFs e Bonds mantêm lógica simplificada (Top 5)
        const groups = {
          etf: scored.filter(s => s.type === "etf").sort((a, b) => b.score - a.score).slice(0, 5),
          bond: scored.filter(s => s.type === "bond").sort((a, b) => b.score - a.score).slice(0, 5)
        };

        // 3. Alocação Estratégica de STOCKS por SETOR
        const stockTotalCash = totalCash * (targets.stock / 100);
        if (stockTotalCash > 0) {
          if (totalSectorWeight > 0) {
            // Seguir pesos do utilizador
            for (const [sName, sWeight] of Object.entries(userSectors)) {
              const sectorCash = stockTotalCash * (sWeight / totalSectorWeight);
              const bestInSector = scored
                .filter(a => a.type === "stock" && a.sector === sName)
                .sort((a, b) => b.score - a.score)
                .slice(0, 2); // 2 melhores de cada setor
              
              if (bestInSector.length > 0) {
                const cashPerAsset = sectorCash / bestInSector.length;
                bestInSector.forEach(item => {
                  selectedAssets.push({ ...item, allocation: cashPerAsset, cat: "stock" });
                });
              }
            }
          } else {
            // Fallback: Top 5 Stocks geral
            const topStocks = scored.filter(s => s.type === "stock").sort((a, b) => b.score - a.score).slice(0, 5);
            const cashPerStock = stockTotalCash / (topStocks.length || 1);
            topStocks.forEach(item => {
              selectedAssets.push({ ...item, allocation: cashPerStock, cat: "stock" });
            });
          }
        }

        // 4. Adicionar ETFs e Bonds
        ["etf", "bond"].forEach(cat => {
          const catCash = totalCash * (targets[cat] / 100);
          if (catCash > 0 && groups[cat].length > 0) {
            const cashPerAsset = catCash / groups[cat].length;
            groups[cat].forEach(item => {
              selectedAssets.push({ ...item, allocation: cashPerAsset, cat });
            });
          }
        });

        let totalScore = 0;
        let totalYield = 0;
        let totalGrowth = 0;
        let sumPE = 0, sumROIC = 0, sumDebtEq = 0, countFundamental = 0;

        selectedAssets.forEach(item => {
          const pctOfTotal = (item.allocation / totalCash) * 100;
          const y = Number(item.yield) || 0;
          const g = Number(item.rAnnual) || 0;
          
          // Fundamental metrics for snapshot
          if (item.cat === "stock") {
            const pe = Number(item.pe || item.p_e || 0);
            const roic = Number(item.roic || 0);
            const de = Number(item.debt_eq || 0);
            if (pe > 0) sumPE += pe;
            if (roic > 0) sumROIC += roic;
            if (de > 0) sumDebtEq += de;
            countFundamental++;
          }

          // Dados para gráficos
          const clsName = item.cat === "stock" ? "Stocks" : item.cat === "etf" ? "ETFs" : "Bonds";
          classData[clsName] += item.allocation;
          
          const sector = item.setor || item.sector || "Outros";
          sectorData[sector] = (sectorData[sector] || 0) + item.allocation;

          html += `
            <tr style="border-bottom: 1px solid var(--border);">
              <td style="padding: 10px;">
                <div style="font-weight: 700;">${item.ticker}</div>
                <div class="muted" style="font-size: 0.65rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;">
                  ${item.nome || item.ticker}
                </div>
              </td>
              <td><span class="badge" style="background: var(--muted); color: var(--foreground); font-size: 0.6rem;">${item.cat.toUpperCase()}</span></td>
              <td style="font-size: 0.7rem; color: var(--muted-foreground);">${sector}</td>
              <td style="text-align: right; font-weight: 700;">${fmtEUR(item.allocation)}</td>
              <td style="text-align: right; color: var(--muted-foreground);">${pctOfTotal.toFixed(1)}%</td>
              <td style="text-align: right;">
                <span class="badge ${item.score > 0.7 ? "ok" : item.score > 0.5 ? "warn" : "danger"}">
                  ${(item.score * 10).toFixed(1)}
                </span>
              </td>
            </tr>
          `;
          totalScore += item.score;
          totalYield += y;
          totalGrowth += g;
          count++;
        });

        sugTableBody.innerHTML = html || '<tr><td colspan="6" style="text-align:center; padding:30px;" class="muted">Sem dados suficientes.</td></tr>';
        
        const avgGrowth = count > 0 ? (totalGrowth / count) : 0;
        const avgYield = count > 0 ? (totalYield / count) : 0;

        document.getElementById("sugTotalCapital").textContent = fmtEUR(totalCash);
        document.getElementById("sugAvgScore").textContent = count > 0 ? (totalScore / count * 10).toFixed(1) : "0.0";
        document.getElementById("sugEstYield").textContent = avgYield.toFixed(2) + "%";
        document.getElementById("sugAvgGrowth").textContent = (avgGrowth * 100).toFixed(2) + "%";

        // Update fundamental highlights
        if (countFundamental > 0) {
          const elPE = document.querySelector("#metPE span");
          const elROIC = document.querySelector("#metROIC span");
          const elSolv = document.querySelector("#metSolv span");
          const elDiv = document.querySelector("#metDiv span");
          if (elPE) elPE.textContent = (sumPE / countFundamental).toFixed(1) + "x";
          if (elROIC) elROIC.textContent = (sumROIC / countFundamental * 100).toFixed(1) + "%";
          if (elSolv) elSolv.textContent = (sumDebtEq / countFundamental).toFixed(2);
          if (elDiv) elDiv.textContent = avgYield.toFixed(1) + "%";
        }

        // Projeções ...
        const rTotal = avgGrowth + (avgYield / 100);
        const proj = (years) => totalCash * Math.pow(1 + rTotal, years);

        const updateProj = (id, years) => {
          const val = proj(years);
          const profit = val - totalCash;
          const el = document.getElementById(id);
          if (el) {
            el.innerHTML = `
              <div>${fmtEUR(val)}</div>
              <div style="font-size: 0.65rem; color: var(--success); margin-top: 2px;">
                +${fmtEUR(profit)} Lucro
              </div>
            `;
          }
        };

        updateProj("proj1y", 1);
        updateProj("proj3y", 3);
        updateProj("proj5y", 5);

      } catch (err) {
        console.error("Error generating suggestion:", err);
      } finally {
        // Garantir que a roda de loading desaparece SEMPRE
        if (sugLoader) sugLoader.classList.add("hidden");
        if (sugContent) sugContent.classList.remove("hidden");
      }

      // Criar Gráficos (atraso maior para garantir renderização estável)
      setTimeout(() => {
        try {
          const canvasClass = document.getElementById("chartSugClass");
          const canvasSector = document.getElementById("chartSugSector");

          if (!canvasClass || !canvasSector) return;

          // Forçar redimensionamento para evitar canvas com tamanho 0
          window.dispatchEvent(new Event('resize'));

          if (typeof Chart !== "undefined" && count > 0) {
            chartClass = new Chart(canvasClass, {
              type: "doughnut",
              data: {
                labels: Object.keys(classData).filter(k => classData[k] > 0),
                datasets: [{
                  data: Object.values(classData).filter(v => v > 0),
                  backgroundColor: ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"],
                  borderWidth: 2,
                  borderColor: "rgba(255,255,255,0.1)"
                }]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "70%",
                animation: { duration: 1000, easing: 'easeOutQuart' },
                plugins: { 
                  legend: { 
                    position: "bottom", 
                    labels: { color: "#888", font: { size: 10, weight: "bold" }, padding: 15 } 
                  } 
                }
              }
            });

            chartSector = new Chart(canvasSector, {
              type: "pie",
              data: {
                labels: Object.keys(sectorData),
                datasets: [{
                  data: Object.values(sectorData),
                  backgroundColor: ["#6366f1", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#ef4444", "#06b6d4"],
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.1)"
                }]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 1200, easing: 'easeOutQuart' },
                plugins: { 
                  legend: { display: false } 
                }
              }
            });
          }
        } catch (chartErr) {
          console.error("Chart.js Error:", chartErr);
        }
      }, 500);
    }

    if (btnShowSuggested) btnShowSuggested.addEventListener("click", showSuggestedPortfolio);
    if (sugClose) sugClose.addEventListener("click", () => sugModal.classList.add("hidden"));
    if (sugOk) sugOk.addEventListener("click", () => sugModal.classList.add("hidden"));
    if (sugModal) sugModal.addEventListener("click", (e) => { if (e.target === sugModal) sugModal.classList.add("hidden"); });
  }

  // Botões de Perfil
  const btnProfCons = document.getElementById("btnProfCons");
  const btnProfMod = document.getElementById("btnProfMod");
  const btnProfAgre = document.getElementById("btnProfAgre");

  const WEIGHT_PRESETS = {
    conservador: { R: 0.05, V: 0.25, T: 0.1, D: 0.35, E: 0.2, Rsk: 0.05 },
    moderado: { R: 0.1, V: 0.2, T: 0.25, D: 0.2, E: 0.2, Rsk: 0.05 },
    agressivo: { R: 0.3, V: 0.15, T: 0.3, D: 0.05, E: 0.15, Rsk: 0.05 },
  };

  // Pesos
  const weightsUI = {
    R: {
      el: document.getElementById("cfgWeightR"),
      val: document.getElementById("valR"),
    },
    V: {
      el: document.getElementById("cfgWeightV"),
      val: document.getElementById("valV"),
    },
    T: {
      el: document.getElementById("cfgWeightT"),
      val: document.getElementById("valT"),
    },
    D: {
      el: document.getElementById("cfgWeightD"),
      val: document.getElementById("valD"),
    },
    E: {
      el: document.getElementById("cfgWeightE"),
      val: document.getElementById("valE"),
    },
    Rsk: {
      el: document.getElementById("cfgWeightRsk"),
      val: document.getElementById("valRsk"),
    },
  };

  if (!elLanguage || !elCurrency || !elDark || !btnSave || !btnCancel) {
    console.warn(
      "⚠️ settings.js: elementos não encontrados. Confirma o HTML dos IDs.",
    );
    return;
  }

  // --- LÓGICA DE ABAS (TABS) ---
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabSections = document.querySelectorAll(".settings-section");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      
      // Update buttons
      tabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      // Update sections
      tabSections.forEach(sec => {
        sec.classList.remove("active");
        if (sec.id === target) sec.classList.add("active");
      });
    });
  });

  // 🔒 Logout — liga AQUI (agora o botão existe no DOM)
  if (btnLogout) {
    btnLogout.addEventListener("click", (e) => {
      e.preventDefault();
      doLogout(); // exportado do auth.js
    });
  }

  // Carrega estado atual (se não houver, segue sistema e grava já)
  let state = loadSettings();
  if (!("darkMode" in state)) {
    state.darkMode =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    saveSettings(state);
  }

  // Preenche UI
  elLanguage.value = state.language;
  elCurrency.value = state.currency;
  elDark.checked = !!state.darkMode;

  if (elEmailN) elEmailN.checked = !!state.emailNotifications;
  if (elPush) elPush.checked = !!state.pushNotifications;
  if (elWeekly) elWeekly.checked = !!state.weeklyReports;
  if (el2FA) el2FA.checked = !!state.twoFactor;
  if (elLogin) elLogin.checked = !!state.loginNotifications;

  // Preenche Pesos (0-10 scale para o utilizador, 0-1 interno)
  const elTotalWeight = document.getElementById("valTotalWeight");
  const updateWeightsUI = () => {
    let sum = 0;
    Object.keys(weightsUI).forEach((k) => {
      const item = weightsUI[k];
      if (item.el) {
        const val = (state.weights[k] || 0) * 10;
        item.el.value = val;
        if (item.val) item.val.textContent = val.toFixed(1);
        sum += val;
      }
    });
    if (elTotalWeight) elTotalWeight.textContent = sum.toFixed(1);
  };

  updateWeightsUI();

  // Aplica tema no arranque deste screen
  applyTheme(!!state.darkMode);

  // Listeners (atualizam o estado em memória)
  elLanguage.addEventListener("change", () => {
    state.language = elLanguage.value;
  });
  elCurrency.addEventListener("change", () => {
    state.currency = elCurrency.value;
  });
  elDark.addEventListener("change", () => {
    state.darkMode = !!elDark.checked;
    applyTheme(state.darkMode); // aplica imediatamente
  });

  elEmailN?.addEventListener("change", () => {
    state.emailNotifications = !!elEmailN.checked;
  });
  elPush?.addEventListener("change", () => {
    state.pushNotifications = !!elPush.checked;
  });
  elWeekly?.addEventListener("change", () => {
    state.weeklyReports = !!elWeekly.checked;
  });

  el2FA?.addEventListener("change", () => {
    state.twoFactor = !!el2FA.checked;
  });
  elLogin?.addEventListener("change", () => {
    state.loginNotifications = !!elLogin.checked;
  });

  // Lógica de Redistribuição Proporcional
  function redistribute(changedKey, newValue) {
    const keys = Object.keys(weightsUI);
    const otherKeys = keys.filter((k) => k !== changedKey);
    const targetTotal = 10;

    state.weights[changedKey] = newValue / 10;
    const remaining = targetTotal - newValue;
    const currentOthersSum = otherKeys.reduce(
      (s, k) => s + state.weights[k] * 10,
      0,
    );

    if (currentOthersSum > 0.01) {
      const ratio = remaining / currentOthersSum;
      otherKeys.forEach((k) => {
        state.weights[k] = state.weights[k] * ratio;
      });
    } else {
      const equalShare = remaining / otherKeys.length;
      otherKeys.forEach((k) => {
        state.weights[k] = equalShare / 10;
      });
    }

    keys.forEach((k) => {
      if (state.weights[k] < 0) state.weights[k] = 0;
    });

    const finalSum = keys.reduce((s, k) => s + state.weights[k], 0);
    const diff = 1.0 - finalSum;
    if (Math.abs(diff) > 0.0001) {
      const adjKey = otherKeys.sort(
        (a, b) => state.weights[b] - state.weights[a],
      )[0];
      state.weights[adjKey] = Math.max(0, state.weights[adjKey] + diff);
    }
    updateWeightsUI();
  }

  // Listeners Pesos
  Object.keys(weightsUI).forEach((k) => {
    const item = weightsUI[k];
    item.el?.addEventListener("input", () => {
      redistribute(k, parseFloat(item.el.value));
    });
  });

  // Listeners Perfis
  const applyPreset = (id) => {
    const p = WEIGHT_PRESETS[id];
    if (!p) return;
    state.weights = { ...p };
    updateWeightsUI();
  };
  btnProfCons?.addEventListener("click", () => applyPreset("conservador"));
  btnProfMod?.addEventListener("click", () => applyPreset("moderado"));
  btnProfAgre?.addEventListener("click", () => applyPreset("agressivo"));

  // Botões
  btnSave.addEventListener("click", async () => {
    saveSettings(state);

    if (elCoreW && elSatW) {
      const origHTML = btnSave.innerHTML;
      btnSave.disabled = true;
      btnSave.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A guardar...`;
      try {
        const strategyPayload = {
          coreWeight: Number(elCoreW.value),
          satelliteWeight: Number(elSatW.value),
          availableCash: Number(elAvailCash.value),
          monthlyBase: Number(elMonthlyBase.value),
          allocStocks: Number(elAllocStocks.value),
          allocEtfs: Number(elAllocEtfs.value),
          allocBonds: Number(elAllocBonds.value),
          // Configuração de Risco e Regime (mesmos campos que "Guardar Estratégia" guarda —
          // este botão tem de os incluir também, senão fica sempre a desfazer o que o outro guardou).
          singleStockCapPct: Number(elSingleStockCapPct?.value || 10),
          sectorConcentrationLimitPct: Number(elSectorConcentrationLimitPct?.value || 35),
          minConfidencePct: Number(elMinConfidencePct?.value || 50),
          macroRegime: elMacroRegime?.value || "high_rates",
          sectorAlloc: (() => {
            const sa = {};
            const SECTOR_KEYS = ["tech","health","fin","energy","cyclical","defensive","industrial","materials","reits"];
            SECTOR_KEYS.forEach(k => {
              const el = document.getElementById(`cfgSector${k.charAt(0).toUpperCase() + k.slice(1)}`);
              sa[k] = Number(el?.value || 0);
            });
            return sa;
          })(),
          styleAlloc: (() => {
            const sta = {};
            const STYLE_KEYS = ["growth", "value", "div", "qual"];
            STYLE_KEYS.forEach(k => {
              const el = document.getElementById(`cfgStyle${k.charAt(0).toUpperCase() + k.slice(1).replace("Qual", "Qual").replace("Div", "Div")}`);
              // Special case for ID names
              let id = `cfgStyle${k.charAt(0).toUpperCase() + k.slice(1)}`;
              if (k === "div") id = "cfgStyleDiv";
              if (k === "qual") id = "cfgStyleQual";
              const input = document.getElementById(id);
              sta[k] = Number(input?.value || 0);
            });
            return sta;
          })()
        };

        let crisisLadderError = "";
        if (elCrisisLadder) {
          if (elCrisisLadderError) elCrisisLadderError.textContent = "";
          try {
            const parsed = JSON.parse(elCrisisLadder.value);
            if (Array.isArray(parsed)) strategyPayload.crisisLadder = parsed;
            else crisisLadderError = "Crisis Ladder tem de ser um array JSON — mantido o valor anterior.";
          } catch (err) {
            crisisLadderError = "Crisis Ladder: JSON inválido — mantido o valor anterior.";
          }
          if (crisisLadderError && elCrisisLadderError) elCrisisLadderError.textContent = crisisLadderError;
        }

        await setDoc(doc(db, "config", "strategy"), strategyPayload, { merge: true });

        if (window.showToast) window.showToast(crisisLadderError ? "Configurações guardadas, Crisis Ladder ignorado (JSON inválido)" : "Configurações guardadas!");
      } catch (err) {
        console.error("Strategy save error:", err);
        if (window.showToast) window.showToast("Erro ao guardar configurações — tenta novamente.", "warning");
      }
      btnSave.disabled = false;
      btnSave.innerHTML = origHTML;
    } else {
      if (window.showToast) window.showToast("Configurações guardadas!");
    }
  });

  btnCancel.addEventListener("click", () => {
    // Recarrega do storage e volta a preencher/Aplicar
    state = loadSettings();

    elLanguage.value = state.language;
    elCurrency.value = state.currency;
    elDark.checked = !!state.darkMode;

    if (elEmailN) elEmailN.checked = !!state.emailNotifications;
    if (elPush) elPush.checked = !!state.pushNotifications;
    if (elWeekly) elWeekly.checked = !!state.weeklyReports;

    if (el2FA) el2FA.checked = !!state.twoFactor;
    if (elLogin) elLogin.checked = !!state.loginNotifications;

    Object.keys(weightsUI).forEach((k) => {
      const item = weightsUI[k];
      if (item.el) {
        const val = (state.weights[k] || 0) * 10;
        item.el.value = val;
        if (item.val) item.val.textContent = val.toFixed(1);
      }
    });

    applyTheme(state.darkMode);
  });

  // ═══════════════════════════════════════════
  // 🔔 ALERTAS DE PORTFÓLIO
  // ═══════════════════════════════════════════
  (function wireAlerts() {
    const TYPE_LABELS = {
      preco_alvo:  { label: "Preco alvo (>=)",      unit: "EUR",  hasThreshold: false },
      preco_queda: { label: "Preco de queda (<=)",  unit: "EUR",  hasThreshold: false },
      rsi_compra:  { label: "RSI Sobrevenda (<=)",  unit: "RSI",  hasThreshold: false },
      rsi_venda:   { label: "RSI Sobrecompra (>=)", unit: "RSI",  hasThreshold: false },
      alocacao:    { label: "Desvio de Alocacao",   unit: "%",    hasThreshold: true  },
    };

    const btnAdd       = document.getElementById("btnAddAlert");
    const formWrap     = document.getElementById("alertFormWrap");
    const btnSave      = document.getElementById("btnSaveAlert");
    const btnCancel    = document.getElementById("btnCancelAlert");
    const alertsListEl = document.getElementById("alertsList");
    const selType      = document.getElementById("alertType");
    const inpTicker    = document.getElementById("alertTicker");
    const inpValue     = document.getElementById("alertValue");
    const inpThreshold = document.getElementById("alertThreshold");
    const lblValue     = document.getElementById("alertValueLabel");
    const threshWrap   = document.getElementById("alertThresholdWrap");
    const btnPerm      = document.getElementById("btnRequestNotifPerm");

    if (!btnAdd || !formWrap) return;

    function renderAlertsList() {
      const alerts = loadAlerts();
      if (!alerts.length) {
        alertsListEl.innerHTML = `<div class="muted" style="text-align:center;padding:20px;font-size:0.8rem;">Sem alertas configurados.</div>`;
        return;
      }
      alertsListEl.innerHTML = alerts.map(a => {
        const meta = TYPE_LABELS[a.type] || { label: a.type, unit: "" };
        const firedBadge = a.fired
          ? `<span style="background:#ef444420;color:#ef4444;border:1px solid #ef444440;font-size:0.6rem;padding:1px 6px;border-radius:4px;">DISPARADO</span>`
          : `<span style="background:#22c55e20;color:#22c55e;border:1px solid #22c55e40;font-size:0.6rem;padding:1px 6px;border-radius:4px;">ATIVO</span>`;
        const threshLine = a.threshold ? ` · tolerância ${a.threshold}%` : "";
        const firedLine  = a.fired && a.firedAt
          ? `<div class="muted" style="font-size:0.68rem;margin-top:3px;">Disparado: ${new Date(a.firedAt).toLocaleString("pt-PT")}</div>` : "";
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(var(--primary-rgb),0.03);border:1px solid var(--border);border-radius:8px;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-weight:700;font-size:0.82rem;">${a.ticker || "—"}</span>
                <span class="muted" style="font-size:0.72rem;">${meta.label}</span>
                <span style="font-size:0.72rem;">${Number(a.value).toFixed(a.type.startsWith("rsi") ? 0 : 2)} ${meta.unit}${threshLine}</span>
                ${firedBadge}
              </div>
              ${firedLine}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              ${a.fired ? `<button class="btn ghost" style="padding:4px 8px;font-size:0.7rem;" data-reset="${a.id}" title="Resetar"><i class="fas fa-redo-alt"></i></button>` : ""}
              <button class="btn ghost" style="padding:4px 8px;font-size:0.7rem;color:#ef4444;" data-delete="${a.id}" title="Apagar"><i class="fas fa-trash"></i></button>
            </div>
          </div>`;
      }).join("");

      alertsListEl.querySelectorAll("[data-delete]").forEach(btn =>
        btn.addEventListener("click", () => {
          deleteAlert(btn.dataset.delete);
          renderAlertsList();
        })
      );
      alertsListEl.querySelectorAll("[data-reset]").forEach(btn =>
        btn.addEventListener("click", () => {
          resetAlert(btn.dataset.reset);
          renderAlertsList();
          if (window.showToast) window.showToast("Alerta reativado!", "success");
        })
      );
    }

    function updateFormForType() {
      const meta = TYPE_LABELS[selType.value] || { unit: "€", hasThreshold: false };
      lblValue.textContent = `Valor (${meta.unit})`;
      threshWrap.style.display = meta.hasThreshold ? "block" : "none";
    }

    selType.addEventListener("change", updateFormForType);
    updateFormForType();

    btnAdd.addEventListener("click", () => {
      formWrap.style.display = formWrap.style.display === "none" ? "block" : "none";
      if (formWrap.style.display === "block") {
        inpTicker.value = "";
        inpValue.value = "";
        inpThreshold.value = "5";
        selType.value = "preco_alvo";
        updateFormForType();
        inpTicker.focus();
      }
    });

    btnCancel.addEventListener("click", () => { formWrap.style.display = "none"; });

    btnSave.addEventListener("click", () => {
      const ticker = inpTicker.value.trim().toUpperCase();
      const value  = parseFloat(inpValue.value);
      if (!ticker) { if (window.showToast) window.showToast("Introduz um ticker.", "warning"); return; }
      if (isNaN(value) || value <= 0) { if (window.showToast) window.showToast("Valor inválido.", "warning"); return; }
      const alert = { ticker, type: selType.value, value };
      if (selType.value === "alocacao") alert.threshold = parseFloat(inpThreshold.value) || 5;
      addAlert(alert);
      formWrap.style.display = "none";
      renderAlertsList();
      if (window.showToast) window.showToast(`Alerta criado para ${ticker}!`, "success");
    });

    // Botão permissão notificações
    if (btnPerm) {
      const notifSupported = "Notification" in window;
      if (notifSupported && Notification.permission !== "granted") {
        btnPerm.style.display = "block";
        btnPerm.addEventListener("click", async () => {
          const granted = await requestNotificationPermission();
          if (granted) {
            btnPerm.style.display = "none";
            if (window.showToast) window.showToast("Notificações ativadas!", "success");
          } else {
            if (window.showToast) window.showToast("Permissão negada pelo browser.", "warning");
          }
        });
      }
    }

    renderAlertsList();
  })();

  // (Opcional) Seguir alterações do sistema se o user nunca "forçou"
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => {
      // só respeita o sistema se o utilizador nunca mudou manualmente
      const saved = loadSettings();
      if (!("userForcedTheme" in saved) || !saved.userForcedTheme) {
        state.darkMode = e.matches;
        applyTheme(state.darkMode);
        saveSettings(state);
        elDark.checked = state.darkMode;
      }
    };
    // marca que o user escolheu manualmente quando mexer no switch
    elDark.addEventListener("change", () => {
      const s = loadSettings();
      s.userForcedTheme = true;
      saveSettings(s);
    });
    mq.addEventListener?.("change", handler);
  } catch {}
}
