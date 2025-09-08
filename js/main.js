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

      // Título dinâmico
      const root = screenContainer.firstElementChild;
      const dynamicTitle = root?.getAttribute("data-screen-title");
      if (screenTitleEl) screenTitleEl.textContent = dynamicTitle ?? "";

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