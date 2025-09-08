// js/screens/settings.js
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
  darkMode: false,
  language: "pt-PT",
  currency: "EUR",
};

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

function applyTheme(dark) {
  const mode = dark ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", mode);
}

export function initScreen() {
  // Elementos
  const elLanguage = document.getElementById("cfgLanguage");
  const elCurrency = document.getElementById("cfgCurrency");
  const elDark = document.getElementById("cfgDarkMode");

  const elEmail = document.getElementById("cfgEmailNotifications");
  const elPush = document.getElementById("cfgPushNotifications");
  const elWeekly = document.getElementById("cfgWeeklyReports");

  const el2FA = document.getElementById("cfgTwoFactor");
  const elLogin = document.getElementById("cfgLoginNotifications");

  const btnSave = document.getElementById("cfgSave");
  const btnCancel = document.getElementById("cfgCancel");

  if (!elLanguage || !elCurrency || !elDark || !btnSave || !btnCancel) {
    console.warn(
      "⚠️ settings.js: elementos não encontrados. Confirma o HTML dos IDs."
    );
    return;
  }

  // Carrega estado atual
  let state = loadSettings();

  // Preenche UI
  elLanguage.value = state.language;
  elCurrency.value = state.currency;
  elDark.checked = !!state.darkMode;

  elEmail.checked = !!state.emailNotifications;
  elPush.checked = !!state.pushNotifications;
  elWeekly.checked = !!state.weeklyReports;

  el2FA.checked = !!state.twoFactor;
  elLogin.checked = !!state.loginNotifications;

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

  elEmail.addEventListener("change", () => {
    state.emailNotifications = !!elEmail.checked;
  });
  elPush.addEventListener("change", () => {
    state.pushNotifications = !!elPush.checked;
  });
  elWeekly.addEventListener("change", () => {
    state.weeklyReports = !!elWeekly.checked;
  });

  el2FA.addEventListener("change", () => {
    state.twoFactor = !!el2FA.checked;
  });
  elLogin.addEventListener("change", () => {
    state.loginNotifications = !!elLogin.checked;
  });

  // Botões
  btnSave.addEventListener("click", () => {
    saveSettings(state);
    // se tiveres um toast global, chama-o aqui
    // showToast("Configurações guardadas!");
  });

  btnCancel.addEventListener("click", () => {
    // Recarrega do storage e volta a preencher/Aplicar
    state = loadSettings();

    elLanguage.value = state.language;
    elCurrency.value = state.currency;
    elDark.checked = !!state.darkMode;

    elEmail.checked = !!state.emailNotifications;
    elPush.checked = !!state.pushNotifications;
    elWeekly.checked = !!state.weeklyReports;

    el2FA.checked = !!state.twoFactor;
    elLogin.checked = !!state.loginNotifications;

    applyTheme(state.darkMode);
  });
}
