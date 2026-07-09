// js/main.js
const screenContainer = document.getElementById("screenContainer");
const screenTitleEl = document.getElementById("screenTitle");

import { initGlobalHelp } from "./components/help.js";
import "./components/asset-deep-panel.js";

export function navigateTo(screen) {
  console.log("👉 Navegar para:", screen);

  fetch(`screens/${screen}.html`)
    .then((res) => res.text())
    .then((html) => {
      // Injetar HTML do screen
      screenContainer.innerHTML = html;

      // Classe de layout: auth oculta o footer
      document.body.classList.toggle("auth-screen", screen === "auth");

      // Título dinâmico (atualiza #screenTitle e .app-header h1)
      setHeaderTitleFromScreen(screenContainer);

      // Voltar ao topo
      window.scrollTo(0, 0);

      // Importar JS específico do screen (se existir) (com cache-buster em dev)
      const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
      const buster = isDev ? `?v=${Date.now()}` : "";
      import(`./screens/${screen}.js${buster}`)
        .then((module) => {
          if (typeof module.initScreen === "function") {
            module.initScreen();
          } else {
            console.warn(`ℹ️ initScreen() não encontrado em ${screen}.js`);
          }
          initGlobalHelp();
        })
        .catch((err) => {
          console.warn(`ℹ️ Sem JS para "${screen}" ou falha no import.`, err);
        });
    })
    .catch((err) => {
      console.error("❌ Erro ao carregar HTML do screen:", err);
      screenContainer.innerHTML = "<p>Erro ao carregar a página.</p>";
    });
}

// Disponibilizar globalmente para onclick="navigateTo('...')"
window.navigateTo = navigateTo;

// Arranque na auth e Registo de Service Worker
document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 APPFinance v2.8.7 (Dev mode SW bypass enabled)");
  navigateTo("auth");
  initGlobalHelp();

  // Se estivermos em ambiente local (127.0.0.1 ou localhost), limpamos agressivamente
  // qualquer Service Worker e Cache para evitar colisões entre PWAs locais.
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (let registration of registrations) {
          registration.unregister().then((success) => {
            if (success) console.log("🛠️ [Dev] Service Worker antigo anulado com sucesso!");
          });
        }
      });
    }
    if ("caches" in window) {
      caches.keys().then((keys) => {
        keys.forEach((key) => {
          caches.delete(key).then(() => {
            console.log(`🛠️ [Dev] Cache "${key}" eliminado com sucesso!`);
          });
        });
      });
    }
  } else {
    // Registo do Service Worker para PWA (Apenas em Produção)
    if ("serviceWorker" in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      navigator.serviceWorker.register("./service-worker.js")
        .then((reg) => {
          console.log("[PWA] Service Worker Registado.");
          reg.update();

          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (!installingWorker) return;

            installingWorker.onstatechange = () => {
              if (installingWorker.state === "installed") {
                if (navigator.serviceWorker.controller) {
                  console.log("[PWA] Nova versão disponível.");
                  installingWorker.postMessage({ type: "SKIP_WAITING" });
                }
              }
            };
          };
        })
        .catch((err) => console.error("[PWA] Falha no registo do SW:", err));
    }
  }
});

// --- Header title helper (global) ---
export function setHeaderTitleFromScreen(root = document) {
  const el = root.querySelector("[data-screen-title]");
  const title = el?.getAttribute("data-screen-title")?.trim();
  const h1 = document.querySelector(".app-header h1");
  if (h1 && title) h1.textContent = title;
}

// expõe para uso inline nos screens que carregam via HTML estático
window.setHeaderTitleFromScreen = setHeaderTitleFromScreen;

// Se tens um router/navigateTo, chama SEMPRE após render:
const _origNavigateTo = window.navigateTo;
window.navigateTo = function (screen, ...args) {
  const res = _origNavigateTo ? _origNavigateTo(screen, ...args) : undefined;
  // dá tempo ao DOM para render; depois atualiza o header
  queueMicrotask(() => setHeaderTitleFromScreen(document));
  return res;
};

// Também atualiza ao carregar a página (ex: refresh direto num screen)
document.addEventListener("DOMContentLoaded", () =>
  setHeaderTitleFromScreen(document),
);
// --- Toast helper (global) ---
export function showToast(message, duration = 3000) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i class="fas fa-check-circle toast-icon"></i> ${message}`;

  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add("show"), 10);

  // Auto-remove
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
window.showToast = showToast;
