import { db } from "./js/firebase-config.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

async function audit() {
  console.log("--- AUDITORIA DE ESTRATÉGIA ---");
  
  // 1. Get Strategy
  const stratSnap = await getDoc(doc(db, "config", "strategy"));
  const strat = stratSnap.exists() ? stratSnap.data() : {};
  console.log("Estratégia Configurada:", JSON.stringify(strat, null, 2));

  // 2. Get Holdings
  const ativosSnap = await getDocs(collection(db, "ativos"));
  const grupos = {};
  ativosSnap.forEach(d => {
    const data = d.data();
    const t = data.ticker;
    if (!grupos[t]) grupos[t] = { ticker: t, qtd: 0, investido: 0 };
    const q = parseFloat(data.quantidade) || 0;
    const p = parseFloat(data.precoCompra) || 0;
    grupos[t].qtd += q;
    if (q > 0) grupos[t].investido += q * p;
  });

  const abertos = Object.values(grupos).filter(g => g.qtd > 0);
  const totalInvestido = abertos.reduce((a, b) => a + b.investido, 0);
  console.log(`Total Investido: ${totalInvestido}€`);

  // 3. Calculate current distribution
  let coreInv = 0;
  let satInv = 0;
  
  abertos.forEach(g => {
    const s = strat.tickers && strat.tickers[g.ticker];
    const cat = s ? s.category : "NONE";
    const weight = (g.investido / totalInvestido) * 100;
    console.log(`Ativo: ${g.ticker} | Cat: ${cat} | Peso: ${weight.toFixed(1)}%`);
    if (cat === "CORE") coreInv += weight;
    if (cat === "SATELLITE") satInv += weight;
  });

  console.log(`--- TOTAIS ---`);
  console.log(`Core Atual: ${coreInv.toFixed(1)}%`);
  console.log(`Satélite Atual: ${satInv.toFixed(1)}%`);
}

audit();
