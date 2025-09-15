// screens/analise.js
import { db } from "../firebase-config.js";
import { collection, getDocs, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ===============================
   Chart.js on-demand
   =============================== */
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
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
const chartColors = () => ({
  grid:  isDark() ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
  ticks: isDark() ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.7)",
  tooltipBg: isDark() ? "rgba(17,17,17,.95)" : "rgba(255,255,255,.95)",
  tooltipFg: isDark() ? "#fff" : "#111",
});
const PALETTE = ["#4F46E5","#22C55E","#EAB308","#EF4444","#06B6D4","#F59E0B","#A855F7","#10B981","#3B82F6","#F472B6","#84CC16","#14B8A6"];
const charts = { setor: null, mercado: null, topYield: null };

/* ===============================
   Helpers (formato)
   =============================== */
const mesesPT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const mesToIdx = new Map(mesesPT.map((m, i) => [m, i]));
const toNum = (v)=>{ const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtEUR = (n)=> Number(n || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

/* ===============================
   Regras de dividendos (iguais ao Dashboard)
   =============================== */
function anualizarDividendo(dividendoPorPagamento, periodicidade) {
  const d = toNum(dividendoPorPagamento);
  const p = String(periodicidade || "").toLowerCase();
  if (d <= 0) return 0;
  if (p === "mensal") return d * 12;
  if (p === "trimestral") return d * 4;
  if (p === "semestral") return d * 2;
  return d; // anual ou n/a
}
function pagamentosAno(periodicidade) {
  const p = String(periodicidade || "");
  if (p === "Mensal") return 12;
  if (p === "Trimestral") return 4;
  if (p === "Semestral") return 2;
  if (p === "Anual") return 1;
  return 0;
}
function perPayment(doc){
  // se existir "dividendo" por pagamento no doc, usa; senão derivado do anual
  const base = toNum(doc.dividendo);
  if (base > 0) return base;
  const anual = anualPreferido(doc);
  const pAno = pagamentosAno(doc.periodicidade);
  return pAno > 0 ? anual / pAno : 0;
}
function anualPreferido(doc){
  // preferir dividendoMedio24m (anual) se existir; senão anualizar "dividendo"
  const d24 = toNum(doc.dividendoMedio24m);
  if (d24 > 0) return d24;
  return anualizarDividendo(doc.dividendo, doc.periodicidade);
}

/* ===============================
   Crescimento (mesma estratégia do Dashboard)
   =============================== */
function campoCrescimentoPreferido(periodoSel) {
  if (periodoSel === "1s") return "taxaCrescimento_1semana";
  if (periodoSel === "1m") return "taxaCrescimento_1mes";
  return "taxaCrescimento_1ano";
}
function melhorTaxaCrescimento(docAcao, prefer) {
  const ordem = [prefer, "taxaCrescimento_1mes", "taxaCrescimento_1semana", "taxaCrescimento_1ano"];
  for (const k of ordem) {
    const v = Number(docAcao?.[k] ?? 0);
    if (v !== 0) return v; // usa a primeira disponível ≠ 0
  }
  return 0;
}
const clamp = (v,min,max)=>Math.max(min, Math.min(max, v));

/* ===============================
   Cálculo por ação (portado do Dashboard)
   =============================== */
function calcularMetricasAcao(acao, { periodo="1m", horizonte=1, incluirDiv=true } = {}) {
  const precoAtual = toNum(acao.valorStock);
  const anualDiv   = anualPreferido(acao); // anual por ação
  const prefer = campoCrescimentoPreferido(periodo);
  const taxaPct = melhorTaxaCrescimento(acao, prefer); // %
  const r = clamp(taxaPct/100, -0.95, 5);
  const h = Math.max(1, Number(horizonte||1));

  const mult = Math.pow(1+r, h);
  const valorizacaoPorAcao = precoAtual * (mult - 1);

  const dividendosNoHorizontePorAcao = incluirDiv ? anualDiv * h : 0;

  const lucroUnidade = dividendosNoHorizontePorAcao + valorizacaoPorAcao;
  const retornoPorEuro = precoAtual > 0 ? (lucroUnidade / precoAtual) : 0;

  return {
    preco: precoAtual,
    dividendoAnual: anualDiv,
    taxaPct,
    totalDividendos: dividendosNoHorizontePorAcao,
    valorizacao: valorizacaoPorAcao,
    lucroUnidade,
    retornoPorEuro
  };
}

/* ===============================
   Distribuição (igual ao Dashboard: proporção por retorno/€)
   =============================== */
function distribuirFracoes(acoes, investimento){
  const soma = acoes.reduce((s,a)=>s + a.metrics.retornoPorEuro, 0);
  if (soma <= 0) {
    return { linhas: [], totalLucro: 0, totalGasto: 0, totalDivAnual: 0, totalDivPeriodo: 0, totalValoriz: 0, restante: investimento };
  }
  const linhas = acoes.map(a=>{
    const propor    = a.metrics.retornoPorEuro / soma;
    const investido = investimento * propor;
    const qtd       = a.metrics.preco > 0 ? (investido / a.metrics.preco) : 0;

    const lucro           = qtd * a.metrics.lucroUnidade;
    const divAnualAlloc   = qtd * a.metrics.dividendoAnual;   // anual (por ano)
    const divPeriodoAlloc = qtd * a.metrics.totalDividendos;  // no horizonte
    const valorizAlloc    = qtd * a.metrics.valorizacao;      // no horizonte

    return {
      nome: a.nome, ticker: a.ticker,
      preco: a.metrics.preco,
      quantidade: qtd,
      investido,
      lucro,
      taxaPct: a.metrics.taxaPct,
      dividendoAnual: a.metrics.dividendoAnual,
      divAnualAlloc, divPeriodoAlloc, valorizAlloc
    };
  });

  const totalLucro      = linhas.reduce((s,l)=>s + l.lucro, 0);
  const totalGasto      = linhas.reduce((s,l)=>s + l.investido, 0);
  const totalDivAnual   = linhas.reduce((s,l)=>s + l.divAnualAlloc, 0);
  const totalDivPeriodo = linhas.reduce((s,l)=>s + l.divPeriodoAlloc, 0);
  const totalValoriz    = linhas.reduce((s,l)=>s + l.valorizAlloc, 0);

  return { linhas, totalLucro, totalGasto, totalDivAnual, totalDivPeriodo, totalValoriz, restante: Math.max(0, investimento - totalGasto) };
}

/* ===============================
   Yield (apenas para gráficos/tabela)
   =============================== */
function computeYieldPct(annualDividend, valorStock){
  if (!Number.isFinite(annualDividend) || !Number.isFinite(valorStock) || valorStock<=0) return 0;
  return (annualDividend / valorStock) * 100;
}

/* ===============================
   Seleção + Ordenação + Tabela/Heatmap (inalterado)
   =============================== */
const selectedTickers = new Set();
const updateSelCount = ()=>{ const el = document.getElementById("anlSelCount"); if (el) el.textContent = String(selectedTickers.size); };

let sortKey = null, sortDir = "desc";
const SORT_ACCESSORS = {
  ticker: r => r.ticker,
  nome: r => r.nome || "",
  setor: r => r.setor || "",
  mercado: r => r.mercado || "",
  yield: r => Number.isFinite(r.yield) ? r.yield : -Infinity,
  yield24: r => Number.isFinite(r.yield24) ? r.yield24 : -Infinity,
  divPer: r => Number.isFinite(r.divPer) ? r.divPer : -Infinity,
  divAnual: r => Number.isFinite(r.divAnual) ? r.divAnual : -Infinity,
  pe: r => Number.isFinite(r.pe) ? r.pe : Infinity,
  delta50: r => Number.isFinite(r.delta50) ? r.delta50 : -Infinity,
  delta200: r => Number.isFinite(r.delta200) ? r.delta200 : -Infinity,
  g1w: r => Number.isFinite(r.g1w) ? r.g1w : -Infinity,
  g1m: r => Number.isFinite(r.g1m) ? r.g1m : -Infinity,
  g1y: r => Number.isFinite(r.g1y) ? r.g1y : -Infinity,
  periodicidade: r => r.periodicidade || "",
  mes: r => r.mes || "",
  observacao: r => r.observacao || "",
};
function sortRows(rows){
  if (!sortKey) return rows;
  const acc = SORT_ACCESSORS[sortKey] || (r=>r[sortKey]);
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a,b)=>{
    const va = acc(a), vb = acc(b);
    if (va < vb) return -1*dir;
    if (va > vb) return  1*dir;
    return 0;
  });
}
function markSortedHeader(){
  document.querySelectorAll('#anlTable thead th.sortable').forEach(th=>{
    th.classList.remove('sorted-asc','sorted-desc');
  });
  if (sortKey){
    const th = document.querySelector(`#anlTable thead th[data-sort="${sortKey}"]`);
    if (th) th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  }
}

/* ===============================
   Gráficos / Heatmap / Tabela (mesmo que já tinhas)
   =============================== */
function renderDonut(elId, dataMap) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const labels = Array.from(dataMap.keys());
  const data = Array.from(dataMap.values());
  return new Chart(el, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1 }]},
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: chartColors().ticks } },
        tooltip: { backgroundColor: chartColors().tooltipBg, titleColor: chartColors().tooltipFg, bodyColor: chartColors().tooltipFg,
          callbacks: { label: (ctx) => {
            const total = data.reduce((a, b) => a + b, 0) || 1;
            const v = Number(ctx.parsed);
            const pct = ((v / total) * 100).toFixed(1);
            return ` ${ctx.label}: ${pct}%`;
          } }
        }
      }
    }
  });
}
function renderTopYield(elId, rows) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const top = [...rows].filter(r => Number.isFinite(r.yield) && r.yield > 0).sort((a,b)=>b.yield-a.yield).slice(0,5);
  return new Chart(el, {
    type: "bar",
    data: { labels: top.map(r=>r.ticker), datasets: [{ label:"Yield (%)", data: top.map(r=>r.yield), backgroundColor:"#22C55E" }]},
    options: {
      indexAxis:"y", responsive:true, maintainAspectRatio:false,
      scales: {
        x: { ticks:{ color: chartColors().ticks }, grid:{ color: chartColors().grid } },
        y: { ticks:{ color: chartColors().ticks }, grid:{ color: chartColors().grid } },
      },
      plugins: { legend:{ labels:{ color: chartColors().ticks } },
        tooltip:{ backgroundColor: chartColors().tooltipBg, titleColor: chartColors().tooltipFg, bodyColor: chartColors().tooltipFg,
          callbacks:{ label:(ctx)=>` ${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}%` }
        }
      }
    }
  });
}
function renderCharts(rows) {
  const groupBy = (key) => {
    const map = new Map();
    rows.forEach(r => {
      const k = r[key] || "—";
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  };
  charts.setor?.destroy(); charts.mercado?.destroy(); charts.topYield?.destroy();
  charts.setor = renderDonut("anlChartSetor", groupBy("setor"));
  charts.mercado = renderDonut("anlChartMercado", groupBy("mercado"));
  charts.topYield = renderTopYield("anlChartTopYield", rows);
}
function mesesPagamento(periodicidade, mesTipicoIdx) {
  if (!Number.isFinite(mesTipicoIdx)) return [];
  if (periodicidade === "Mensal")     return Array.from({ length: 12 }, (_, i) => i);
  if (periodicidade === "Trimestral") return [0,3,6,9].map(k => (mesTipicoIdx + k) % 12);
  if (periodicidade === "Semestral")  return [0,6].map(k => (mesTipicoIdx + k) % 12);
  if (periodicidade === "Anual")      return [mesTipicoIdx];
  return [];
}
function renderHeatmap(rows) {
  const body = document.getElementById("anlHeatmapBody");
  if (!body) return;
  const values = rows.map(r => perPayment(r)).filter(v => v > 0).sort((a,b)=>a-b);
  const q1 = values.length ? values[Math.floor(values.length * 0.33)] : 0.01;
  const q2 = values.length ? values[Math.floor(values.length * 0.66)] : 0.02;

  body.innerHTML = rows.map(r => {
    const per = String(r.periodicidade || "n/A");
    const idxMes = mesToIdx.get(String(r.mes || ""));
    const meses = mesesPagamento(per, idxMes);
    const perPay = perPayment(r);
    const klass = (perPay>0) ? (perPay<=q1 ? "pay-weak" : perPay<=q2 ? "pay-med" : "pay-strong") : "";
    const cells = Array.from({ length: 12 }, (_, m) => {
      if (!meses.includes(m)) return `<div class="cell"></div>`;
      const tt = `${r.ticker} • ${mesesPT[m]} • ~${fmtEUR(perPay)}`;
      return `<div class="cell tt ${klass}" data-tt="${tt}">${perPay ? fmtEUR(perPay) : ""}</div>`;
    }).join("");
    const nome = r.nome ? ` <span class="muted">— ${r.nome}</span>` : "";
    return `
      <div class="row">
        <div class="cell sticky-col"><strong>${r.ticker}</strong>${nome}</div>
        <div class="months">${cells}</div>
      </div>
    `;
  }).join("");
}
function renderTable(rows) {
  const tb = document.getElementById("anlTableBody");
  if (!tb) return;

  const badgePE = (pe) => {
    if (!Number.isFinite(pe) || pe <= 0) return `<span class="badge muted">—</span>`;
    if (pe < 15)  return `<span class="badge ok">${pe.toFixed(2)} Barato</span>`;
    if (pe <= 25) return `<span class="badge warn">${pe.toFixed(2)} Justo</span>`;
    return `<span class="badge danger">${pe.toFixed(2)} Caro</span>`;
  };
  const badgeYield = (y, y24) => {
    if (!Number.isFinite(y)) return `<span class="badge muted">—</span>`;
    let base = "muted";
    if (y >= 6) base = "warn";
    else if (y >= 2) base = "ok";
    const curr = `<span class="badge ${base}">${y.toFixed(2)}%</span>`;
    if (Number.isFinite(y24)) {
      const comp = (y - y24) >= 0 ? `<span class="badge up">↑ acima da média</span>` : `<span class="badge down">↓ abaixo da média</span>`;
      return `${curr} ${comp}`;
    }
    return curr;
  };
  const pct = (v) => {
    if (!Number.isFinite(v)) return `—`;
    const cls = v >= 0 ? "up" : "down";
    const sign = v >= 0 ? "+" : "";
    return `<span class="${cls}">${sign}${v.toFixed(2)}%</span>`;
  };

  tb.innerHTML = rows.map(r=>{
    const checked = selectedTickers.has(r.ticker) ? "checked" : "";
    const y  = Number.isFinite(r.yield) ? r.yield : null;
    const y24 = Number.isFinite(r.yield24) ? r.yield24 : null;
    const divPerTxt = r.divPer > 0 ? fmtEUR(r.divPer) : "—";
    const divAnualTxt = r.divAnual > 0 ? fmtEUR(r.divAnual) : "—";
    return `
      <tr>
        <td class="sticky-col">
          <input type="checkbox" class="anlRowSel" data-ticker="${r.ticker}" ${checked} />
        </td>
        <td class="sticky-col"><strong>${r.ticker}</strong></td>
        <td>${r.nome || "—"}</td>
        <td>${r.setor || "—"}</td>
        <td>${r.mercado || "—"}</td>
        <td>${badgeYield(y, y24)}</td>
        <td>${Number.isFinite(r.yield24) ? `${r.yield24.toFixed(2)}%` : "—"}</td>
        <td>${divPerTxt}</td>
        <td>${divAnualTxt}</td>
        <td>${badgePE(r.pe)}</td>
        <td>${pct(r.delta50)}</td>
        <td>${pct(r.delta200)}</td>
        <td>${pct(r.g1w)}</td>
        <td>${pct(r.g1m)}</td>
        <td>${pct(r.g1y)}</td>
        <td>${r.periodicidade || "—"}</td>
        <td>${r.mes || "—"}</td>
        <td>${r.observacao || "—"}</td>
      </tr>
    `;
  }).join("");

  // liga checkboxes
  tb.querySelectorAll(".anlRowSel").forEach(ch => {
    ch.addEventListener("change", (e)=>{
      const t = e.target.getAttribute("data-ticker");
      if (!t) return;
      if (e.target.checked) selectedTickers.add(t);
      else selectedTickers.delete(t);
      updateSelCount();
    });
  });
}

/* ===============================
   Dados (Firestore)
   =============================== */
let ALL_ROWS = [];
async function fetchAcoes() {
  const snap = await getDocs(query(collection(db, "acoesDividendos")));
  const rows = [];
  snap.forEach(doc => {
    const d = doc.data();
    const ticker = String(d.ticker || "").toUpperCase();
    if (!ticker) return;

    const valor = toNum(d.valorStock);
    const anual = anualPreferido(d);
    const y = computeYieldPct(anual, valor);

    rows.push({
      ticker,
      nome: d.nome || "",
      setor: d.setor || "",
      mercado: d.mercado || "",
      valorStock: valor,
      dividendo: toNum(d.dividendo),                // por pagamento
      dividendoMedio24m: toNum(d.dividendoMedio24m),// anual (média 24m)
      periodicidade: d.periodicidade || "",
      mes: d.mes || "",
      observacao: d.observacao || "",

      // derivados
      divPer: perPayment(d),
      divAnual: anual,           // anual por ação
      yield: Number.isFinite(y) ? y : null,

      // extra (se existir)
      yield24: Number.isFinite(d.yield24) ? Number(d.yield24) : null,
      pe: Number.isFinite(d.pe) ? Number(d.pe) : null,
      delta50: Number.isFinite(d.delta50) ? Number(d.delta50) : null,
      delta200: Number.isFinite(d.delta200) ? Number(d.delta200) : null,
      g1w: Number.isFinite(d.taxaCrescimento_1semana) ? Number(d.taxaCrescimento_1semana) : null,
      g1m: Number.isFinite(d.taxaCrescimento_1mes) ? Number(d.taxaCrescimento_1mes) : null,
      g1y: Number.isFinite(d.taxaCrescimento_1ano) ? Number(d.taxaCrescimento_1ano) : null,
    });
  });
  ALL_ROWS = rows;
}

/* ===============================
   Filtros
   =============================== */
const keyStr = (s)=> String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
function applyFilters() {
  const term = keyStr(document.getElementById("anlSearch")?.value || "");
  const setor = document.getElementById("anlSetor")?.value || "";
  const mercado = document.getElementById("anlMercado")?.value || "";
  const periodo = document.getElementById("anlPeriodo")?.value || "";

  let rows = [...ALL_ROWS];
  if (term) rows = rows.filter(r => keyStr(r.ticker).includes(term) || keyStr(r.nome).includes(term));
  if (setor) rows = rows.filter(r => r.setor === setor);
  if (mercado) rows = rows.filter(r => r.mercado === mercado);
  if (periodo) rows = rows.filter(r => (r.periodicidade || "") === periodo);

  rows = sortRows(rows);
  renderCharts(rows);
  renderHeatmap(rows);
  renderTable(rows);

  const selAll = document.getElementById("anlSelectAll");
  if (selAll) selAll.checked = rows.length > 0 && rows.every(r => selectedTickers.has(r.ticker));
}
function populateFilters() {
  const setorSel = document.getElementById("anlSetor");
  const mercadoSel = document.getElementById("anlMercado");
  const setSet = new Set(), merSet = new Set();
  ALL_ROWS.forEach(r => { if (r.setor) setSet.add(r.setor); if (r.mercado) merSet.add(r.mercado); });
  const addOpts = (sel, values) => {
    const cur = sel.value;
    sel.innerHTML = `<option value="">Todos</option>` + [...values].sort().map(v => `<option>${v}</option>`).join("");
    sel.value = cur || "";
  };
  if (setorSel) addOpts(setorSel, setSet);
  if (mercadoSel) addOpts(mercadoSel, merSet);
}

/* ===============================
   UI: Simulador (modal)
   =============================== */
function openSimModal(){ document.getElementById("anlSimModal")?.classList.remove("hidden"); }
function closeSimModal(){ document.getElementById("anlSimModal")?.classList.add("hidden"); }

function renderResultadoSimulacao(res){
  const cont = document.getElementById("anlSimResultado");
  if (!cont) return;

  if (!res || !res.linhas || res.linhas.length === 0){
    cont.innerHTML = `<p class="muted">Sem resultados. Verifica o investimento e a seleção.</p>`;
    return;
  }

  // Lê controlos do modal para mostrar contexto
  const horizonte  = Number(document.getElementById("anlSimHoriz")?.value || 1);
  const periodoSel = document.getElementById("anlSimPeriodo")?.value || "1m";
  const incluirDiv = !!document.getElementById("anlSimIncluiDiv")?.checked;

  const periodoLabel = periodoSel === "1s" ? "1 semana"
                      : periodoSel === "1m" ? "1 mês" : "1 ano";

  // Recalcula o retorno% só a partir dos totais (mais robusto)
  const totalGasto = res.totalGasto || 0;
  const retornoPct = totalGasto > 0 ? ((res.totalDivPeriodo + res.totalValoriz) / totalGasto) * 100 : 0;

  const rows = res.linhas.map(l => {
    const lucroLinha = l.divPeriodoAlloc + l.valorizAlloc; // soma explícita na UI
    const noGrowth = Math.abs(l.valorizAlloc) < 1e-8;      // badge se não há valorização

    return `
      <tr>
        <td><strong>${l.ticker}</strong></td>
        <td>${l.nome || "—"}</td>
        <td>${fmtEUR(l.preco)}</td>
        <td>${l.quantidade.toFixed(4)}</td>
        <td>${fmtEUR(l.investido)}</td>
        <td>
          ${fmtEUR(lucroLinha)}
          ${noGrowth ? ` <span class="badge muted" title="Sem valorização (taxa=0)">r=0%</span>` : ""}
        </td>
        <td>${fmtEUR(l.divAnualAlloc)}</td>
        <td>${fmtEUR(l.divPeriodoAlloc)}</td>
        <td>${fmtEUR(l.valorizAlloc)}</td>
      </tr>
    `;
  }).join("");

  cont.innerHTML = `
    <div class="card" style="margin-bottom:10px;">
      <div class="card-content" style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
        <div><strong>Horizonte:</strong> ${horizonte} ${horizonte===1?"ano":"anos"}</div>
        <div><strong>Período de crescimento:</strong> ${periodoLabel}</div>
        <div><strong>Dividendos:</strong> ${incluirDiv ? "incluídos" : "excluídos"}</div>
      </div>
    </div>

    <div class="tabela-scroll-wrapper">
      <table class="fine-table" style="width:100%">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Nome</th>
            <th>Preço</th>
            <th>Qtd.</th>
            <th>Investido</th>
            <th>Lucro estimado (= Div. no horizonte + Valorização)</th>
            <th>Dividendo anual (aloc.)</th>
            <th>Dividendos no horizonte (h=${horizonte})</th>
            <th>Valorização no horizonte</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th colspan="4" style="text-align:right;">Totais</th>
            <th>${fmtEUR(res.totalGasto)}</th>
            <th>${fmtEUR(res.totalDivPeriodo + res.totalValoriz)}</th>
            <th>${fmtEUR(res.totalDivAnual)}</th>
            <th>${fmtEUR(res.totalDivPeriodo)}</th>
            <th>${fmtEUR(res.totalValoriz)}</th>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="card" style="margin-top:10px;">
      <div class="card-content" style="display:flex; gap:16px; flex-wrap:wrap;">
        <div><strong>Retorno total (€):</strong> ${fmtEUR(res.totalDivPeriodo + res.totalValoriz)}</div>
        <div><strong>Retorno total (%):</strong> ${retornoPct.toFixed(2)}%</div>
        <div><strong>Dividendos anuais (soma aloc.):</strong> ${fmtEUR(res.totalDivAnual)}</div>
        <div><strong>Dividendos no horizonte:</strong> ${fmtEUR(res.totalDivPeriodo)}</div>
        <div><strong>Valorização no horizonte:</strong> ${fmtEUR(res.totalValoriz)}</div>
      </div>
    </div>
  `;
}


/* ===============================
   INIT (exposto ao router)
   =============================== */
export async function initScreen() {
  await ensureChartJS();
  await fetchAcoes();
  populateFilters();

  // Ordenação por cabeçalho
  document.querySelectorAll('#anlTable thead th.sortable').forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.getAttribute("data-sort");
      if (!key) return;
      if (sortKey === key) sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
      else { sortKey = key; sortDir = (key === "pe") ? "asc" : "desc"; }
      markSortedHeader();
      applyFilters();
    });
  });

  // Filtros
  document.getElementById("anlSearch")?.addEventListener("input", applyFilters);
  document.getElementById("anlSetor")?.addEventListener("change", applyFilters);
  document.getElementById("anlMercado")?.addEventListener("change", applyFilters);
  document.getElementById("anlPeriodo")?.addEventListener("change", applyFilters);
  document.getElementById("anlReset")?.addEventListener("click", ()=>{
    document.getElementById("anlSearch").value = "";
    document.getElementById("anlSetor").value = "";
    document.getElementById("anlMercado").value = "";
    document.getElementById("anlPeriodo").value = "";
    applyFilters();
  });

  // Seleção
  document.getElementById("anlSelectAll")?.addEventListener("change", (e)=>{
    const check = e.target.checked;
    // aplica sobre a lista filtrada atual
    const term = keyStr(document.getElementById("anlSearch")?.value || "");
    const setor = document.getElementById("anlSetor")?.value || "";
    const mercado = document.getElementById("anlMercado")?.value || "";
    const periodo = document.getElementById("anlPeriodo")?.value || "";
    let rows = [...ALL_ROWS];
    if (term) rows = rows.filter(r => keyStr(r.ticker).includes(term) || keyStr(r.nome).includes(term));
    if (setor) rows = rows.filter(r => r.setor === setor);
    if (mercado) rows = rows.filter(r => r.mercado === mercado);
    if (periodo) rows = rows.filter(r => (r.periodicidade || "") === periodo);

    rows.forEach(r => { if (check) selectedTickers.add(r.ticker); else selectedTickers.delete(r.ticker); });
    updateSelCount();
    renderTable(sortRows(rows));
  });

  document.getElementById("anlClearSel")?.addEventListener("click", ()=>{
    selectedTickers.clear();
    updateSelCount();
    applyFilters();
  });

  // Abrir modal (copiado do Dashboard)
  document.getElementById("anlSimular")?.addEventListener("click", ()=>{
    if (selectedTickers.size === 0) {
      alert("Seleciona pelo menos uma ação para simular.");
      return;
    }
    openSimModal();
  });

  // Fechar modal
  document.getElementById("anlSimClose")?.addEventListener("click", closeSimModal);
  document.getElementById("anlSimModal")?.addEventListener("click", (e)=>{ if (e.target.id === "anlSimModal") closeSimModal(); });

  // Calcular simulação (algoritmo do Dashboard)
  document.getElementById("anlSimCalcular")?.addEventListener("click", ()=>{
    const investimento = Number(document.getElementById("anlSimInvest")?.value || 0);
    const horizonte    = Number(document.getElementById("anlSimHoriz")?.value || 1);
    const periodo      = document.getElementById("anlSimPeriodo")?.value || "1m";
    const incluirDiv   = !!document.getElementById("anlSimIncluiDiv")?.checked;

    if (!(investimento>0)){ alert("Indica um investimento total válido."); return; }

    const selecionadas = ALL_ROWS.filter(r => selectedTickers.has(r.ticker));
    const acoes = selecionadas.map(a=>{
      const metrics = calcularMetricasAcao(a, { periodo, horizonte, incluirDiv });
      return metrics ? { ...a, metrics } : null;
    }).filter(Boolean);

    if (acoes.length === 0){ alert("Sem métricas suficientes nas ações selecionadas."); return; }

    const res = distribuirFracoes(acoes, investimento);
    renderResultadoSimulacao(res);
  });

  // Exportar para simulador
  document.getElementById("anlSimExportar")?.addEventListener("click", ()=>{
    const selecionadas = ALL_ROWS.filter(r => selectedTickers.has(r.ticker))
      .map(r => ({
        ticker: r.ticker, nome: r.nome, preco: r.valorStock,
        divPer: r.divPer, divAnual: r.divAnual, periodicidade: r.periodicidade, mes: r.mes, yield: r.yield
      }));
    localStorage.setItem("simulacaoSelecionados", JSON.stringify(selecionadas));
    alert(`Exportado ${selecionadas.length} tickers. Podes abrir o ecrã do simulador.`);
    closeSimModal();
  });

  // Render inicial
  markSortedHeader();
  applyFilters();
}

/* Auto-init (se o router não chamar explicitamente) */
if (!window.__ANL_AUTO_INIT__) {
  window.__ANL_AUTO_INIT__ = true;
  initScreen().catch(console.error);
}