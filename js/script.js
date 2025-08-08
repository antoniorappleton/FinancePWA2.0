const screenContainer = document.getElementById("screenContainer");

function navigateTo(screen) {
  fetch(`screens/${screen}.html`)
    .then((res) => res.text())
    .then((html) => {
      screenContainer.innerHTML = html;
      window.scrollTo(0, 0); // voltar ao topo sempre que muda
      if (typeof initScreen === "function") initScreen(); // permite lógica específica
    })
    .catch(() => {
      screenContainer.innerHTML = "<p>Erro ao carregar a página.</p>";
    });
}

// Inicia na dashboard
document.addEventListener("DOMContentLoaded", () => {
  navigateTo("dashboard");
});
