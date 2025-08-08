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
    // 1) Busca as compras
    const q = query(collection(db, "ativos"), orderBy("dataCompra", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      return;
    }

    // 2) Recolhe tickers únicos para ir buscar dados atuais (com 1 query por chunk)
    const ativos = [];
    const tickers = new Set();
    snap.forEach(doc => {
      const d = doc.data();
      d.__id = doc.id;
      ativos.push(d);
      if (d.ticker) tickers.add(d.ticker);
    });

    // Helper: divide em chunks de 10 (limite do Firestore 'in')
    const toChunks = (arr, size=10) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i+size));
      return out;
    };

    // 3) Mapa ticker->dados atuais a partir de acoesDividendos
    const tickersArr = Array.from(tickers);
    const chunks = toChunks(tickersArr, 10);

    const tickerInfo = new Map();
    for (const chunk of chunks) {
      const qPrices = query(
        collection(db, "acoesDividendos"),
        where("ticker", "in", chunk)
      );
      const s2 = await getDocs(qPrices);
      s2.forEach(doc => {
        const d = doc.data();
        if (d.ticker) tickerInfo.set(d.ticker, d);
      });
    }

    // 4) Formatters
    const fmtEUR  = new Intl.NumberFormat("pt-PT",{ style:"currency", currency:"EUR" });
    const fmtDate = new Intl.DateTimeFormat("pt-PT",{ year:"numeric", month:"short", day:"2-digit" });

    // 5) Utilitário para estimar tempo (n períodos) com base na taxa
    function estimateTime(currentPrice, targetPrice, growthPct, periodLabel) {
      // growthPct ex.: 4.5 (%/mês, ou %/semana, ou %/ano consoante a taxa)
      const r = (Number(growthPct)||0)/100;
      if (r <= 0 || currentPrice <= 0 || targetPrice <= 0) return "—";
      const n = Math.log(targetPrice/currentPrice) / Math.log(1+r);
      if (!isFinite(n) || n < 0) return "—";

      // devolve já com unidade correta
      if (periodLabel === "semana") {
        return `${n.toFixed(1)} semanas`;
      } else if (periodLabel === "mês") {
        return `${n.toFixed(1)} meses`;
      } else {
        return `${n.toFixed(1)} anos`;
      }
    }

    // 6) Constroi HTML
    const html = ativos.map(d => {
      const nome = d.nome || d.ticker || "Ativo";
      const qtd  = Number(d.quantidade || 0);
      const precoCompra = Number(d.precoCompra || 0);
      const objetivo = Number(d.objetivoFinanceiro || 0);
      const tipoObj  = (d.tipoObjetivo || "lucro").toLowerCase();

      let dataTxt = "sem data";
      if (d.dataCompra && typeof d.dataCompra.toDate === "function") {
        dataTxt = fmtDate.format(d.dataCompra.toDate());
      }

      // Dados atuais do ticker
      const info = d.ticker ? tickerInfo.get(d.ticker) : null;
      const precoAtual = Number(info?.valorStock || precoCompra);

      // Cálculos base
      const investido   = qtd * precoCompra;
      const lucroAtual  = (precoAtual - precoCompra) * qtd;

      // Progresso vs objetivo (só faz sentido para tipo "lucro" com objetivo > 0)
      let progresso = null;
      let tp2Necessario = null;
      let estimativaTempo = "—";

      if (tipoObj === "lucro" && objetivo > 0 && qtd > 0) {
        progresso = Math.max(0, Math.min(1, lucroAtual / objetivo)); // clamp 0..1
        tp2Necessario = precoCompra + (objetivo / Math.max(qtd, 1)); // P tal que (P - precoCompra)*qtd = objetivo

        // Escolhe melhor taxa disponível e estima o tempo
        // prioridade: 1 mês > 1 semana > 1 ano
        let period = null;
        let taxa = null;

        if (typeof info?.taxaCrescimento_1mes === "number") {
          taxa = info.taxaCrescimento_1mes;
          period = "mês";
        } else if (typeof info?.taxaCrescimento_1semana === "number") {
          taxa = info.taxaCrescimento_1semana;
          period = "semana";
        } else if (typeof info?.taxaCrescimento_1ano === "number") {
          taxa = info.taxaCrescimento_1ano;
          period = "ano";
        }

        if (taxa !== null && taxa !== undefined) {
          estimativaTempo = estimateTime(precoAtual, tp2Necessario, taxa, period);
        }
      }

      const progressoPct = progresso !== null ? (progresso*100).toFixed(0) : "—";

      return `
        <div class="activity-item">
          <div class="activity-left">
            <span class="activity-icon">🛒</span>
            <div>
              <p><strong>Compra - ${nome}</strong></p>
              <p class="muted">${qtd} ${qtd === 1 ? "ação" : "ações"} @ ${fmtEUR.format(precoCompra)}</p>
              <p class="muted">Investido: ${fmtEUR.format(investido)} · Preço atual: ${fmtEUR.format(precoAtual)}</p>
              <p class="muted">Lucro atual: <strong>${fmtEUR.format(lucroAtual)}</strong></p>
              ${tipoObj === "lucro" && objetivo > 0 ? `
                <div class="progress-row">
                  <span class="muted">Objetivo (lucro): ${fmtEUR.format(objetivo)}</span>
                  <div class="progress">
                    <div class="progress-bar" style="width:${progressoPct}%"></div>
                  </div>
                  <span class="muted small">${progressoPct}%</span>
                </div>
                <p class="muted">TP2 necessário: <strong>${fmtEUR.format(tp2Necessario)}</strong> · Estimativa: <strong>${estimativaTempo}</strong></p>
              ` : ``}
            </div>
          </div>
          <span class="date">${dataTxt}</span>
        </div>
      `;
    });

    cont.innerHTML = html.join("");

  } catch (e) {
    console.error("Erro ao carregar atividades:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
  }
}
