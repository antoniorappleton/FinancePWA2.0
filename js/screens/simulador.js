// js/screens/simulador.js
// Nota: este ficheiro trata do UI/UX (mostrar/ocultar painéis e scroll).
// Integra as tuas funções de cálculo aqui dentro, nos handlers, quando quiseres.

function setScreenTitleIfAvailable() {
  if (typeof window.setScreenTitle === "function") {
    window.setScreenTitle("Simulador");
  }
}

export function initScreen() {
  setScreenTitleIfAvailable();

  // Alternar painéis (popups) conforme clique nos botões da esquerda
  const buttons = document.querySelectorAll(".sim-sidebar .btn[data-target]");
  const panels = document.querySelectorAll(".sim-content .panel");

  function activatePanel(id) {
    panels.forEach(p => p.classList.remove("active"));
    const target = document.getElementById(id);
    if (target) {
      target.classList.add("active");

      // Em ecrãs pequenos, faz scroll até ao painel
      if (window.matchMedia("(max-width: 820px)").matches) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      activatePanel(targetId);
    });
  });

  // Botões "quick amount" para preencher o investimento rapidamente
  document.querySelectorAll('[data-quick]').forEach(el => {
    el.addEventListener('click', () => {
      const v = parseFloat(el.getAttribute('data-quick'));
      const investInput = document.getElementById('investimento');
      if (investInput) investInput.value = v;
    });
  });

  // Handlers mínimos (liga aqui à tua lógica real)
  document.getElementById("btnSimularGrafico")?.addEventListener("click", () => {
    // TODO: chama a tua função simularEGUardar()
    console.log("Simular com gráfico (liga à tua função)");
  });

  document.getElementById("btnSomarLucros")?.addEventListener("click", () => {
    // TODO: chama a tua função somarLucros()
    console.log("Somar lucros (liga à tua função)");
  });

  document.getElementById("btnLimparTabela")?.addEventListener("click", () => {
    // TODO: limpar tabela
    const tbody = document.querySelector("#tabelaSimulacoes tbody");
    if (tbody) tbody.innerHTML = "";
  });

  document.getElementById("btnLimparGrafico")?.addEventListener("click", () => {
    // TODO: destruir/limpar o gráfico atual
    console.log("Limpar gráfico (liga à tua função)");
  });

  document.getElementById("btnEnviarEmail")?.addEventListener("click", () => {
    // TODO: abrir/usar fluxo de email
    console.log("Enviar email (liga à tua função)");
  });

  // Reforço
  document.getElementById("btnCalcularReforco")?.addEventListener("click", () => {
    // TODO: calcular média ponderada -> calcularMediaPonderada()
    console.log("Calcular reforço (liga à tua função)");
  });
  document.getElementById("btnLimparReforco")?.addEventListener("click", () => {
    ["invest1","preco1","invest22","preco2"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const out = document.getElementById("resultadoReforco");
    if (out) out.innerHTML = "";
  });

  // TP2
  document.getElementById("btnCalcularTP2")?.addEventListener("click", () => {
    // TODO: calcularTP2()
    console.log("Calcular TP2 (liga à tua função)");
  });
  document.getElementById("btnLimparTP2")?.addEventListener("click", () => {
    ["tp1Input","investimentoInput","lucroDesejadoInput"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const out = document.getElementById("resultadoTP2");
    if (out) out.innerHTML = "";
  });

  // TOP 10
  document.getElementById("btnSimularTop10")?.addEventListener("click", () => {
    // TODO: simular()
    console.log("Simular TOP 10 (liga à tua função)");
  });
  document.getElementById("btnLimparTop10")?.addEventListener("click", () => {
    ["inputInvestimento","inputLucro","inputCrescimento"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const out = document.getElementById("resultadoSimulacao");
    if (out) out.innerHTML = "";
  });
}
