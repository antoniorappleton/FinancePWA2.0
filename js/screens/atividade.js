// ===== Hard error guard =====
window.addEventListener("error", (e) =>
  console.error("ATIVIDADE HARD ERROR:", e.error || e.message)
);

// ===== Firebase =====
import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, orderBy, where,
  addDoc, serverTimestamp, doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ===============================
// Carregar Chart.js on-demand
// ===============================
async function ensureChartJS() {
  if (window.Chart) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ===============================
// Tema
// ===============================
function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}
function chartColors() {
  const dark = isDark();
  return {
    grid: dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
    ticks: dark ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.7)",
    tooltipBg: dark ? "rgba(17,17,17,.95)" : "rgba(255,255,255,.95)",
    tooltipFg: dark ? "#fff" : "#111",
  };
}
const PALETTE = [
  "#4F46E5","#22C55E","#EAB308","#EF4444","#06B6D4","#F59E0B",
  "#A855F7","#10B981","#3B82F6","#F472B6","#84CC16","#14B8A6"
];

// ===============================
// Helpers
// ===============================
function toNumStrict(v){ const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function isFiniteNum(v){ if (v===null||v===undefined||v==="") return false; const n=Number(v); return Number.isFinite(n); }
function formatNum(n){ return Number(n || 0).toLocaleString("pt-PT"); }

// Dividend data helpers
async function fetchDividendInfoByTickers(tickers){
  const out = new Map();
  const chunks = [];
  for (let i=0;i<tickers.length;i+=10) chunks.push(tickers.slice(i,i+10));
  for (const chunk of chunks){
    const q2 = query(collection(db,"acoesDividendos"), where("ticker","in",chunk));
    const snap = await getDocs(q2);
    snap.forEach(d=>{
      const x = d.data();
      if (x.ticker) out.set(String(x.ticker).toUpperCase(), x);
    });
  }
  return out;
}
function pickBestRate(info){
  if (typeof info?.taxaCrescimento_1mes === "number") return { taxa: info.taxaCrescimento_1mes, periodLabel: "mês" };
  if (typeof info?.taxaCrescimento_1semana === "number") return { taxa: info.taxaCrescimento_1semana, periodLabel: "semana" };
  if (typeof info?.taxaCrescimento_1ano === "number") return { taxa: info.taxaCrescimento_1ano, periodLabel: "ano" };
  return { taxa: null, periodLabel: null };
}
function estimateTime(currentPrice, targetPrice, growthPct, label){
  const r = Number(growthPct || 0) / 100;
  if (r<=0 || !isFiniteNum(currentPrice) || !isFiniteNum(targetPrice) || currentPrice<=0 || targetPrice<=0) return "—";
  const n = Math.log(targetPrice/currentPrice) / Math.log(1+r);
  if (!isFinite(n) || n < 0) return "—";
  if (label==="semana") return `${n.toFixed(1)} semanas`;
  if (label==="mês")    return `${n.toFixed(1)} meses`;
  return `${n.toFixed(1)} anos`;
}
const MES_IDX = { "janeiro":0,"fevereiro":1,"março":2,"marco":2,"abril":3,"maio":4,"junho":5,"julho":6,"agosto":7,"setembro":8,"outubro":9,"novembro":10,"dezembro":11 };
function pagamentosAno(p){p=String(p||"").toLowerCase(); if(p.startsWith("mensal"))return 12; if(p.startsWith("trimes"))return 4; if(p.startsWith("semes"))return 2; if(p.startsWith("anual"))return 1; return 0;}
function mesesPagos(period, mesTipico){
  const p = String(period||"").toLowerCase();
  const baseIdx = MES_IDX[String(mesTipico||"").trim().toLowerCase()];
  if (p.startsWith("mensal")) return Array.from({length:12},(_,i)=>i);
  if (p.startsWith("trimes")){ const s=Number.isFinite(baseIdx)?baseIdx:0; return [s,(s+3)%12,(s+6)%12,(s+9)%12]; }
  if (p.startsWith("semes")) { const s=Number.isFinite(baseIdx)?baseIdx:0; return [s,(s+6)%12]; }
  if (p.startsWith("anual")) return Number.isFinite(baseIdx)?[baseIdx]:[];
  return [];
}

// ===============================
// Renders — gráficos (uso de Chart.js)
// ===============================
function renderSetorDoughnut(map){
  const el = document.getElementById("chartSetores"); if (!el) return;
  if (window.__chSetores) window.__chSetores.destroy();
  const labels=[...map.keys()], data=[...map.values()];
  if (!labels.length){ el.getContext("2d").clearRect(0,0,el.width, el.height); return; }
  window.__chSetores = new Chart(el,{type:"doughnut",
    data:{labels,datasets:[{data,backgroundColor:labels.map((_,i)=>PALETTE[i%PALETTE.length]),borderWidth:1}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"62%",
      plugins:{legend:{position:"bottom",labels:{color:chartColors().ticks}},
        tooltip:{backgroundColor:chartColors().tooltipBg,titleColor:chartColors().tooltipFg,bodyColor:chartColors().tooltipFg}}
    }
  });
}
function renderMercadoDoughnut(map){
  const el = document.getElementById("chartMercados"); if (!el) return;
  if (window.__chMercados) window.__chMercados.destroy();
  const labels=[...map.keys()], data=[...map.values()];
  if (!labels.length){ el.getContext("2d").clearRect(0,0,el.width, el.height); return; }
  window.__chMercados = new Chart(el,{type:"doughnut",
    data:{labels,datasets:[{data,backgroundColor:labels.map((_,i)=>PALETTE[(i+5)%PALETTE.length]),borderWidth:1}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"62%",
      plugins:{legend:{position:"bottom",labels:{color:chartColors().ticks}},
        tooltip:{backgroundColor:chartColors().tooltipBg,titleColor:chartColors().tooltipFg,bodyColor:chartColors().tooltipFg}}
    }
  });
}
function renderTop5Bar(arr){
  const el=document.getElementById("chartTop5"); if(!el) return;
  if (window.__chTop5) window.__chTop5.destroy();
  const ativos = arr.filter(g=>g.qtd>0).sort((a,b)=>(b.investido||0)-(a.investido||0)).slice(0,5);
  if (!ativos.length){ el.getContext("2d").clearRect(0,0,el.width, el.height); return; }
  const labels=ativos.map(a=>a.ticker), invest=ativos.map(a=>a.investido||0), lucro=ativos.map(a=>a.lucroAtual||0);
  window.__chTop5 = new Chart(el,{type:"bar",
    data:{labels,datasets:[{label:"Investido (€)",data:invest,backgroundColor:"#3B82F6"},{label:"Lucro Atual (€)",data:lucro,backgroundColor:"#22C55E"}]},
    options:{responsive:true,maintainAspectRatio:false,
      scales:{x:{ticks:{color:chartColors().ticks},grid:{color:chartColors().grid}},y:{ticks:{color:chartColors().ticks},grid:{color:chartColors().grid}}},
      plugins:{legend:{labels:{color:chartColors().ticks}}}
    }
  });
}
function renderTop5YieldBar(rows){
  const el=document.getElementById("chartTop5Yield"); if(!el) return;
  if (window.__chTop5Yield) window.__chTop5Yield.destroy();
  const ativos = rows.filter(r=>r.active && isFiniteNum(r.yieldCur)).sort((a,b)=>b.yieldCur-a.yieldCur).slice(0,5);
  if (!ativos.length){ el.getContext("2d").clearRect(0,0,el.width, el.height); return; }
  const labels=ativos.map(a=>a.ticker), ys=ativos.map(a=>Number(a.yieldCur*100).toFixed(2));
  window.__chTop5Yield = new Chart(el,{type:"bar",
    data:{labels,datasets:[{label:"Yield (%)",data:ys}]},
    options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,
      scales:{x:{ticks:{color:chartColors().ticks},grid:{color:chartColors().grid}},y:{ticks:{color:chartColors().ticks},grid:{color:chartColors().grid}}},
      plugins:{legend:{labels:{color:chartColors().ticks}}}
    }
  });
}
function renderTimeline(points){
  const el=document.getElementById("chartTimeline"); if(!el) return;
  if (window.__chTimeline) window.__chTimeline.destroy();
  if(!points.length){ el.getContext("2d").clearRect(0,0,el.width, el.height); return; }
  const labels=points.map(p=>p.label), invested=points.map(p=>p.cumInvest), valueNow=points.map(p=>p.valueNow);
  window.__chTimeline = new Chart(el,{type:"line",
    data:{labels,datasets:[{label:"Investido acumulado (€)",data:invested,tension:.25,borderWidth:2},{label:"Avaliação atual (€)",data:valueNow,tension:.25,borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,elements:{point:{radius:0}},
      scales:{x:{ticks:{color:chartColors().ticks},grid:{color:chartColors().grid}},y:{ticks:{color:chartColors().ticks},grid:{color:chartColors().grid}}},
      plugins:{legend:{labels:{color:chartColors().ticks}}}
    }
  });
}
function renderDividendoCalendario12m(arr){
  const el=document.getElementById("chartDivCalendario"); if(!el) return;
  if (window.__chDivCal) window.__chDivCal.destroy();
  const labels=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  window.__chDivCal = new Chart(el,{type:"bar",
    data:{labels,datasets:[{label:"€ / mês (estimado)",data:arr}]} ,
    options:{responsive:true,maintainAspectRatio:false,
      scales:{x:{ticks:{color:chartColors().ticks},grid:{color:chartColors().grid}},y:{ticks:{color:chartColors().ticks},grid:{color:chartColors().grid}}},
      plugins:{legend:{labels:{color:chartColors().ticks}}}
    }
  });
}

// ===============================
// Quick Actions (comprar/vender/editar + collapse)
// ===============================
function wireQuickActions(gruposArr){
  const byTicker = new Map(gruposArr.map((g) => [g.ticker, g]));
  const $ = (s) => document.querySelector(s);

  const modal = $("#pfAddModal");
  const title = $("#pfAddTitle");
  const form = $("#pfAddForm");
  const close = $("#pfAddClose");
  const cancel = $("#pfAddCancel");

  const tipoSel = $("#pfTipoAcao");
  const labelP = $("#pfLabelPreco");
  const vendaTotWrap = $("#pfVendaTotalWrap");
  const vendaTot = $("#pfVendaTotal");
  // (NOVO) posição atual do ticker que está aberto no modal
  let currentPosQty = 0;

  // (NOVO) hidden onde vamos guardar a posição atual
  // (nota: vais adicionar este hidden no HTML a seguir — depois fazemos isso)
  const fPosAtual = document.getElementById("pfPosicaoAtual");
  const fTicker = $("#pfTicker");
  const fNome = $("#pfNome");
  const fSetor = $("#pfSetor");
  const fMerc = $("#pfMercado");
  const fQtd = $("#pfQuantidade");
  const fPreco = $("#pfPreco");
  const fObj = $("#pfObjetivo");

  function open(kind, ticker) {
    const g = byTicker.get(ticker);
    if (!g) return;

    // posição atual em carteira
    currentPosQty = Number(g.qtd || 0);
    if (fPosAtual) fPosAtual.value = String(currentPosQty);

    // garantir que o input de quantidade fica editável
    if (fQtd) fQtd.removeAttribute("readonly");

    modal?.classList.remove("hidden");
    if (title)
      title.textContent = kind === "compra" ? "Comprar ativo" : "Vender ativo";
    if (tipoSel) tipoSel.value = kind;
    if (fTicker) fTicker.value = g.ticker;
    if (fNome) fNome.value = g.nome;
    if (fSetor) fSetor.value = g.setor || "";
    if (fMerc) fMerc.value = g.mercado || "";
    if (fQtd) fQtd.value = "";
    if (fPreco) fPreco.value = "";
    if (fObj) fObj.value = g.objetivo || "";
    if (vendaTot) vendaTot.checked = false;
    if (vendaTotWrap)
      vendaTotWrap.style.display = kind === "venda" ? "block" : "none";
    if (labelP)
      labelP.textContent =
        kind === "venda" ? "Preço de venda (€)" : "Preço de compra (€)";
  }
  function closeModal() {
    modal?.classList.add("hidden");
    form?.reset();
    const idHidden = document.getElementById("pfDocId");
    if (idHidden) idHidden.value = "";
    if (tipoSel) tipoSel.value = "compra";
    if (labelP) labelP.textContent = "Preço de compra (€)";
    if (vendaTot) vendaTot.checked = false;
    if (vendaTotWrap) vendaTotWrap.style.display = "none";
  }
  close?.addEventListener("click", closeModal);
  cancel?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e) => {
    if (e.target.id === "pfAddModal") closeModal();
  });

  // BUY/SELL buttons
  document.getElementById("listaAtividades")?.addEventListener("click", (e) => {
    const buy = e.target.closest?.("[data-buy]");
    const sell = e.target.closest?.("[data-sell]");
    if (buy) open("compra", buy.getAttribute("data-buy"));
    if (sell) open("venda", sell.getAttribute("data-sell"));
  });

  // Collapse per card
  document.getElementById("listaAtividades")?.addEventListener("click", (e) => {
    const t = e.target.closest?.("[data-toggle-card]");
    if (!t) return;
    const card = t.closest(".activity-item");
    if (!card) return;
    card.classList.toggle("collapsed");
  });

  // Edit button
  document
    .getElementById("listaAtividades")
    ?.addEventListener("click", async (e) => {
      const btn = e.target.closest?.("[data-edit]");
      if (!btn) return;
      const docId = btn.getAttribute("data-edit");
      const ticker = btn.getAttribute("data-edit-ticker") || "";
      if (!docId) {
        alert("Não encontrei o último movimento deste ticker.");
        return;
      }

      try {
        const ref = doc(db, "ativos", docId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          alert("Documento não encontrado.");
          return;
        }
        const d = snap.data();

        modal?.classList.remove("hidden");
        if (title) title.textContent = "Editar movimento";
        if (tipoSel) tipoSel.value = "edicao";
        const idHidden = document.getElementById("pfDocId");
        if (idHidden) idHidden.value = docId;

        if (fTicker) fTicker.value = d.ticker || ticker || "";
        if (fNome) fNome.value = d.nome || "";
        if (fSetor) fSetor.value = d.setor || "";
        if (fMerc) fMerc.value = d.mercado || "";
        if (fQtd) fQtd.value = Number(d.quantidade || 0);
        if (fPreco) fPreco.value = Number(d.precoCompra || 0);
        if (fObj) fObj.value = Number(d.objetivoFinanceiro || 0);

        if (labelP) labelP.textContent = "Preço (€)";
        if (vendaTotWrap) vendaTotWrap.style.display = "none";
      } catch (err) {
        console.error("Falha ao abrir edição:", err);
        alert("Não foi possível abrir a edição.");
      }
    });

  // Tipo muda o label e visibilidade de venda total
  tipoSel?.addEventListener("change", () => {
    const isVenda = tipoSel.value === "venda";

    if (labelP)
      labelP.textContent = isVenda
        ? "Preço de venda (€)"
        : "Preço de compra (€)";

    if (vendaTotWrap) vendaTotWrap.style.display = isVenda ? "block" : "none";

    // (NOVO) se não for venda, limpar estado de "venda total"
    if (!isVenda) {
      if (vendaTot) vendaTot.checked = false;
      if (fQtd) {
        fQtd.removeAttribute("readonly");
        // se quiseres limpar também o valor, descomenta:
        // fQtd.value = "";
      }
    }
  });

  // ===============================
  // Venda total = fechar posição (SEM apagar histórico)
  // ===============================
  vendaTot?.addEventListener("change", () => {
    const checked = !!vendaTot.checked;
    const pos = Number(fPosAtual?.value || currentPosQty || 0);

    if (!fQtd) return;

    if (checked) {
      if (!(pos > 0)) {
        alert("Não há posição para fechar (quantidade em carteira = 0).");
        vendaTot.checked = false;
        return;
      }

      // preenche com a posição total
      fQtd.value = Math.abs(pos).toString();
      fQtd.setAttribute("readonly", "readonly");
    } else {
      fQtd.removeAttribute("readonly");
      fQtd.value = "";
    }
  });

  // Submit
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tipo = (tipoSel?.value || "compra").toLowerCase(); // compra | venda | edicao
    const nome = fNome?.value.trim() || "";
    const ticker = fTicker?.value.trim().toUpperCase() || "";
    const setor = fSetor?.value.trim() || "";
    const merc = fMerc?.value.trim() || "";
    const qtd = toNumStrict(fQtd?.value);
    const preco = toNumStrict(fPreco?.value);
    const obj = toNumStrict(fObj?.value);
    const vendaTotal = !!vendaTot?.checked;
    const docId = (document.getElementById("pfDocId")?.value || "").trim();

    try {
      if (tipo === "edicao" && docId) {
        await updateDoc(doc(db, "ativos", docId), {
          nome,
          ticker,
          setor,
          mercado: merc,
          quantidade: Number.isFinite(qtd) ? qtd : 0,
          precoCompra: Number.isFinite(preco) ? preco : 0,
          objetivoFinanceiro: Number.isFinite(obj) ? obj : 0,
        });
      } else {
        let qtdEfetiva = qtd;

        // venda total → usar posição atual
        if (tipo === "venda" && vendaTotal) {
          const pos = Number(fPosAtual?.value || currentPosQty || 0);
          qtdEfetiva = Math.abs(pos);

          if (!(qtdEfetiva > 0)) {
            alert("Não há posição para fechar (quantidade em carteira = 0).");
            return;
          }
        }

        // validação base
        if (
          !ticker ||
          !nome ||
          !Number.isFinite(qtdEfetiva) ||
          !Number.isFinite(preco) ||
          qtdEfetiva <= 0 ||
          preco <= 0
        ) {
          alert("Preenche Ticker, Nome, Quantidade (>0) e Preço (>0).");
          return;
        }

        // venda parcial não pode exceder a posição
        if (tipo === "venda" && !vendaTotal) {
          const pos = Number(fPosAtual?.value || currentPosQty || 0);
          if (qtdEfetiva > pos) {
            alert(`Não podes vender mais do que tens. Posição atual: ${pos}`);
            return;
          }
        }
        const quantidade =
          tipo === "venda" ? -Math.abs(qtdEfetiva) : Math.abs(qtdEfetiva);
        const payload = {
          tipoAcao: tipo,
          nome,
          ticker,
          setor,
          mercado: merc,
          quantidade,
          precoCompra: preco,
          objetivoFinanceiro: Number.isFinite(obj) ? obj : 0,
          dataCompra: serverTimestamp(),
        };
        await addDoc(collection(db, "ativos"), payload);
      }

      closeModal();
      location.reload();
    } catch (err) {
      console.error("❌ Erro ao guardar movimento:", err);
      alert("Não foi possível guardar. Tenta novamente.");
    }
  });
}

// ===============================
// Ajuda (popup)
// ===============================
const HELP_KEY = "prt.help.dismissed";
function wirePortfolioHelpModal(){
  const modal = document.getElementById("prtHelpModal");
  if (!modal || modal.__wired) return;
  modal.__wired = true;

  const closeBtn = document.getElementById("prtHelpClose");
  const okBtn    = document.getElementById("prtHelpOK");
  const laterBtn = document.getElementById("prtHelpLater");
  const dontShow = document.getElementById("prtHelpDontShow");

  const close = (persist) => {
    if (persist && dontShow?.checked){ try{ localStorage.setItem(HELP_KEY,"1"); }catch{} }
    modal.classList.add("hidden");
  };

  closeBtn?.addEventListener("click", ()=>close(false));
  laterBtn?.addEventListener("click", ()=>close(false));
  okBtn?.addEventListener("click", ()=>close(true));

  modal.addEventListener("click", (e)=>{ if (e.target===modal) close(false); });
  document.addEventListener("keydown", (e)=>{ if (!modal.classList.contains("hidden") && e.key==="Escape") close(false); });
}
function showPortfolioHelp(force=false){
  const modal = document.getElementById("prtHelpModal");
  if (!modal) return;
  if (!force){ try{ if (localStorage.getItem(HELP_KEY)==="1") return; }catch{} }
  modal.classList.remove("hidden");
}

// ===============================
// INIT (screen)
// ===============================
export async function initScreen(){
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  cont.innerHTML = "A carregar…";
  await ensureChartJS();

  try{
    // 1) Buscar movimentos e agrupar
    const snap = await getDocs(
      query(collection(db, "ativos"), orderBy("dataCompra", "asc"))
    );
    if (snap.empty){
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      renderSetorDoughnut(new Map());
      renderMercadoDoughnut(new Map());
      renderTop5Bar([]);
      renderTop5YieldBar([]);
      renderTimeline([]);
      renderDividendoCalendario12m(new Array(12).fill(0));
      return;
    }

    const grupos = new Map();
    const movimentosAsc = [];

    snap.forEach((docu)=>{
      const d = docu.data();
      const dt =
        d.dataCompra && typeof d.dataCompra.toDate === "function"
          ? d.dataCompra.toDate()
          : null;

      const ticker = String(d.ticker || "").toUpperCase();
      if (!ticker) return;

      const qtd = toNumStrict(d.quantidade);
      const preco = toNumStrict(d.precoCompra);
      const safeQtd = Number.isFinite(qtd) ? qtd : 0;
      const safePreco = Number.isFinite(preco) ? preco : 0;
      // estado financeiro correto por ticker
      const g = grupos.get(ticker) || {
        ticker,
        nome: d.nome || ticker,
        setor: d.setor || "-",
        mercado: d.mercado || "-",

        qtd: 0,
        custoMedio: 0, // 👈 NOVO
        investido: 0, // = qtd * custoMedio
        realizado: 0, // 👈 opcional (já preparado)

        objetivo: 0,
        anyObjSet: false,
        lastDate: null,
        lastDocId: null,
      };

      // --- COMPRA ---
      if (safeQtd > 0) {
        const totalAntes = g.qtd * g.custoMedio;
        const totalCompra = safeQtd * safePreco;
        const novaQtd = g.qtd + safeQtd;

        g.custoMedio = novaQtd > 0 ? (totalAntes + totalCompra) / novaQtd : 0;

        g.qtd = novaQtd;
      }

      // --- VENDA ---
      else if (safeQtd < 0) {
        const sellQtd = Math.abs(safeQtd);
        const lucro = (safePreco - g.custoMedio) * sellQtd;

        g.realizado += lucro;
        g.qtd -= sellQtd;

        if (g.qtd <= 0) {
          g.qtd = 0;
          g.custoMedio = 0;
        }
      }

      // investido real (posição aberta)
      g.investido = g.qtd * g.custoMedio;

      const obj = toNumStrict(d.objetivoFinanceiro);
      if (!g.anyObjSet && Number.isFinite(obj) && obj > 0) {
        g.objetivo = obj;
        g.anyObjSet = true;
      }

      if (!g.lastDate || (dt && dt > g.lastDate)) {
        g.lastDate = dt;
        g.lastDocId = docu.id;
      }

      g.nome = d.nome || g.nome;
      g.setor = d.setor || g.setor;
      g.mercado = d.mercado || g.mercado;

      grupos.set(ticker, g);
      movimentosAsc.push({
        date: dt || new Date(0),
        ticker,
        qtd: safeQtd,
        preco: safePreco,
      });
    });

    const gruposArr = Array.from(grupos.values());

    // 2) Info complementar
    const infoMap = await fetchDividendInfoByTickers(gruposArr.map(g=>g.ticker));
    const fmtEUR = new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR"});
    const fmtDate = new Intl.DateTimeFormat("pt-PT",{year:"numeric",month:"short",day:"2-digit"});

    const rowsForYield = [];
    gruposArr.forEach((g)=>{
      const info = infoMap.get(g.ticker) || {};
      const precoAtual = isFiniteNum(info.valorStock) ? Number(info.valorStock) : null;
      const precoMedio = g.qtd !== 0 ? (g.investido / (g.qtd || 1)) : 0;
      g.lucroAtual = precoAtual !== null ? (precoAtual - precoMedio) * g.qtd : 0;
      g.precoAtual = precoAtual;

      const dividendo = isFiniteNum(info.dividendo) ? Number(info.dividendo) : 0;
      const dmed24 = isFiniteNum(info.dividendoMedio24m) ? Number(info.dividendoMedio24m) : 0;
      const pe = isFiniteNum(info.peRatio) ? Number(info.peRatio) : null;
      const sma50 = isFiniteNum(info.sma50) ? Number(info.sma50) : null;
      const sma200 = isFiniteNum(info.sma200) ? Number(info.sma200) : null;

      const yCur = precoAtual && dividendo > 0 && info.periodicidade
        ? (dividendo * pagamentosAno(info.periodicidade)) / precoAtual
        : (precoAtual && dmed24 > 0 ? dmed24 / precoAtual : null);

      const y24m = precoAtual && dmed24 > 0 ? dmed24 / precoAtual : null;

      g._yCur = yCur; g._y24m = y24m; g._pe = pe; g._sma50 = sma50; g._sma200 = sma200;
      rowsForYield.push({ ticker:g.ticker, active:g.qtd>0, yieldCur:yCur });
    });

    // 2.1) Distribuições (apenas abertas)
    const setoresMap = new Map(), mercadosMap = new Map();
    for (const g of gruposArr){
      if ((g.qtd||0) <= 0) continue;
      const setor = g.setor || "—"; setoresMap.set(setor, (setoresMap.get(setor)||0)+(g.investido||0));
      const merc  = g.mercado || "—"; mercadosMap.set(merc, (mercadosMap.get(merc)||0)+(g.investido||0));
    }

    // 2.2) KPIs agregados
    const abertos = gruposArr.filter(g=>g.qtd>0);
    const totalInvestido = abertos.reduce((a,g)=>a+(g.investido||0),0);
    const lucroTotal     = abertos.reduce((a,g)=>a+(g.lucroAtual||0),0);
    const retornoPct     = totalInvestido ? (lucroTotal/totalInvestido)*100 : 0;

    // Dividendos
    let rendimentoAnual = 0;
    const eurosMes = new Array(12).fill(0);
    for (const g of abertos){
      const info = infoMap.get(g.ticker) || {};
      const divUnit = isFiniteNum(info.dividendo) ? Number(info.dividendo) : 0;
      const per = info.periodicidade; const mesT = info.mes;
      const payN = pagamentosAno(per);
      rendimentoAnual += g.qtd * divUnit * payN;
      for (const m of mesesPagos(per,mesT)) eurosMes[m] += g.qtd * divUnit;
    }

    // Exposição acima da SMA200
    let somaPesosAcima=0;
    for (const g of abertos){
      if (!totalInvestido) continue;
      const w = (g.investido||0)/totalInvestido;
      const p=g.precoAtual, s200=g._sma200;
      if (isFiniteNum(p) && isFiniteNum(s200) && Number(p)>Number(s200)) somaPesosAcima += w;
    }
    const expSMA200Pct = somaPesosAcima*100;

    // Preencher KPIs
    const elTI = document.getElementById("prtTotalInvestido");
    const elRA = document.getElementById("prtRendimentoAnual");
    const elRP = document.getElementById("prtRetorno");
    const elEX = document.getElementById("prtExpSMA200");
    if (elTI) elTI.textContent = fmtEUR.format(totalInvestido);
    if (elRA) elRA.textContent = fmtEUR.format(rendimentoAnual);
    if (elRP) elRP.textContent = `${retornoPct.toFixed(1)}%`;
    if (elEX) elEX.textContent = `${expSMA200Pct.toFixed(0)}%`;

    // 2.3) Timeline
    movimentosAsc.sort((a,b)=>a.date-b.date);
    const qtyNow = new Map(), priceNow = new Map();
    gruposArr.forEach(g=>{ if (isFiniteNum(g.precoAtual)) priceNow.set(g.ticker,Number(g.precoAtual)); qtyNow.set(g.ticker,0); });
    let cumInvest=0; const timelinePoints=[];
    for (const m of movimentosAsc){
      const deltaInvest = Number(m.qtd)*Number(m.preco);
      cumInvest += deltaInvest;
      qtyNow.set(m.ticker, (qtyNow.get(m.ticker)||0)+m.qtd);
      let valueNow=0; qtyNow.forEach((q,tk)=>{ const p=priceNow.get(tk); if (isFiniteNum(p)) valueNow += q*Number(p); });
      timelinePoints.push({ label: isFinite(m.date?.getTime?.()) ? new Intl.DateTimeFormat("pt-PT",{year:"numeric",month:"short",day:"2-digit"}).format(m.date) : "", cumInvest, valueNow });
    }

    // 3) Render gráficos
    renderSetorDoughnut(setoresMap);
    renderMercadoDoughnut(mercadosMap);
    renderTop5Bar(gruposArr);
    renderTop5YieldBar(rowsForYield);
    renderTimeline(timelinePoints);
    renderDividendoCalendario12m(eurosMes);

    // 4) Render lista
    const html = gruposArr
      .filter((g) => Number.isFinite(g.qtd) && g.qtd > 0)
      .map((g) => {
        const info = infoMap.get(g.ticker) || {};
        const precoAtual = g.precoAtual;
        const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
        const lucroAtual = g.lucroAtual || 0;
        const posStatus =
          g.qtd > 0
            ? "Posição aberta"
            : g.qtd < 0
            ? "Posição negativa (ver movimentos)"
            : "Posição encerrada";
        const itemClass = g.qtd > 0 ? "" : " muted";

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
                <div class="fill ${
                  positive ? "positive" : "negative"
                }" style="width:${sideWidthPct}%"></div>
                <div class="zero"></div>
              </div>
            </div>`;
        }

        const tp2Necessario =
          objetivo > 0 && g.qtd !== 0
            ? precoMedio + objetivo / (g.qtd || 1)
            : null;
        const { taxa, periodLabel } = pickBestRate(info);
        const estimativa =
          tp2Necessario && precoAtual
            ? estimateTime(precoAtual, tp2Necessario, taxa, periodLabel)
            : "—";
        const dataTxt = g.lastDate
          ? new Intl.DateTimeFormat("pt-PT", {
              year: "numeric",
              month: "short",
              day: "2-digit",
            }).format(g.lastDate)
          : "sem data";

        const dividendoUnit = isFiniteNum(info.dividendo)
          ? Number(info.dividendo)
          : 0;
        const payN = pagamentosAno(info.periodicidade);
        const divAnualEst = dividendoUnit * payN;
        const yCur = g._yCur,
          y24 = g._y24m,
          pe = g._pe,
          s50 = g._sma50,
          s200 = g._sma200;
        const yPct = isFiniteNum(yCur) ? (yCur * 100).toFixed(2) + "%" : "—";
        const y24Pct = isFiniteNum(y24) ? (y24 * 100).toFixed(2) + "%" : "—";
        const yBadge =
          isFiniteNum(yCur) && isFiniteNum(y24)
            ? yCur > y24
              ? "↑ acima da média"
              : "↓ abaixo da média"
            : "";
        const peBadge = isFiniteNum(pe)
          ? pe < 15
            ? "Barato"
            : pe <= 25
            ? "Justo"
            : "Caro"
          : "—";
        const d50 =
          isFiniteNum(s50) && isFiniteNum(precoAtual)
            ? ((precoAtual - s50) / s50) * 100
            : null;
        const d200 =
          isFiniteNum(s200) && isFiniteNum(precoAtual)
            ? ((precoAtual - s200) / s200) * 100
            : null;
        const d50Txt = d50 === null ? "—" : `${d50.toFixed(1)}%`;
        const d200Txt = d200 === null ? "—" : `${d200.toFixed(1)}%`;

        const stopLight =
          isFiniteNum(precoAtual) &&
          isFiniteNum(s200) &&
          precoAtual < s200 &&
          Number(info.taxaCrescimento_1mes || 0) < 0
            ? "🔴"
            : (isFiniteNum(precoAtual) &&
                isFiniteNum(s200) &&
                precoAtual < s200) ||
              Number(info.taxaCrescimento_1mes || 0) < 0
            ? "🟡"
            : isFiniteNum(precoAtual) &&
              isFiniteNum(s200) &&
              precoAtual > s200 &&
              Number(info.taxaCrescimento_1mes || 0) > 0
            ? "🟢"
            : "⚪️";

        const analysis = `
          <p class="muted" style="margin-top:.4rem">
            ${stopLight} Yield: <strong>${yPct}</strong> (${yBadge || "—"}) •
            Yield 24m: <strong>${y24Pct}</strong> •
            P/E: <strong>${
              isFiniteNum(pe) ? Number(pe).toFixed(2) : "—"
            } (${peBadge})</strong> •
            Δ50d: <strong>${d50Txt}</strong> •
            Δ200d: <strong>${d200Txt}</strong>
          </p>
          <p class="muted">
            ${String(info.periodicidade || "n/A")} • paga em <strong>${String(
          info.mes || "n/A"
        )}</strong> •
            Div. unit.: <strong>${
              isFiniteNum(dividendoUnit) ? fmtEUR.format(dividendoUnit) : "—"
            }</strong> •
            Div. anual est.: <strong>${
              isFiniteNum(divAnualEst) ? fmtEUR.format(divAnualEst) : "—"
            }</strong>
          </p>`;

        const actions =
          g.qtd > 0
            ? `<div class="actions-row" style="margin-top:.5rem; display:flex; gap:.5rem; flex-wrap:wrap">
               <button class="btn outline" data-buy="${
                 g.ticker
               }">Comprar</button>
               <button class="btn ghost"  data-sell="${
                 g.ticker
               }">Vender</button>
               <button class="btn" data-edit="${
                 g.lastDocId || ""
               }" data-edit-ticker="${g.ticker}">Editar</button>
             </div>`
            : `<div class="actions-row" style="margin-top:.5rem; display:flex; gap:.5rem; flex-wrap:wrap">
               <button class="btn outline" data-buy="${
                 g.ticker
               }">Reabrir (comprar)</button>
               <button class="btn" data-edit="${
                 g.lastDocId || ""
               }" data-edit-ticker="${g.ticker}">Editar</button>
             </div>`;

        return `
          <div class="activity-item${itemClass}">
            <div class="activity-left">
              <button class="collapse-btn" data-toggle-card title="Abrir/Fechar">▾</button>
              <span class="activity-icon">${g.qtd > 0 ? "📦" : "📭"}</span>
              <div>
                <p><strong>${g.nome}</strong> <span class="muted">(${
          g.ticker
        })</span></p>
                <p class="muted">${g.setor} • ${g.mercado} • ${posStatus}</p>
                <p class="muted">Última compra: ${
                  g.lastDate ? fmtDate.format(g.lastDate) : "sem data"
                }</p>

                <div class="activity-details">
                  <p class="muted">
                    Qtd: <strong>${formatNum(g.qtd)}</strong> ·
                    Preço médio: <strong>${fmtEUR.format(
                      precoMedio || 0
                    )}</strong> ·
                    Preço atual: <strong>${
                      precoAtual !== null ? fmtEUR.format(precoAtual) : "—"
                    }</strong>
                  </p>
                  <p class="muted">
                    Investido: <strong>${fmtEUR.format(
                      g.investido || 0
                    )}</strong> ·
                    Lucro atual: <strong>${fmtEUR.format(lucroAtual)}</strong>
                  </p>

                  ${
                    objetivo > 0
                      ? `
                    <div class="activity-meta">
                      <span>Objetivo (lucro): <strong>${fmtEUR.format(
                        objetivo
                      )}</strong></span>
                      <span>${pctText}</span>
                    </div>
                    ${barHTML}
                    <p class="muted">
                      TP2 necessário: <strong>${
                        tp2Necessario ? fmtEUR.format(tp2Necessario) : "—"
                      }</strong>
                      ${
                        taxa !== null
                          ? `· Estimativa: <strong>${estimativa}</strong>`
                          : ``
                      }
                    </p>
                  `
                      : `<p class="muted">Sem objetivo definido para este ticker.</p>`
                  }

                  ${analysis}
                  ${actions}
                </div>
              </div>
            </div>
          </div>`;
      });

    cont.innerHTML = html.join("");

    // 5) Quick actions
    wireQuickActions(gruposArr);

    // 6) Re-render ao mudar de tema
    if (window.__prtThemeHandler) window.removeEventListener("app:theme-changed", window.__prtThemeHandler);
    window.__prtThemeHandler = ()=>{
      if (!document.getElementById("chartSetores")) return;
      renderSetorDoughnut(setoresMap);
      renderMercadoDoughnut(mercadosMap);
      renderTop5Bar(gruposArr);
      renderTop5YieldBar(rowsForYield);
      renderTimeline(timelinePoints);
      renderDividendoCalendario12m(eurosMes);
    };
    window.addEventListener("app:theme-changed", window.__prtThemeHandler);

    // 7) Ajuda
    wirePortfolioHelpModal();
    setTimeout(()=>showPortfolioHelp(false), 0);

    // 8) Auto-clean
    const observer = new MutationObserver(()=>{
      if (!document.getElementById("chartSetores")){
        window.__chSetores?.destroy?.();
        window.__chMercados?.destroy?.();
        window.__chTop5?.destroy?.();
        window.__chTop5Yield?.destroy?.();
        window.__chTimeline?.destroy?.();
        window.__chDivCal?.destroy?.();
        if (window.__prtThemeHandler){
          window.removeEventListener("app:theme-changed", window.__prtThemeHandler);
          window.__prtThemeHandler = null;
        }
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList:true, subtree:true });

  }catch(e){
    console.error("Erro ao carregar atividades:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
    renderSetorDoughnut(new Map());
    renderMercadoDoughnut(new Map());
    renderTop5Bar([]);
    renderTop5YieldBar([]);
    renderTimeline([]);
    renderDividendoCalendario12m(new Array(12).fill(0));
  }
}
