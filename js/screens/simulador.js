// js/screens/simulador.js
// Requer Chart.js incluído em simulador.html (ex.: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>)

let simulacoes = [];
let grafico = null;

/* =========================
   HELPERS
   ========================= */
function setScreenTitleIfAvailable() {
  if (typeof window.setScreenTitle === "function") {
    window.setScreenTitle("Simulador");
  }
}

function toNumber(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function limparInputsSimulacao() {
  ["nomeAcao","tp1","tp2","investimento","dividendo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

/* =========================
   SIMULAÇÃO + GRÁFICO
   ========================= */
function guardarSimulacao({ nomeAcao, tp1, tp2, valorInvestido, dividendo = 0 }) {
  const crescimento = tp1 > 0 ? ((tp2 - tp1) / tp1) * 100 : 0;
  const numeroAcoes = tp1 > 0 ? valorInvestido / tp1 : 0;
  const lucroValorizacao = (tp2 - tp1) * numeroAcoes;
  const lucroDividendos  = numeroAcoes * dividendo;
  const lucroTotal       = lucroValorizacao + lucroDividendos;

  const novaSimulacao = {
    nomeAcao: (nomeAcao || "—").trim(),
    tp1: Number(tp1.toFixed(2)),
    tp2: Number(tp2.toFixed(2)),
    valorInvestido: Number(valorInvestido.toFixed(2)),
    lucro: Number(lucroTotal.toFixed(2)),
    crescimentoPercentual: Number(crescimento.toFixed(2)),
  };

  simulacoes.push(novaSimulacao);
  atualizarTabela();
  atualizarGrafico();
}

function atualizarTabela() {
  const corpo = document.querySelector("#tabelaSimulacoes tbody");
  if (!corpo) return;

  corpo.innerHTML = "";

  simulacoes.forEach((sim, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${sim.nomeAcao}</td>
      <td>${sim.tp1.toFixed(2)}</td>
      <td>${sim.tp2.toFixed(2)}</td>
      <td>${sim.valorInvestido.toFixed(2)}</td>
      <td>${sim.lucro.toFixed(2)}</td>
      <td>${sim.crescimentoPercentual.toFixed(2)}%</td>
      <td>
        <button class="btn outline btn-remove" data-index="${index}">❌</button>
      </td>
      <td>
        <input type="checkbox" class="checkbox-lucro" data-lucro="${sim.lucro}">
      </td>
    `;
    corpo.appendChild(tr);
  });

  // linha total (0 por defeito; atualiza quando marcarem checkboxes)
  mostrarTotalLucro(0);

  // Se clicarem nas checkboxes, recalcula automático
  corpo.querySelectorAll(".checkbox-lucro").forEach(cb => {
    cb.addEventListener("change", atualizarSomaLucros);
  });
}

function removerSimulacao(index) {
  simulacoes.splice(index, 1);
  atualizarTabela();
  atualizarGrafico();
}

function atualizarSomaLucros() {
  const checkboxes = document.querySelectorAll(".checkbox-lucro");
  let total = 0;
  checkboxes.forEach(cb => {
    if (cb.checked) total += toNumber(cb.dataset.lucro);
  });
  mostrarTotalLucro(total);
}

function mostrarTotalLucro(valor) {
  const corpo = document.querySelector("#tabelaSimulacoes tbody");
  if (!corpo) return;

  let totalRow = document.getElementById("linha-total-lucro");
  if (!totalRow) {
    totalRow = document.createElement("tr");
    totalRow.id = "linha-total-lucro";
    totalRow.innerHTML = `
      <td colspan="4"><strong>Total Lucro Selecionado:</strong></td>
      <td colspan="4" id="valorTotalLucro"><strong>${valor.toFixed(2)} €</strong></td>
    `;
    corpo.appendChild(totalRow);
  } else {
    totalRow.querySelector("#valorTotalLucro").innerHTML =
      `<strong>${valor.toFixed(2)} €</strong>`;
  }
}

function atualizarGrafico() {
  const canvas = document.getElementById("graficoLucro");
  if (!canvas) return;

  const labels = simulacoes.map(s => s.nomeAcao);
  const dados  = simulacoes.map(s => s.lucro);

  if (grafico) grafico.destroy();

  const ctx = canvas.getContext("2d");
  grafico = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Lucro (€)",
          data: dados,
          backgroundColor: dados.map(v => v >= 0 ? "rgba(46, 204, 113, 0.6)" : "rgba(231, 76, 60, 0.6)"),
          borderColor:     dados.map(v => v >= 0 ? "rgba(46, 204, 113, 1)"   : "rgba(231, 76, 60, 1)"),
          borderWidth: 1
        }
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function simularEGUardar() {
  document.querySelector(".tabela-scroll-wrapper")?.classList.remove("hidden");

  const nome         = document.getElementById("nomeAcao")?.value?.trim();
  const tp1          = toNumber(document.getElementById("tp1")?.value);
  const tp2          = toNumber(document.getElementById("tp2")?.value);
  const investimento = toNumber(document.getElementById("investimento")?.value);
  const dividendo    = toNumber(document.getElementById("dividendo")?.value);

  if (!nome || tp1 <= 0 || tp2 <= 0 || investimento <= 0) {
    alert("Preenche todos os campos com valores > 0!");
    return;
  }

  guardarSimulacao({ nomeAcao: nome, tp1, tp2, valorInvestido: investimento, dividendo });

  // Limpa apenas os inputs (mantém gráfico+tabela)
  limparInputsSimulacao();
}

function limparGrafico() {
  simulacoes = [];
  atualizarTabela();
  if (grafico) {
    grafico.destroy();
    grafico = null;
  }
}

/* =========================
   REFORÇO (MÉDIA PONDERADA)
   ========================= */
function calcularMediaPonderada() {
  const invest1 = toNumber(document.getElementById("invest1")?.value);
  const preco1  = toNumber(document.getElementById("preco1")?.value);
  const invest2 = toNumber(document.getElementById("invest22")?.value);
  const preco2  = toNumber(document.getElementById("preco2")?.value);

  const out = document.getElementById("resultadoReforco");

  if (invest1 > 0 && preco1 > 0 && invest2 > 0 && preco2 > 0) {
    const qtd1 = invest1 / preco1;
    const qtd2 = invest2 / preco2;
    const totalQtd = qtd1 + qtd2;
    const totalInvestido = invest1 + invest2;
    const precoMedio = totalInvestido / totalQtd;

    out.innerHTML = `
      <p>📊 <strong>Preço Médio:</strong> ${precoMedio.toFixed(2)} €</p>
      <p>📦 <strong>Total de Ações:</strong> ${totalQtd.toFixed(2)}</p>
      <p>💰 <strong>Total Investido:</strong> ${totalInvestido.toFixed(2)} €</p>
    `;
  } else {
    out.innerHTML = `<p style="color:red;">⚠️ Insere valores válidos.</p>`;
  }
}

/* =========================
   TP2 (alvo para lucro desejado)
   ========================= */
// Fórmula: n = investimento / tp1 ; tp2 = tp1 + lucroDesejado / n
function calcularTP2() {
  const tp1   = toNumber(document.getElementById("tp1Input")?.value);
  const inv   = toNumber(document.getElementById("investimentoInput")?.value);
  const lucro = toNumber(document.getElementById("lucroDesejadoInput")?.value);

  const out = document.getElementById("resultadoTP2");

  if (tp1 <= 0 || inv <= 0 || lucro <= 0) {
    out.innerHTML = `<p style="color:red;">⚠️ Preenche TP1, Investimento e Lucro Desejado com valores > 0.</p>`;
    return;
  }

  const nAcoes = inv / tp1;
  const tp2 = tp1 + (lucro / nAcoes);

  out.innerHTML = `
    <p>🎯 <strong>TP2 necessário:</strong> ${tp2.toFixed(2)} €</p>
    <small>(${nAcoes.toFixed(2)} ações estimadas)</small>
  `;
}

/* =========================
   TOP 10 (placeholder local)
   ========================= */
function simularTop10() {
  const inv   = toNumber(document.getElementById("inputInvestimento")?.value);
  const lucro = toNumber(document.getElementById("inputLucro")?.value);
  const cres  = toNumber(document.getElementById("inputCrescimento")?.value); // opcional (%)

  const out = document.getElementById("resultadoSimulacao");

  if (inv <= 0 || lucro <= 0) {
    out.innerHTML = `<p class="muted">Preenche pelo menos Montante a investir e Lucro desejado.</p>`;
    return;
  }

  const candidatos = ["AAPL","NVDA","AMD","MSFT","VUAA"].map((ticker, i) => {
    const tp1 = 100 + i * 25; // preço base fictício
    const n   = inv / tp1;
    const tp2 = tp1 + (lucro / n);
    const percent = tp1 > 0 ? ((tp2 - tp1) / tp1) * 100 : 0;
    const override = cres > 0 ? ` | Cresc. ref: ${cres.toFixed(1)}%` : "";
    return { ticker, tp1, n, tp2, percent, note: override };
  });

  out.innerHTML = `
    <table class="table-like">
      <thead>
        <tr>
          <th>Ticker</th><th>TP1 (€)</th><th>Qtd</th><th>TP2 alvo (€)</th><th>Δ%</th>
        </tr>
      </thead>
      <tbody>
        ${candidatos.map(c => `
          <tr>
            <td>${c.ticker}</td>
            <td>${c.tp1.toFixed(2)}</td>
            <td>${c.n.toFixed(2)}</td>
            <td>${c.tp2.toFixed(2)}</td>
            <td>${c.percent.toFixed(1)}% ${c.note}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <p class="muted">Nota: isto é apenas uma simulação local. Podemos ligar à coleção <code>acoesDividendos</code> mais tarde para resultados reais.</p>
  `;
}

/* =========================
   EMAIL (mailto: resumo)
   ========================= */
function enviarEmailResumo() {
  const emailDestino = prompt("Para que email queres enviar o resumo?");
  if (!emailDestino) return;

  if (simulacoes.length === 0) {
    alert("Faz pelo menos uma simulação primeiro.");
    return;
  }

  const assunto = encodeURIComponent("Resumo de Simulações Financeiras");
  let corpo = "Resumo das Simulações:\n\n";

  simulacoes.forEach((s, i) => {
    corpo += `Simulação ${i + 1}:\n`;
    corpo += `Ação: ${s.nomeAcao}\n`;
    corpo += `TP1: €${s.tp1.toFixed(2)}\n`;
    corpo += `TP2: €${s.tp2.toFixed(2)}\n`;
    corpo += `Investimento: €${s.valorInvestido.toFixed(2)}\n`;
    corpo += `Lucro: €${s.lucro.toFixed(2)}\n`;
    corpo += `Crescimento: ${s.crescimentoPercentual.toFixed(2)}%\n\n`;
  });

  const body = encodeURIComponent(corpo);
  const mailtoLink = `mailto:${encodeURIComponent(emailDestino)}?subject=${assunto}&body=${body}`;
  window.location.href = mailtoLink;
}

/* =========================
   INIT + Wiring UI
   ========================= */
export function initScreen() {
  setScreenTitleIfAvailable();

  // Alternância de painéis (se usares sidebar + content)
  const buttons = document.querySelectorAll(".sim-sidebar .btn[data-target]");
  const panels = document.querySelectorAll(".sim-content .panel");
  function activatePanel(id) {
    panels.forEach(p => p.classList.remove("active"));
    const t = document.getElementById(id);
    if (t) {
      t.classList.add("active");
      if (window.matchMedia("(max-width: 820px)").matches) {
        t.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      activatePanel(targetId);
    });
  });

  // Quick amount
  document.querySelectorAll("[data-quick]").forEach(el => {
    el.addEventListener("click", () => {
      const v = toNumber(el.getAttribute("data-quick"));
      const investInput = document.getElementById("investimento");
      if (investInput) investInput.value = v;
    });
  });

  // Simular com gráfico
  document.getElementById("btnSimularGrafico")?.addEventListener("click", simularEGUardar);

  // 🔹 Limpar só inputs (NÃO mexe em tabela/gráfico)
  document.getElementById("btnLimparInputs")?.addEventListener("click", limparInputsSimulacao);

  // 🔹 Limpar gráfico + tabela (tudo)
  document.getElementById("btnLimparGrafico")?.addEventListener("click", limparGrafico);

  // Enviar email
  document.getElementById("btnEnviarEmail")?.addEventListener("click", enviarEmailResumo);

  // Delegation: remover linha + checkboxes
  document.querySelector("#tabelaSimulacoes tbody")?.addEventListener("click", (e) => {
    const rm = e.target.closest(".btn-remove");
    if (rm) {
      const idx = parseInt(rm.dataset.index, 10);
      if (!isNaN(idx)) removerSimulacao(idx);
    }
  });

  // Reforço (média ponderada)
  document.getElementById("btnCalcularReforco")?.addEventListener("click", calcularMediaPonderada);
  document.getElementById("btnLimparReforco")?.addEventListener("click", () => {
    ["invest1","preco1","invest22","preco2"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const out = document.getElementById("resultadoReforco");
    if (out) out.innerHTML = "";
  });

  // TP2
  document.getElementById("btnCalcularTP2")?.addEventListener("click", calcularTP2);
  document.getElementById("btnLimparTP2")?.addEventListener("click", () => {
    ["tp1Input","investimentoInput","lucroDesejadoInput"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const out = document.getElementById("resultadoTP2");
    if (out) out.innerHTML = "";
  });

  // Top 10 (mock)
  document.getElementById("btnSimularTop10")?.addEventListener("click", simularTop10);
  document.getElementById("btnLimparTop10")?.addEventListener("click", () => {
    ["inputInvestimento","inputLucro","inputCrescimento"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const out = document.getElementById("resultadoSimulacao");
    if (out) out.innerHTML = "";
  });
}