// js/screens/dashboard.js
import { db } from "../firebase-config.js";
import {
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
  addDoc,
  serverTimestamp,
  getDocs,
  doc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  calculateLucroMaximoScore,
  getUserWeights,
  SCORING_CFG,
  canon,
  cleanTicker,
  normalizeSector
} from "../utils/scoring.js";
import { toNumStrict } from "../utils/num.js";
import { Treemap } from "../components/treemap.js";
import { canonicalTicker, getAssetCategory } from "../utils/normalize.js";
import * as CapitalManager from "../utils/capitalManager.js";
import { aggregatePortfolioPositions } from "../utils/portfolioPositions.js";
import { subscribeMarketData } from "../utils/marketDataStore.js";
import { checkAlerts, loadAlerts } from "../utils/alerts.js";
import { portfolioHealth } from "../engines/portfolio-health.js";
import { stressTest } from "../engines/stress-test.js";
import { riskContribution } from "../engines/risk-contrib.js";
import { analyzeETFOverlap, isKnownETF, smartETFAnalysis, enrichETFAsset } from "../engines/etf-overlap.js";

let lastAtivosSnap = null;
let lastAcoesSnap = null;
let treemapInstance = null;
let unsubAtivos = null;
let unsubAcoes = null;
let unsubConfig = null;
let lastConfigData = null;
let histFltState = { ticker: "", tipo: "", periodo: "" };
const STARTUP_BRIEF_SESSION_KEY = "fin_startup_brief_seen_v1";


export async function initScreen() {
  console.log("✅ dashboard.js iniciado");

  // Limpar listeners antigos se existirem (evita leaks ao navegar entre screens)
  if (unsubAtivos) unsubAtivos();
  if (unsubAcoes) unsubAcoes();
  if (unsubConfig) unsubConfig();

  // --- ELEMENTOS DA UI ---
  const valorTotalEl = document.getElementById("valorTotal");
  const retornoEl = document.getElementById("retornoTotal");
  const lucroTotalEl = document.getElementById("lucroTotal");
  const posicoesEl = document.getElementById("posicoesAtivas");
  const objetivosEl = document.getElementById("objetivosFinanceiros");
  const taxaSucessoEl = document.getElementById("taxaSucesso");
  const objectiveTotalEl = document.getElementById("objetivoTotal");
  const valorCarteiraEl = document.getElementById("valorCarteira");

  // Função interna para atualizar KPIs baseada nos snapshots guardados
  const atualizarKPIs = () => {
    if (!lastAtivosSnap || !lastAcoesSnap) return;

    let totalInvestido = 0;
    let lucroNaoRealizadoTotal = 0;
    let lucroRealizadoTotal = 0;
    let objetivoFinanceiroTotal = 0;
    let objetivosAtingidos = 0;

    // Mapa de preços atuais por TICKER
    const valorAtualMap = new Map();
    lastAcoesSnap.forEach((doc) => {
      const d = doc.data();
      if (d.ticker && d.valorStock !== undefined && d.valorStock !== null) {
        const preco = Number(d.valorStock);
        if (!isNaN(preco)) {
          // Usar cleanTicker para garantir correspondência com outros ecrãs
          valorAtualMap.set(cleanTicker(d.ticker), preco);
        }
      }
    });

    // Agrupar ativos por TICKER usando a mesma lógica FIFO do screen Portfólio
    const { groups: agrupadoPorTicker } = aggregatePortfolioPositions(lastAtivosSnap);

    let totalObjetivos = 0;
    agrupadoPorTicker.forEach((g, ticker) => {
      const precoAtual = valorAtualMap.get(ticker) || 0;
      const valorMercadoAtual = g.qtd * precoAtual;
      const lucroNaoRealizado = valorMercadoAtual - g.investido;

      totalInvestido += g.investido;
      lucroNaoRealizadoTotal += lucroNaoRealizado;
      lucroRealizadoTotal += g.realizado;

      if (g.anyObjSet && g.qtd > 0) {
        totalObjetivos++;
        objetivoFinanceiroTotal += g.objetivo;
        if (lucroNaoRealizado + g.realizado >= g.objetivo)
          objetivosAtingidos++;
      }
    });

    const totalLucroAcumulado = lucroNaoRealizadoTotal + lucroRealizadoTotal;
    
    // Novo Cálculo de Retorno: Baseado no total investido em aberto para o retorno da exposição atual,
    // mas guardamos o lucro acumulado para o retorno global se preferível.
    // Para resolver a volatilidade, usamos o total investido original se quisermos ROI histórico.
    // Contudo, mantemos a lógica mas garantimos que não explode se totalInvestido for minúsculo.
    const retorno =
      totalInvestido > 0.01 ? (totalLucroAcumulado / totalInvestido) * 100 : (totalLucroAcumulado > 0 ? 100 : 0);

    // Progresso para Objetivo (anterior Taxa de Sucesso):
    // Main (Atual): Lucro Aberto / Objetivo Total (Capado a 0% se negativo para evitar confusões de -1000%)
    // Sub (Acumulada): Lucro Acumulado / Objetivo Total
    let taxaSucessoAtual =
      objetivoFinanceiroTotal > 0
        ? (lucroNaoRealizadoTotal / objetivoFinanceiroTotal) * 100
        : 0;

    // Se o progresso for negativo (prejuízo), mostramos 0% para o indicador de "sucesso"
    // mas mantemos o valor real se o usuário quiser ver o quão longe está (opcional).
    // Conforme o plano: "Limitar o valor mínimo a 0%"
    if (taxaSucessoAtual < 0) taxaSucessoAtual = 0;

    const taxaSucessoAcumulada =
      objetivoFinanceiroTotal > 0
        ? (totalLucroAcumulado / objetivoFinanceiroTotal) * 100
        : 0;

    const valorCarteira = totalInvestido + lucroNaoRealizadoTotal;

    const fmtEUR = new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "EUR",
    });
    const lucroAcumuladoEl = document.getElementById("lucroAcumulado");
    const taxaSucessoAcumEl = document.getElementById("taxaSucessoAcumulada");

    if (valorTotalEl) valorTotalEl.textContent = fmtEUR.format(totalInvestido);
    if (lucroTotalEl)
      lucroTotalEl.textContent = fmtEUR.format(lucroNaoRealizadoTotal);
    if (lucroAcumuladoEl)
      lucroAcumuladoEl.textContent = `Total acumulado: ${fmtEUR.format(totalLucroAcumulado)}`;
    if (retornoEl)
      retornoEl.textContent =
        totalInvestido > 0 ? `${retorno.toFixed(1)}%` : "---";
    if (posicoesEl)
      posicoesEl.textContent = Array.from(agrupadoPorTicker.values()).filter(
        (g) => g.qtd > 0,
      ).length;
    if (objetivosEl)
      objetivosEl.textContent = `${objetivosAtingidos}/${totalObjetivos}`;
    if (objectiveTotalEl)
      objectiveTotalEl.textContent = fmtEUR.format(objetivoFinanceiroTotal);
    if (taxaSucessoEl)
      taxaSucessoEl.textContent = `${taxaSucessoAtual.toFixed(1)}%`;
    if (taxaSucessoAcumEl)
      taxaSucessoAcumEl.textContent = `Total acumulado: ${taxaSucessoAcumulada.toFixed(1)}%`;
    if (valorCarteiraEl)
      valorCarteiraEl.textContent = `${fmtEUR.format(valorCarteira)} valor em carteira`;

    // --- NOVA LÓGICA: Capital Manager ---
    renderCapitalStrategy(agrupadoPorTicker, valorAtualMap);
    renderStartupPortfolioBrief(agrupadoPorTicker, valorAtualMap);
  };

  // Se já tivermos dados de uma navegação anterior, mostramos logo
  if (lastAtivosSnap && lastAcoesSnap) {
    console.log("⚡ Usando snapshots em cache para renderização imediata");
    atualizarKPIs();
    const contAtividade = document.getElementById("atividadeRecente");
    if (contAtividade) carregarAtividadeRecenteSimplificada(lastAtivosSnap);
  }

  // Listeners em tempo real
  unsubAtivos = onSnapshot(
    query(collection(db, "ativos"), orderBy("dataCompra", "desc")),
    (snap) => {
      lastAtivosSnap = snap;
      atualizarKPIs();
      const contAtividade = document.getElementById("atividadeRecente");
      if (contAtividade) carregarAtividadeRecenteSimplificada(snap);
    },
  );

  // Wire History filters
  const hTicker = document.getElementById("histFltTicker");
  const hTipo = document.getElementById("histFltTipo");
  const hPeriodo = document.getElementById("histFltPeriodo");

  hTicker?.addEventListener("input", () => {
    histFltState.ticker = hTicker.value.trim().toUpperCase();
    handleUpdateHistory();
  });
  [hTipo, hPeriodo].forEach((el) => {
    el?.addEventListener("change", () => {
      histFltState.tipo = hTipo?.value || "";
      histFltState.periodo = hPeriodo?.value || "";
      handleUpdateHistory();
    });
  });

  const handleUpdateHistory = () => {
    if (lastAtivosSnap) carregarAtividadeRecenteSimplificada(lastAtivosSnap);
  };

  unsubAcoes = subscribeMarketData((_map, snap) => {
    lastAcoesSnap = snap;
    atualizarKPIs();
    // Se o modal de oportunidades estiver aberto, atualizamos o treemap em tempo real
    const modal = document.getElementById("opModal");
    if (modal && !modal.classList.contains("hidden")) {
      carregarTop10Crescimento(opPeriodoAtual);
    }
  });

  unsubConfig = onSnapshot(doc(db, "config", "strategy"), (snap) => {
    if (snap.exists()) {
      lastConfigData = snap.data();
      atualizarKPIs(); // Re-calcula e renderiza a estratégia
    }
  });

  // 3) Botões
  document
    .getElementById("btnOportunidades")
    ?.addEventListener("click", openOportunidades);
  document
    .getElementById("opClose")
    ?.addEventListener("click", closeOportunidades);
  document.getElementById("opModal")?.addEventListener("click", (e) => {
    if (e.target.id === "opModal") closeOportunidades();
  });

  setupStartupBriefModal();

  // Chips do período no popup
  document.querySelectorAll("#opModal .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-periodo");
      opPeriodoAtual = p || "1s";
      setActiveChip(opPeriodoAtual);
      carregarTop10Crescimento(opPeriodoAtual);
    });
  });

  // --- Modal: Adicionar Ação ---
  const btnAdd = document.getElementById("btnAddAcao");
  const addModal = document.getElementById("addModal");
  const addClose = document.getElementById("addClose");
  const addCancel = document.getElementById("addCancel");
  const addForm = document.getElementById("addForm");
  const tipoAcaoSel = document.getElementById("tipoAcao");
  const labelPreco = document.getElementById("labelPreco");

  // abre
  btnAdd?.addEventListener("click", () => {
    addModal?.classList.remove("hidden");
  });

  // fecha
  function closeAddModal() {
    addModal?.classList.add("hidden");
    addForm?.reset();
    // repõe o label e data (caso tenha mudado)
    if (labelPreco)
      labelPreco.firstChild.textContent = "Preço da transação (€)";
    const fData = document.getElementById("dataAtivo");
    if (fData) fData.value = new Date().toISOString().split("T")[0];
  }
  addClose?.addEventListener("click", closeAddModal);
  addCancel?.addEventListener("click", closeAddModal);
  addModal?.addEventListener("click", (e) => {
    if (e.target.id === "addModal") closeAddModal();
  });

  // muda o label conforme compra/venda (puramente visual)
  tipoAcaoSel?.addEventListener("change", () => {
    if (!labelPreco) return;
    if (tipoAcaoSel.value === "venda") {
      labelPreco.firstChild.textContent = "Preço de venda (€)";
    } else {
      labelPreco.firstChild.textContent = "Preço de compra (€)";
    }
  });

  // submit
  addForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tipoAcao = (
      document.getElementById("tipoAcao")?.value || "compra"
    ).toLowerCase();
    const nome = (document.getElementById("nomeAtivo")?.value || "").trim();
    const ticker = (document.getElementById("tickerAtivo")?.value || "")
      .trim()
      .toUpperCase();
    const setor = (document.getElementById("setorAtivo")?.value || "").trim();
    const mercado = (
      document.getElementById("mercadoAtivo")?.value || ""
    ).trim();
    const qtdRaw = Number(
      document.getElementById("quantidadeAtivo")?.value || 0,
    );
    const preco = Number(document.getElementById("precoAtivo")?.value || 0);
    const objetivo = Number(
      document.getElementById("objetivoAtivo")?.value || 0,
    );

    if (!nome || !ticker || !qtdRaw || !preco) {
      alert("Preenche pelo menos: Tipo, Nome, Ticker, Quantidade e Preço.");
      return;
    }

    // ── regra simples: vendas entram como quantidade negativa e usam o mesmo campo 'precoCompra'
    const quantidade =
      tipoAcao === "venda" ? -Math.abs(qtdRaw) : Math.abs(qtdRaw);

    const payload = {
      tipoAcao, // "compra" ou "venda" (útil para auditoria)
      nome,
      ticker,
      setor,
      mercado,
      quantidade, // negativo na venda
      precoCompra: preco, // mantém a compatibilidade com os teus cálculos atuais
      objetivoFinanceiro: isNaN(objetivo) ? 0 : objetivo,
      dataCompra: (() => {
        const dVal = document.getElementById("dataAtivo")?.value;
        return dVal ? Timestamp.fromDate(new Date(dVal)) : serverTimestamp();
      })(),
    };

    try {
      await addDoc(collection(db, "ativos"), payload);
      closeAddModal();
      // Removido window.location.reload() - a atualização é agora em tempo real via onSnapshot
    } catch (err) {
      console.error("❌ Erro ao guardar ativo:", err);
      alert("Não foi possível guardar. Tenta novamente.");
    }
  });
  wireDashBuy();
}

/**
 * Renderiza a secção de Estratégia de Capital e War Chest
 */
function setupStartupBriefModal() {
  const modal = document.getElementById("startupBriefModal");
  if (!modal || modal.__wired) return;
  modal.__wired = true;

  const close = () => {
    modal.classList.add("hidden");
    sessionStorage.setItem(STARTUP_BRIEF_SESSION_KEY, "1");
  };

  modal.querySelector("#startupBriefClose")?.addEventListener("click", close);
  modal.querySelector("#startupBriefLater")?.addEventListener("click", close);
  modal.querySelector("#startupBriefIntel")?.addEventListener("click", () => {
    close();
    window.navigateTo?.("portfolio-intel");
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
}

function renderStartupPortfolioBrief(agrupadoPorTicker, valorAtualMap) {
  const modal = document.getElementById("startupBriefModal");
  const body = document.getElementById("startupBriefBody");
  if (!modal || !body || !lastAcoesSnap) return;

  const infoMap = buildTickerInfoMap();
  const positions = buildBriefPositions(agrupadoPorTicker, valorAtualMap, infoMap);
  if (!positions.length) return;

  const totalValue = positions.reduce((sum, p) => sum + p.valAtual, 0);
  const totalInvested = positions.reduce((sum, p) => sum + p.investido, 0);
  const openPnL = positions.reduce((sum, p) => sum + p.pnl, 0);
  const realizedPnL = positions.reduce((sum, p) => sum + (p.realizado || 0), 0);
  const achievedObjectives = positions.filter((p) => p.objetivo > 0 && p.pnl + (p.realizado || 0) >= p.objetivo).length;
  const objectiveCount = positions.filter((p) => p.objetivo > 0).length;

  const health = portfolioHealth(positions, totalValue);
  const stress = stressTest(positions, totalValue);
  const risk = riskContribution(positions, totalValue);
  const etfOverlap = analyzeETFOverlap(positions);
  const triggered = checkAlerts(positions, infoMap);
  const fired = loadAlerts()
    .filter((a) => a.fired && a.lastMessage)
    .map((a) => ({ alert: a, message: a.lastMessage, alreadyFired: true }));

  const urgentItems = buildUrgentBriefItems({ positions, health, stress, risk, etfOverlap, triggered, fired, totalValue });
  const actions = buildBriefActions({ positions, health, stress, risk, urgentItems, objectiveCount, achievedObjectives });
  const objectives = buildObjectiveBriefItems(positions);
  const topPosition = [...positions].sort((a, b) => b.valAtual - a.valAtual)[0];
  const topSector = getTopSector(positions, totalValue);

  const updatedAt = new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  body.innerHTML = `
    <section class="startup-brief-hero">
      <div>
        <p class="startup-brief-kicker">Briefing de abertura</p>
        <h2>${getBriefHeadline(urgentItems.length, health.score)}</h2>
        <p class="muted">Atualizado em ${updatedAt}. Prioriza alertas, risco e objetivos antes de olhar para detalhes.</p>
      </div>
      <div class="startup-brief-score ${getBriefScoreClass(health.score)}">
        <span>${health.score}</span>
        <small>Saude<br>estrutural</small>
      </div>
    </section>

    <section class="startup-brief-metrics" aria-label="Resumo essencial do portfolio">
      ${briefMetric("Valor em carteira", fmtBriefEUR(totalValue), "fa-wallet")}
      ${briefMetric("Lucro aberto", fmtBriefEUR(openPnL), openPnL >= 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", openPnL >= 0 ? "positive" : "negative", "Posicoes atuais vs custo medio") }
      ${briefMetric("Retorno aberto", totalInvested > 0 ? `${((openPnL / totalInvested) * 100).toFixed(1)}%` : "---", "fa-percent")}
      ${briefMetric("Objetivos", `${achievedObjectives}/${objectiveCount}`, "fa-bullseye")}
      ${briefMetric("Stress pior caso", stress.worstCase ? `${stress.worstCase.portfolioDropPct}%` : "---", "fa-shield-halved", stress.worstCase?.portfolioDropPct <= -25 ? "negative" : "")}
      ${briefMetric("Lucro acumulado", fmtBriefEUR(openPnL + realizedPnL), "fa-coins", openPnL + realizedPnL >= 0 ? "positive" : "negative", "Aberto + vendas realizadas") }
    </section>


    <section class="startup-brief-objectives">
      <div class="startup-brief-panel-title">
        <i class="fas fa-bullseye"></i>
        <h3>Objetivos em aberto</h3>
      </div>
      <div class="startup-brief-objective-list">
        ${objectives.length ? objectives.map(renderObjectiveItem).join("") : `<div class="startup-brief-empty">Sem objetivos configurados nas posicoes atuais.</div>`}
      </div>
    </section>
    <section class="startup-brief-grid">
      <div class="startup-brief-panel urgent">
        <div class="startup-brief-panel-title">
          <i class="fas fa-triangle-exclamation"></i>
          <h3>Alertas urgentes</h3>
        </div>
        <div class="startup-brief-list">
          ${urgentItems.length ? urgentItems.slice(0, 6).map(renderUrgentItem).join("") : `<div class="startup-brief-empty">Sem alertas urgentes neste momento.</div>`}
        </div>
      </div>

      <div class="startup-brief-panel">
        <div class="startup-brief-panel-title">
          <i class="fas fa-list-check"></i>
          <h3>O que fazer agora</h3>
        </div>
        <div class="startup-brief-actions-list">
          ${actions.map((a) => `<div class="startup-brief-action ${a.type}"><strong>${a.title}</strong><span>${a.text}</span></div>`).join("")}
        </div>
      </div>
    </section>

    <section class="startup-brief-exposure">
      <div>
        <span>Maior posicao bruta</span>
        <strong>${escapeBrief(topPosition?.ticker || "---")}</strong>
        <small>${topPosition ? getPositionContextLabel(topPosition, totalValue) : "---"}</small>
      </div>
      <div>
        <span>Maior setor</span>
        <strong>${escapeBrief(topSector.name)}</strong>
        <small>${fmtBriefPct(topSector.weight)} do portfolio</small>
      </div>
      <div>
        <span>Risco escondido</span>
        <strong>${health.hiddenRiskScore}/100</strong>
        <small>${health.classification || "---"}</small>
      </div>
      <div>
        <span>Beta estimado</span>
        <strong>${risk.portfolioBeta || "---"}</strong>
        <small>Distribuicao de risco: ${risk.riskDistributionScore || 0}/100</small>
      </div>
    </section>
  `;

  if (sessionStorage.getItem(STARTUP_BRIEF_SESSION_KEY) !== "1" && !modal.__openedOnce) {
    modal.__openedOnce = true;
    modal.classList.remove("hidden");
  }
}

function buildTickerInfoMap() {
  const infoMap = new Map();
  lastAcoesSnap?.forEach((docu) => {
    const data = docu.data();
    const ticker = cleanTicker(String(data.ticker || "").toUpperCase());
    if (ticker) infoMap.set(ticker, data);
  });
  return infoMap;
}

function buildBriefPositions(agrupadoPorTicker, valorAtualMap, infoMap) {
  return Array.from(agrupadoPorTicker.values())
    .filter((g) => g.qtd > 0)
    .map((g) => {
      const info = infoMap.get(g.ticker) || {};
      const precoAtual = Number(valorAtualMap.get(g.ticker) ?? info.valorStock ?? 0);
      const valAtual = g.qtd * Math.max(precoAtual, 0);
      return {
        ...g,
        precoAtual,
        valAtual,
        pnl: valAtual - (g.investido || 0),
        pnlPct: g.investido > 0 ? ((valAtual - g.investido) / g.investido) * 100 : 0,
        mkt: info,
        setor: normalizeSector(info) || g.setor,
      };
    })
    .filter((p) => p.valAtual > 0 || p.investido > 0);
}

function buildUrgentBriefItems({ positions, health, stress, risk, etfOverlap, triggered, fired, totalValue }) {
  const items = [];
  const seenMessages = new Set();
  const topRisk = risk.contributions?.[0];
  const topRiskPosition = positions.find((p) => p.ticker === topRisk?.ticker);
  const topRiskIsBroadETF = topRiskPosition && isBroadMarketETF(topRiskPosition);

  for (const item of [...triggered, ...fired]) {
    if (!item.message || seenMessages.has(item.message)) continue;
    seenMessages.add(item.message);
    items.push({ severity: "critical", title: "Alerta configurado", text: item.message });
  }

  const coreInsight = buildCoreRiskInsight(topRiskPosition, topRisk, totalValue);
  if (coreInsight) items.push(coreInsight);

  for (const warning of (health.warnings || [])) {
    if (isDuplicateConcentrationWarning(warning, topRiskPosition, topRiskIsBroadETF)) continue;
    items.push({ severity: health.score < 50 ? "critical" : "warning", title: "Estrutura do portfolio", text: warning });
  }

  for (const warning of (risk.warnings || [])) {
    if (isDuplicateConcentrationWarning(warning, topRiskPosition, topRiskIsBroadETF)) continue;
    items.push({ severity: "warning", title: "Contribuicao de risco", text: warning });
  }

  if (etfOverlap?.knownETFs?.length) {
    for (const warning of (etfOverlap.warnings || []).slice(0, 2)) {
      items.push({ severity: "warning", title: "Look-through de ETFs", text: warning });
    }
  }

  if (stress.worstCase && stress.worstCase.portfolioDropPct <= -30) {
    items.push({
      severity: stress.worstCase.portfolioDropPct <= -40 ? "critical" : "warning",
      title: "Stress test severo",
      text: `${stress.worstCase.name}: perda estimada de ${stress.worstCase.portfolioDropPct}% (${fmtBriefEUR(stress.worstCase.estimatedLoss)}).`,
    });
  }

  const heavy = [...positions].sort((a, b) => b.valAtual - a.valAtual)[0];
  if (heavy && totalValue > 0 && heavy.valAtual / totalValue >= 0.25 && !isBroadMarketETF(heavy)) {
    items.push({ severity: "warning", title: "Posicao dominante", text: `${heavy.ticker} representa ${fmtBriefPct(heavy.valAtual / totalValue)} do portfolio.` });
  }

  for (const p of positions.filter((x) => x.pnlPct <= -15).sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 2)) {
    items.push({ severity: "warning", title: "Queda relevante", text: `${p.ticker} esta com ${p.pnlPct.toFixed(1)}% de perda aberta (${fmtBriefEUR(p.pnl)}).` });
  }

  return dedupeBriefItems(items).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}
function buildCoreRiskInsight(position, contribution, totalValue) {
  if (!position || !contribution || contribution.riskContribution < 35) return null;

  const weight = totalValue > 0 ? (position.valAtual || 0) / totalValue : 0;
  if (isBroadMarketETF(position)) {
    const etf = isKnownETF(position.ticker) ? smartETFAnalysis(position.ticker) : null;
    const lookThrough = etf
      ? ` Top 10 interno: ${etf.top10Concentration.toFixed(1)}%, logo nao equivale a uma single stock.`
      : " E uma ancora diversificada; avaliar por dependencia da ancora, nao por concentracao numa acao.";

    return {
      severity: contribution.riskContribution >= 70 ? "warning" : "info",
      title: "Ancora core dominante",
      text: `${position.ticker}: ${fmtBriefPct(weight)} do valor e ${contribution.riskContribution.toFixed(1)}% do risco estimado. O risco vem do peso na carteira, nao de beta desproporcional.${lookThrough}`,
    };
  }

  return {
    severity: "warning",
    title: "Contribuicao de risco elevada",
    text: `${position.ticker}: ${fmtBriefPct(weight)} do valor e ${contribution.riskContribution.toFixed(1)}% do risco estimado.`,
  };
}

function isBroadMarketETF(position) {
  return getAssetCategory({ ...(position.mkt || {}), ...position, ticker: position.ticker }) === "Broad Market ETF";
}

function isDuplicateConcentrationWarning(message, topRiskPosition, topRiskIsBroadETF) {
  if (!message) return false;
  const text = String(message).toUpperCase();
  if (topRiskIsBroadETF && topRiskPosition?.ticker && text.includes(topRiskPosition.ticker)) return true;
  if (topRiskIsBroadETF && /TOP\s+[135]/.test(text)) return true;
  if (topRiskIsBroadETF && text.includes("DIVERSIFICA")) return true;
  return false;
}

function dedupeBriefItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}|${item.text}`.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildObjectiveBriefItems(positions) {
  return positions
    .filter((p) => p.objetivo > 0)
    .map((p) => {
      const current = p.pnl + (p.realizado || 0);
      const progress = p.objetivo > 0 ? (current / p.objetivo) * 100 : 0;
      return { ticker: p.ticker, objective: p.objetivo, current, progress };
    })
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 6);
}

function renderObjectiveItem(item) {
  const capped = Math.max(0, Math.min(100, item.progress));
  const tone = item.progress >= 100 ? "complete" : item.progress >= 85 ? "near" : "";
  return `
    <div class="startup-brief-objective ${tone}">
      <div>
        <strong>${escapeBrief(item.ticker)}</strong>
        <span>${fmtBriefEUR(item.current)} / ${fmtBriefEUR(item.objective)}</span>
      </div>
      <div class="startup-brief-objective-bar" aria-hidden="true"><span style="width:${capped.toFixed(0)}%"></span></div>
      <small>${item.progress.toFixed(0)}%</small>
    </div>
  `;
}

function getPositionContextLabel(position, totalValue) {
  const weight = fmtBriefPct((position.valAtual || 0) / Math.max(totalValue, 1));
  if (isBroadMarketETF(position)) return `${weight} do portfolio; ETF core diversificado`;
  if (getAssetCategory({ ...(position.mkt || {}), ...position, ticker: position.ticker }) === "Commodity") return `${weight} do portfolio; hedge/commodity`;
  return `${weight} do portfolio`;
}
function buildBriefActions({ positions, health, stress, risk, urgentItems, objectiveCount, achievedObjectives }) {
  const actions = [];
  if (urgentItems.some((i) => i.severity === "critical")) {
    actions.push({ type: "critical", title: "Agir com prioridade", text: "Reve primeiro os alertas criticos antes de novas compras." });
  }
  if (health.score < 50 || health.hiddenRiskScore > 60) {
    actions.push({ type: "warning", title: "Rever diversificacao", text: "A estrutura sugere concentracao ou risco escondido acima do desejavel." });
  }
  const topRisk = risk.contributions?.[0];
  if (topRisk && topRisk.riskContribution >= 35) {
    actions.push({ type: "warning", title: `Validar ${topRisk.ticker}`, text: `Contribui ${topRisk.riskContribution}% do risco estimado do portfolio.` });
  }
  if (stress.robustnessCrisis < 55) {
    actions.push({ type: "warning", title: "Testar cenario defensivo", text: "O stress test indica vulnerabilidade em quedas fortes de mercado." });
  }
  const closeObjective = positions
    .filter((p) => p.objetivo > 0)
    .map((p) => ({ ...p, progress: ((p.pnl + (p.realizado || 0)) / p.objetivo) * 100 }))
    .filter((p) => p.progress >= 85)
    .sort((a, b) => b.progress - a.progress)[0];
  if (closeObjective) {
    actions.push({ type: "positive", title: `Objetivo perto em ${closeObjective.ticker}`, text: `${closeObjective.progress.toFixed(0)}% do objetivo financeiro ja foi atingido.` });
  }
  if (!actions.length) {
    actions.push({ type: "positive", title: "Sem urgencias", text: "O portfolio nao mostra sinais criticos no briefing atual." });
  }
  if (objectiveCount > 0 && achievedObjectives === objectiveCount) {
    actions.push({ type: "positive", title: "Objetivos encaminhados", text: "Todos os objetivos definidos aparecem cumpridos ou acima da meta." });
  }
  return actions.slice(0, 4);
}

function getTopSector(positions, totalValue) {
  const sectors = new Map();
  for (const p of positions) {
    const sector = normalizeSector(p.mkt || p) || p.setor || "Outros";
    sectors.set(sector, (sectors.get(sector) || 0) + (p.valAtual || 0));
  }
  const [name = "---", value = 0] = [...sectors.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return { name, weight: totalValue > 0 ? value / totalValue : 0 };
}

function getBriefHeadline(urgentCount, healthScore) {
  if (urgentCount >= 3 || healthScore < 40) return "Ha pontos que merecem atencao imediata";
  if (urgentCount > 0) return "Ha sinais para rever antes de agir";
  return "Portfolio sem urgencias no arranque";
}

function briefMetric(label, value, icon, tone = "", sublabel = "") {
  return `<div class="startup-brief-metric ${tone}"><i class="fas ${icon}"></i><span>${label}</span><strong>${value}</strong>${sublabel ? `<small>${escapeBrief(sublabel)}</small>` : ""}</div>`;
}

function renderUrgentItem(item) {
  return `<div class="startup-brief-alert ${item.severity}"><span>${item.severity === "critical" ? "Critico" : "Atencao"}</span><div><strong>${escapeBrief(item.title)}</strong><p>${escapeBrief(item.text)}</p></div></div>`;
}

function getBriefScoreClass(score) {
  if (score >= 65) return "good";
  if (score >= 45) return "watch";
  return "risk";
}

function severityRank(severity) {
  return severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
}

function fmtBriefEUR(value) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function fmtBriefPct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function escapeBrief(value) {
  return normalizeBriefText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeBriefText(value) {
  return String(value ?? "")
    .replace(/\uFFFD/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=");
}
function renderCapitalStrategy(agrupadoPorTicker, valorAtualMap) {
  const container = document.getElementById("capitalStrategyContainer");
  if (!container) return;

  const positions = Array.from(agrupadoPorTicker.entries()).map(([ticker, data]) => ({
    ticker,
    ...data
  }));

  // Converter snapshots em Map de objetos para o CapitalManager
  const acoesDataMap = new Map();
  lastAcoesSnap?.forEach(doc => {
    const d = doc.data();
    if (d.ticker) {
      acoesDataMap.set(canonicalTicker(cleanTicker(d.ticker)), d);
    }
  });

  const cashReservePct = lastConfigData?.cashReservePct ?? 22;
  const state = CapitalManager.calculatePortfolioState(positions, acoesDataMap, cashReservePct);
  
  // Valores do utilizador vindos do Firestore
  const availableCash = lastConfigData?.availableCash || 0;
  const monthlyBase = lastConfigData?.monthlyBase || 0;
  const portfolioValue = positions.reduce((sum, p) => {
    const price = Number(valorAtualMap.get(p.ticker) || p.custoMedio || 0);
    return sum + Number(p.qtd || 0) * price;
  }, 0);
  const totalWithCash = portfolioValue + availableCash;
  const cashSharePct = totalWithCash > 0 ? (availableCash / totalWithCash) * 100 : 0;
  const recommendation = CapitalManager.getWarChestRecommendation(state, availableCash);
  const smartDca = CapitalManager.getSmartDCA(monthlyBase, state);

  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

  container.innerHTML = `
    <div class="card" style="border-top: 4px solid ${state.color}; background: rgba(255,255,255,0.05); backdrop-filter: blur(10px);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 20px;">
        <div style="flex: 1; min-width: 280px;">
          <h3 style="margin: 0 0 8px 0; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-shield-halved" style="color: ${state.color}"></i>
            Estado da Carteira: <span style="color: ${state.color}">${state.label}</span>
          </h3>
          <p class="muted" style="font-size: 0.9rem; margin-bottom: 16px;">${state.message}</p>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="report-kpi" style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
              <span class="kpi-label" style="font-size: 0.7rem; opacity: 0.7; text-transform: uppercase;">Reserva Recomendada</span>
              <span class="kpi-value" style="font-size: 1.1rem; font-weight: 800;">${recommendation.percentage.toFixed(0)}%</span>
            </div>
            <div class="report-kpi" style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
              <span class="kpi-label" style="font-size: 0.7rem; opacity: 0.7; text-transform: uppercase;">DCA Inteligente</span>
              <span class="kpi-value" style="font-size: 1.1rem; font-weight: 800;">${fmtEUR.format(smartDca.adjusted)}</span>
            </div>
          </div>
        </div>

        <div style="flex: 1; min-width: 280px; border-left: 1px solid var(--border); padding-left: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 0.9rem; text-transform: uppercase; color: #888;">Gestão de "War Chest"</h4>
          
          <div style="margin-bottom: 16px; background: rgba(var(--primary-rgb), 0.1); border-radius: 12px; padding: 12px; border: 1px solid rgba(var(--primary-rgb), 0.2);">
             <div style="font-size: 0.75rem; color: var(--muted-foreground); margin-bottom: 8px;">🛒 Ação para este Mês (DCA):</div>
             <div style="font-size: 1.2rem; font-weight: 800; color: var(--success);">
               Investir ${fmtEUR.format(smartDca.adjusted)}
             </div>
             <div style="font-size: 0.75rem; margin-top: 4px; opacity: 0.8;">
               ${smartDca.fromReserve > 0 
                 ? `Inclui ${fmtEUR.format(smartDca.fromReserve)} extra vindo da tua reserva (Mercado em Saldos).` 
                 : `Plano padrão de ${fmtEUR.format(smartDca.original)}.`}
             </div>
          </div>

          <div style="background: #111; height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 8px; border: 1px solid #333;">
            <div style="width: ${recommendation.percentage}%; height: 100%; background: ${state.color}; transition: width 1s;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 12px;">
            <span class="muted">Em Reserva: <strong>${fmtEUR.format(recommendation.amount)}</strong></span>
            <span class="muted">Fundo de Investimento: <strong>${fmtEUR.format(recommendation.totalInvestable)}</strong></span>
          </div>

          <div style="border-top: 1px dashed var(--border); padding-top: 10px; font-size: 0.75rem; color: var(--muted-foreground);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Liquidez Total:</span>
              <strong>${fmtEUR.format(availableCash)} (${cashSharePct.toFixed(1)}%)</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Autonomia Estimada:</span>
              <strong>${smartDca.adjusted > 0 ? (availableCash / smartDca.adjusted).toFixed(1) : 0} meses</strong>
            </div>
          </div>
          
          <div style="margin-top: 16px; font-size: 0.8rem; padding: 10px; background: rgba(239, 68, 68, 0.05); border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.1);">
             <i class="fas fa-fire" style="color: #ef4444; margin-right: 6px;"></i>
             ${(() => {
               const ladder = lastConfigData?.crisisLadder || CapitalManager.DEFAULT_CRISIS_LADDER;
               const firstRung = ladder[0] ?? { drawdownPct: 10, deployPct: 25 };
               const deployed = CapitalManager.getCrisisDeployment(firstRung.drawdownPct / 100, recommendation.amount, ladder).amountToDeploy;
               return `<strong>Plano de Crise:</strong> Se o mercado cair ${firstRung.drawdownPct}%, mobiliza <strong>${fmtEUR.format(deployed)}</strong> da reserva.`;
             })()}
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =========================
   ATIVIDADE RECENTE (FILTRADA) + EXPAND/COLAPSE
   ========================= */
let atividadesCache = []; // guarda todos os objetos processados
let atividadesSummaryCache = new Map();
let atividadesExpandido = false; // estado de expansão

function calcularPnlVendasPorTicker(movimentos) {
  const tickerMap = new Map();

  movimentos.forEach((mov) => {
    const list = tickerMap.get(mov.ticker) || [];
    list.push(mov);
    tickerMap.set(mov.ticker, list);
  });

  const summaryByTicker = new Map();

  tickerMap.forEach((list, ticker) => {
    list.sort((a, b) => {
      const diff = (a.data?.getTime() || 0) - (b.data?.getTime() || 0);
      if (diff !== 0) return diff;
      const aIsBuy = a.quantidade > 0 ? 0 : 1;
      const bIsBuy = b.quantidade > 0 ? 0 : 1;
      if (aIsBuy !== bIsBuy) return aIsBuy - bIsBuy;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });

    const lots = [];
    let totalRealizado = 0;
    let totalCustoBase = 0;
    let totalVenda = 0;

    list.forEach((mov) => {
      const qty = Number(mov.quantidade) || 0;
      const preco = Number(mov.preco) || 0;
      if (qty > 0) {
        lots.push({ qty, preco });
        return;
      }

      if (qty >= 0) return;

      let remaining = Math.abs(qty);
      let custoBase = 0;
      let vendido = 0;

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        if (lot.qty <= remaining) {
          custoBase += lot.qty * lot.preco;
          vendido += lot.qty;
          remaining -= lot.qty;
          lots.shift();
        } else {
          custoBase += remaining * lot.preco;
          vendido += remaining;
          lot.qty -= remaining;
          remaining = 0;
        }
      }

      const vendaTotal = Math.abs(qty) * preco;
      const pnl = vendaTotal - custoBase;
      const pct = custoBase > 0 ? (pnl / custoBase) * 100 : null;

      mov.pnlEUR = pnl;
      mov.pnlPct = pct;
      mov.pnlCustoBase = custoBase;
      mov.pnlVendaTotal = vendaTotal;

      totalRealizado += pnl;
      totalCustoBase += custoBase;
      totalVenda += vendaTotal;
    });

    if (totalCustoBase > 0 || totalVenda > 0) {
      const avgPct = totalCustoBase > 0 ? (totalRealizado / totalCustoBase) * 100 : (totalRealizado / totalVenda) * 100;
      summaryByTicker.set(ticker, {
        ticker,
        totalRealizado,
        totalCustoBase,
        totalVenda,
        avgPct,
      });
    }
  });

  return summaryByTicker;
}

async function carregarAtividadeRecenteSimplificada(snapAtivos) {
  const cont = document.getElementById("atividadeRecente");
  if (!cont) return;

  try {
    if (snapAtivos.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      return;
    }

    const movimentos = [];
    const periodosSet = new Set();

    snapAtivos.forEach((doc) => {
      const d = doc.data();
      const dt = d.dataCompra && typeof d.dataCompra.toDate === "function" ? d.dataCompra.toDate() : null;
      
      let periodoStr = "Sem data";
      if (dt) {
        const m = dt.getMonth() + 1;
        const y = dt.getFullYear();
        periodoStr = `${y}-${String(m).padStart(2, "0")}`;
        periodosSet.add(periodoStr);
      }

      movimentos.push({
        id: doc.id,
        ticker: cleanTicker(d.ticker),
        nome: d.nome || d.ticker || "Ativo",
        tipo: (d.tipoAcao || "compra").toLowerCase(),
        quantidade: toNumStrict(d.quantidade),
        preco: d.precoCompra || 0,
        data: dt,
        periodo: periodoStr,
      });
    });

    const summaryFull = calcularPnlVendasPorTicker(movimentos);

    // Popular dropdown de períodos se estiver vazio
    const hPeriodo = document.getElementById("histFltPeriodo");
    if (hPeriodo && hPeriodo.options.length <= 1) {
      const sortedPeriods = [...periodosSet].sort((a, b) => b.localeCompare(a));
      sortedPeriods.forEach((p) => {
        const [y, m] = p.split("-");
        const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        const label = `${months[parseInt(m) - 1]} ${y}`;
        hPeriodo.add(new Option(label, p));
      });
    }

    // Aplicar Filtros
    let filtered = movimentos;
    if (histFltState.ticker) {
      filtered = filtered.filter((m) => m.ticker.includes(histFltState.ticker));
    }
    if (histFltState.tipo) {
      filtered = filtered.filter((m) => m.tipo === histFltState.tipo);
    }
    if (histFltState.periodo) {
      filtered = filtered.filter((m) => m.periodo === histFltState.periodo);
    }

    atividadesCache = filtered;
    const tickersAtivos = new Set(filtered.map((m) => m.ticker));
    atividadesSummaryCache = new Map(
      [...summaryFull].filter(([ticker]) => tickersAtivos.has(ticker)),
    );
    
    // Render: 2 ou tudo
    renderAtividades(cont, atividadesExpandido ? filtered.length : 2);

  } catch (e) {
    console.error("Erro ao carregar atividade recente:", e);
    cont.innerHTML = `<p class="error">Erro ao carregar atividade.</p>`;
  }
}

function renderAtividades(cont, limitItems) {
  const list = atividadesCache;
  if (list.length === 0) {
    cont.innerHTML = `<p class="muted" style="text-align: center; padding: 12px;">Nenhum movimento encontrado.</p>`;
    return;
  }

  const fmtEUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  const fmtDate = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const itemsToShow = list.slice(0, limitItems);
  const summaryLines = [];
  const fmtDateOnly = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });

  const uniqueTickers = [...new Set(list.map((m) => m.ticker))].slice(0, 5);
  uniqueTickers.forEach((ticker) => {
    const summary = atividadesSummaryCache.get(ticker);
    if (!summary) return;
    const pctLabel = Number.isFinite(summary.avgPct)
      ? `${summary.avgPct.toFixed(1)}%`
      : "—";
    summaryLines.push(`
      <div style="display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid var(--border);">
        <div>
          <strong>${ticker}</strong>
          <div class="muted" style="font-size:0.75rem;">Vendido: ${fmtEUR.format(summary.totalVenda)} • Custo base: ${fmtEUR.format(summary.totalCustoBase)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700; color:${summary.totalRealizado >= 0 ? "var(--success)" : "var(--error)"};">${fmtEUR.format(summary.totalRealizado)}</div>
          <div class="muted" style="font-size:0.75rem;">${pctLabel}</div>
        </div>
      </div>
    `);
  });

  const summaryHtml = summaryLines.length
    ? `<div style="margin-bottom: 12px; padding: 10px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 10px;"><strong>Resumo P/L por ticker</strong>${summaryLines.join("")}</div>`
    : "";

  const html = `${summaryHtml}${itemsToShow
    .map((m) => {
      const isVenda = m.tipo === "venda";
      const badgeClass = isVenda ? "tag venda" : "tag compra";
      const icon = isVenda ? "📉" : "🛒";
      const dateStr = m.data ? fmtDate.format(m.data) : "N/A";
      const pnlLabel = isVenda
        ? m.pnlEUR !== undefined
          ? `${fmtEUR.format(m.pnlEUR)} (${Number.isFinite(m.pnlPct) ? m.pnlPct.toFixed(1) + "%" : "—"})`
          : ""
        : "";

      return `
      <div class="activity-item" style="border-bottom: 1px solid var(--border); padding: 10px 0; background: transparent; border-left: 0; border-right: 0; border-top: 0; border-radius: 0; margin-bottom: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.1rem;">${icon}</span>
            <div>
              <p style="margin: 0; font-size: 0.9rem; font-weight: 600;">
                <span class="${badgeClass}" style="font-size: 0.65rem;">${m.tipo.toUpperCase()}</span> 
                ${m.ticker}
              </p>
              <p class="muted" style="margin: 0; font-size: 0.7rem;">${dateStr}</p>
            </div>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 0.9rem; font-weight: 700; color: ${isVenda ? "var(--error)" : "var(--success)"};">
              ${m.quantidade > 0 ? "+" : ""}${m.quantidade.toFixed(2).replace(/\.?0+$/, "")}
            </p>
            <p class="muted" style="margin: 0; font-size: 0.7rem;">${fmtEUR.format(m.preco)}</p>
            ${pnlLabel ? `<p class="muted" style="margin: 0; font-size: 0.7rem;">${pnlLabel}</p>` : ""}
          </div>
        </div>
      </div>
    `;
    })
    .join("")}`;

  cont.innerHTML = html;

  // Botão de expandir/recolher
  if (limitItems < list.length) {
    const btn = document.createElement("button");
    btn.className = "btn ghost full";
    btn.style.marginTop = "8px";
    btn.style.fontSize = "0.8rem";
    btn.innerHTML = `Mostrar tudo (${list.length})`;
    btn.onclick = () => {
      atividadesExpandido = true;
      renderAtividades(cont, list.length);
    };
    cont.appendChild(btn);
  } else if (atividadesExpandido && list.length > 2) {
    const btn = document.createElement("button");
    btn.className = "btn ghost full";
    btn.style.marginTop = "8px";
    btn.style.fontSize = "0.8rem";
    btn.textContent = "Recolher";
    btn.onclick = () => {
      atividadesExpandido = false;
      renderAtividades(cont, 2);
    };
    cont.appendChild(btn);
  }
}

/* =========================
   POPUP: TOP 10 OPORTUNIDADES
   ========================= */
let opInterval = null;
let opPeriodoAtual = "1m";

async function carregarTop10Crescimento(periodo = "1m") {
  const container = document.getElementById("treemapContainer");
  if (!container) return;

  if (!treemapInstance) {
    treemapInstance = new Treemap("treemapContainer", {
      groupHeaderHeight: 22,
    });
  }

  try {
    // OPTIMIZAÇÃO: Usa o snapshot já carregado em vez de fazer getDocs lento
    let snap = lastAcoesSnap;
    if (!snap) {
      console.log("⏳ Fetching acoesDividendos for Treemap...");
      snap = await getDocs(collection(db, "acoesDividendos"));
      lastAcoesSnap = snap;
    }

    // Build allAssetsMap for ETF holdings quality enrichment
    const allAssetsMap = new Map();
    snap.forEach(doc => { const x = doc.data(); if (x.ticker) allAssetsMap.set(String(x.ticker).toUpperCase(), x); });

    const allCands = [];

    snap.forEach((doc) => {
      const d = doc.data();
      if (isKnownETF(d.ticker)) enrichETFAsset(d, allAssetsMap);
      const result = calculateLucroMaximoScore(d, periodo, null, lastConfigData?.macroRegime ?? null);
      if (d.ticker && result.score > 0) {
        let rawYield = Number(d["Dividend Yield"] || d.yield || 0);
        let yPct =
          Math.abs(rawYield) > 0 && Math.abs(rawYield) < 1
            ? rawYield * 100
            : rawYield;

        const tickerLimpo = cleanTicker(d.ticker);
        
        const setorNormalizado = normalizeSector(d);

        allCands.push({
          ticker: tickerLimpo,
          nome: d.nome || tickerLimpo,
          setor: setorNormalizado,
          score: result.score,
          growth: result.rAnnual,
          yieldPct: yPct,
          raw: d,
        });
      }
    });

    if (!allCands.length) {
      container.innerHTML =
        "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#666;'>😕 Nenhuma oportunidade encontrada.</div>";
      return;
    }

    // --- CÁLCULO DE ALOCAÇÃO COM CAPS (Simulação de 1000€ para definir área visual) ---
    const investimentoSimulado = 1000;
    const somaScore = allCands.reduce((s, c) => s + c.score, 0) || 1;
    const allocMap = new Map();

    // 1) Proporção inicial
    allCands.forEach((c) => {
      allocMap.set(c.ticker, (c.score / somaScore) * investimentoSimulado);
    });

    // 2) Aplicar caps (15% ticker, 30% setor)
    const capTicker = 0.15 * investimentoSimulado;
    const capSetor = 0.3 * investimentoSimulado;

    // Cap Ticker
    let excedente = 0;
    for (const [t, v] of allocMap) {
      if (v > capTicker) {
        excedente += v - capTicker;
        allocMap.set(t, capTicker);
      }
    }

    // Redistribuição simples respeitando cap setorial (max 10 iterações)
    let safety = 0;
    while (excedente > 0.01 && safety++ < 10) {
      const porSetor = new Map();
      allCands.forEach((c) => {
        const v = allocMap.get(c.ticker) || 0;
        porSetor.set(c.setor, (porSetor.get(c.setor) || 0) + v);
      });

      const elegiveis = allCands.filter((c) => {
        const v = allocMap.get(c.ticker) || 0;
        const sV = porSetor.get(c.setor) || 0;
        return v < capTicker - 0.01 && sV < capSetor - 0.01;
      });

      if (!elegiveis.length) break;

      const somaScoreEleg = elegiveis.reduce((s, c) => s + c.score, 0) || 1;
      let redistribuidoNestaRonda = 0;

      for (const c of elegiveis) {
        const share = (c.score / somaScoreEleg) * excedente;
        const margemTicker = capTicker - allocMap.get(c.ticker);
        const margemSetor = capSetor - porSetor.get(c.setor);
        const add = Math.min(share, margemTicker, margemSetor);
        if (add > 0) {
          allocMap.set(c.ticker, allocMap.get(c.ticker) + add);
          redistribuidoNestaRonda += add;
        }
      }
      excedente -= redistribuidoNestaRonda;
      if (redistribuidoNestaRonda < 0.01) break;
    }

    // --- PREPARAR DADOS PARA O TREEMAP ---
    const dataBySector = new Map();
    allCands.forEach((c) => {
      if (!dataBySector.has(c.setor)) {
        dataBySector.set(c.setor, { name: c.setor, value: 0, children: [] });
      }
      const group = dataBySector.get(c.setor);
      const allocation = allocMap.get(c.ticker) || 0;

      // A área visual (value) agora é a alocação calculada
      // Mas garantimos um mínimo para não desaparecerem os pequenos
      const visualArea = Math.max(1, allocation);

      group.value += visualArea;
      group.children.push({
        name: c.ticker,
        fullName: c.nome,
        value: visualArea,
        colorValue: c.score, // Cor continua a ser o score (qualidade)
        growth: c.growth,
        yield: c.yieldPct,
        meta: {
          valorStock: Number(c.raw.valorStock || 0),
          pe: c.raw["P/E ratio (Preço/Lucro)"] || c.raw.pe || "—",
          evebitda: c.raw["EV/Ebitda"] || c.raw.evEbitda || "—",
          marketCap: Number(c.raw["Market Cap"] || c.raw.marketCap || 0),
          setor: c.setor,
          mercado: c.raw.mercado,
          periodo: c.raw.periodicidade,
          divMedio: c.raw.dividendoMedio24m,
          epsNextY: c.raw.epsNextY || c.raw.eps_next_year || 0,
          netDebt: c.raw.dividaLiquida || c.raw.netDebt || 0,
          ebitda: c.raw.ebitda || 0,
        },
      });
    });

    const finalData = Array.from(dataBySector.values());
    const totalAssets = allCands.length;

    if (totalAssets === 0) {
      container.innerHTML =
        "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#666;'>😕 Nenhuma oportunidade encontrada.</div>";
      return;
    }

    const dynamicHeight = Math.max(700, Math.min(3000, totalAssets * 15));
    treemapInstance.render(finalData, dynamicHeight);
  } catch (err) {
    console.error("Erro ao carregar Treemap:", err);
    container.innerHTML =
      "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#f88;'>Erro ao carregar dados.</div>";
  }
}

function openOportunidades() {
  const modal = document.getElementById("opModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  atualizarLegendaPesos();
  setActiveChip(opPeriodoAtual);
  carregarTop10Crescimento(opPeriodoAtual);

  clearInterval(opInterval);
  opInterval = setInterval(() => {
    carregarTop10Crescimento("1m");
  }, 30000);
}

function closeOportunidades() {
  const modal = document.getElementById("opModal");
  if (!modal) return;

  modal.classList.add("hidden");
  clearInterval(opInterval);
  opInterval = null;
}

// =========================
// ATUALIZA LEGENDA DE PESOS DINAMICAMENTE
// =========================
function atualizarLegendaPesos() {
  const W = getUserWeights() || SCORING_CFG.WEIGHTS;

  const mapping = {
    "w-R": W.R,
    "w-T": W.T,
    "w-V": W.V,
    "w-D": W.D,
    "w-E": W.E,
    "w-Rsk": W.Rsk || 0.05,
  };

  for (const [id, val] of Object.entries(mapping)) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = `${Math.round(val * 100)}%`;
    }
  }
}

function setActiveChip(periodo) {
  // Chips removed from HTML
}

// =========================
// Simulador Botão Definir Objetivo (versão wizard + dropdowns)
// =========================

// ---------- Helpers comuns ----------

function keyStr(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // requer JS moderno
    .trim()
    .toLowerCase();
}

function euro(v) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(v || 0);
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dividirPeriodicidade(dividendo, periodicidade) {
  const p = String(periodicidade || "").toLowerCase();
  if (p === "mensal") return dividendo * 12;
  if (p === "trimestral") return dividendo * 4;
  if (p === "semestral") return dividendo * 2;
  return dividendo; // anual ou n/a
}
function campoCrescimento(periodoSel) {
  if (periodoSel === "1s" || periodoSel === "1w") return "priceChange_1w";
  if (periodoSel === "1m") return "priceChange_1m";
  return "priceChange_1y";
}
function melhorTaxaDisponivel(acao, prefer) {
  const ordem = [
    prefer,
    "priceChange_1m",
    "priceChange_1w",
    "priceChange_1y",
    "taxaCrescimento_1mes",
    "taxaCrescimento_1semana",
    "taxaCrescimento_1ano",
  ];
  for (const k of ordem) {
    const v = acao[k];
    if (v !== undefined && v !== null && v !== "") {
      const n = parseFloat(String(v).replace(",", "."));
      if (!isNaN(n) && n !== 0) return n;
    }
  }
  return 0;
}
function calcularMetricasAcao(acao, periodoSel, horizonte) {
  const prefer = campoCrescimento(periodoSel);
  const taxaPct = melhorTaxaDisponivel(acao, prefer);
  const preco = Number(acao.valorStock || 0);
  const dividendo = Number(acao.dividendo || 0);
  const per = acao.periodicidade || "Anual";
  if (!(preco > 0)) return null;

  const r = clamp(taxaPct / 100, -0.95, 5);
  const h = Math.max(1, Number(horizonte || 1));

  const mult = Math.pow(1 + r, h);
  const valorizacao = preco * (mult - 1);
  const divAnual = dividirPeriodicidade(dividendo, per);
  // Sanity check: cap dividend yield at 50% for projections
  const totalDividendos = Math.min(divAnual, preco * 0.5) * h;

  const lucroUnidade = totalDividendos + valorizacao;
  const retornoPorEuro = lucroUnidade / preco;

  return {
    preco,
    dividendoAnual: Math.min(divAnual, preco * 0.5),
    taxaPct,
    lucroUnidade,
    retornoPorEuro,
  };
}

function distribuirFracoes(acoes, investimento) {
  const somaRetorno = acoes.reduce((s, a) => s + a.metrics.retornoPorEuro, 0);
  if (somaRetorno <= 0)
    return { linhas: [], totalLucro: 0, totalGasto: 0, restante: investimento };

  const linhas = acoes.map((a) => {
    const propor = a.metrics.retornoPorEuro / somaRetorno;
    const investido = investimento * propor;
    const qtd = investido / a.metrics.preco;
    const lucro = qtd * a.metrics.lucroUnidade;
    return {
      nome: a.nome,
      ticker: a.ticker,
      preco: a.metrics.preco,
      quantidade: qtd,
      investido,
      lucro,
      taxaPct: a.metrics.taxaPct,
      dividendoAnual: a.metrics.dividendoAnual,
    };
  });
  const totalLucro = linhas.reduce((s, l) => s + l.lucro, 0);
  const totalGasto = linhas.reduce((s, l) => s + l.investido, 0);
  return {
    linhas,
    totalLucro,
    totalGasto,
    restante: Math.max(0, investimento - totalGasto),
  };
}

function distribuirInteiras(acoes, investimento) {
  const ordenadas = [...acoes].sort(
    (a, b) => b.metrics.retornoPorEuro - a.metrics.retornoPorEuro,
  );
  const linhasMap = new Map();
  let restante = investimento;

  const precoMin = Math.min(...ordenadas.map((a) => a.metrics.preco));
  while (restante >= precoMin - 1e-9) {
    let best = null;
    for (const a of ordenadas) {
      if (a.metrics.preco <= restante + 1e-9) {
        best = a;
        break;
      }
    }
    if (!best) break;

    const key = best.ticker;
    const linha = linhasMap.get(key) || {
      nome: best.nome,
      ticker: best.ticker,
      preco: best.metrics.preco,
      quantidade: 0,
      investido: 0,
      lucro: 0,
      taxaPct: best.metrics.taxaPct,
      dividendoAnual: best.metrics.dividendoAnual,
    };
    linha.quantidade += 1;
    linha.investido += best.metrics.preco;
    linha.lucro += best.metrics.lucroUnidade;
    linhasMap.set(key, linha);
    restante -= best.metrics.preco;
  }
  const linhas = Array.from(linhasMap.values());
  const totalLucro = linhas.reduce((s, l) => s + l.lucro, 0);
  const totalGasto = linhas.reduce((s, l) => s + l.investido, 0);
  return { linhas, totalLucro, totalGasto, restante };
}

function renderResultado(destEl, resultado, opts) {
  const { linhas, totalLucro, totalGasto, restante = 0 } = resultado;
  if (!linhas || linhas.length === 0) {
    destEl.innerHTML = `<div class="card"><p class="muted">Nenhuma ação selecionada com retorno positivo.</p></div>`;
    return;
  }
  const rows = linhas
    .map(
      (l) => `
    <tr>
      <td>${l.nome} <span class="muted">(${l.ticker})</span></td>
      <td>${euro(l.preco)}</td>
      <td>${l.quantidade.toFixed(opts.inteiras ? 0 : 4)}</td>
      <td>${euro(l.investido)}</td>
      <td>${euro(l.lucro)}</td>
      <td>${(l.taxaPct || 0).toFixed(2)}%</td>
      <td>${euro(l.dividendoAnual || 0)}/ano</td>
    </tr>
  `,
    )
    .join("");
  destEl.innerHTML = `
    <div class="card">
      <div class="tabela-scroll-wrapper">
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr>
              <th>Ativo</th><th>Preço</th><th>Qtd</th><th>Investido</th><th>Lucro Estim.</th><th>Tx ${opts.periodo}</th><th>Dividendo</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="margin-top:.6rem">
        <strong>Total investido:</strong> ${euro(totalGasto)}
        ${opts.inteiras && restante > 0 ? `• <strong>Resto:</strong> ${euro(restante)}` : ``}
        <br/>
        <strong>Lucro total estimado (${opts.horizonte} ${opts.horizonte > 1 ? "períodos" : "período"}):</strong> ${euro(totalLucro)}
      </p>
    </div>
  `;
}

// --- opções dropdowns
const OPT_SETORES = [
  "",
  "ETF iTech",
  "ETF Finance",
  "ETF Energia",
  "ETF Materiais",
  "ETF Múltiplos Setores",
  "Alimentação",
  "Automóvel",
  "Bens Consumidor",
  "Consumo Cíclico",
  "Consumo Defensivo",
  "Criptomoedas",
  "Defesa",
  "Energia",
  "Finanças",
  "Imobiliário",
  "Indústria",
  "Infraestruturas / Energia",
  "Materiais",
  "Mineração (Ouro)",
  "Restauração",
  "Saúde",
  "Tecnologia",
  "Telecomunicações",
];
const OPT_MERCADOS = [
  "",
  "Mundial",
  "Asiático",
  "Português",
  "Europeu",
  "Americano",
  "Americano SP500",
];
const OPT_MESES = [
  "",
  "n/A",
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const OPT_PERIODICIDADE = [
  "",
  "n/A",
  "Anual",
  "Semestral",
  "Trimestral",
  "Mensal",
];

function fillSelect(id, opts, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = opts
    .map((v) => {
      const label = v || placeholder || "Todos";
      return `<option value="${v}">${label}</option>`;
    })
    .join("");
}

// ---------- Estado do modal ----------


//Compra acoes dashboard.js
// Abre o modal "Adicionar Ação" já em modo COMPRA e limpa os campos
function wireDashBuy() {
  const btn = document.getElementById("btnDashBuy");
  const modal = document.getElementById("addModal");
  const form = document.getElementById("addForm");
  const tipoAcao = document.getElementById("tipoAcao");
  const labelPreco = document.getElementById("labelPreco");

  const open = () => {
    if (!modal) return;
    modal.classList.remove("hidden");

    // força COMPRA
    if (tipoAcao) tipoAcao.value = "compra";
    if (labelPreco) labelPreco.firstChild.textContent = "Preço de compra (€)";

    // limpa campos do formulário
    [
      "nomeAtivo",
      "tickerAtivo",
      "setorAtivo",
      "mercadoAtivo",
      "quantidadeAtivo",
      "precoAtivo",
      "objetivoAtivo",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  };

  const close = () => {
    if (!modal) return;
    modal.classList.add("hidden");
    form?.reset();
    if (labelPreco)
      labelPreco.firstChild.textContent = "Preço da transação (€)";
  };

  // abrir via botão principal
  btn?.addEventListener("click", open);

  // fechos já existentes do modal "Adicionar Ação"
  document.getElementById("addClose")?.addEventListener("click", close);
  document.getElementById("addCancel")?.addEventListener("click", close);
  modal?.addEventListener("click", (e) => {
    if (e.target.id === "addModal") close();
  });

  // se o utilizador mudar entre compra/venda, atualiza o label
  tipoAcao?.addEventListener("change", () => {
    if (!labelPreco) return;
    labelPreco.firstChild.textContent =
      tipoAcao.value === "venda" ? "Preço de venda (€)" : "Preço de compra (€)";
  });
}
