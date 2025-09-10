import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, orderBy, where,
  addDoc, serverTimestamp, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================
   Estado e helpers globais
   ========================= */
let _setorChart = null;
let _themeHandlerBound = null;

/** Carrega Chart.js uma única vez, se necessário */
function loadChartJsOnce() {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js";
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/** Tokens de tema para o gráfico */
function getThemeTokens() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    isDark,
    label: isDark ? "#eaeaea" : "#111",
    bg: "transparent",
    palette: isDark
      ? ["#60a5fa","#34d399","#f472b6","#f59e0b","#a78bfa","#22d3ee","#fb7185","#f97316","#93c5fd","#4ade80"]
      : ["#2563eb","#16a34a","#db2777","#d97706","#7c3aed","#0891b2","#e11d48","#ea580c","#3b82f6","#22c55e"],
  };
}

/** Garante o painel de analytics + canvas antes da lista */
function ensureAnalyticsPanel(listEl) {
  if (document.getElementById("pfAnalytics")) return;

  const wrapper = document.createElement("div");
  wrapper.id = "pfAnalytics";
  wrapper.className = "dashboard-columns";
  wrapper.style.marginBottom = "12px";

  wrapper.innerHTML = `
    <div class="card premium">
      <div class="card-content">
        <div>
          <p class="label">Valor Total Investido</p>
          <p class="value" id="pfTotalInvestido">—</p>
          <p class="subvalue muted">Somatório de posições ativas</p>
        </div>
        <div class="icon-box"><i class="fas fa-coins"></i></div>
      </div>
    </div>

    <div class="card success">
      <div class="card-content">
        <div>
          <p class="label">Lucro Atual</p>
          <p class="value" id="pfLucroAtual">—</p>
          <p class="subvalue muted" id="pfLucroPct">—</p>
        </div>
        <div class="icon-box"><i class="fas fa-chart-line"></i></div>
      </div>
    </div>

    <div class="card default">
      <div class="card-content">
        <div>
          <p class="label">Posições Ativas</p>
          <p class="value" id="pfPosicoes">0</p>
          <p class="subvalue muted" id="pfTickersUnicos">Tickers únicos</p>
        </div>
        <div class="icon-box"><i class="fas fa-briefcase"></i></div>
      </div>
    </div>

    <div class="card info" id="setorChartCard">
      <div class="card-content" style="flex-direction:column; align-items:stretch; gap:8px;">
        <div>
          <p class="label">Distribuição por Setor</p>
          <p class="subvalue muted">Percentagem do valor investido</p>
        </div>
        <div style="width:100%;max-width:520px;">
          <canvas id="setorChartCanvas" height="260"></canvas>
        </div>
      </div>
    </div>
  `;

  // insere o painel antes da lista
  listEl.parentElement.insertBefore(wrapper, listEl);
}

/** Desenha/Atualiza o doughnut por setor */
function renderSetorDoughnut(setoresMap) {
  if (!document.getElementById("setorChartCanvas")) return;
  if (!window.Chart) return;

  const labels = [];
  const data = [];
  for (const [setor, valor] of setoresMap.entries()) {
    labels.push(setor);
    data.push(Number(valor || 0));
  }

  const card = document.getElementById("setorChartCard");
  if (!labels.length) {
    if (card) card.style.display = "none";
    if (_setorChart) { _setorChart.destroy(); _setorChart = null; }
    return;
  } else {
    if (card) card.style.display = "";
  }

  const t = getThemeTokens();
  const ctx = document.getElementById("setorChartCanvas").getContext("2d");

  if (_setorChart) { _setorChart.destroy(); _setorChart = null; }

  _setorChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => t.palette[i % t.palette.length]),
        borderColor: t.bg,
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      plugins: {
        legend: {
          position: "right",
          labels: { color: t.label, boxWidth: 12, boxHeight: 12, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              const val = Number(ctx.parsed) || 0;
              const pct = ((val / total) * 100).toFixed(1);
              const fmt = new Intl.NumberFormat("pt-PT",{ style:"currency", currency:"EUR" });
              return ` ${ctx.label}: ${fmt.format(val)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/* =========================
   Helpers numéricos/tempo
   ========================= */
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isFiniteNum(v){ return Number.isFinite(Number(v)); }
function formatNum(n){ return Number(n || 0).toLocaleString("pt-PT"); }

// busca info em acoesDividendos por lotes de 10
async function fetchDividendInfoByTickers(tickers){
  const out = new Map();
  const chunks = [];
  for (let i=0; i<tickers.length; i+=10) chunks.push(tickers.slice(i, i+10));
  for (const chunk of chunks){
    if (!chunk.length) continue;
    const q = query(collection(db, "acoesDividendos"), where("ticker", "in", chunk));
    const snap = await getDocs(q);
    snap.forEach(docu => {
      const d = docu.data();
      if (d.ticker) out.set(String(d.ticker).toUpperCase(), d);
    });
  }
  return out;
}

// melhor taxa disponível: 1m > 1s > 1ano
function pickBestRate(info){
  if (typeof info?.taxaCrescimento_1mes === "number") return { taxa: info.taxaCrescimento_1mes, periodLabel: "mês" };
  if (typeof info?.taxaCrescimento_1semana === "number") return { taxa: info.taxaCrescimento_1semana, periodLabel: "semana" };
  if (typeof info?.taxaCrescimento_1ano === "number") return { taxa: info.taxaCrescimento_1ano, periodLabel: "ano" };
  return { taxa: null, periodLabel: null };
}

// estima nº de períodos até atingir targetPrice
function estimateTime(currentPrice, targetPrice, growthPct, periodLabel) {
  const r = Number(growthPct || 0) / 100;
  if (r <= 0 || !isFiniteNum(currentPrice) || !isFiniteNum(targetPrice) || currentPrice <= 0 || targetPrice <= 0) return "—";
  const n = Math.log(targetPrice / currentPrice) / Math.log(1 + r);
  if (!isFinite(n) || n < 0) return "—";
  if (periodLabel === "semana") return `${n.toFixed(1)} semanas`;
  if (periodLabel === "mês") return `${n.toFixed(1)} meses`;
  return `${n.toFixed(1)} anos`;
}

/* =========================
   Quick Actions (modal)
   ========================= */
function wireQuickActions(gruposArr){
  const byTicker = new Map(gruposArr.map(g => [g.ticker, g]));
  const $ = s => document.querySelector(s);

  const modal   = $("#pfAddModal");
  const title   = $("#pfAddTitle");
  const form    = $("#pfAddForm");
  const close   = $("#pfAddClose");
  const cancel  = $("#pfAddCancel");

  const tipoSel = $("#pfTipoAcao");
  const labelP  = $("#pfLabelPreco");
  const vendaTotWrap = $("#pfVendaTotalWrap");
  const vendaTot = $("#pfVendaTotal");

  const fTicker = $("#pfTicker");
  const fNome   = $("#pfNome");
  const fSetor  = $("#pfSetor");
  const fMerc   = $("#pfMercado");
  const fQtd    = $("#pfQuantidade");
  const fPreco  = $("#pfPreco");
  const fObj    = $("#pfObjetivo");

  function open(kind, ticker){
    const g = byTicker.get(ticker);
    if (!g) return;

    modal.classList.remove("hidden");
    title.textContent = kind === "compra" ? "Comprar ativo" : "Vender ativo";

    tipoSel.value = kind;
    fTicker.value = g.ticker;
    fNome.value   = g.nome;
    fSetor.value  = g.setor;
    fMerc.value   = g.mercado;
    fQtd.value    = "";
    fPreco.value  = "";
    fObj.value    = g.objetivo || "";

    vendaTot.checked = false;
    vendaTotWrap.style.display = kind === "venda" ? "block" : "none";
    labelP.firstChild.textContent = kind === "venda" ? "Preço de venda (€)" : "Preço de compra (€)";
  }
  function closeModal(){
    modal.classList.add("hidden");
    form.reset();
    vendaTot.checked = false;
    vendaTotWrap.style.display = "none";
    labelP.firstChild.textContent = "Preço de compra (€)";
  }
  close?.addEventListener("click", closeModal);
  cancel?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e)=>{ if (e.target.id === "pfAddModal") closeModal(); });

  document.getElementById("listaAtividades")?.addEventListener("click", (e)=>{
    const buy = e.target.closest("[data-buy]");
    const sell = e.target.closest("[data-sell]");
    if (buy)  open("compra", buy.getAttribute("data-buy"));
    if (sell) open("venda",  sell.getAttribute("data-sell"));
  });

  tipoSel?.addEventListener("change", () => {
    const isVenda = tipoSel.value === "venda";
    labelP.firstChild.textContent = isVenda ? "Preço de venda (€)" : "Preço de compra (€)";
    vendaTotWrap.style.display = isVenda ? "block" : "none";
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tipo  = (tipoSel.value || "compra").toLowerCase();
    const nome  = fNome.value.trim();
    const ticker= fTicker.value.trim().toUpperCase();
    const setor = fSetor.value.trim();
    const merc  = fMerc.value.trim();
    const qtd   = Number(fQtd.value || 0);
    const preco = Number(fPreco.value || 0);
    const obj   = Number(fObj.value || 0);
    const vendaTotal = vendaTot.checked;

    if (!ticker || !nome || !qtd || !preco) {
      alert("Preenche Ticker, Nome, Quantidade e Preço.");
      return;
    }

    const quantidade = tipo === "venda" ? -Math.abs(qtd) : Math.abs(qtd);

    const payload = {
      tipoAcao: tipo,
      nome, ticker, setor, mercado: merc,
      quantidade,
      precoCompra: preco,
      objetivoFinanceiro: isNaN(obj) ? 0 : obj,
      dataCompra: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, "ativos"), payload);

      if (tipo === "venda" && vendaTotal) {
        const toDelQ = query(collection(db, "ativos"), where("ticker", "==", ticker));
        const snapDel = await getDocs(toDelQ);
        const promises = [];
        snapDel.forEach(d => promises.push(deleteDoc(doc(db, "ativos", d.id))));
        await Promise.all(promises);
      }

      closeModal();
      location.reload();
    } catch (err) {
      console.error("❌ Erro ao guardar movimento:", err);
      alert("Não foi possível guardar. Tenta novamente.");
    }
  });
}

/* =========================
   INIT SCREEN
   ========================= */
export async function initScreen() {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  cont.innerHTML = "A carregar…";

  try {
    const q = query(collection(db, "ativos"), orderBy("dataCompra", "desc"));
    const snap = await getDocs(q);

    // painel (KPI + gráfico) sempre presente
    ensureAnalyticsPanel(cont);

    if (snap.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      // gráfico vazio desaparece automaticamente
      return;
    }

    const grupos = new Map();
    snap.forEach(docu => {
      const d = docu.data();
      const ticker = String(d.ticker || "").toUpperCase();
      if (!ticker) return;

      const qtd = toNum(d.quantidade);
      const preco = toNum(d.precoCompra);
      const invest = qtd * preco;

      const g = grupos.get(ticker) || {
        ticker,
        nome: d.nome || ticker,
        setor: d.setor || "-",
        mercado: d.mercado || "-",
        qtd: 0,
        investido: 0,
        objetivo: 0,
        anyObjSet: false,
        lastDate: null,
      };

      g.qtd += qtd;
      g.investido += invest;

      const obj = toNum(d.objetivoFinanceiro);
      if (!g.anyObjSet && obj > 0) {
        g.objetivo = obj;
        g.anyObjSet = true;
      }

      const dt = (d.dataCompra && typeof d.dataCompra.toDate === "function")
        ? d.dataCompra.toDate()
        : null;
      if (!g.lastDate || (dt && dt > g.lastDate)) g.lastDate = dt;

      g.nome = d.nome || g.nome;
      g.setor = d.setor || g.setor;
      g.mercado = d.mercado || g.mercado;

      grupos.set(ticker, g);
    });

    const gruposArr = Array.from(grupos.values());

    // 2) Preços atuais
    const tickers = gruposArr.map(g => g.ticker);
    const infoMap = await fetchDividendInfoByTickers(tickers);

    const fmtEUR  = new Intl.NumberFormat("pt-PT",{ style:"currency", currency:"EUR" });
    const fmtDate = new Intl.DateTimeFormat("pt-PT",{ year:"numeric", month:"short", day:"2-digit" });

    // === KPIs + agregação por setor ===
    let totalInvestido = 0;
    let totalAtual = 0;
    let posicoesAtivas = 0;
    const setoresMap = new Map();

    for (const g of gruposArr) {
      if ((g.qtd || 0) <= 0) continue;
      posicoesAtivas++;

      const precoMedio = g.qtd > 0 ? (g.investido / g.qtd) : 0;
      const info = infoMap.get(g.ticker) || {};
      const precoAtual = isFiniteNum(info.valorStock) ? Number(info.valorStock) : null;

      totalInvestido += g.investido || 0;
      totalAtual += (precoAtual !== null ? (precoAtual * g.qtd) : g.investido || 0);

      const setor = g.setor || "—";
      const prev = setoresMap.get(setor) || 0;
      setoresMap.set(setor, prev + (g.investido || 0));
    }

    const lucroTotal = totalAtual - totalInvestido;
    const lucroPct = totalInvestido > 0 ? (lucroTotal / totalInvestido) * 100 : 0;

    // Preenche KPIs
    document.getElementById("pfTotalInvestido").textContent = fmtEUR.format(totalInvestido || 0);
    document.getElementById("pfLucroAtual").textContent = fmtEUR.format(lucroTotal || 0);
    document.getElementById("pfLucroPct").textContent = isFinite(lucroPct) ? `${lucroPct.toFixed(1)}%` : "—";
    document.getElementById("pfPosicoes").textContent = String(posicoesAtivas || 0);
    document.getElementById("pfTickersUnicos").textContent = `${gruposArr.filter(g => g.qtd > 0).length} tickers únicos`;

    // Garante Chart.js e renderiza gráfico
    await loadChartJsOnce();
    renderSetorDoughnut(setoresMap);

    // re-render no change de tema (remove handler antigo se existir)
    if (_themeHandlerBound) {
      window.removeEventListener("app:theme-changed", _themeHandlerBound);
    }
    _themeHandlerBound = () => renderSetorDoughnut(setoresMap);
    window.addEventListener("app:theme-changed", _themeHandlerBound);

    // === Lista de posições ===
    const html = gruposArr
      .filter(g => g.qtd > 0)
      .map(g => {
        const info = infoMap.get(g.ticker) || {};
        const precoAtual = isFiniteNum(info.valorStock) ? Number(info.valorStock) : null;

        const precoMedio = g.qtd > 0 ? (g.investido / g.qtd) : 0;
        const lucroAtual = (precoAtual !== null)
          ? (precoAtual - precoMedio) * g.qtd
          : 0;

        let pctText = "—";
        let barHTML = "";
        const objetivo = g.objetivo > 0 ? g.objetivo : 0;
        if (objetivo > 0) {
          const progresso = (lucroAtual / objetivo) * 100;
          const clamped = Math.max(-100, Math.min(100, progresso));
          const sideWidthPct = (Math.abs(clamped) / 2).toFixed(1);
          const positive = clamped >= 0;
          pctText = `${clamped.toFixed(0)}%`;
          barHTML = `
            <div class="progress-dual">
              <div class="track">
                <div class="fill ${positive ? "positive" : "negative"}" style="width:${sideWidthPct}%"></div>
                <div class="zero"></div>
              </div>
            </div>
          `;
        }

        const tp2Necessario = (objetivo > 0 && g.qtd > 0)
          ? (precoMedio + (objetivo / g.qtd))
          : null;

        const { taxa, periodLabel } = pickBestRate(info);
        const estimativa = (tp2Necessario && precoAtual)
          ? estimateTime(precoAtual, tp2Necessario, taxa, periodLabel)
          : "—";

        const dataTxt = g.lastDate ? fmtDate.format(g.lastDate) : "sem data";

        const actions = `
          <div class="actions-row" style="margin-top:.5rem">
            <button class="btn outline" data-buy="${g.ticker}">Comprar</button>
            <button class="btn ghost"  data-sell="${g.ticker}">Vender</button>
          </div>
        `;

        return `
          <div class="activity-item">
            <div class="activity-left">
              <span class="activity-icon">📦</span>
              <div>
                <p><strong>${g.nome}</strong> <span class="muted">(${g.ticker})</span></p>
                <p class="muted">${g.setor} • ${g.mercado}</p>
                <p class="muted">Última compra: ${dataTxt}</p>
                <p class="muted">
                  Qtd: <strong>${formatNum(g.qtd)}</strong> ·
                  Preço médio: <strong>${fmtEUR.format(precoMedio || 0)}</strong> ·
                  Preço atual: <strong>${precoAtual !== null ? fmtEUR.format(precoAtual) : "—"}</strong>
                </p>
                <p class="muted">
                  Investido: <strong>${fmtEUR.format(g.investido || 0)}</strong> ·
                  Lucro atual: <strong>${fmtEUR.format(lucroAtual)}</strong>
                </p>

                ${objetivo > 0 ? `
                  <div class="activity-meta">
                    <span>Objetivo (lucro): <strong>${fmtEUR.format(objetivo)}</strong></span>
                    <span>${pctText}</span>
                  </div>
                  ${barHTML}
                  <p class="muted">
                    TP2 necessário: <strong>${tp2Necessario ? fmtEUR.format(tp2Necessario) : "—"}</strong>
                    ${taxa !== null ? `· Estimativa: <strong>${estimativa}</strong>` : ``}
                  </p>
                ` : `
                  <p class="muted">Sem objetivo definido para este ticker.</p>
                `}

                ${actions}
              </div>
            </div>
          </div>
        `;
      });

    cont.innerHTML = html.join("");

    // 4) Ligações dos botões de ação rápida
    wireQuickActions(gruposArr);

  } catch (e) {
    console.error("Erro ao carregar atividades:", e);
    ensureAnalyticsPanel(cont);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
  }
}
