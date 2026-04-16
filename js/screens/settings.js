// js/screens/settings.js

// ⚠️ AJUSTA ESTE CAMINHO conforme a estrutura do teu projeto:
// - Se este ficheiro está em js/screens/, usa "../auth.js" (como abaixo).
// - Se estiver lado a lado com auth.js, usa "./auth.js".
import { doLogout } from "./auth.js";
import { db } from "../firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

  // Estratégia
  const elCoreW = document.getElementById("cfgCoreWeight");
  const elSatW = document.getElementById("cfgSatelliteWeight");

  if (elCoreW && elSatW) {
    elCoreW.addEventListener("input", () => {
       const v = Number(elCoreW.value);
       if (v <= 100 && v >= 0) elSatW.value = 100 - v;
    });
    elSatW.addEventListener("input", () => {
       const v = Number(elSatW.value);
       if (v <= 100 && v >= 0) elCoreW.value = 100 - v;
    });
    getDoc(doc(db, "config", "strategy")).then(snap => {
       if (snap.exists()) {
          const d = snap.data();
          if (typeof d.coreWeight === "number") elCoreW.value = d.coreWeight;
          if (typeof d.satelliteWeight === "number") elSatW.value = d.satelliteWeight;
       }
    }).catch(e => console.error("Strategy load err:", e));

    const btnSaveStratG = document.getElementById("btnSaveStrategyG");
    const stStatus = document.getElementById("cfgStrategyStatus");
    if (btnSaveStratG && stStatus) {
       btnSaveStratG.addEventListener("click", async () => {
          btnSaveStratG.disabled = true;
          btnSaveStratG.textContent = "...";
          try {
             await setDoc(doc(db, "config", "strategy"), {
                coreWeight: Number(elCoreW.value),
                satelliteWeight: Number(elSatW.value)
             }, { merge: true });
             stStatus.textContent = "Alocação atualizada! ✅";
             stStatus.style.color = "var(--success)";
             setTimeout(() => { stStatus.textContent = ""; }, 3000);
          } catch(err) {
             stStatus.textContent = err.message || "Erro";
             stStatus.style.color = "var(--destructive)";
             console.error(err);
          }
          btnSaveStratG.disabled = false;
          btnSaveStratG.textContent = "Guardar Alocação";
       });
    }
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
          satelliteWeight: Number(elSatW.value)
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
