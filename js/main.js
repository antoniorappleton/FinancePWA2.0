// js/main.js
const screenContainer = document.getElementById("screenContainer");
const screenTitleEl = document.getElementById("screenTitle");

export function navigateTo(screen) {
  console.log("👉 Navegar para:", screen);

  fetch(`screens/${screen}.html`)
    .then((res) => res.text())
    .then((html) => {
      // Injetar o HTML do screen
      screenContainer.innerHTML = html;

      // Definir o título do header, lendo do atributo data-screen-title
      const root = screenContainer.firstElementChild;
      const dynamicTitle = root?.getAttribute("data-screen-title");
      if (screenTitleEl) {
        screenTitleEl.textContent = dynamicTitle ?? "";
      }

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
          // Nem todos os screens precisam de JS — tratamos o erro de forma “silenciosa”
          console.warn(`ℹ️ Sem JS específico para "${screen}" ou falha no import.`, err);
        });
    })
    .catch((err) => {
      console.error("❌ Erro ao carregar HTML do screen:", err);
      screenContainer.innerHTML = "<p>Erro ao carregar a página.</p>";
    });
}

// Disponibilizar globalmente para onclick="navigateTo('...')"
window.navigateTo = navigateTo;

// Arranque na dashboard
document.addEventListener("DOMContentLoaded", () => {
  navigateTo("dashboard");
});