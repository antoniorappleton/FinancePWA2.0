// js/screens/simulador.js
// Requer Chart.js incluído na página (ex.: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>)

import {
  getDocs,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "../firebase-config.js";

/* =========================
   ESTADO
   ========================= */
let simulacoes = [];
let grafico = null;
let chSimSetores = null;
let chSimAtivos = null;
let graficoCapital = null;
let _currentTop10Result = null;
let _currentTop10Opts = null;
let _unsubGuardadas = null;
let _unsubPrices = null;
let _cachedPrices = new Map();
let _cachedAcoes = [];

const PALETTE = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#06b6d4", "#f43f5e", "#84cc16", "#eab308", "#d946ef"
];

/* =========================
   HELPERS GERAIS
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
function euro(v) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(v || 0);
}

function canon(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// cleanTicker removido (importado de scoring.js)
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function limparInputsSimulacao() {
  ["nomeAcao", "tp1", "tp2", "investimento", "dividendo"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

/* =========================
   SIMULAÇÃO + GRÁFICO
   ========================= */
function guardarSimulacao({
  nomeAcao,
  tp1,
  tp2,
  valorInvestido,
  dividendo = 0,
}) {
  const crescimento = tp1 > 0 ? ((tp2 - tp1) / tp1) * 100 : 0;
  const numeroAcoes = tp1 > 0 ? valorInvestido / tp1 : 0;
  const lucroValorizacao = (tp2 - tp1) * numeroAcoes;
  const lucroDividendos = numeroAcoes * dividendo;
  const lucroTotal = lucroValorizacao + lucroDividendos;

  const novaSimulacao = {
    nomeAcao: String(nomeAcao || "—").trim(),
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
  corpo.querySelectorAll(".checkbox-lucro").forEach((cb) => {
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
  checkboxes.forEach((cb) => {
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

  const labels = simulacoes.map((s) => s.nomeAcao);
  const dados = simulacoes.map((s) => s.lucro);

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
          backgroundColor: dados.map((v) =>
            v >= 0 ? "rgba(46, 204, 113, 0.6)" : "rgba(231, 76, 60, 0.6)",
          ),
          borderColor: dados.map((v) =>
            v >= 0 ? "rgba(46, 204, 113, 1)" : "rgba(231, 76, 60, 1)",
          ),
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      layout: { padding: 0 },
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function simularEGUardar() {
  document.querySelector(".tabela-scroll-wrapper")?.classList.remove("hidden");

  const nome = document.getElementById("nomeAcao")?.value?.trim();
  const tp1 = toNumber(document.getElementById("tp1")?.value);
  const tp2 = toNumber(document.getElementById("tp2")?.value);
  const investimento = toNumber(document.getElementById("investimento")?.value);
  const dividendo = toNumber(document.getElementById("dividendo")?.value);

  if (!nome || tp1 <= 0 || tp2 <= 0 || investimento <= 0) {
    alert("Preenche todos os campos com valores > 0!");
    return;
  }

  guardarSimulacao({
    nomeAcao: nome,
    tp1,
    tp2,
    valorInvestido: investimento,
    dividendo,
  });
  limparInputsSimulacao(); // limpa inputs mas mantém tabela/gráfico
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
  const preco1 = toNumber(document.getElementById("preco1")?.value);
  const invest2 = toNumber(document.getElementById("invest22")?.value);
  const preco2 = toNumber(document.getElementById("preco2")?.value);

  const out = document.getElementById("resultadoReforco");

  if (invest1 > 0 && preco1 > 0 && invest2 > 0 && preco2 > 0) {
    const qtd1 = invest1 / preco1;
    const qtd2 = invest2 / preco2;
    const totalQtd = qtd1 + qtd2;
    const totalInvestido = invest1 + invest2;
    const precoMedio = totalInvestido / totalQtd;
    const diffPreco = preco1 > 0 ? ((preco2 - preco1) / preco1) * 100 : 0;

    out.innerHTML = `
      <div class="resultado-header">
        <p>📊 <strong>Preço Médio:</strong> ${precoMedio.toFixed(2)} €</p>
        <p>📈 <strong>Diferença de Preço:</strong> ${diffPreco.toFixed(2)}%</p>
        <p>📦 <strong>Total de Ações:</strong> ${totalQtd.toFixed(2)}</p>
        <p>💰 <strong>Total Investido:</strong> ${totalInvestido.toFixed(2)} €</p>
      </div>
      <button class="btn premium full btn-transfer-tp2" 
              data-pm="${precoMedio.toFixed(2)}" 
              data-total="${totalInvestido.toFixed(2)}"
              style="margin-top: 1rem;">
        🎯 Calcular TP2 com estes dados
      </button>
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
  const tp1 = toNumber(document.getElementById("tp1Input")?.value);
  const inv = toNumber(document.getElementById("investimentoInput")?.value);
  const lucro = toNumber(document.getElementById("lucroDesejadoInput")?.value);

  const out = document.getElementById("resultadoTP2");

  if (tp1 <= 0 || inv <= 0 || lucro <= 0) {
    out.innerHTML = `<p style="color:red;">⚠️ Preenche TP1, Investimento e Lucro Desejado com valores > 0.</p>`;
    return;
  }

  const nAcoes = inv / tp1;
  const tp2 = tp1 + lucro / nAcoes;
  const crescimento = tp1 > 0 ? ((tp2 - tp1) / tp1) * 100 : 0;

  out.innerHTML = `
    <p>🎯 <strong>TP2 necessário:</strong> ${tp2.toFixed(2)} €</p>
    <p>📈 <strong>Crescimento necessário:</strong> ${crescimento.toFixed(2)}%</p>
    <small>(${nAcoes.toFixed(2)} ações estimadas)</small>
  `;
}

/* =========================
   TOP 10 — Distribuição
   ========================= */
// === MOTOR LOCAL (não depende do analise.js) ===
// === MOTOR LOCAL (TOP 10) — configurações mais realistas ===
const TOP_CFG = {
  // Máximo/mínimo anual admitido depois da anualização
  MAX_ANNUAL_RETURN: 0.2, // Reduzido para 20% (mais conservador)
  MIN_ANNUAL_RETURN: -0.5, // -50%/ano

  // Limite prudente por ticker (quando fracionado/inteiras)
  CAP_PCT_POR_TICKER: 0.3, // 30% do capital por ativo

  // Blends por período (mantém)
  BLEND_WEIGHTS: {
    "1s": { w: 0.6, m: 0.25, y: 0.15 },
    "1m": { w: 0.15, m: 0.65, y: 0.2 },
    "1a": { w: 0.1, m: 0.2, y: 0.7 },
  },

  // Se a taxa "primária" for alta, capamos o blend
  REALISM_CAP: { enabled: true, trigger: 0.2, cap: 0.15 },
  // se a taxa primária ≥20%/ano, capar o blend a 15%/ano
};

const clamp2 = (v, min, max) => Math.max(min, Math.min(max, v));
const toNum = (x) => Number(x || 0);

// === Render do resultado TOP 10 (drop-in) ===
function renderResultado(destEl, resultado, opts) {
  const { linhas, totalLucro, totalGasto, restante = 0 } = resultado;

  if (!linhas || linhas.length === 0) {
    destEl.innerHTML = `<div class="card"><p class="muted">Sem ações elegíveis com retorno positivo para o período selecionado.</p></div>`;
    document.getElementById("graficosSimulacao").style.display = "none";
    return;
  }

  const rows = linhas
    .map(
      (l) => `
    <tr>
      <td>${l.nome} <span class="muted">(${l.ticker})</span></td>
      <td>${euro(l.preco)}</td>
      <td>${l.quantidade.toFixed(opts.acoesCompletas ? 0 : 4)}</td>
      <td>${euro(l.investido)}</td>
      <td>${euro(l.lucro)}</td>
      <td><strong>${(l.score * 100).toFixed(0)}%</strong></td>
      <td>${(l.taxaPct || 0).toFixed(2)}%</td>
      <td>${euro(l.dividendoAnual || 0)}/ano</td>
    </tr>
  `,
    )
    .join("");

  destEl.innerHTML = `
    <div class="card">
      <div class="tabela-scroll-wrapper">
        <!-- Recomendação de Gestão de Capital -->
        <div id="simCapitalAdvice" style="margin-bottom: 1rem;"></div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr>
              <th>Ativo</th>
              <th>Preço</th>
              <th>Qtd</th>
              <th>Investido</th>
              <th>Lucro Estim.</th>
              <th>Score</th>
              <th>Tx ${opts.periodoSel}</th>
              <th>Dividendo</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:1rem; margin-top:.6rem">
        <div>
          <p>
            <strong>Total investido:</strong> ${euro(totalGasto)}
            ${opts.acoesCompletas && restante > 0 ? `· <strong>Resto:</strong> ${euro(restante)}` : ``}
            <br/>
            <strong>Lucro total estimado (${opts.horizonte} ${opts.horizonte > 1 ? "períodos" : "período"}):</strong> ${euro(totalLucro)}
            <span class="${totalLucro >= 0 ? "up" : "down"}" style="font-weight:bold; margin-left:8px;">
              (${totalGasto > 0 ? ((totalLucro / totalGasto) * 100).toFixed(2) : 0}%)
            </span>
          </p>
          <p class="muted" style="margin-top:.3rem">
            ${opts.incluirDiv === false ? "Dividendo excluído do cálculo." : "Dividendo incluído no cálculo."}
          </p>
        </div>
        <button class="btn premium" id="btnGuardarSimulacao">💾 Guardar Simulação</button>
      </div>
    </div>
  `;

  // Listener para o botão de guardar
  document.getElementById("btnGuardarSimulacao")?.addEventListener("click", () => {
    guardarSimulacaoFirestore(resultado, opts);
  });

  // Listener para o botão de guardar
  document.getElementById("btnGuardarSimulacao")?.addEventListener("click", () => {
    guardarSimulacaoFirestore(resultado, opts);
  });

  // Mostrar conselho de capital
  const adviceEl = document.getElementById("simCapitalAdvice");
  if (adviceEl && _cachedAcoes.length > 0) {
     // Obter estado atual da carteira (usando ativos em cache ou buscando)
     const qAtivos = query(collection(db, "ativos"));
     getDocs(qAtivos).then(snap => {
       const pos = snap.docs.map(d => ({ ticker: d.data().ticker, ...d.data() }));
       const state = CapitalManager.calculatePortfolioState(pos, _cachedAcoes);
       const recommendation = CapitalManager.getWarChestRecommendation(state, opts.investimento);
       
       if (state.label === "Sobrevalorizada") {
         adviceEl.innerHTML = `
           <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; padding: 12px; border-radius: 8px; font-size: 0.85rem; color: #ef4444; margin-bottom: 12px;">
             <strong>⚠️ Mercado Caro:</strong> A sua carteira está sobrevalorizada. Recomendamos investir apenas <strong>${euro(recommendation.toInvestNow)}</strong> agora e guardar <strong>${euro(recommendation.amount)}</strong> em reserva (War Chest).
           </div>
         `;
       } else if (state.label === "Subvalorizada") {
         adviceEl.innerHTML = `
           <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid #22c55e; padding: 12px; border-radius: 8px; font-size: 0.85rem; color: #22c55e; margin-bottom: 12px;">
             <strong>✅ Oportunidade:</strong> O mercado está atrativo. Considere investir o valor total ou até usar uma tranche da sua reserva.
           </div>
         `;
       }
     });
  }

  // Mostrar e renderizar gráficos
  document.getElementById("graficosSimulacao").style.display = "grid";
  renderSimDistCharts(resultado);
}

function renderSimDistCharts(resultado) {
  const { linhas } = resultado;
  
  // 1. Distribuição por Setor
  const setorMap = new Map();
  const ativoMap = new Map();
  
  linhas.forEach(l => {
    const sRaw = l.setor || l.sector || l.Setor || l.Sector || l.industry || l.Industry || l.indústria || l.Indústria || l.segmento || l.segment || "";
    let s = canon(sRaw);
    if (!s && String(l.ticker).includes(":")) {
      const p = String(l.ticker).split(":")[0].trim();
      if (p.length > 2) s = canon(p);
    }
    if (!s) s = "Outros";
    setorMap.set(s, (setorMap.get(s) || 0) + l.investido);
    
    const tickerLimpo = cleanTicker(l.ticker);
    ativoMap.set(tickerLimpo, (ativoMap.get(tickerLimpo) || 0) + l.investido);
  });

  // Render Setores
  const elSet = document.getElementById("chartSimSetores");
  if (elSet) {
    if (chSimSetores) chSimSetores.destroy();
    chSimSetores = new Chart(elSet, {
      type: "doughnut",
      data: {
        labels: [...setorMap.keys()],
        datasets: [{
          data: [...setorMap.values()],
          backgroundColor: PALETTE,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed || 0;
                const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
                const pct = ((val/total)*100).toFixed(1);
                return `${ctx.label}: ${euro(val)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // Render Ativos
  const elAti = document.getElementById("chartSimAtivos");
  if (elAti) {
    if (chSimAtivos) chSimAtivos.destroy();
    chSimAtivos = new Chart(elAti, {
      type: "doughnut",
      data: {
        labels: [...ativoMap.keys()],
        datasets: [{
          data: [...ativoMap.values()],
          backgroundColor: PALETTE,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed || 0;
                const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
                const pct = ((val/total)*100).toFixed(1);
                return `${ctx.label}: ${euro(val)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }
}

async function guardarSimulacaoFirestore(resultado, opts) {
  const nome = prompt("Dê um nome a esta simulação:", `Carteira ${new Date().toLocaleDateString()}`);
  if (!nome) return;

  try {
    const payload = {
      nome,
      dataCriacao: Timestamp.now(),
      investimentoInicial: resultado.totalGasto,
      periodo: opts.periodoSel,
      horizonte: opts.horizonte,
      ativos: resultado.linhas.map(l => ({
        ticker: l.ticker,
        nome: l.nome,
        setor: l.setor || "",
        qtd: l.quantidade,
        precoInicial: l.preco,
        investido: l.investido
      }))
    };

    await addDoc(collection(db, "simulacoesSalvas"), payload);
    alert("Simulação guardada com sucesso! Pode consultá-la no painel 'Simulações Guardadas'.");
  } catch (err) {
    console.error("Erro ao guardar simulação:", err);
    alert("Erro ao guardar simulação.");
  }
}

async function carregarSimulacoesGuardadas() {
  const container = document.getElementById("listaGuardadas");
  if (!container) return;

  // Evitar múltiplos listeners
  if (_unsubGuardadas) _unsubGuardadas();
  if (_unsubPrices) _unsubPrices();

  container.innerHTML = `<div class="card"><p class="muted">A sincronizar dados de mercado...</p></div>`;

  // 1. Listener para Preços e Dados de Mercado (sempre atualizado)
  const qAcoes = query(collection(db, "acoesDividendos"));
  _unsubPrices = onSnapshot(qAcoes, (snap) => {
    _cachedAcoes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cachedPrices = new Map(_cachedAcoes.map(a => [cleanTicker(a.ticker), Number(a.valorStock || 0)]));
    
    if (!_unsubGuardadas) iniciarListenerSimulacoes();
  });

  function iniciarListenerSimulacoes() {
    const q = query(collection(db, "simulacoesSalvas"), orderBy("dataCriacao", "desc"));
    _unsubGuardadas = onSnapshot(q, (snap) => {
      renderizarListaGuardadas(snap);
    });
  }

  function renderizarListaGuardadas(snap) {
    container.innerHTML = "";
    if (snap.empty) {
      container.innerHTML = `<div class="card"><p class="muted">Nenhuma simulação guardada ainda. Use o TOP 10 para criar uma!</p></div>`;
      return;
    }

    snap.forEach(docSnap => {
      const sim = docSnap.data();
      const id = docSnap.id;
      
      let valorAtualTotal = 0;
      let divAnualTotal = 0;
      let somaPE = 0;
      let countPE = 0;

      sim.ativos.forEach(a => {
        const ticker = cleanTicker(a.ticker);
        const pAtual = _cachedPrices.get(ticker) || a.precoInicial;
        const acaoFull = _cachedAcoes.find(ac => cleanTicker(ac.ticker) === ticker) || {};
        
        valorAtualTotal += a.qtd * pAtual;
        
        const dUnit = Number(acaoFull.dividendo || 0);
        const per = acaoFull.periodicidade || "Anual";
        const payN = (per === "Mensal" ? 12 : per === "Trimestral" ? 4 : per === "Semestral" ? 2 : 1);
        divAnualTotal += a.qtd * dUnit * payN;

        const pe = Number(acaoFull.pe || acaoFull.peRatio || 0);
        if (pe > 0) {
          somaPE += pe * (a.qtd * pAtual);
          countPE += (a.qtd * pAtual);
        }
      });

      const lucroAbs = valorAtualTotal - sim.investimentoInicial;
      const lucroPct = (lucroAbs / sim.investimentoInicial) * 100;
      const dyAtual = valorAtualTotal > 0 ? (divAnualTotal / valorAtualTotal) * 100 : 0;
      const peMedio = countPE > 0 ? somaPE / countPE : 0;
      const dataStr = sim.dataCriacao?.toDate().toLocaleDateString() || "—";

      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "1.5rem";
      card.style.borderLeft = `4px solid ${lucroAbs >= 0 ? "#22c55e" : "#ef4444"}`;
      
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h4 style="margin:0; font-size:1.15rem;">${sim.nome}</h4>
            <small class="muted">📅 Criada em ${dataStr} · Original: ${euro(sim.investimentoInicial)}</small>
          </div>
          <button class="btn ghost btn-delete-sim" data-id="${id}" title="Apagar" style="padding:4px; margin:0;">❌</button>
        </div>
        
        <div style="margin-top:1.25rem; display:grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap:1rem;">
          <div class="metric-item">
            <span class="label" style="display:block; font-size:0.7rem; text-transform:uppercase; color:#888;">Valor Atual</span>
            <span class="value" style="font-size:1.1rem; font-weight:700;">${euro(valorAtualTotal)}</span>
          </div>
          <div class="metric-item">
            <span class="label" style="display:block; font-size:0.7rem; text-transform:uppercase; color:#888;">Retorno</span>
            <span class="value ${lucroAbs >= 0 ? "up" : "down"}" style="font-size:1.1rem; font-weight:700;">
              ${lucroPct >= 0 ? "+" : ""}${lucroPct.toFixed(2)}%
            </span>
          </div>
          <div class="metric-item">
            <span class="label" style="display:block; font-size:0.7rem; text-transform:uppercase; color:#888;">Yield Atual</span>
            <span class="value" style="font-size:1.1rem; font-weight:700; color:#10b981;">${dyAtual.toFixed(2)}%</span>
          </div>
          <div class="metric-item" style="text-align:right;">
            <span class="label" style="display:block; font-size:0.7rem; text-transform:uppercase; color:#888;">P/E Médio</span>
            <span class="value" style="font-size:1.1rem; font-weight:700; color:#3b82f6;">${peMedio > 0 ? peMedio.toFixed(1) : "—"}</span>
          </div>
        </div>

        <div style="height:6px; background:#eee; border-radius:3px; margin-top:1rem; overflow:hidden;">
          <div style="height:100%; width:${Math.min(100, Math.abs(lucroPct))}%; background:${lucroAbs >= 0 ? "#22c55e" : "#ef4444"}; transition: width 0.5s;"></div>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.5rem;">
           <p style="font-size:0.8rem; margin:0; font-weight:600;" class="${lucroAbs >= 0 ? "up" : "down"}">
            ${lucroAbs >= 0 ? "Lucro" : "Prejuízo"} de ${euro(Math.abs(lucroAbs))}
          </p>
          <p style="font-size:0.8rem; margin:0; color:#10b981; font-weight:600;">
            Est. ${euro(divAnualTotal)}/ano em dividendos
          </p>
        </div>

        <details style="margin-top:1rem; border-top: 1px solid #eee; pt:0.5rem;">
          <summary class="muted" style="cursor:pointer; font-size:.85rem; padding-top:0.5rem;">🔍 Análise detalhada dos ativos</summary>
          <div class="tabela-scroll-wrapper" style="margin-top:.5rem;">
            <table style="width:100%; font-size:.8rem; border-collapse:collapse;">
              <thead>
                <tr style="text-align:left; border-bottom:1px solid #eee;">
                  <th style="padding:6px 0;">Ativo</th>
                  <th>Qtd</th>
                  <th>P. Inicial</th>
                  <th>P. Atual</th>
                  <th style="text-align:right;">Retorno</th>
                </tr>
              </thead>
              <tbody>
                ${sim.ativos.map(a => {
                  const ticker = cleanTicker(a.ticker);
                  const pAt = _cachedPrices.get(ticker) || a.precoInicial;
                  const resAt = (pAt - a.precoInicial) * a.qtd;
                  const resPct = ((pAt - a.precoInicial) / a.precoInicial) * 100;
                  return `
                    <tr style="border-bottom:1px dotted #f0f0f0;">
                      <td style="padding:8px 0;"><strong>${a.ticker}</strong></td>
                      <td>${a.qtd.toFixed(2)}</td>
                      <td>${a.precoInicial.toFixed(2)}</td>
                      <td>${pAt.toFixed(2)}</td>
                      <td style="text-align:right;" class="${resAt >= 0 ? "up" : "down"}">
                        <strong>${euro(resAt)}</strong><br/><small>${resPct >= 0 ? "+" : ""}${resPct.toFixed(1)}%</small>
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        </details>
      `;

      card.querySelector(".btn-delete-sim").addEventListener("click", async (e) => {
        if (confirm("Tem a certeza que quer apagar esta simulação?")) {
          await deleteDoc(doc(db, "simulacoesSalvas", id));
        }
      });

      container.appendChild(card);
    });
  }
}

import { annualizeRate, anualPreferido, calculateLucroMaximoScore, cleanTicker } from "../utils/scoring.js";
import * as CapitalManager from "../utils/capitalManager.js";
import { enrichETFAsset, isKnownETF } from "../engines/etf-overlap.js";

function calcularMetricasBase_TOP(
  acao,
  { periodo = "1m", horizonte = 1, incluirDiv = true } = {},
) {
  const precoAtual = toNum(acao.valorStock);
  if (!(precoAtual > 0)) return null;

  // Frequência do período (semanas=52, meses=12, anos=1)
  const freq = periodo === "1s" ? 52 : periodo === "1m" ? 12 : 1;
  const h = Math.max(1, Number(horizonte || 1));
  const timeFactor = h / freq;

  const anualDiv = toNum(acao.divAnual ?? anualPreferido(acao));
  const rAnnual = annualizeRate(acao, periodo);

  // Math.pow(1 + rAnnual, h/f) - 1 dá o crescimento REAL no horizonte h
  const taxaNoPeriodo = Math.pow(1 + rAnnual, timeFactor) - 1;
  const valorizacao = precoAtual * taxaNoPeriodo;
  const dividendos = incluirDiv ? anualDiv * timeFactor : 0;
  const lucroUnidade = dividendos + valorizacao;
  const retornoPorEuro = precoAtual > 0 ? lucroUnidade / precoAtual : 0;

  return {
    preco: precoAtual,
    dividendoAnual: anualDiv,
    taxaPct: taxaNoPeriodo * 100, // Mostra a taxa para o HORIZONTE h selecionado
    totalDividendos: dividendos,
    valorizacao,
    lucroUnidade,
    retornoPorEuro,
  };
}

// “Lucro Máximo” = score baseado só em retorno/€
function prepararCandidatos_TOP(
  rows,
  { periodo, horizonte, incluirDiv, modoEstrito = true },
) {
  let cands = rows
    .map((a) => {
      const metrics = calcularMetricasBase_TOP(a, {
        periodo,
        horizonte,
        incluirDiv,
      });
      if (!metrics || !(metrics.lucroUnidade > 0)) return null;

      // Usamos o motor de pontuação avançado
      const scoreData = calculateLucroMaximoScore(a, periodo);
      const score = scoreData.score;

      return { ...a, metrics, score, scoreData };
    })
    .filter(Boolean)
    // Garantimos que o score seja positivo e haja retorno esperado
    .filter((c) => c.score > 0);

  return cands;
}

function makeLinha_TOP(c, qtd) {
  const investido = qtd * c.metrics.preco;
  return {
    nome: c.nome,
    ticker: cleanTicker(c.ticker),
    preco: c.metrics.preco,
    quantidade: qtd,
    investido,
    lucro: qtd * c.metrics.lucroUnidade,
    setor: (() => {
      const sRaw = c.setor || c.sector || c.Setor || c.Sector || c.industry || c.Industry || c.indústria || c.Indústria || c.segmento || c.segment || "";
      let s = canon(sRaw);
      if (!s && String(c.ticker).includes(":")) {
        const p = String(c.ticker).split(":")[0].trim();
        if (p.length > 2) s = canon(p);
      }
      return s || "Outros";
    })(),
    score: c.score,
    taxaPct: c.metrics.taxaPct,
    dividendoAnual: c.metrics.dividendoAnual,
    divAnualAlloc: qtd * c.metrics.dividendoAnual,
    divPeriodoAlloc: qtd * c.metrics.totalDividendos,
    valorizAlloc: qtd * c.metrics.valorizacao,
  };
}
function sumarizar_TOP(linhas, investimento, gasto) {
  const totalLucro = linhas.reduce((s, l) => s + l.lucro, 0);
  const totalDivAnual = linhas.reduce((s, l) => s + l.divAnualAlloc, 0);
  const totalDivPeriodo = linhas.reduce((s, l) => s + l.divPeriodoAlloc, 0);
  const totalValoriz = linhas.reduce((s, l) => s + l.valorizAlloc, 0);
  return {
    linhas,
    totalLucro,
    totalGasto: gasto,
    totalDivAnual,
    totalDivPeriodo,
    totalValoriz,
    restante: Math.max(0, investimento - gasto),
  };
}

// FRACIONADO (proporcional ao score) com cap por ticker
function distribuirFracoes_porScore_TOP(cands, investimento) {
  const somaScore = cands.reduce((s, c) => s + c.score, 0);
  if (!(somaScore > 0))
    return {
      linhas: [],
      totalLucro: 0,
      totalGasto: 0,
      totalDivAnual: 0,
      totalDivPeriodo: 0,
      totalValoriz: 0,
      restante: investimento,
    };

  const capAbs = (TOP_CFG.CAP_PCT_POR_TICKER ?? 0.35) * investimento;
  const ord = [...cands].sort((a, b) => b.score - a.score);

  const alvos = new Map(
    ord.map((c) => [c, (c.score / somaScore) * investimento]),
  );

  const alloc = new Map();
  let restante = 0;
  for (const c of ord) {
    const alvo = alvos.get(c) || 0;
    const investido = Math.min(alvo, capAbs);
    alloc.set(c, investido);
    if (alvo > capAbs) restante += alvo - capAbs;
  }

  let progress = true;
  while (restante > 1e-6 && progress) {
    progress = false;
    const elig = ord.filter((c) => (alloc.get(c) || 0) + 1e-9 < capAbs);
    if (!elig.length) break;
    const somaElig = elig.reduce((s, c) => s + c.score, 0) || 1;

    for (const c of elig) {
      if (restante <= 1e-6) break;
      const share = (c.score / somaElig) * restante;
      const margem = Math.max(0, capAbs - (alloc.get(c) || 0));
      const add = Math.min(share, margem);
      if (add > 1e-6) {
        alloc.set(c, (alloc.get(c) || 0) + add);
        restante -= add;
        progress = true;
      }
    }
  }

  const linhas = [];
  let gasto = 0;
  for (const c of ord) {
    const investido = alloc.get(c) || 0;
    if (investido <= 0) continue;
    const qtd = c.metrics.preco > 0 ? investido / c.metrics.preco : 0;
    if (qtd <= 0) continue;
    linhas.push(makeLinha_TOP(c, qtd));
    gasto += investido;
  }
  return sumarizar_TOP(linhas, investimento, gasto);
}

// INTEIROS (cap prudente + guloso por retorno/€)
function distribuirInteiros_porScore_capped_TOP(cands, invest) {
  if (!(invest > 0) || !Array.isArray(cands) || cands.length === 0) {
    return { linhas: [], totalLucro: 0, totalGasto: 0, restante: invest };
  }

  const ord = [...cands].sort((a, b) => b.score - a.score);
  const n = ord.length;
  const capTop = 0.35 * invest;

  // targets prudentes
  const targets = new Map();
  if (n === 1) {
    targets.set(ord[0], Math.min(capTop, invest));
  } else if (n === 2) {
    targets.set(ord[0], 0.65 * invest);
    targets.set(ord[1], 0.35 * invest);
  } else {
    const top = ord[0],
      rest = ord.slice(1);
    const s = rest.reduce((x, c) => x + c.score, 0) || 1;
    const topT = Math.min(capTop, invest);
    const rem = Math.max(0, invest - topT);
    targets.set(top, topT);
    for (const c of rest) targets.set(c, rem * (c.score / s));
  }

  const base = ord.map((c) => {
    const p = c.metrics.preco,
      alvo = targets.get(c) || 0;
    const q = Math.max(0, Math.floor(p > 0 ? alvo / p : 0));
    return { c, q };
  });

  // ✅ bug fix: usar x.c
  let gasto = base.reduce((s, x) => s + x.q * x.c.metrics.preco, 0);
  let restante = invest - gasto;

  while (restante >= Math.min(...ord.map((c) => c.metrics.preco)) - 1e-9) {
    let best = null,
      bestR = -Infinity;
    for (const c of ord) {
      const p = c.metrics.preco;
      if (p > restante + 1e-9) continue;
      const invNow = (base.find((x) => x.c === c)?.q || 0) * p;
      if (invNow + p > capTop + 1e-9) continue;

      const rpe = (c.metrics.lucroUnidade || 0) / p;
      if (rpe > bestR) {
        bestR = rpe;
        best = c;
      }
    }
    if (!best) break;
    const rec = base.find((x) => x.c === best);
    rec.q += 1;
    gasto += best.metrics.preco;
    restante = invest - gasto;
  }

  const linhas = base
    .filter((x) => x.q > 0)
    .map((x) => makeLinha_TOP(x.c, x.q));
  return sumarizar_TOP(linhas, invest, gasto);
}

async function fetchAcoesBase() {
  const snap = await getDocs(collection(db, "acoesDividendos"));
  const allAssetsMap = new Map();
  snap.forEach(doc => { const x = doc.data(); if (x.ticker) allAssetsMap.set(String(x.ticker).toUpperCase(), x); });

  const out = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d || !d.ticker) return;
    if (isKnownETF(d.ticker)) enrichETFAsset(d, allAssetsMap);
    out.push({
      ...d, // Spread all fields (pe, evebitda, sma, etc) for the scoring engine
      nome: d.nome || d.ticker,
      ticker: cleanTicker(d.ticker),
      valorStock: Number(d.valorStock || 0),
      dividendoMedio24m: Number(d.dividendoMedio24m || 0),
      dividendo: Number(d.dividendo || 0),
      periodicidade: d.periodicidade || "Anual",
      g1w: Number(d.taxaCrescimento_1semana || d.priceChange_1w || 0),
      g1m: Number(d.taxaCrescimento_1mes || d.priceChange_1m || 0),
      g1y: Number(d.taxaCrescimento_1ano || d.priceChange_1y || 0),
    });
  });
  return out;
}

async function distribuirInvestimento(opts) {
  const {
    investimento,
    periodoSel,
    horizonte,
    acoesCompletas,
    usarTotal,
    incluirDiv,
  } = opts;
  const periodo = periodoSel === "1ano" ? "1a" : periodoSel;

  const base = await fetchAcoesBase();

  const cands = prepararCandidatos_TOP(base, {
    periodo,
    horizonte: Number(horizonte || 1),
    incluirDiv: incluirDiv ?? true, // ← aqui
    modoEstrito: !!usarTotal, // “Lucro Máximo” quando ligado
  });

  if (!cands.length) {
    return { linhas: [], totalLucro: 0, totalGasto: 0, restante: investimento };
  }

  const TOP_N = 10;
  const universo = [...cands].sort((a, b) => b.score - a.score).slice(0, TOP_N);

  return acoesCompletas
    ? distribuirInteiros_porScore_capped_TOP(universo, investimento)
    : distribuirFracoes_porScore_TOP(universo, investimento);
}

/* =========================
   SIMULADOR DE CAPITAL NECESSÁRIO
   ========================= */

function simularCenarioCapital(p0, pTarget, years, freq, isYield, divVal, reinvest) {
  let g = 0;
  if (years > 0 && pTarget > 0 && p0 > 0) {
    g = Math.pow(pTarget / p0, 1 / years) - 1;
  }
  
  const nPayments = Math.max(1, Math.floor(years * freq));
  const timeStep = years / nPayments;
  
  let shares = 1.0;
  let accumulatedCash = 0.0;
  let history = [];
  
  history.push({
    t: 0,
    price: p0,
    shares: shares,
    stockValue: p0,
    cashValue: 0,
    totalValue: p0,
    divReceivedCum: 0
  });
  
  let divReceivedCum = 0;
  
  for (let k = 1; k <= nPayments; k++) {
    const t = k * timeStep;
    const price = p0 * Math.pow(1 + g, t);
    
    let d = 0;
    if (isYield) {
      d = price * (divVal / 100) * timeStep;
    } else {
      d = divVal * timeStep;
    }
    
    const divReceived = shares * d;
    divReceivedCum += divReceived;
    
    if (reinvest) {
      shares += divReceived / price;
    } else {
      accumulatedCash += divReceived;
    }
    
    const stockValue = shares * price;
    const totalValue = stockValue + accumulatedCash;
    
    history.push({
      t: t,
      price: price,
      shares: shares,
      stockValue: stockValue,
      cashValue: accumulatedCash,
      totalValue: totalValue,
      divReceivedCum: divReceivedCum
    });
  }
  
  const finalPrice = pTarget;
  const finalShares = shares;
  const finalCashValue = accumulatedCash;
  const finalTotalValue = finalShares * finalPrice + finalCashValue;
  
  const returnPerShare = finalTotalValue - p0;
  const returnPerEuro = returnPerShare / p0;
  
  return {
    returnPerEuro,
    history,
    finalPrice,
    finalShares,
    finalCashValue,
    finalTotalValue,
    divReceivedCum,
    g
  };
}

function calcularCapitalNecessario() {
  const ticker = document.getElementById("capTicker")?.value?.trim() || "Ativo";
  const p0 = toNumber(document.getElementById("capPrecoAtual")?.value);
  const tp1 = toNumber(document.getElementById("capTP1")?.value);
  const tp2 = toNumber(document.getElementById("capTP2")?.value);
  const lucroDesejado = toNumber(document.getElementById("capLucroDesejado")?.value);
  const anosInput = toNumber(document.getElementById("capAnos")?.value);
  const mesesInput = toNumber(document.getElementById("capMeses")?.value);
  const freq = toNumber(document.getElementById("capFreqDiv")?.value);
  const tipoDiv = document.getElementById("capTipoDiv")?.value || "valor";
  const valorDiv = toNumber(document.getElementById("capValorDiv")?.value);
  const reinvestir = document.getElementById("capReinvestir")?.checked || false;

  const out = document.getElementById("resultadoCapital");
  if (!out) return;

  // Validations
  if (p0 <= 0) {
    alert("O preço atual deve ser superior a zero!");
    return;
  }
  if (tp1 <= 0) {
    alert("O preço-alvo TP1 deve ser superior a zero!");
    return;
  }
  if (lucroDesejado <= 0) {
    alert("O lucro desejado deve ser superior a zero!");
    return;
  }
  
  const totalMonths = anosInput * 12 + mesesInput;
  if (totalMonths <= 0) {
    alert("O horizonte temporal (Anos/Meses) deve ser superior a zero!");
    return;
  }

  const years = totalMonths / 12;

  // Scenario 1 (TP1)
  const res1 = simularCenarioCapital(p0, tp1, years, freq, tipoDiv === "yield", valorDiv, reinvestir);

  if (res1.returnPerEuro <= 0) {
    out.style.display = "block";
    out.innerHTML = `
      <div class="card" style="border-left: 4px solid #ef4444; background: rgba(239, 68, 68, 0.05); padding: 1rem;">
        <h4 style="color: #ef4444; margin: 0 0 0.5rem;">⚠️ Sem Retorno Positivo</h4>
        <p style="margin: 0;">Com as condições definidas para o TP1 (TP1 de ${euro(tp1)} vs Preço Atual de ${euro(p0)} e dividendos), o investimento não gera lucro positivo ou desvaloriza. Ajuste os preços-alvo ou dividendos.</p>
      </div>
    `;
    if (graficoCapital) {
      graficoCapital.destroy();
      graficoCapital = null;
    }
    document.getElementById("graficoCapitalWrapper").style.display = "none";
    return;
  }

  const C_1 = lucroDesejado / res1.returnPerEuro;
  const N_shares_1 = C_1 / p0;

  // Smart Alerts
  const alerts = [];
  const cagr1 = res1.g * 100;
  if (cagr1 > 35) {
    alerts.push({
      type: "warning",
      title: "Preço-Alvo TP1 Altamente Otimista",
      text: `O crescimento anual composto (CAGR) necessário de <strong>${cagr1.toFixed(1)}%</strong> é muito superior à média histórica do mercado (~8-10%). Certifique-se de que este otimismo é fundamentado.`
    });
  }

  let yieldAnn = 0;
  if (tipoDiv === "yield") {
    yieldAnn = valorDiv;
  } else if (p0 > 0) {
    yieldAnn = (valorDiv / p0) * 100;
  }
  if (yieldAnn > 12) {
    alerts.push({
      type: "warning",
      title: "Dividend Yield Excessivo",
      text: `Uma rentabilidade de dividendos de <strong>${yieldAnn.toFixed(1)}%</strong> é invulgarmente alta e pode sinalizar uma armadilha de dividendos (dividend trap) ou insustentabilidade.`
    });
  }

  if (totalMonths < 12) {
    alerts.push({
      type: "info",
      title: "Horizonte Curto",
      text: `Um horizonte temporal de apenas ${totalMonths} meses é muito suscetível à volatilidade de curto prazo. Investimentos em ações beneficiam tipicamente de horizontes mais longos (3+ anos).`
    });
  }

  if (C_1 > 100000) {
    alerts.push({
      type: "info",
      title: "Exigência de Capital Elevada",
      text: `Para atingir o lucro de <strong>${euro(lucroDesejado)}</strong> nas condições de TP1, necessita de investir um capital inicial considerável de <strong>${euro(C_1)}</strong>.`
    });
  }

  if (res1.returnPerEuro < 0.1) {
    alerts.push({
      type: "warning",
      title: "Eficiência de Capital Baixa",
      text: `Para ganhar <strong>${euro(lucroDesejado)}</strong>, precisa de imobilizar <strong>${euro(C_1)}</strong> (retorno total de apenas <strong>${(res1.returnPerEuro * 100).toFixed(1)}%</strong>). Considere ativos com maior potencial de valorização.`
    });
  }

  // Setup main results HTML
  let html = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
      <div class="card" style="border-left: 4px solid var(--primary); padding: 1.25rem; display: flex; flex-direction: column; justify-content: center;">
        <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--muted-foreground); font-weight: 600;">Capital Necessário (TP1)</span>
        <span style="font-size: 2rem; font-weight: 800; color: var(--primary); margin: 0.25rem 0;">${euro(C_1)}</span>
        <span class="muted">Para acumular um lucro de <strong>${euro(lucroDesejado)}</strong>.</span>
      </div>

      <div class="card" style="padding: 1.25rem;">
        <h4 style="margin: 0 0 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Detalhes do Cenário TP1 (${ticker})</h4>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.4rem;">
          <span class="muted">Ações Iniciais:</span>
          <strong>${N_shares_1.toFixed(2)} ações</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.4rem;">
          <span class="muted">Valorização de Preço:</span>
          <strong>${euro((tp1 - p0) * N_shares_1)} (+${((tp1 - p0)/p0 * 100).toFixed(1)}%)</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.4rem;">
          <span class="muted">Dividendos Acumulados:</span>
          <strong>${euro(res1.divReceivedCum * N_shares_1)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.4rem;">
          <span class="muted">Retorno % Total:</span>
          <strong class="up">+${(res1.returnPerEuro * 100).toFixed(2)}%</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700; border-top: 1px dashed var(--border); padding-top: 0.4rem;">
          <span>Valor Final Projetado:</span>
          <span>${euro(C_1 + lucroDesejado)}</span>
        </div>
      </div>
    </div>
  `;

  // Scenario 2 (TP2) comparison if filled
  let hasValidTP2 = false;
  let res2 = null;
  let C_2 = 0;
  let N_shares_2 = 0;
  if (tp2 > 0) {
    res2 = simularCenarioCapital(p0, tp2, years, freq, tipoDiv === "yield", valorDiv, reinvestir);
    if (res2.returnPerEuro > 0) {
      hasValidTP2 = true;
      C_2 = lucroDesejado / res2.returnPerEuro;
      N_shares_2 = C_2 / p0;

      const diffCap = C_2 - C_1;
      const diffCapPct = (diffCap / C_1) * 100;
      const diffRetorno = (res2.returnPerEuro - res1.returnPerEuro) * 100;

      html += `
        <div class="card" style="padding: 1.25rem; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 1rem; color: var(--foreground); display: flex; align-items: center; gap: 0.5rem;">
            <span>📊 Comparação Cenário TP1 vs Cenário TP2</span>
          </h4>
          <div class="tabela-scroll-wrapper">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
              <thead>
                <tr style="border-bottom: 2px solid var(--border);">
                  <th style="padding: 8px 4px;">Métrica</th>
                  <th style="padding: 8px 4px;">Cenário TP1 (${euro(tp1)})</th>
                  <th style="padding: 8px 4px;">Cenário TP2 (${euro(tp2)})</th>
                  <th style="padding: 8px 4px; text-align: right;">Diferença</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 8px 4px;"><strong>Capital Necessário</strong></td>
                  <td style="padding: 8px 4px;">${euro(C_1)}</td>
                  <td style="padding: 8px 4px;">${euro(C_2)}</td>
                  <td style="padding: 8px 4px; text-align: right;" class="${C_2 < C_1 ? 'up' : 'down'}">
                    <strong>${C_2 < C_1 ? '-' : '+'}${euro(Math.abs(diffCap))}</strong> (${diffCapPct.toFixed(1)}%)
                  </td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 8px 4px;"><strong>Ações Necessárias</strong></td>
                  <td style="padding: 8px 4px;">${N_shares_1.toFixed(2)}</td>
                  <td style="padding: 8px 4px;">${N_shares_2.toFixed(2)}</td>
                  <td style="padding: 8px 4px; text-align: right;">
                    <strong>${(N_shares_2 - N_shares_1).toFixed(2)} ações</strong>
                  </td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 8px 4px;"><strong>Retorno % Total</strong></td>
                  <td style="padding: 8px 4px;">+${(res1.returnPerEuro * 100).toFixed(2)}%</td>
                  <td style="padding: 8px 4px;">+${(res2.returnPerEuro * 100).toFixed(2)}%</td>
                  <td style="padding: 8px 4px; text-align: right;" class="${res2.returnPerEuro > res1.returnPerEuro ? 'up' : 'down'}">
                    <strong>${diffRetorno >= 0 ? '+' : ''}${diffRetorno.toFixed(2)}%</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 4px;"><strong>CAGR Requerido</strong></td>
                  <td style="padding: 8px 4px;">${(res1.g * 100).toFixed(2)}%</td>
                  <td style="padding: 8px 4px;">${(res2.g * 100).toFixed(2)}%</td>
                  <td style="padding: 8px 4px; text-align: right;">
                    <strong>${(res2.g * 100 - res1.g * 100) >= 0 ? '+' : ''}${(res2.g * 100 - res1.g * 100).toFixed(2)}%</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style="margin-top: 1rem; padding: 10px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; text-align: center; background: rgba(59, 130, 246, 0.05); color: var(--primary);">
            ${
              C_1 === C_2 ? "Os dois cenários de preços-alvo são idênticos." :
              C_2 < C_1 ? `💡 Cenário TP2 é mais eficiente: Requer menos <strong>${euro(C_1 - C_2)}</strong> (${Math.abs(diffCapPct).toFixed(1)}% poupado) para atingir os mesmos ${euro(lucroDesejado)}.` :
              `💡 Cenário TP1 é mais eficiente: Requer menos <strong>${euro(C_2 - C_1)}</strong> (${Math.abs(diffCapPct).toFixed(1)}% poupado) para atingir os mesmos ${euro(lucroDesejado)}.`
            }
          </div>
        </div>
      `;
    }
  }

  // Add Smart Alerts
  if (alerts.length > 0) {
    html += `
      <div class="smart-alerts" style="margin-top: 1rem; margin-bottom: 1.5rem;">
        <h4 style="margin: 0 0 0.75rem; color: var(--foreground);">⚠️ Alertas Inteligentes</h4>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${alerts.map(a => {
            const isWarning = a.type === "warning";
            const borderCol = isWarning ? "#eab308" : "#3b82f6";
            const bgCol = isWarning ? "rgba(234, 179, 8, 0.05)" : "rgba(59, 130, 246, 0.05)";
            const textCol = isWarning ? "#a16207" : "#1d4ed8";
            return `
              <div style="border-left: 4px solid ${borderCol}; background: ${bgCol}; color: ${textCol}; padding: 10px 12px; border-radius: 6px; font-size: 0.85rem; line-height: 1.4;">
                <strong>${a.title}:</strong> ${a.text}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  out.innerHTML = html;
  out.style.display = "block";

  // Chart Rendering
  const canvas = document.getElementById("graficoCapital");
  if (canvas) {
    if (graficoCapital) graficoCapital.destroy();
    document.getElementById("graficoCapitalWrapper").style.display = "block";
    const ctx = canvas.getContext("2d");

    // Labels for the steps
    const labels = res1.history.map(h => {
      const yr = Math.floor(h.t);
      const mo = Math.round((h.t - yr) * 12);
      if (yr > 0 && mo > 0) return `${yr}a ${mo}m`;
      if (yr > 0) return `${yr}a`;
      return `${mo}m`;
    });

    if (hasValidTP2 && res2) {
      // Comparison chart: 2 lines
      const dataTP1 = res1.history.map(h => h.totalValue * N_shares_1);
      const dataTP2 = res2.history.map(h => h.totalValue * N_shares_2);

      graficoCapital = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: `Total TP1 (Investimento: ${euro(C_1)})`,
              data: dataTP1,
              borderColor: "#3b82f6",
              backgroundColor: "rgba(59, 130, 246, 0.05)",
              borderWidth: 2,
              fill: false,
              tension: 0.1
            },
            {
              label: `Total TP2 (Investimento: ${euro(C_2)})`,
              data: dataTP2,
              borderColor: "#10b981",
              backgroundColor: "rgba(16, 185, 129, 0.05)",
              borderWidth: 2,
              fill: false,
              tension: 0.1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom" }
          },
          scales: {
            y: {
              ticks: {
                callback: (value) => euro(value)
              }
            }
          }
        }
      });
    } else {
      // Single scenario: stacked bar chart showing components
      const dataCapital = res1.history.map(() => C_1);
      const dataValorizacao = res1.history.map(h => Math.max(0, h.totalValue * N_shares_1 - C_1 - h.divReceivedCum * N_shares_1));
      const dataDividends = res1.history.map(h => h.divReceivedCum * N_shares_1);

      graficoCapital = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Capital Inicial",
              data: dataCapital,
              backgroundColor: "rgba(59, 130, 246, 0.7)",
              borderColor: "#3b82f6",
              borderWidth: 1
            },
            {
              label: "Valorização do Ativo",
              data: dataValorizacao,
              backgroundColor: "rgba(245, 158, 11, 0.7)",
              borderColor: "#f59e0b",
              borderWidth: 1
            },
            {
              label: "Dividendos Acumulados",
              data: dataDividends,
              backgroundColor: "rgba(16, 185, 129, 0.7)",
              borderColor: "#10b981",
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom" }
          },
          scales: {
            x: { stacked: true },
            y: {
              stacked: true,
              ticks: {
                callback: (value) => euro(value)
              }
            }
          }
        }
      });
    }
  }
}

/* =========================
   EMAIL (mailto)
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
    panels.forEach((p) => p.classList.remove("active"));
    const t = document.getElementById(id);
    if (t) {
      t.classList.add("active");
      
      // Inicializar painel específico se necessário
      if (id === "panel-guardadas") {
        carregarSimulacoesGuardadas();
      }

      if (window.matchMedia("(max-width: 820px)").matches) {
        t.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      activatePanel(targetId);
    });
  });

  // Quick amount
  document.querySelectorAll("[data-quick]").forEach((el) => {
    el.addEventListener("click", () => {
      const v = toNumber(el.getAttribute("data-quick"));
      const investInput = document.getElementById("investimento");
      if (investInput) investInput.value = v;
    });
  });

  // Simular com gráfico
  document
    .getElementById("btnSimularGrafico")
    ?.addEventListener("click", simularEGUardar);

  // 🔹 Limpar só inputs (NÃO mexe em tabela/gráfico)
  document
    .getElementById("btnLimparInputs")
    ?.addEventListener("click", limparInputsSimulacao);

  // 🔹 Limpar gráfico + tabela (tudo)
  document
    .getElementById("btnLimparGrafico")
    ?.addEventListener("click", limparGrafico);

  // Enviar email
  document
    .getElementById("btnEnviarEmail")
    ?.addEventListener("click", enviarEmailResumo);

  // Delegation: remover linha + checkboxes
  document
    .querySelector("#tabelaSimulacoes tbody")
    ?.addEventListener("click", (e) => {
      const rm = e.target.closest(".btn-remove");
      if (rm) {
        const idx = parseInt(rm.dataset.index, 10);
        if (!isNaN(idx)) removerSimulacao(idx);
      }
    });

  // Reforço (média ponderada)
  document
    .getElementById("btnCalcularReforco")
    ?.addEventListener("click", calcularMediaPonderada);
  document.getElementById("btnLimparReforco")?.addEventListener("click", () => {
    ["invest1", "preco1", "invest22", "preco2"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const out = document.getElementById("resultadoReforco");
    if (out) out.innerHTML = "";
  });

  // Transferência Reforço -> TP2
  document.getElementById("resultadoReforco")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-transfer-tp2");
    if (btn) {
      const pm = btn.dataset.pm;
      const total = btn.dataset.total;

      const tp1Input = document.getElementById("tp1Input");
      const invInput = document.getElementById("investimentoInput");

      if (tp1Input) tp1Input.value = pm;
      if (invInput) invInput.value = total;

      activatePanel("panel-tp2");
    }
  });

  // TP2
  document
    .getElementById("btnCalcularTP2")
    ?.addEventListener("click", calcularTP2);
  document.getElementById("btnLimparTP2")?.addEventListener("click", () => {
    ["tp1Input", "investimentoInput", "lucroDesejadoInput"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const out = document.getElementById("resultadoTP2");
    if (out) out.innerHTML = "";
  });

  // === TOP 10 ===

  // estado inicial das checkboxes
  const chkUsarTotal = document.getElementById("chkUsarTotal");
  const chkAcoesCompletas = document.getElementById("chkAcoesCompletas");
  if (chkUsarTotal) chkUsarTotal.checked = true;
  if (chkAcoesCompletas) chkAcoesCompletas.checked = false;

  // exclusividade
  chkUsarTotal?.addEventListener("change", () => {
    if (chkUsarTotal.checked) chkAcoesCompletas.checked = false;
  });
  chkAcoesCompletas?.addEventListener("change", () => {
    if (chkAcoesCompletas.checked) chkUsarTotal.checked = false;
  });

  // simular
  document
    .getElementById("btnSimularTop10")
    ?.addEventListener("click", async () => {
      const investimento = Number(
        document.getElementById("inputInvestimento")?.value || 0,
      );
      const periodoSel =
        document.getElementById("inputPeriodo")?.value || "1ano";
      const horizonte = Math.max(
        1,
        Number(document.getElementById("inputHorizonte")?.value || 1),
      );
      const usarTotal = !!document.getElementById("chkUsarTotal")?.checked;
      const acoesCompletas =
        !!document.getElementById("chkAcoesCompletas")?.checked;
      const incluirDiv = document.getElementById("chkIncluirDiv")
        ? !!document.getElementById("chkIncluirDiv").checked
        : true; // default: inclui dividendos

      if (!investimento || investimento <= 0) {
        alert("Indica o montante a investir.");
        return;
      }

      const opts = {
        investimento,
        periodoSel,
        horizonte,
        usarTotal,
        acoesCompletas,
        incluirDiv,
      };
      const box = document.getElementById("resultadoSimulacao");
      if (box) box.innerHTML = `<div class="card">A simular…</div>`;

      try {
        const resultado = await distribuirInvestimento(opts);
        if (box) renderResultado(box, resultado, opts);
      } catch (err) {
        console.error(err);
        if (box)
          box.innerHTML = `<div class="card"><p class="muted">Ocorreu um erro na simulação.</p></div>`;
      }
    });

  // limpar
  document.getElementById("btnLimparTop10")?.addEventListener("click", () => {
    const investEl = document.getElementById("inputInvestimento");
    const perEl = document.getElementById("inputPeriodo");
    const horEl = document.getElementById("inputHorizonte");
    const box = document.getElementById("resultadoSimulacao");

    if (investEl) investEl.value = "";
    if (perEl) perEl.value = "1ano";
    if (horEl) horEl.value = 1;
    if (chkUsarTotal) chkUsarTotal.checked = true;
    if (chkAcoesCompletas) chkAcoesCompletas.checked = false;
    if (box) box.innerHTML = "";
  });

  // === CAPITAL NECESSÁRIO ===
  document.getElementById("btnCalcularCapital")?.addEventListener("click", calcularCapitalNecessario);

  document.getElementById("btnLimparCapital")?.addEventListener("click", () => {
    ["capTicker", "capPrecoAtual", "capTP1", "capTP2", "capLucroDesejado", "capValorDiv"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const capAnos = document.getElementById("capAnos");
    if (capAnos) capAnos.value = "1";
    const capMeses = document.getElementById("capMeses");
    if (capMeses) capMeses.value = "0";
    const capFreq = document.getElementById("capFreqDiv");
    if (capFreq) capFreq.value = "1";
    const capTipo = document.getElementById("capTipoDiv");
    if (capTipo) capTipo.value = "valor";
    const capReinvest = document.getElementById("capReinvestir");
    if (capReinvest) capReinvest.checked = false;

    const out = document.getElementById("resultadoCapital");
    if (out) {
      out.innerHTML = "";
      out.style.display = "none";
    }
    if (graficoCapital) {
      graficoCapital.destroy();
      graficoCapital = null;
    }
    const wrapper = document.getElementById("graficoCapitalWrapper");
    if (wrapper) wrapper.style.display = "none";
  });

  // Presets para Lucro Desejado
  document.querySelectorAll("[data-cap-quick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-cap-quick");
      const el = document.getElementById("capLucroDesejado");
      if (el) el.value = val;
    });
  });
}
