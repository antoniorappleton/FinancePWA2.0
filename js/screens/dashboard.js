// js/screens/dashboard.js
import { db } from "../firebase-config.js";
import {
  getDocs,
  collection,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function initScreen() {
  console.log("✅ dashboard.js iniciado");

  const valorTotalEl = document.getElementById("valorTotal");
  const retornoEl = document.getElementById("retornoTotal");
  const lucroTotalEl = document.getElementById("lucroTotal");
  const posicoesEl = document.getElementById("posicoesAtivas");
  const objetivosEl = document.getElementById("objetivosFinanceiros");
  const taxaSucessoEl = document.getElementById("taxaSucesso");
  const objetivoTotalEl = document.getElementById("objetivoTotal");

  let totalInvestido = 0;
  let totalLucro = 0;
  let objetivoFinanceiroTotal = 0;
  let objetivosAtingidos = 0;

  try {
    const ativosSnapshot = await getDocs(collection(db, "ativos"));
    const acoesSnapshot = await getDocs(collection(db, "acoesDividendos"));

    // Map para valor atual das ações
    const valorAtualMap = new Map();
    acoesSnapshot.forEach((doc) => {
      const dados = doc.data();
      if (dados.ticker) {
        valorAtualMap.set(dados.ticker.toUpperCase(), dados.valorStock);
      }
    });

    // Map para agrupar ativos por ticker
    const agrupadoPorTicker = new Map();

    ativosSnapshot.forEach((doc) => {
      const ativo = doc.data();
      const ticker = ativo.ticker?.toUpperCase();
      if (!ticker) return;

      const grupo = agrupadoPorTicker.get(ticker) || {
        quantidade: 0,
        investimento: 0,
        precoCompraTotal: 0,
        objetivoFinanceiro: 0,
        objetivoDefinido: false,
      };

      const quantidade = parseFloat(ativo.quantidade || 0);
      const precoCompra = parseFloat(ativo.precoCompra || 0);
      const objetivo = parseFloat(ativo.objetivoFinanceiro || 0);

      grupo.quantidade += quantidade;
      grupo.investimento += precoCompra * quantidade;
      grupo.precoCompraTotal += precoCompra * quantidade;

      // Apenas considera o objetivo uma vez
      if (!grupo.objetivoDefinido && objetivo > 0) {
        grupo.objetivoFinanceiro = objetivo;
        grupo.objetivoDefinido = true;
      }

      agrupadoPorTicker.set(ticker, grupo);
    });

    let totalObjetivos = 0;

    agrupadoPorTicker.forEach((grupo, ticker) => {
      const precoAtual = valorAtualMap.get(ticker) || 0;
      const lucro = (precoAtual * grupo.quantidade) - grupo.investimento;

      totalInvestido += grupo.investimento;
      totalLucro += lucro;

      if (grupo.objetivoDefinido) {
        totalObjetivos++;
        objetivoFinanceiroTotal += grupo.objetivoFinanceiro;

        if (lucro >= grupo.objetivoFinanceiro) {
          objetivosAtingidos++;
        }
      }
    });

    const retorno = totalInvestido > 0 ? (totalLucro / totalInvestido) * 100 : 0;
    const taxaSucesso = objetivoFinanceiroTotal > 0 ? (totalLucro / objetivoFinanceiroTotal) * 100 : 0;

    // Atualizar UI
    valorTotalEl.textContent = `€${totalInvestido.toFixed(2)}`;
    lucroTotalEl.textContent = `€${totalLucro.toFixed(2)}`;
    retornoEl.textContent = `${retorno.toFixed(1)}%`;
    posicoesEl.textContent = agrupadoPorTicker.size;
    objetivosEl.textContent = `${objetivosAtingidos}/${totalObjetivos}`;
    objetivoTotalEl.textContent = `€${objetivoFinanceiroTotal.toFixed(2)}`;
    taxaSucessoEl.textContent = `${taxaSucesso.toFixed(1)}%`;
  } catch (error) {
    console.error("❌ Erro ao carregar dados da dashboard:", error);
  }
  await carregarAtividadeRecente();
  // em dashboard.js dentro de initScreen()
document.getElementById("btnAtividade")?.addEventListener("click", () => {
  import("../main.js").then(({ navigateTo }) => navigateTo("atividade"));
});


}
import { query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

async function carregarAtividadeRecente() {
  const atividadeEl = document.getElementById("atividadeRecente");
  atividadeEl.innerHTML = ""; // Limpa antes de renderizar

  try {
    const q = query(collection(db, "ativos"), orderBy("dataCompra", "desc"), limit(5));
    const snapshot = await getDocs(q);

    snapshot.forEach((doc) => {
      const dados = doc.data();
      const ticker = dados.ticker || "—";
      const quantidade = dados.quantidade || 0;
      const preco = dados.precoCompra || 0;
      const dataCompra = dados.dataCompra?.toDate?.() || new Date();

      const dataFormatada = dataCompra.toLocaleDateString("pt-PT");

      const itemHTML = `
        <div class="activity-item">
          <div>
            <p><strong>Compra - ${ticker}</strong></p>
            <p class="muted">${quantidade} ações @ €${preco.toFixed(2)}</p>
          </div>
          <span class="date">${dataFormatada}</span>
        </div>
      `;

      atividadeEl.innerHTML += itemHTML;
    });
  } catch (err) {
    console.error("❌ Erro ao carregar atividade recente:", err);
    atividadeEl.innerHTML = `<p class="muted">Erro ao carregar atividade</p>`;
  }
}
