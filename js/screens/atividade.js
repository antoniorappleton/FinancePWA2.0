// js/screens/atividade.js
import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function initScreen() {
  const cont = document.getElementById("listaAtividades");
  if (!cont) return;

  cont.innerHTML = "A carregar…";

  try {
    // 1) Buscar TODAS as compras (ativos) e agrupar por ticker
    const q = query(collection(db, "ativos"), orderBy("dataCompra", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      return;
    }

    // Agrupador por TICKER
    const grupos = new Map(); // ticker -> { nome, setor, mercado, qtd, investido, objetivo, lastDate, anyObjSet }
    snap.forEach(doc => {
      const d = doc.data();
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
        lastDate: null, // última compra
      };

      g.qtd += qtd;
      g.investido += invest;

      const obj = toNum(d.objetivoFinanceiro);
      // regra: considerar o primeiro objetivo > 0 por ticker (podes trocar para max, se preferires)
      if (!g.anyObjSet && obj > 0) {
        g.objetivo = obj;
        g.anyObjSet = true;
      }

      const dt = (d.dataCompra && typeof d.dataCompra.toDate === "function")
        ? d.dataCompra.toDate()
        : null;

      if (!g.lastDate || (dt && dt > g.lastDate)) g.lastDate = dt;

      // mantém nome/setor/mercado “mais recentes” caso venham diferentes
      g.nome = d.nome || g.nome;
      g.setor = d.setor || g.setor;
      g.mercado = d.mercado || g.mercado;

      grupos.set(ticker, g);
    });

    const gruposArr = Array.from(grupos.values());

    // 2) Ir buscar preços atuais + taxas a acoesDividendos (em chunks de 10 por causa do where "in")
    const tickers = gruposArr.map(g => g.ticker);
    const infoMap = await fetchDividendInfoByTickers(tickers);

    // 3) Helpers de formatação
    const fmtEUR  = new Intl.NumberFormat("pt-PT",{ style:"currency", currency:"EUR" });
    const fmtDate = new Intl.DateTimeFormat("pt-PT",{ year:"numeric", month:"short", day:"2-digit" });

    // 4) Construir linhas por TICKER
    const html = gruposArr.map(g => {
      const info = infoMap.get(g.ticker) || {};
      const precoAtual = isFiniteNum(info.valorStock) ? Number(info.valorStock) : null;

      // preço médio de compra
      const precoMedio = g.qtd > 0 ? (g.investido / g.qtd) : 0;

      // lucro atual (se tivermos preçoAtual; senão fica 0)
      const lucroAtual = (precoAtual !== null)
        ? (precoAtual - precoMedio) * g.qtd
        : 0;

      // progresso vs objetivo (zero ao centro)
      let pctText = "—";
      let barHTML = "";
      const objetivo = g.objetivo > 0 ? g.objetivo : 0;

      if (objetivo > 0) {
        // progresso real em relação ao objetivo (pode ser negativo)
        const progresso = (lucroAtual / objetivo) * 100;

        // limitar entre -100 e 100
        const clamped = Math.max(-100, Math.min(100, progresso));

        // largura do lado a preencher: 0..50 (porque a barra tem duas metades)
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

      // TP2 necessário (para atingir o objetivo de lucro por ticker)
      const tp2Necessario = (objetivo > 0 && g.qtd > 0)
        ? (precoMedio + (objetivo / g.qtd))
        : null;

      // Estimativa temporal para atingir TP2 (usa melhor taxa: 1m > 1s > 1ano)
      const { taxa, periodLabel } = pickBestRate(info);
      const estimativa = (tp2Necessario && precoAtual)
        ? estimateTime(precoAtual, tp2Necessario, taxa, periodLabel)
        : "—";

      const dataTxt = g.lastDate ? fmtDate.format(g.lastDate) : "sem data";

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
            </div>
          </div>
        </div>
      `;
    });

    cont.innerHTML = html.join("");

  } catch (e) {
    console.error("Erro ao carregar atividades:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
  }
}

/* =========================
   Helpers
   ========================= */
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isFiniteNum(v){ return Number.isFinite(Number(v)); }
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function formatNum(n){ return Number(n || 0).toLocaleString("pt-PT"); }

// vai buscar info da coleção acoesDividendos por lotes de 10 tickers
async function fetchDividendInfoByTickers(tickers){
  const out = new Map();
  const chunks = [];
  for (let i=0; i<tickers.length; i+=10) chunks.push(tickers.slice(i, i+10));
  for (const chunk of chunks){
    const q = query(collection(db, "acoesDividendos"), where("ticker", "in", chunk));
    const snap = await getDocs(q);
    snap.forEach(doc => {
      const d = doc.data();
      if (d.ticker) out.set(String(d.ticker).toUpperCase(), d);
    });
  }
  return out;
}

// escolhe a melhor taxa disponível: 1m > 1s > 1ano
function pickBestRate(info){
  if (typeof info?.taxaCrescimento_1mes === "number") return { taxa: info.taxaCrescimento_1mes, periodLabel: "mês" };
  if (typeof info?.taxaCrescimento_1semana === "number") return { taxa: info.taxaCrescimento_1semana, periodLabel: "semana" };
  if (typeof info?.taxaCrescimento_1ano === "number") return { taxa: info.taxaCrescimento_1ano, periodLabel: "ano" };
  return { taxa: null, periodLabel: null };
}

// estima nº de períodos até atingir targetPrice, com crescimento composto r (%) por período
function estimateTime(currentPrice, targetPrice, growthPct, periodLabel){
  const r = Number(growthPct || 0) / 100;
  if (r <= 0 || !isFiniteNum(currentPrice) || !isFiniteNum(targetPrice) || currentPrice <= 0 || targetPrice <= 0) return "—";
  const n = Math.log(targetPrice / currentPrice) / Math.log(1 + r);
  if (!isFinite(n) || n < 0) return "—";
  if (periodLabel === "semana") return `${n.toFixed(1)} semanas`;
  if (periodLabel === "mês")    return `${n.toFixed(1)} meses`;
  return `${n.toFixed(1)} anos`;
}