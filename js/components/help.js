import { HELP_CONTENT } from "../help-data.js";

export function initGlobalHelp() {
  const headerRight = document.querySelector(".header-right");
  if (!headerRight) return;

  // Evitar duplicação
  if (document.getElementById("btnGlobalHelp")) return;

  const btn = document.createElement("button");
  btn.id = "btnGlobalHelp";
  btn.className = "btn-help-trigger";
  btn.innerHTML = '<i class="far fa-question-circle"></i>';
  btn.title = "Ajuda Contextual";
  
  headerRight.insertBefore(btn, headerRight.firstChild);

  btn.addEventListener("click", () => {
    const currentScreen = getCurrentScreen();
    openHelpModal(currentScreen);
  });
}

function getCurrentScreen() {
  // Tenta obter o nome do screen a partir do screenTitle ou do contexto global
  const title = document.getElementById("screenTitle")?.textContent?.toLowerCase() || "";
  
  if (title.includes("património") || title.includes("dashboard")) return "dashboard";
  if (title.includes("portfólio") || title.includes("atividade")) return "atividade";
  if (title.includes("mercado") || title.includes("análise")) return "analise";
  if (title.includes("intelligence") || title.includes("dna")) return "portfolio-intel";
  if (title.includes("simulador")) return "simulador";
  if (title.includes("config") || title.includes("definições")) return "settings";
  
  // Fallback: tenta ver qual o botão ativo no footer
  const activeBtn = document.querySelector(".footer-nav button.active span");
  if (activeBtn) {
    const label = activeBtn.textContent.toLowerCase();
    if (label.includes("dashboard")) return "dashboard";
    if (label.includes("portfólio")) return "atividade";
    if (label.includes("mercado")) return "analise";
    if (label.includes("config")) return "settings";
  }

  return "dashboard"; // Default
}

function openHelpModal(screenKey) {
  let modal = document.getElementById("globalHelpModal");
  if (!modal) {
    modal = createHelpModal();
  }

  const content = HELP_CONTENT[screenKey] || HELP_CONTENT.dashboard;
  const body = modal.querySelector(".help-modal-body");
  
  body.innerHTML = `
    <div class="help-header-section">
      <h2>${content.title}</h2>
      <p>O que podes fazer nesta página:</p>
    </div>
    <div class="help-grid">
      ${content.sections.map(s => `
        <div class="help-item">
          <div class="help-icon"><i class="fas ${s.icon}"></i></div>
          <div class="help-text">
            <h3>${s.label}</h3>
            <p>${s.text}</p>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="help-footer-note">
      <p><i class="fas fa-lightbulb"></i> <strong>Dica:</strong> Explora os botões e gráficos para veres mais detalhes em tempo real.</p>
    </div>
  `;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function createHelpModal() {
  const modal = document.createElement("div");
  modal.id = "globalHelpModal";
  modal.className = "global-help-modal hidden";
  modal.innerHTML = `
    <div class="help-modal-content">
      <div class="help-modal-header">
        <span><i class="fas fa-info-circle"></i> Centro de Ajuda</span>
        <button class="help-close">&times;</button>
      </div>
      <div class="help-modal-body"></div>
      <div class="help-modal-actions">
        <button class="btn premium btn-close-help">Entendido!</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  };

  modal.querySelector(".help-close").addEventListener("click", close);
  modal.querySelector(".btn-close-help").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  return modal;
}
