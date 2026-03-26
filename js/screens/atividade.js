// ===== Hard error guard =====
window.addEventListener("error", (e) =>
  console.error("ATIVIDADE HARD ERROR:", e.error || e.message),
);

// ===== Firebase =====
import { db } from "../firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  getDocs,
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
  "#4F46E5",
  "#22C55E",
  "#EAB308",
  "#EF4444",
  "#06B6D4",
  "#F59E0B",
  "#A855F7",
  "#10B981",
  "#3B82F6",
  "#F472B6",
  "#84CC16",
  "#14B8A6",
];

// ===============================
// Helpers
// ===============================
function toNumStrict(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function isFiniteNum(v) {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n);
}
function formatNum(n) {
  return Number(n || 0).toLocaleString("pt-PT");
}

// Dividend data helpers
async function fetchDividendInfoByTickers(tickers) {
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < tickers.length; i += 10)
    chunks.push(tickers.slice(i, i + 10));
  for (const chunk of chunks) {
    const q2 = query(
      collection(db, "acoesDividendos"),
      where("ticker", "in", chunk),
    );
    const snap = await getDocs(q2);
    snap.forEach((d) => {
      const x = d.data();
      if (x.ticker) out.set(String(x.ticker).toUpperCase(), x);
    });
  }
  return out;
}
function pickBestRate(info) {
  if (typeof info?.taxaCrescimento_1mes === "number")
    return { taxa: info.taxaCrescimento_1mes, periodLabel: "mês" };
  if (typeof info?.taxaCrescimento_1semana === "number")
    return { taxa: info.taxaCrescimento_1semana, periodLabel: "semana" };
  if (typeof info?.taxaCrescimento_1ano === "number")
    return { taxa: info.taxaCrescimento_1ano, periodLabel: "ano" };
  return { taxa: null, periodLabel: null };
}
function estimateTime(currentPrice, targetPrice, growthPct, label) {
  const r = Number(growthPct || 0) / 100;
  if (
    r <= 0 ||
    !isFiniteNum(currentPrice) ||
    !isFiniteNum(targetPrice) ||
    currentPrice <= 0 ||
    targetPrice <= 0
  )
    return "—";
  const n = Math.log(targetPrice / currentPrice) / Math.log(1 + r);
  if (!isFinite(n) || n < 0) return "—";
  if (label === "semana") return `${n.toFixed(1)} semanas`;
  if (label === "mês") return `${n.toFixed(1)} meses`;
  return `${n.toFixed(1)} anos`;
}
const MES_IDX = {
  janeiro: 0,
  fevereiro: 1,
  março: 2,
  marco: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};
function pagamentosAno(p) {
  p = String(p || "").toLowerCase();
  if (p.startsWith("mensal")) return 12;
  if (p.startsWith("trimes")) return 4;
  if (p.startsWith("semes")) return 2;
  if (p.startsWith("anual")) return 1;
  return 0;
}
function mesesPagos(period, mesTipico) {
  const p = String(period || "").toLowerCase();
  const baseIdx =
    MES_IDX[
      String(mesTipico || "")
        .trim()
        .toLowerCase()
    ];
  if (p.startsWith("mensal")) return Array.from({ length: 12 }, (_, i) => i);
  if (p.startsWith("trimes")) {
    const s = Number.isFinite(baseIdx) ? baseIdx : 0;
    return [s, (s + 3) % 12, (s + 6) % 12, (s + 9) % 12];
  }
  if (p.startsWith("semes")) {
    const s = Number.isFinite(baseIdx) ? baseIdx : 0;
    return [s, (s + 6) % 12];
  }
  if (p.startsWith("anual")) return Number.isFinite(baseIdx) ? [baseIdx] : [];
  return [];
}

// ===============================
// Renders — gráficos (uso de Chart.js)
// ===============================
function renderSetorDoughnut(map) {
  const el = document.getElementById("chartSetores");
  if (!el) return;
  if (window.__chSetores) window.__chSetores.destroy();
  const labels = [...map.keys()],
    data = [...map.values()];
  if (!labels.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  window.__chSetores = new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: chartColors().ticks } },
        tooltip: {
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
        },
      },
    },
  });
}
function renderMercadoDoughnut(map) {
  const el = document.getElementById("chartMercados");
  if (!el) return;
  if (window.__chMercados) window.__chMercados.destroy();
  const labels = [...map.keys()],
    data = [...map.values()];
  if (!labels.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  window.__chMercados = new Chart(el, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map(
            (_, i) => PALETTE[(i + 5) % PALETTE.length],
          ),
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: chartColors().ticks } },
        tooltip: {
          backgroundColor: chartColors().tooltipBg,
          titleColor: chartColors().tooltipFg,
          bodyColor: chartColors().tooltipFg,
        },
      },
    },
  });
}
function renderTop5Bar(arr) {
  const el = document.getElementById("chartTop5");
  if (!el) return;
  if (window.__chTop5) window.__chTop5.destroy();
  const ativos = arr
    .filter((g) => g.qtd > 0)
    .sort((a, b) => (b.investido || 0) - (a.investido || 0))
    .slice(0, 5);
  if (!ativos.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  const labels = ativos.map((a) => a.ticker),
    invest = ativos.map((a) => a.investido || 0),
    lucro = ativos.map((a) => a.lucroAtual || 0);
  window.__chTop5 = new Chart(el, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Investido (€)", data: invest, backgroundColor: "#3B82F6" },
        { label: "Lucro Atual (€)", data: lucro, backgroundColor: "#22C55E" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
        y: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
      },
      plugins: { legend: { labels: { color: chartColors().ticks } } },
    },
  });
}
function renderTop5YieldBar(rows) {
  const el = document.getElementById("chartTop5Yield");
  if (!el) return;
  if (window.__chTop5Yield) window.__chTop5Yield.destroy();
  const ativos = rows
    .filter((r) => r.active && isFiniteNum(r.yieldCur))
    .sort((a, b) => b.yieldCur - a.yieldCur)
    .slice(0, 5);
  if (!ativos.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  const labels = ativos.map((a) => a.ticker),
    ys = ativos.map((a) => Number(a.yieldCur * 100).toFixed(2));
  window.__chTop5Yield = new Chart(el, {
    type: "bar",
    data: { labels, datasets: [{ label: "Yield (%)", data: ys }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
        y: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
      },
      plugins: { legend: { labels: { color: chartColors().ticks } } },
    },
  });
}
function renderTimeline(points) {
  const el = document.getElementById("chartTimeline");
  if (!el) return;
  if (window.__chTimeline) window.__chTimeline.destroy();
  if (!points.length) {
    el.getContext("2d").clearRect(0, 0, el.width, el.height);
    return;
  }
  const labels = points.map((p) => p.label),
    invested = points.map((p) => p.cumInvest),
    valueNow = points.map((p) => p.valueNow);
  window.__chTimeline = new Chart(el, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Investido acumulado (€)",
          data: invested,
          tension: 0.25,
          borderWidth: 2,
        },
        {
          label: "Avaliação atual (€)",
          data: valueNow,
          tension: 0.25,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      elements: { point: { radius: 0 } },
      scales: {
        x: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
        y: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
      },
      plugins: { legend: { labels: { color: chartColors().ticks } } },
    },
  });
}
function renderDividendoCalendario12m(arr) {
  const el = document.getElementById("chartDivCalendario");
  if (!el) return;
  if (window.__chDivCal) window.__chDivCal.destroy();
  const labels = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ];
  window.__chDivCal = new Chart(el, {
    type: "bar",
    data: { labels, datasets: [{ label: "€ / mês (estimado)", data: arr }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
        y: {
          ticks: { color: chartColors().ticks },
          grid: { color: chartColors().grid },
        },
      },
      plugins: { legend: { labels: { color: chartColors().ticks } } },
    },
  });
}

// ===============================
// Quick Actions (comprar/vender/editar + collapse)
// ===============================
function wireQuickActions(gruposArr) {
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
        // Obter o documento original antes de editar
        const docRef = doc(db, "ativos", docId);
        const snap = await getDoc(docRef);
        const originalData = snap.exists() ? snap.data() : {};
        const oldTicker = (originalData.ticker || "").toUpperCase();

        // 1. Atualizar o registo atual
        await updateDoc(docRef, {
          nome,
          ticker,
          setor,
          mercado: merc,
          quantidade: Number.isFinite(qtd) ? qtd : 0,
          precoCompra: Number.isFinite(preco) ? preco : 0,
          objetivoFinanceiro: Number.isFinite(obj) ? obj : 0,
        });

        // 2. (NOVO) Se o objetivo mudou, propagar para TODOS os registos deste ticker
        if (Number.isFinite(obj) && obj !== originalData.objetivoFinanceiro) {
          const q = query(collection(db, "ativos"), where("ticker", "==", ticker));
          const snapAll = await getDocs(q);
          const updates = snapAll.docs.map(d => updateDoc(d.ref, { objetivoFinanceiro: obj }));
          await Promise.all(updates);
          console.log(`[atividade] Objetivo atualizado para ${snapAll.size} registos de ${ticker}`);
        }
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
      // Removido location.reload() - a atualização é agora em tempo real via onSnapshot
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
function wirePortfolioHelpModal() {
  const modal = document.getElementById("prtHelpModal");
  if (!modal || modal.__wired) return;
  modal.__wired = true;

  const closeBtn = document.getElementById("prtHelpClose");
  const okBtn = document.getElementById("prtHelpOK");
  const laterBtn = document.getElementById("prtHelpLater");
  const dontShow = document.getElementById("prtHelpDontShow");
  const helpIcon = document.getElementById("btnPrtHelp");

  const close = (persist) => {
    if (persist && dontShow?.checked) {
      try {
        localStorage.setItem(HELP_KEY, "1");
      } catch {}
    }
    modal.classList.add("hidden");
  };

  closeBtn?.addEventListener("click", () => close(false));
  laterBtn?.addEventListener("click", () => close(false));
  okBtn?.addEventListener("click", () => close(true));
  helpIcon?.addEventListener("click", () => showPortfolioHelp(true));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) close(false);
  });
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("hidden") && e.key === "Escape") close(false);
  });
}

function showPortfolioHelp(force = false) {
  const modal = document.getElementById("prtHelpModal");
  if (!modal) return;
  if (!force) {
    try {
      if (localStorage.getItem(HELP_KEY) === "1") return;
    } catch {}
  }
  modal.classList.remove("hidden");
}

// ===============================
// INIT (screen)
// ===============================
let _lastAtivosSnap = null;
let _lastAcoesSnap = null;
let fltState = { estado: "", mercado: "", setor: "", sort: "queda" };

export async function initScreen() {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  cont.innerHTML = "A carregar…";

  // Registrar ajuda
  wirePortfolioHelpModal();
  showPortfolioHelp();

  await ensureChartJS();

  // Wire filters
  const fEstado = document.getElementById("fltEstado");
  const fMercado = document.getElementById("fltMercado");
  const fSetor = document.getElementById("fltSetor");
  const fSort = document.getElementById("fltSort");

  [fEstado, fMercado, fSetor, fSort].forEach(el => {
    el?.addEventListener("change", () => {
      fltState = {
        estado: fEstado.value,
        mercado: fMercado.value,
        setor: fSetor.value,
        sort: fSort.value
      };
      handleUpdate();
    });
  });

  const handleUpdate = async () => {
    if (!_lastAtivosSnap || !_lastAcoesSnap) return;
    await processAndRender(_lastAtivosSnap, _lastAcoesSnap);
  };

  // Listeners em tempo real
  onSnapshot(
    query(collection(db, "ativos"), orderBy("dataCompra", "asc")),
    (snap) => {
      _lastAtivosSnap = snap;
      handleUpdate();
    },
  );

  onSnapshot(collection(db, "acoesDividendos"), (snap) => {
    _lastAcoesSnap = snap;
    handleUpdate();
  });
}

async function processAndRender(snap, aSnap) {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  try {
    const infoMap = new Map();
    aSnap.forEach((d) => {
      const x = d.data();
      if (x.ticker) infoMap.set(String(x.ticker).toUpperCase(), x);
    });

    const grupos = new Map();
    const movimentosAsc = [];

    snap.forEach((docu) => {
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

      const g = grupos.get(ticker) || {
        ticker,
        nome: d.nome || ticker,
        setor: d.setor || "-",
        mercado: d.mercado || "-",
        qtd: 0,
        custoMedio: 0,
        investido: 0,
        realizado: 0,
        objetivo: 0,
        anyObjSet: false,
        lastDate: null,
        lastDocId: null,
      };

      if (safeQtd > 0) {
        const totalAntes = g.qtd * g.custoMedio;
        const totalCompra = safeQtd * safePreco;
        const novaQtd = g.qtd + safeQtd;
        g.custoMedio = novaQtd > 0 ? (totalAntes + totalCompra) / novaQtd : 0;
        g.qtd = novaQtd;
      } else if (safeQtd < 0) {
        const sellQtd = Math.abs(safeQtd);
        const lucro = (safePreco - g.custoMedio) * sellQtd;
        g.realizado += lucro;
        g.qtd -= sellQtd;
        if (g.qtd <= 0) {
          g.qtd = 0;
          g.custoMedio = 0;
        }
      }

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
    const fmtEUR = new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "EUR",
    });

    const rowsForYield = [];
    gruposArr.forEach((g) => {
      const info = infoMap.get(g.ticker) || {};
      const precoAtual = isFiniteNum(info.valorStock)
        ? Number(info.valorStock)
        : null;
      const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
      g.lucroAtual =
        precoAtual !== null ? (precoAtual - precoMedio) * g.qtd : 0;
      g.precoAtual = precoAtual;

      // --- Normalização de dados (alinhamento com analise.js) ---
      const dividendoUnit = isFiniteNum(info.dividendo)
        ? Number(info.dividendo)
        : 0;
      const dmed24 = isFiniteNum(info.dividendoMedio24m)
        ? Number(info.dividendoMedio24m)
        : 0;

      const pe =
        Number(info.pe) ||
        Number(info.peRatio) ||
        Number(info["P/E ratio (Preço/Lucro)"]) ||
        null;
      const sma50 = Number(info.sma50) || Number(info.SMA50) || null;
      const sma200 = Number(info.sma200) || Number(info.SMA200) || null;
      const periodicidade = info.periodicidade || "";
      const payN = pagamentosAno(periodicidade);

      const yCur =
        precoAtual && dividendoUnit > 0 && periodicidade
          ? (dividendoUnit * payN) / precoAtual
          : precoAtual && dmed24 > 0
            ? dmed24 / precoAtual
            : null;

      const y24m = precoAtual && dmed24 > 0 ? dmed24 / precoAtual : null;

      // Guardar métricas normalizadas no objeto do grupo
      g._yCur = yCur;
      g._y24m = y24m;
      g._pe = pe;
      g._sma50 = sma50;
      g._sma200 = sma200;
      g._divUnit = dividendoUnit;
      g._divAnual = dmed24 || dividendoUnit * payN; // Usa média 24m ou projeta

      rowsForYield.push({
        ticker: g.ticker,
        active: g.qtd > 0,
        yieldCur: yCur,
      });
    });

    // 2.1) Distribuições (apenas abertas)
    const setoresMap = new Map(),
      mercadosMap = new Map();
    for (const g of gruposArr) {
      if ((g.qtd || 0) <= 0) continue;
      const setor = g.setor || "—";
      setoresMap.set(setor, (setoresMap.get(setor) || 0) + (g.investido || 0));
      const merc = g.mercado || "—";
      mercadosMap.set(merc, (mercadosMap.get(merc) || 0) + (g.investido || 0));
    }

    // 2.2) KPIs agregados
    const abertos = gruposArr.filter((g) => g.qtd > 0);
    const totalInvestido = abertos.reduce((a, g) => a + (g.investido || 0), 0);

    // Lucro Atual (aberto)
    const lucroAberto = abertos.reduce((a, g) => a + (g.lucroAtual || 0), 0);
    // Lucro Total (Acumulado) = Lucro Aberto + Lucro já realizado (vendas passadas)
    const lucroRealizado = gruposArr.reduce(
      (a, g) => a + (g.realizado || 0),
      0,
    );
    const lucroTotal = lucroAberto + lucroRealizado;

    const retornoPct = totalInvestido ? (lucroTotal / totalInvestido) * 100 : 0;

    // Dividendos
    let rendimentoAnual = 0;
    const eurosMes = new Array(12).fill(0);
    for (const g of abertos) {
      const info = infoMap.get(g.ticker) || {};
      const divUnit = isFiniteNum(info.dividendo) ? Number(info.dividendo) : 0;
      const per = info.periodicidade;
      const mesT = info.mes;
      const payN = pagamentosAno(per);
      rendimentoAnual += g.qtd * divUnit * payN;
      for (const m of mesesPagos(per, mesT)) eurosMes[m] += g.qtd * divUnit;
    }

    // Exposição acima da SMA200
    let somaPesosAcima = 0;
    for (const g of abertos) {
      if (!totalInvestido) continue;
      const w = (g.investido || 0) / totalInvestido;
      const p = g.precoAtual,
        s200 = g._sma200;
      if (isFiniteNum(p) && isFiniteNum(s200) && Number(p) > Number(s200))
        somaPesosAcima += w;
    }
    const expSMA200Pct = somaPesosAcima * 100;

    // Preencher KPIs
    const elTI = document.getElementById("prtTotalInvestido");
    const elLT = document.getElementById("prtLucroTotal");
    const elLA = document.getElementById("prtLucroAcumulado");
    const elRA = document.getElementById("prtRendimentoAnual");
    const elRP = document.getElementById("prtRetorno");
    const elEX = document.getElementById("prtExpSMA200");

    if (elTI) elTI.textContent = fmtEUR.format(totalInvestido);
    if (elLT) elLT.textContent = fmtEUR.format(lucroAberto);
    if (elLA) elLA.textContent = `Acumulado: ${fmtEUR.format(lucroTotal)}`;
    if (elRA) elRA.textContent = fmtEUR.format(rendimentoAnual);
    if (elRP)
      elRP.textContent =
        totalInvestido > 0 ? `${retornoPct.toFixed(1)}%` : "---";
    if (elEX) elEX.textContent = `${expSMA200Pct.toFixed(0)}%`;

    // 2.3) Timeline
    movimentosAsc.sort((a, b) => a.date - b.date);
    const qtyNow = new Map(),
      priceNow = new Map();
    gruposArr.forEach((g) => {
      if (isFiniteNum(g.precoAtual))
        priceNow.set(g.ticker, Number(g.precoAtual));
      qtyNow.set(g.ticker, 0);
    });
    let cumInvest = 0;
    const timelinePoints = [];
    for (const m of movimentosAsc) {
      const deltaInvest = Number(m.qtd) * Number(m.preco);
      cumInvest += deltaInvest;
      qtyNow.set(m.ticker, (qtyNow.get(m.ticker) || 0) + m.qtd);
      let valueNow = 0;
      qtyNow.forEach((q, tk) => {
        const p = priceNow.get(tk);
        if (isFiniteNum(p)) valueNow += q * Number(p);
      });
      timelinePoints.push({
        label: isFinite(m.date?.getTime?.())
          ? new Intl.DateTimeFormat("pt-PT", {
              year: "numeric",
              month: "short",
              day: "2-digit",
            }).format(m.date)
          : "",
        cumInvest,
        valueNow,
      });
    }

    // 3) Render gráficos
    renderSetorDoughnut(setoresMap);
    renderMercadoDoughnut(mercadosMap);
    renderTop5Bar(gruposArr);
    renderTop5YieldBar(rowsForYield);
    renderTimeline(timelinePoints);
    renderDividendoCalendario12m(eurosMes);

    // 3.1) Pré-cálculo de métricas operacionais para filtros/ordenação
    gruposArr.forEach(g => {
      const precoAtual = g.precoAtual || 0;
      const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
      const posValNow = g.qtd * precoAtual;
      const pLoss = posValNow - g.investido;
      const pLossPct = g.investido > 0 ? (pLoss / g.investido) * 100 : 0;
      const s200 = g._sma200;
      const isCrypto = (g.mercado === "Criptomoedas" || g.setor === "Criptomoedas");
      
      // Validação de sanidade para SMA (evita dados lixo tipo 0.01 vs preço 70)
      const isSmaValid = s200 && precoAtual > 0 && (s200 > (precoAtual * 0.01) && s200 < (precoAtual * 100));
      const isBelowSMA200 = isSmaValid && precoAtual < s200;
      
      const lucroAtual = g.lucroAtual || 0;
      const isBull = isSmaValid && precoAtual > s200 && Number(infoMap.get(g.ticker)?.taxaCrescimento_1mes || 0) > 0;

      let estadoOp = "ESPERAR";
      // Regra para Crypto: mais tolerância na SMA (pode ignorar se SMA for lixo) e threshold de queda maior (-7%)
      if (isCrypto) {
        if (pLossPct < -7) estadoOp = "REFORÇAR";
        else if (pLossPct > 15) estadoOp = "REDUZIR";
      } else {
        // Regra para Ações/ETFs: -4% e abaixo da SMA200 (se válida)
        if (pLossPct < -4 && (!isSmaValid || isBelowSMA200)) estadoOp = "REFORÇAR";
        else if (isBull && pLossPct > -2) estadoOp = "COMPRAR";
        else if (pLossPct > 10 && pLossPct <= 25) estadoOp = "REDUZIR";
        else if (pLossPct > 25) estadoOp = "VENDER";
      }

      g._estadoOp = estadoOp;
      g._pLossPct = pLossPct;
      g._distBE = Math.abs(pLossPct);
      const tp2 = tp2NecessarioCalc(g) || precoMedio * 1.15;
      g._distTP = precoAtual && tp2 ? Math.abs((tp2 / precoAtual - 1) * 100) : 999;
    });

    // 4) FILTRAGEM E ORDENAÇÃO
    let filtered = gruposArr.filter(g => Number.isFinite(g.qtd) && g.qtd > 0);
    
    // Popular dropdowns de Mercado e Setor (apenas se vazios)
    const fMercado = document.getElementById("fltMercado");
    const fSetor = document.getElementById("fltSetor");
    if (fMercado && (!fMercado.options.length || fMercado.options.length <= 1)) {
      const markets = [...new Set(gruposArr.map(g => g.mercado).filter(Boolean))].sort();
      markets.forEach(m => fMercado.add(new Option(m, m)));
      const sectors = [...new Set(gruposArr.map(g => g.setor).filter(Boolean))].sort();
      sectors.forEach(s => fSetor.add(new Option(s, s)));
    }

    // Aplicar Filtros
    if (fltState.mercado) filtered = filtered.filter(g => g.mercado === fltState.mercado);
    if (fltState.setor) filtered = filtered.filter(g => g.setor === fltState.setor);
    if (fltState.estado) filtered = filtered.filter(g => g._estadoOp === fltState.estado);

    // Aplicar Ordenação
    filtered.sort((a, b) => {
      if (fltState.sort === "queda") return a._pLossPct - b._pLossPct; 
      if (fltState.sort === "lucro") return a.lucroAtual - b.lucroAtual;
      if (fltState.sort === "yield") return (b._yCur || 0) - (a._yCur || 0);
      if (fltState.sort === "be_dist") return b._distBE - a._distBE;
      if (fltState.sort === "tp_dist") return a._distTP - b._distTP;
      return a.ticker.localeCompare(b.ticker);
    });

    const finalHtml = filtered.map(g => {
       const info = infoMap.get(g.ticker) || {};
       return renderAssetCard(g, info, fmtEUR, tp2NecessarioCalc(g));
    }).join("");

    cont.innerHTML = finalHtml || `<div class="muted" style="text-align:center; padding: 40px;">Nenhum ativo corresponde aos filtros selecionados.</div>`;
    
    wireQuickActions(gruposArr);
    wirePortfolioHelpModal();
  } catch (e) {
    console.error("Erro ao processar atividade:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
  }
}

function tp2NecessarioCalc(g) {
  const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
  const objetivo = g.objetivo > 0 ? g.objetivo : 0;
  return objetivo > 0 && g.qtd !== 0 ? precoMedio + objetivo / (g.qtd || 1) : null;
}

function renderAssetCard(g, info, fmtEUR, tp2Necessario) {
  // METRICS & BADGES
  const precoAtual = g.precoAtual;
  const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
  const lucroAtual = g.lucroAtual || 0;
  const pLossPct = g._pLossPct;
  const estadoOp = g._estadoOp;
  const tp2 = tp2Necessario || precoMedio * 1.15;
  const s200 = g._sma200;
  
  const isBelowSMA200 = precoAtual && s200 && precoAtual < s200;
  const r1Pct = isBelowSMA200 ? 5.0 : 2.5;
  const r2Pct = isBelowSMA200 ? 8.5 : 4.5;
  const r1Preco = (precoAtual || 0) * (1 - r1Pct/100);
  const r2Preco = (precoAtual || 0) * (1 - r2Pct/100);
  const tp1 = precoMedio * 1.05;
  const stopTec = s200 ? s200 * 0.95 : precoMedio * 0.90;
  
  const { taxa, periodLabel } = pickBestRate(info);
  const estimativa = tp2 && precoAtual ? estimateTime(precoAtual, tp2, taxa, periodLabel) : "—";

  const yPct = isFiniteNum(g._yCur) ? (g._yCur * 100).toFixed(2) + "%" : "—";
  
  // Formatação de Deltas com proteção contra dados lixo (> 1000%)
  const formatSmaDelta = (sma, cur) => {
    if (!isFiniteNum(sma) || !isFiniteNum(cur) || sma <= 0) return "—";
    const d = ((cur - sma) / sma) * 100;
    if (Math.abs(d) > 1000) return "—"; // Sanity check
    return `${d.toFixed(1)}%`;
  };

  const d50Txt = formatSmaDelta(g._sma50, precoAtual);
  const d200Txt = formatSmaDelta(s200, precoAtual);

  let stateColor = "var(--muted-foreground)";
  if (estadoOp === "REFORÇAR") stateColor = "#ef4444";
  if (estadoOp === "COMPRAR") stateColor = "#22c55e";
  if (estadoOp === "REDUZIR") stateColor = "#eab308";
  if (estadoOp === "VENDER") stateColor = "#ef4444";

  return `
    <div class="activity-item collapsed">
      <div class="activity-header" data-toggle-card style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="background: ${stateColor}15; color: ${stateColor}; padding: 4px 10px; border-radius: 6px; font-weight: 800; font-size: 0.75rem; border: 1px solid ${stateColor}30;">
            ${estadoOp}
          </div>
          <div>
            <strong style="font-size: 1.1rem;">${g.ticker}</strong>
            <div class="muted" style="font-size: 0.8rem;">${g.nome}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; font-size: 1.1rem;">${fmtEUR.format(precoAtual || 0)}</div>
          <div class="${lucroAtual >= 0 ? "up" : "down"}" style="font-size: 0.85rem; font-weight: 600;">
            ${lucroAtual >= 0 ? "+" : ""}${fmtEUR.format(lucroAtual)} (${pLossPct.toFixed(1)}%)
          </div>
        </div>
      </div>

      <div class="activity-details" style="padding: 0 16px 16px 16px;">
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; padding: 10px; background: var(--muted); border-radius: 8px; text-align: center;">
          <div><label class="muted" style="font-size: 0.7rem; display: block;">Qtd</label><strong>${g.qtd.toFixed(1)}</strong></div>
          <div><label class="muted" style="font-size: 0.7rem; display: block;">Médio</label><strong>${fmtEUR.format(precoMedio)}</strong></div>
          <div><label class="muted" style="font-size: 0.7rem; display: block;">Investido</label><strong>${fmtEUR.format(g.investido)}</strong></div>
          <div><label class="muted" style="font-size: 0.7rem; display: block;">Lucro</label><strong class="${lucroAtual >= 0 ? "up" : "down"}">${fmtEUR.format(lucroAtual)}</strong></div>
        </div>

        <div style="margin-bottom: 20px;">
          <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 10px; color: var(--primary); display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-bullseye"></i> 🎯 Meta do Ativo: <span style="color: var(--foreground);">${fmtEUR.format(g.objetivo || 0)} de Lucro</span>
          </div>
          <div style="background: rgba(var(--primary-rgb, 79, 70, 229), 0.05); padding: 12px; border-radius: 10px; border: 1px dashed var(--primary); display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
              <label class="muted" style="font-size: 0.75rem; display: block; margin-bottom: 2px;">Preço Alvo p/ Objetivo (TP)</label>
              <strong style="font-size: 1.15rem; color: var(--success-color, #22c55e);">${fmtEUR.format(tp2)}</strong>
            </div>
            <div style="text-align: right;">
              <span class="badge ${lucroAtual >= (g.objetivo || 0) ? "premium" : "outline"}" style="font-size: 0.7rem; font-weight: 800;">
                ${lucroAtual >= (g.objetivo || 0) ? "META ATINGIDA ✅" : "EM PROGRESSO"}
              </span>
            </div>
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 8px; color: var(--primary);">📝 Plano de Trade (Zonas)</div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
            <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px;">
              <label class="muted" style="font-size: 0.7rem; display: block;">Compra Base</label>
              <strong style="font-size: 0.9rem;">${fmtEUR.format(precoMedio)}</strong>
            </div>
            <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(234, 179, 8, 0.05);">
              <label class="muted" style="font-size: 0.7rem; display: block;">Reforço 1 (-${r1Pct}%)</label>
              <strong style="font-size: 0.9rem;">${fmtEUR.format(r1Preco)}</strong>
            </div>
            <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(234, 179, 8, 0.1);">
              <label class="muted" style="font-size: 0.7rem; display: block;">Reforço 2 (-${r2Pct}%)</label>
              <strong style="font-size: 0.9rem;">${fmtEUR.format(r2Preco)}</strong>
            </div>
            <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(34, 197, 94, 0.05);">
              <label class="muted" style="font-size: 0.7rem; display: block;">TP1 (+5%)</label>
              <strong style="font-size: 0.9rem;">${fmtEUR.format(tp1)}</strong>
            </div>
            <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(34, 197, 94, 0.1);">
              <label class="muted" style="font-size: 0.7rem; display: block;">TP2</label>
              <strong style="font-size: 0.9rem;">${fmtEUR.format(tp2)}</strong>
            </div>
            <div style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: rgba(239, 68, 68, 0.05);">
              <label class="muted" style="font-size: 0.7rem; display: block;">Stop Técnico</label>
              <strong style="font-size: 0.9rem;">${fmtEUR.format(stopTec)}</strong>
            </div>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--muted-foreground); margin-bottom: 4px;">
            <span>${fmtEUR.format(stopTec)} (STOP)</span>
            <span>${fmtEUR.format(precoAtual || 0)} (PREÇO)</span>
            <span>${fmtEUR.format(tp2)} (ALVO)</span>
          </div>
          <div style="height: 6px; background: #eee; border-radius: 10px; position: relative; overflow: hidden; display: flex;">
            <div style="flex: 1; background: #ef4444; opacity: 0.5;"></div>
            <div style="flex: 2; background: #eab308; opacity: 0.5;"></div>
            <div style="flex: 3; background: #3b82f6; opacity: 0.5;"></div>
            <div style="flex: 2; background: #22c55e; opacity: 0.5;"></div>
          </div>
        </div>

        <div style="background: rgba(79, 70, 229, 0.03); border: 1px solid rgba(79, 70, 229, 0.1); border-radius: 10px; padding: 12px; margin-bottom: 16px;">
           <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 10px; color: var(--primary);">🔄 Cenários de Reforço (Breakeven)</div>
           <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
             ${(() => {
                const Io = g.investido;
                const Qo = g.qtd;
                const Pa = precoAtual || 0;
                const genScenario = (label, invest, color) => {
                  const newQtd = Qo + (invest / Pa);
                  const newTotalInv = Io + invest;
                  const newPM = newTotalInv / newQtd;
                  const recNeeded = Pa > 0 ? ((newPM / Pa) - 1) * 100 : 0;
                  return `
                    <div style="text-align: center; padding: 8px; background: #fff; border-radius: 6px; border-bottom: 3px solid ${color};">
                      <div style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase;">${label}</div>
                      <div style="font-size: 0.85rem; margin: 4px 0;">+${fmtEUR.format(invest)}</div>
                      <div style="font-size: 0.65rem; color: var(--muted-foreground);">Novo PM: ${fmtEUR.format(newPM)}</div>
                      <div style="font-size: 0.75rem; font-weight: 700; color: ${color};">+${recNeeded.toFixed(1)}%</div>
                    </div>`;
                };
                return genScenario("Leve", 250, "#eab308") + genScenario("Médio", 500, "#3b82f6") + genScenario("Forte", 1000, "#22c55e");
             })()}
           </div>
        </div>

        <!-- LEITURA TÉCNICA -->
        <div style="display: grid; grid-template-columns: 2fr 1.5fr; gap: 12px; font-size: 0.8rem; margin-bottom: 16px;">
          <div class="card" style="padding: 10px; box-shadow: none; border: 1px solid var(--border);">
            <div style="margin-bottom: 4px;">Yield: <strong>${yPct}</strong></div>
            <div>P/E: <strong>${isFiniteNum(g._pe) ? g._pe.toFixed(1) : "—"}</strong></div>
            <div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--border);">
              Rácio R/R: <strong>
                ${(() => {
                  const risk = (precoAtual || 0) - stopTec;
                  const reward = tp2 - (precoAtual || 0);
                  if (risk > 0 && reward > 0) return `1:${(reward / risk).toFixed(1)}`;
                  return "—";
                })()}
              </strong>
            </div>
          </div>
          <div class="card" style="padding: 10px; box-shadow: none; border: 1px solid var(--border);">
            <div style="margin-bottom: 4px;">ΔSMA50: <strong>${d50Txt}</strong></div>
            <div>ΔSMA200: <strong>${d200Txt}</strong></div>
          </div>
        </div>

        <div style="display: flex; gap: 8px;">
          <button class="btn premium" data-buy="${g.ticker}" style="flex: 2; margin-top: 0; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <i class="fas fa-plus-circle"></i> ${estadoOp === "REFORÇAR" ? "Reforçar" : "Comprar"}
          </button>
          <button class="btn outline" data-sell="${g.ticker}" style="flex: 1; margin-top: 0;">Vender</button>
          <button class="btn ghost" data-edit="${g.lastDocId}" data-edit-ticker="${g.ticker}" style="flex: 0 0 40px; margin-top: 0; padding: 0;">
            <i class="fas fa-edit"></i>
          </button>
        </div>
      </div>
    </div>`;
}
