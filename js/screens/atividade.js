// js/screens/atividade.js
import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, orderBy, where,
  addDoc, serverTimestamp, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ===============================
   Carregar Chart.js on-demand
   =============================== */
async function ensureChartJS(){
  if (window.Chart) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ===============================
   Paleta / Tema
   =============================== */
function isDark(){
  return document.documentElement.getAttribute("data-theme") === "dark";
}
function chartColors(){
  const dark = isDark();
  return {
    grid: dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
    ticks: dark ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.7)",
    title: dark ? "#fff" : "#111",
    tooltipBg: dark ? "rgba(17,17,17,.95)" : "rgba(255,255,255,.95)",
    tooltipFg: dark ? "#fff" : "#111",
  };
}
/* paleta para setores (12 cores suaves) */
const PALETTE = [
  "#4F46E5","#22C55E","#EAB308","#EF4444","#06B6D4","#F59E0B",
  "#A855F7","#10B981","#3B82F6","#F472B6","#84CC16","#14B8A6"
];

/* manter as instâncias para destruir no re-render */
const charts = { setores:null, top5:null, timeline:null };

/* ===============================
   Render: Doughnut por setores
   =============================== */
function renderSetorDoughnut(setoresMap){
  const el = document.getElementById("chartSetores");
  if (!el) return;
  charts.setores?.destroy();

  const labels = Array.from(setoresMap.keys());
  const data   = Array.from(setoresMap.values());

  if (!labels.length){
    // nada para mostrar
    const ctx = el.getContext("2d");
    ctx.clearRect(0,0,el.width, el.height);
    return;
  }

  charts.setores = new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_,i)=>PALETTE[i % PALETTE.length]),
        borderWidth: 1,
      }]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{ position:"bottom", labels:{ color: chartColors().ticks } },
        tooltip:{
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
          callbacks:{
            label: (ctx)=>{
              const v = Number(ctx.parsed);
              const total = data.reduce((a,b)=>a+b,0) || 1;
              const pct = (v/total*100).toFixed(1);
              return ` ${ctx.label}: €${v.toLocaleString("pt-PT",{minimumFractionDigits:2})} (${pct}%)`;
            }
          }
        }
      },
      cutout:"62%"
    }
  });
}

/* ===============================
   Render: Top 5 (Bar) por Investido
   =============================== */
function renderTop5Bar(gruposArr){
  const el = document.getElementById("chartTop5");
  if (!el) return;
  charts.top5?.destroy();

  // top 5 por valor investido (posições ativas)
  const ativos = gruposArr.filter(g=>g.qtd>0)
    .sort((a,b)=> (b.investido||0)-(a.investido||0))
    .slice(0,5);

  if (!ativos.length){
    const ctx = el.getContext("2d");
    ctx.clearRect(0,0,el.width, el.height);
    return;
  }

  const labels = ativos.map(a=>`${a.ticker}`);
  const invest = ativos.map(a=>a.investido||0);
  const lucro  = ativos.map(a=>a.lucroAtual||0);

  charts.top5 = new Chart(el, {
    type:"bar",
    data:{
      labels,
      datasets:[
        { label:"Investido (€)", data:invest, backgroundColor:"#3B82F6" },
        { label:"Lucro Atual (€)", data:lucro, backgroundColor:"#22C55E" }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      scales:{
        x:{
          ticks:{ color: chartColors().ticks },
          grid:{ color: chartColors().grid }
        },
        y:{
          ticks:{ color: chartColors().ticks },
          grid:{ color: chartColors().grid }
        }
      },
      plugins:{
        legend:{ labels:{ color: chartColors().ticks }},
        tooltip:{
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
          callbacks:{
            label:(ctx)=>` ${ctx.dataset.label}: €${Number(ctx.parsed.y||0).toLocaleString("pt-PT",{minimumFractionDigits:2})}`
          }
        }
      }
    }
  });
}

/* ===============================
   Render: Timeline (Line)
   - Evolução do investido acumulado
   - Avaliação “hoje” (quantidades atuais * preço atual) após cada movimento
   =============================== */
function renderTimeline(points){
  const el = document.getElementById("chartTimeline");
  if (!el) return;
  charts.timeline?.destroy();

  if (!points.length){
    const ctx = el.getContext("2d");
    ctx.clearRect(0,0,el.width, el.height);
    return;
  }

  const labels   = points.map(p=>p.label);
  const invested = points.map(p=>p.cumInvest);
  const valueNow = points.map(p=>p.valueNow);

  charts.timeline = new Chart(el,{
    type:"line",
    data:{
      labels,
      datasets:[
        { label:"Investido acumulado (€)", data:invested, tension:.25, borderWidth:2 },
        { label:"Avaliação atual (€)",     data:valueNow, tension:.25, borderWidth:2 }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      elements:{ point:{ radius:0 } },
      scales:{
        x:{ ticks:{ color: chartColors().ticks }, grid:{ color: chartColors().grid }},
        y:{ ticks:{ color: chartColors().ticks }, grid:{ color: chartColors().grid }}
      },
      plugins:{
        legend:{ labels:{ color: chartColors().ticks }},
        tooltip:{
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
          callbacks:{
            label:(ctx)=>` ${ctx.dataset.label}: €${Number(ctx.parsed.y||0).toLocaleString("pt-PT",{minimumFractionDigits:2})}`
          }
        }
      }
    }
  });
}

/* ===============================
   Helpers (mantidos do teu código)
   =============================== */
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isFiniteNum(v){ return Number.isFinite(Number(v)); }
function formatNum(n){ return Number(n || 0).toLocaleString("pt-PT"); }

// busca info em acoesDividendos por lotes de 10
async function fetchDividendInfoByTickers(tickers){
  const out = new Map();
  const chunks = [];
  for (let i=0; i<tickers.length; i+=10) chunks.push(tickers.slice(i, i+10));
  for (const chunk of chunks){
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

/* ===============================
   Quick Actions (mantido)
   =============================== */
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

/* ===============================
   INIT (screen)
   =============================== */
export async function initScreen() {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  cont.innerHTML = "A carregar…";
  await ensureChartJS(); // garante Chart.js antes de renderizar

  try {
    // 1) Buscar movimentos e agrupar por ticker
    const qSnap = await getDocs(query(collection(db, "ativos"), orderBy("dataCompra", "desc")));
    if (qSnap.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      // limpa e gráficos também
      renderSetorDoughnut(new Map());
      renderTop5Bar([]);
      renderTimeline([]);
      return;
    }

    const grupos = new Map();
    const movimentosAsc = []; // para timeline (vamos ordenar por data ascendente)
    qSnap.forEach(docu => {
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

      const dt = (d.dataCompra && typeof d.dataCompra.toDate === "function") ? d.dataCompra.toDate() : null;
      if (!g.lastDate || (dt && dt > g.lastDate)) g.lastDate = dt;

      g.nome = d.nome || g.nome;
      g.setor = d.setor || g.setor;
      g.mercado = d.mercado || g.mercado;

      grupos.set(ticker, g);

      movimentosAsc.push({
        date: dt || new Date(0),
        ticker, qtd, preco
      });
    });

    // 2) Preços atuais
    const gruposArr = Array.from(grupos.values());
    const tickers = gruposArr.map(g => g.ticker);
    const infoMap = await fetchDividendInfoByTickers(tickers);

    const fmtEUR  = new Intl.NumberFormat("pt-PT",{ style:"currency", currency:"EUR" });
    const fmtDate = new Intl.DateTimeFormat("pt-PT",{ year:"numeric", month:"short", day:"2-digit" });

    // Enriquecer grupos com lucroAtual (para gráficos/cards)
    gruposArr.forEach(g=>{
      const info = infoMap.get(g.ticker) || {};
      const precoAtual = isFiniteNum(info.valorStock) ? Number(info.valorStock) : null;
      const precoMedio = g.qtd > 0 ? (g.investido / g.qtd) : 0;
      g.lucroAtual = (precoAtual !== null) ? (precoAtual - precoMedio) * g.qtd : 0;
      g.precoAtual = precoAtual;
    });

    // 2.1) Agregar por setor (valor investido)
    const setoresMap = new Map();
    for (const g of gruposArr) {
      if ((g.qtd || 0) <= 0) continue;
      const setor = g.setor || "—";
      const prev = setoresMap.get(setor) || 0;
      setoresMap.set(setor, prev + (g.investido || 0));
    }

    // 2.2) Cartões de resumo
    const totalInvestido = gruposArr.filter(g=>g.qtd>0).reduce((a,g)=>a+(g.investido||0),0);
    const lucroTotal     = gruposArr.filter(g=>g.qtd>0).reduce((a,g)=>a+(g.lucroAtual||0),0);
    const numAtivos      = gruposArr.filter(g=>g.qtd>0).length;
    const retornoPct     = totalInvestido ? (lucroTotal/totalInvestido*100) : 0;

    const elTI = document.getElementById("prtTotalInvestido");
    const elLT = document.getElementById("prtLucroTotal");
    const elRP = document.getElementById("prtRetorno");
    const elNA = document.getElementById("prtNumAtivos");
    if (elTI) elTI.textContent = fmtEUR.format(totalInvestido);
    if (elLT) elLT.textContent = fmtEUR.format(lucroTotal);
    if (elRP) elRP.textContent = `${retornoPct.toFixed(1)}%`;
    if (elNA) elNA.textContent = String(numAtivos);

    // 2.3) Timeline (ordena movimentos por data ascendente)
    movimentosAsc.sort((a,b)=>a.date - b.date);
    // map para qty corrente por ticker
    const qtyNow = new Map();
    const priceNow = new Map();
    gruposArr.forEach(g=>{
      if (isFiniteNum(g.precoAtual)) priceNow.set(g.ticker, Number(g.precoAtual));
      qtyNow.set(g.ticker, 0);
    });

    let cumInvest = 0;
    const timelinePoints = [];
    for (const m of movimentosAsc){
      const deltaInvest = Number(m.qtd) * Number(m.preco);
      cumInvest += deltaInvest;

      // atualiza qty corrente deste ticker até aqui
      qtyNow.set(m.ticker, (qtyNow.get(m.ticker)||0) + m.qtd);

      // avaliação “hoje” (quantidades após este movimento * preço atual de cada ticker)
      let valueNow = 0;
      qtyNow.forEach((q,tk)=>{
        const p = priceNow.get(tk);
        if (isFiniteNum(p)) valueNow += q * Number(p);
      });

      timelinePoints.push({
        label: isFinite(m.date?.getTime?.()) ? fmtDate.format(m.date) : "",
        cumInvest: cumInvest,
        valueNow: valueNow
      });
    }

    // 3) Render GRÁFICOS
    renderSetorDoughnut(setoresMap);
    renderTop5Bar(gruposArr);
    renderTimeline(timelinePoints);

    // 4) Render LISTA (mantém o teu HTML por item)
    const html = gruposArr
      .filter(g => g.qtd > 0)
      .map(g => {
        const precoAtual = g.precoAtual;
        const precoMedio = g.qtd > 0 ? (g.investido / g.qtd) : 0;
        const lucroAtual = g.lucroAtual || 0;

        // barra zero ao centro
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

        const { taxa, periodLabel } = pickBestRate(infoMap.get(g.ticker) || {});
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

    // 5) Quick actions (mantido)
    wireQuickActions(gruposArr);

    // 6) Re-render ao mudar de tema (remove anterior para não duplicar)
    if (window.__prtThemeHandler){
      window.removeEventListener("app:theme-changed", window.__prtThemeHandler);
    }
    window.__prtThemeHandler = () => {
      renderSetorDoughnut(setoresMap);
      renderTop5Bar(gruposArr);
      renderTimeline(timelinePoints);
    };
    window.addEventListener("app:theme-changed", window.__prtThemeHandler);

  } catch (e) {
    console.error("Erro ao carregar atividades:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
    // ainda assim, não deixar os charts “sujos”
    renderSetorDoughnut(new Map());
    renderTop5Bar([]);
    renderTimeline([]);
  }
}
