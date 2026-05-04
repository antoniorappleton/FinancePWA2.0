// js/screens/settings.js

// ⚠️ AJUSTA ESTE CAMINHO conforme a estrutura do teu projeto:
// - Se este ficheiro está em js/screens/, usa "../auth.js" (como abaixo).
// - Se estiver lado a lado com auth.js, usa "./auth.js".
import { doLogout } from "./auth.js";
import { db } from "../firebase-config.js";
import { doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { generatePortfolioReport } from "../utils/reportGenerator.js";
import { calculateLucroMaximoScore, getAssetType } from "../utils/scoring.js";

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

  [elAvailCash, elAllocStocks, elAllocEtfs, elAllocBonds].forEach(el => {
    el?.addEventListener("input", calculateAllocations);
  });

  if (elCoreW && elSatW) {
    elCoreW.addEventListener("input", () => {
       const v = Number(elCoreW.value);
       if (v <= 100 && v >= 0) elSatW.value = 100 - v;
    });
    elSatW.addEventListener("input", () => {
       const v = Number(elSatW.value);
       if (v <= 100 && v >= 0) elCoreW.value = 100 - v;
    });
    
    // Load Strategy from Firebase
    getDoc(doc(db, "config", "strategy")).then(snap => {
       if (snap.exists()) {
          const d = snap.data();
          if (typeof d.coreWeight === "number") elCoreW.value = d.coreWeight;
          if (typeof d.satelliteWeight === "number") elSatW.value = d.satelliteWeight;
          if (typeof d.availableCash === "number") elAvailCash.value = d.availableCash;
          if (typeof d.monthlyBase === "number") elMonthlyBase.value = d.monthlyBase;
          
          if (typeof d.allocStocks === "number") elAllocStocks.value = d.allocStocks;
          if (typeof d.allocEtfs === "number") elAllocEtfs.value = d.allocEtfs;
          if (typeof d.allocBonds === "number") elAllocBonds.value = d.allocBonds;
          
          calculateAllocations();
       }
    }).catch(e => console.error("Strategy load err:", e));

    if (btnSaveAlloc) {
      btnSaveAlloc.addEventListener("click", async () => {
        btnSaveAlloc.disabled = true;
        btnSaveAlloc.textContent = "...";
        try {
          await setDoc(doc(db, "config", "strategy"), {
            allocStocks: Number(elAllocStocks.value),
            allocEtfs: Number(elAllocEtfs.value),
            allocBonds: Number(elAllocBonds.value),
            availableCash: Number(elAvailCash.value),
            monthlyBase: Number(elMonthlyBase.value)
          }, { merge: true });
          if (allocStatus) {
            allocStatus.textContent = "Estratégia guardada! ✅";
            allocStatus.style.color = "var(--success)";
            setTimeout(() => { allocStatus.textContent = ""; }, 3000);
          }
        } catch(err) {
          if (allocStatus) {
            allocStatus.textContent = "Erro ao guardar";
            allocStatus.style.color = "var(--destructive)";
          }
          console.error(err);
        }
        btnSaveAlloc.disabled = false;
        btnSaveAlloc.textContent = "Guardar Estratégia";
      });
    }

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
        const snap = await getDocs(collection(db, "acoesDividendos"));
        const allData = [];
        snap.forEach(d => allData.push({ ...d.data(), id: d.id }));

        const totalCash = Number(elAvailCash.value) || 0;
        const targets = {
          stock: Number(elAllocStocks.value) || 0,
          etf: Number(elAllocEtfs.value) || 0,
          bond: Number(elAllocBonds.value) || 0
        };

        const scored = allData.map(d => {
          const res = calculateLucroMaximoScore(d, "1m");
          let type = getAssetType(d.ticker, d);
          const nomeU = String(d.nome || "").toUpperCase();
          if (nomeU.includes("BOND") || nomeU.includes("OBRIGA") || nomeU.includes("TREASURY")) {
            type = "bond";
          }
          return { ...d, score: res.score, rAnnual: res.rAnnual, type };
        });

        const groups = {
          stock: scored.filter(s => s.type === "stock").sort((a, b) => b.score - a.score).slice(0, 5),
          etf: scored.filter(s => s.type === "etf").sort((a, b) => b.score - a.score).slice(0, 5),
          bond: scored.filter(s => s.type === "bond").sort((a, b) => b.score - a.score).slice(0, 5)
        };

        let totalScore = 0;
        let totalYield = 0;
        let totalGrowth = 0;
        let sumPE = 0, sumROIC = 0, sumDebtEq = 0, countFundamental = 0;
        const selectedAssets = [];

        ["stock", "etf", "bond"].forEach(cat => {
          const catP = targets[cat];
          if (catP <= 0) return;
          const catCash = totalCash * (catP / 100);
          const items = groups[cat];
          if (!items.length) return;

          const cashPerItem = catCash / items.length;
          items.forEach(item => {
            const pctOfTotal = (cashPerItem / totalCash) * 100;
            const y = Number(item.yield) || 0;
            const g = Number(item.rAnnual) || 0;
            
            selectedAssets.push({ ...item, allocation: cashPerItem });
            
            // Fundamental metrics for snapshot
            if (cat === "stock") {
              const pe = Number(item.pe || item.p_e || 0);
              const roic = Number(item.roic || 0);
              const de = Number(item.debt_eq || 0);
              if (pe > 0) sumPE += pe;
              if (roic > 0) sumROIC += roic;
              if (de > 0) sumDebtEq += de;
              countFundamental++;
            }

            // Dados para gráficos
            const clsName = cat === "stock" ? "Stocks" : cat === "etf" ? "ETFs" : "Bonds";
            classData[clsName] += cashPerItem;
            
            const sector = item.setor || item.sector || "Outros";
            sectorData[sector] = (sectorData[sector] || 0) + cashPerItem;

            html += `
              <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 10px;">
                  <div style="font-weight: 700;">${item.ticker}</div>
                  <div class="muted" style="font-size: 0.65rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;">
                    ${item.nome || item.ticker}
                  </div>
                </td>
                <td><span class="badge" style="background: var(--muted); color: var(--foreground); font-size: 0.6rem;">${cat.toUpperCase()}</span></td>
                <td style="text-align: right; font-weight: 700;">${fmtEUR(cashPerItem)}</td>
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
        });

        sugTableBody.innerHTML = html || '<tr><td colspan="5" style="text-align:center; padding:30px;" class="muted">Sem dados suficientes.</td></tr>';
        
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

  // Relatório de Investimento
  const btnGenReport = document.getElementById("btnGenerateReport");
  const reportModal = document.getElementById("reportModal");
  const reportClose = document.getElementById("reportModalClose");
  const btnPrint = document.getElementById("btnReportPrint");

  if (btnGenReport) {
    btnGenReport.addEventListener("click", () => {
      generatePortfolioReport();
    });
  }

  if (reportClose) {
    reportClose.addEventListener("click", () => {
      reportModal.classList.add("hidden");
    });
  }

  if (reportModal) {
    reportModal.addEventListener("click", (e) => {
      if (e.target === reportModal) reportModal.classList.add("hidden");
    });
  }

  // O listener do btnPrint (PDF) é agora gerido dinamicamente pelo reportGenerator.js
  // para garantir que os dados atuais são exportados via jsPDF (A4).

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
      try {
        await setDoc(doc(db, "config", "strategy"), {
          coreWeight: Number(elCoreW.value),
          satelliteWeight: Number(elSatW.value),
          availableCash: Number(elAvailCash.value),
          monthlyBase: Number(elMonthlyBase.value),
          allocStocks: Number(elAllocStocks.value),
          allocEtfs: Number(elAllocEtfs.value),
          allocBonds: Number(elAllocBonds.value)
        }, { merge: true });
      } catch (err) {
        console.error("Strategy save error:", err);
      }
    }

    if (window.showToast) window.showToast("Configurações guardadas!");
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

  // (Opcional) Seguir alterações do sistema se o user nunca “forçou”
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
