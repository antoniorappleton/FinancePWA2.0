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

// --- Variáveis de cache para evitar leituras redundantes ---
let _lastAtivosSnap = null;
let _lastAcoesSnap = null;

// ===============================
// INIT (screen)
// ===============================
export async function initScreen() {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  cont.innerHTML = "A carregar…";

  // Registrar ajuda
  wirePortfolioHelpModal();
  showPortfolioHelp();

  await ensureChartJS();

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

    // 4) Render lista
    const htmlList = gruposArr
      .filter((g) => Number.isFinite(g.qtd) && g.qtd > 0)
      .map((g) => {
        const info = infoMap.get(g.ticker) || {};
        const precoAtual = g.precoAtual;
        const precoMedio = g.qtd !== 0 ? g.investido / (g.qtd || 1) : 0;
        const lucroAtual = g.lucroAtual || 0;
        const objetivo = g.objetivo > 0 ? g.objetivo : 0;
        let pctText = "—";
        let barHTML = "";
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

        // Percentagem para atingir o TP2
        const pctToTP2 =
          isFiniteNum(precoAtual) &&
          isFiniteNum(tp2Necessario) &&
          precoAtual > 0
            ? (tp2Necessario / precoAtual - 1) * 100
            : null;
        const pctToTP2Txt =
          pctToTP2 !== null
            ? `(${pctToTP2 >= 0 ? "+" : ""}${pctToTP2.toFixed(1)}%)`
            : "";

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

        const divUnit = g._divUnit;
        const divAnualEst = g._divAnual;
        const periodicidade = info.periodicidade || "n/A";
        const mesPagamento = info.mes || "n/A";

        return `
        <div class="activity-item collapsed">
          <div class="activity-header" data-toggle-card>
            <div class="left">
              <span class="status-dot">${stopLight}</span>
              <div class="title-group">
                <strong>${g.nome}</strong> <span class="muted">(${g.ticker})</span>
                <div class="meta">${g.setor} • ${g.mercado} • Posição aberta</div>
              </div>
            </div>
            <div class="right">
              <div class="price-val">€${(precoAtual || 0).toFixed(2)}</div>
              <div class="${lucroAtual >= 0 ? "up" : "down"}">
                ${lucroAtual >= 0 ? "▲" : "▼"} €${Math.abs(lucroAtual).toFixed(2)}
              </div>
            </div>
          </div>
          <div class="activity-details">
            <div style="font-size:0.85rem; margin-bottom:12px;" class="muted">Última compra: ${dataTxt}</div>
            <div class="details-grid">
               <div class="info-block">
                 <label>Posição</label>
                 <div>Qtd: ${g.qtd.toFixed(0)} · Preço médio: €${precoMedio.toFixed(2)} · Preço atual: €${(precoAtual || 0).toFixed(2)}</div>
               </div>
               <div class="info-block" style="grid-column: span 2;">
                 <label>Investimento & Lucro</label>
                 <div>Investido: €${g.investido.toFixed(2)} · Lucro atual: <span class="${lucroAtual >= 0 ? "up" : "down"}">€${lucroAtual.toFixed(2)}</span></div>
               </div>
            </div>

            ${(() => {
              if (!(lucroAtual < 0 && precoAtual > 0)) return "";

              const precoReentrada =
                precoAtual / (1 + Math.abs(lucroAtual) / (g.qtd * precoAtual));
              const dropNeeded = (1 - precoReentrada / precoAtual) * 100;

              // Lógica de Probabilidade
              let prob = "Média";
              let color = "#EAB308"; // Amarelo

              const isBear = stopLight === "🔴";
              const isBull = stopLight === "🟢";
              const isAboveSMA50 = d50 !== null && d50 > 0;

              if (dropNeeded < 4 && (isBear || isAboveSMA50)) {
                prob = "Alta";
                color = "#22C55E"; // Verde
              } else if (dropNeeded > 8 || isBull) {
                prob = "Baixa";
                color = "#EF4444"; // Vermelho
              }

              return `
              <div class="recovery-box" style="margin-top:15px; background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.2); padding:12px; border-radius:8px; font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <div style="font-weight:bold; color:var(--danger-color, #ef4444);">
                    <i class="fas fa-redo-alt"></i> Simulador de Recuperação
                  </div>
                  <div style="background:${color}22; color:${color}; padding:2px 8px; border-radius:12px; font-weight:bold; font-size:0.75rem; border:1px solid ${color}44;">
                    Probabilidade: ${prob}
                  </div>
                </div>
                <div class="muted" style="line-height:1.4;">
                  Se vender agora para reentrar mais baixo, precisará de comprar a 
                  <strong style="color:var(--text-color);">€${precoReentrada.toFixed(2)}</strong> 
                  (<span class="down">-${dropNeeded.toFixed(1)}%</span>) 
                  para recuperar o prejuízo de <strong>€${Math.abs(lucroAtual).toFixed(2)}</strong> quando o preço regressar aos <strong>€${precoAtual.toFixed(2)}</strong> atuais.
                </div>
              </div>`;
            })()}

            <div class="objective-box" style="margin-top:15px; border-top:1px solid var(--border); padding-top:10px;">
              <div class="obj-header">
                <label>Objetivo (lucro): €${objetivo > 0 ? objetivo.toFixed(2) : "0,00"}</label>
                <span class="pct">${pctText}</span>
              </div>
              ${barHTML}
              <p class="muted" style="font-size:0.8rem; margin-top:5px;">
                TP2 necessário: <strong>€${tp2Necessario ? tp2Necessario.toFixed(2) : "—"}</strong> ${pctToTP2Txt} · Estimativa: <strong>${estimativa}</strong>
              </p>
            </div>

            <div class="metrics-box" style="margin-top:15px; background:var(--glass-bg); padding:10px; border-radius:8px; font-size:0.85rem;">
               <div style="margin-bottom:8px;">
                 ${stopLight} 
                 ${g.setor.includes("ETF") && yPct === "—" ? "" : `Yield: <strong>${yPct}</strong> <small class="muted">(${yBadge || "—"})</small> • `}
                 ${g.setor.includes("ETF") && y24Pct === "—" ? "" : `Yield 24m: <strong>${y24Pct}</strong> • `}
                 ${g.setor.includes("ETF") && !isFiniteNum(pe) ? "" : `P/E: <strong>${isFiniteNum(pe) ? pe.toFixed(1) : "—"}</strong> <small class="muted">(${peBadge})</small> • `}
                 Δ50d: <strong>${d50Txt}</strong> • 
                 Δ200d: <strong>${d200Txt}</strong>
               </div>
               ${
                 g.setor.includes("ETF") && divAnualEst === 0
                   ? ""
                   : `
               <div class="muted">
                 ${periodicidade} • paga em <strong>${mesPagamento}</strong> • 
                 Div. unit.: <strong>€${divUnit.toFixed(2)}</strong> • 
                 Div. anual est.: <strong>€${divAnualEst.toFixed(2)}</strong>
               </div>
               `
               }
            </div>

            <div class="actions" style="margin-top:15px;">
              <button class="btn ok sm" data-buy="${g.ticker}"><i class="fas fa-plus"></i> Comprar</button>
              <button class="btn danger sm" data-sell="${g.ticker}"><i class="fas fa-minus"></i> Vender</button>
              <button class="btn outline sm" data-edit="${g.lastDocId}" data-edit-ticker="${g.ticker}"><i class="fas fa-edit"></i> Editar Último</button>
            </div>
          </div>
        </div>`;
      })
      .join("");

    cont.innerHTML = htmlList;
    wireQuickActions(gruposArr);
    wirePortfolioHelpModal();
  } catch (e) {
    console.error("Erro ao processar atividade:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
  }
}
