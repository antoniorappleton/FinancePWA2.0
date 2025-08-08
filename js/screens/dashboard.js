// js/screens/dashboard.js
import { db } from "../firebase-config.js";
import {
  getDocs, collection, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function initScreen() {
  console.log("✅ dashboard.js iniciado");

  // --- ELEMENTOS DA UI ---
  const valorTotalEl      = document.getElementById("valorTotal");
  const retornoEl         = document.getElementById("retornoTotal");
  const lucroTotalEl      = document.getElementById("lucroTotal");
  const posicoesEl        = document.getElementById("posicoesAtivas");
  const objetivosEl       = document.getElementById("objetivosFinanceiros");
  const taxaSucessoEl     = document.getElementById("taxaSucesso");
  const objetivoTotalEl   = document.getElementById("objetivoTotal");

  // --- ACUMULADORES ---
  let totalInvestido = 0;
  let totalLucro = 0;
  let objetivoFinanceiroTotal = 0;
  let objetivosAtingidos = 0;

  try {
    // 1) Buscar ativos e preços atuais
    const [ativosSnapshot, acoesSnapshot] = await Promise.all([
      getDocs(collection(db, "ativos")),
      getDocs(collection(db, "acoesDividendos")),
    ]);

    // Mapa de preços atuais por TICKER
    const valorAtualMap = new Map();
    acoesSnapshot.forEach((doc) => {
      const d = doc.data();
      if (d.ticker && typeof d.valorStock === "number") {
        valorAtualMap.set(d.ticker.toUpperCase(), d.valorStock);
      }
    });

    // Agrupar ativos por TICKER (para KPIs por ativo agregado)
    const agrupadoPorTicker = new Map();

    ativosSnapshot.forEach((doc) => {
      const a = doc.data();
      const ticker = (a.ticker || "").toUpperCase();
      if (!ticker) return;

      const grupo = agrupadoPorTicker.get(ticker) || {
        quantidade: 0,
        investimento: 0,
        objetivoFinanceiro: 0,
        objetivoDefinido: false,
      };

      const quantidade   = parseFloat(a.quantidade || 0);
      const precoCompra  = parseFloat(a.precoCompra || 0);
      const objetivo     = parseFloat(a.objetivoFinanceiro || 0);

      grupo.quantidade   += quantidade;
      grupo.investimento += precoCompra * quantidade;

      // objetivo conta uma única vez por ticker (até decidires outra regra)
      if (!grupo.objetivoDefinido && objetivo > 0) {
        grupo.objetivoFinanceiro = objetivo;
        grupo.objetivoDefinido   = true;
      }

      agrupadoPorTicker.set(ticker, grupo);
    });

    let totalObjetivos = 0;

    // Calcular KPIs globais
    agrupadoPorTicker.forEach((g, ticker) => {
      const precoAtual = valorAtualMap.get(ticker) || 0;
      const atual      = g.quantidade * precoAtual;
      const lucro      = atual - g.investimento;

      totalInvestido += g.investimento;
      totalLucro     += lucro;

      if (g.objetivoDefinido) {
        totalObjetivos++;
        objetivoFinanceiroTotal += g.objetivoFinanceiro;
        if (lucro >= g.objetivoFinanceiro) objetivosAtingidos++;
      }
    });

    const retorno      = totalInvestido > 0 ? (totalLucro / totalInvestido) * 100 : 0;
    const taxaSucesso  = objetivoFinanceiroTotal > 0 ? (totalLucro / objetivoFinanceiroTotal) * 100 : 0;

    // Atualizar UI
    if (valorTotalEl)     valorTotalEl.textContent     = `€${totalInvestido.toFixed(2)}`;
    if (lucroTotalEl)     lucroTotalEl.textContent     = `€${totalLucro.toFixed(2)}`;
    if (retornoEl)        retornoEl.textContent        = `${retorno.toFixed(1)}%`;
    if (posicoesEl)       posicoesEl.textContent       = agrupadoPorTicker.size;
    if (objetivosEl)      objetivosEl.textContent      = `${objetivosAtingidos}/${totalObjetivos}`;
    if (objetivoTotalEl)  objetivoTotalEl.textContent  = `€${objetivoFinanceiroTotal.toFixed(2)}`;
    if (taxaSucessoEl)    taxaSucessoEl.textContent    = `${taxaSucesso.toFixed(1)}%`;

  } catch (err) {
    console.error("❌ Erro nos KPIs:", err);
  }

  // 2) Atividades recentes com barra de progresso
  await carregarAtividadeRecenteComProgresso();
}

// ------- Atividade recente com barra de progresso -------
async function carregarAtividadeRecenteComProgresso() {
  const cont = document.getElementById("atividadeRecente");
  if (!cont) return;

  try {
    const q = query(
      collection(db, "ativos"),
      orderBy("dataCompra", "desc"),
      limit(8)
    );
    const snapAtivos = await getDocs(q);

    if (snapAtivos.empty) {
      cont.innerHTML = `<p class="muted">Sem atividades ainda.</p>`;
      return;
    }

    // Preços atuais
    const mapaPrecoAtual = {};
    const snapAcoes = await getDocs(collection(db, "acoesDividendos"));
    snapAcoes.forEach(doc => {
      const d = doc.data();
      if (d.ticker && typeof d.valorStock === "number") {
        mapaPrecoAtual[d.ticker.toUpperCase()] = d.valorStock;
      }
    });

    const fmtEUR  = new Intl.NumberFormat("pt-PT",{ style:"currency", currency:"EUR" });
    const fmtDate = new Intl.DateTimeFormat("pt-PT",{ year:"numeric", month:"2-digit", day:"2-digit" });

    const html = [];
    snapAtivos.forEach(doc => {
      const d = doc.data();
      const nome        = d.nome || d.ticker || "Ativo";
      const ticker      = (d.ticker || "").toUpperCase();
      const qtd         = Number(d.quantidade || 0);
      const precoCompra = Number(d.precoCompra || 0);
      const objetivoLucro = Number(d.objetivoFinanceiro || 0);

      // Data
      let dataTxt = "sem data";
      if (d.dataCompra && typeof d.dataCompra.toDate === "function") {
        dataTxt = fmtDate.format(d.dataCompra.toDate());
      }

      // Preço atual
      const precoAtual = typeof mapaPrecoAtual[ticker] === "number"
        ? mapaPrecoAtual[ticker]
        : precoCompra;

      // Lucro atual
      const investido   = precoCompra * qtd;
      const atual       = precoAtual * qtd;
      const lucroAtual  = atual - investido;

      // Progresso vs objetivo
      let pct = 0, widthPct = 0, pctText = "—";
      const positive = lucroAtual >= 0;

      if (objetivoLucro > 0) {
        pct     = (lucroAtual / objetivoLucro) * 100;
        widthPct= Math.min(100, Math.abs(pct));
        pctText = `${pct.toFixed(0)}%`;
      }

      html.push(`
        <div class="activity-item">
          <div class="activity-left">
            <span class="activity-icon">🛒</span>
            <div>
              <p><strong>Compra - ${nome}</strong></p>
              <p class="muted">${qtd} ${qtd === 1 ? "ação" : "ações"} @ ${fmtEUR.format(precoCompra)}</p>

              <div class="activity-meta">
                <span>Objetivo (lucro): <strong>${fmtEUR.format(objetivoLucro || 0)}</strong></span>
                <span>${pctText}</span>
              </div>
              <div class="progress">
                <div class="progress-track">
                  <div class="progress-fill ${positive ? "positive" : "negative"}" style="width:${widthPct}%"></div>
                </div>
              </div>
            </div>
          </div>
          <span class="date">${dataTxt}</span>
        </div>
      `);
    });

    cont.innerHTML = html.join("");
  } catch (e) {
    console.error("Erro ao carregar atividade/progresso:", e);
    cont.innerHTML = `<p class="muted">Não foi possível carregar a lista.</p>`;
  }
}