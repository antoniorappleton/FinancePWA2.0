// js/main.js
const screenContainer = document.getElementById("screenContainer");
const screenTitleEl = document.getElementById("screenTitle");

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

      // Importar JS específico do screen (se existir)
      import(`./screens/${screen}.js`)
        .then((module) => {
          if (typeof module.initScreen === "function") {
            module.initScreen();
          } else {
            console.warn(`ℹ️ initScreen() não encontrado em ${screen}.js`);
          }
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

// Arranque na auth
document.addEventListener("DOMContentLoaded", () => {
  navigateTo("auth");
});

// --- Header title helper (global) ---
export function setHeaderTitleFromScreen(root = document) {
  const el = root.querySelector('[data-screen-title]');
  const title = el?.getAttribute('data-screen-title')?.trim();
  const h1 = document.querySelector('.app-header h1');
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
document.addEventListener('DOMContentLoaded', () => setHeaderTitleFromScreen(document));
