export function initScreen() {
  console.log("✅ Simulador carregado");

  // Aqui podemos inicializar listeners, se necessário.
  // Exemplo:
  // document.getElementById("meuBotao")?.addEventListener("click", minhaFuncao);

  // Certifica que os popups começam escondidos
  document.querySelectorAll(".popup").forEach(p => p.classList.add("hidden"));
}
