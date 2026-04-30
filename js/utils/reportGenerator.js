// js/utils/reportGenerator.js
import { db } from "../firebase-config.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { calculateLucroMaximoScore, getAssetType } from "./scoring.js";

const CRISES_HISTORY = [
  { id: "likely_now", name: "Cenário Provável Atual", drop: 13 },
  { id: "geo_mod", name: "Crise Geopolítica Moderada", drop: 11.5 },
  { id: "rus_ukraine", name: "Invasão da Ucrânia (2022)", drop: 24 },
  { id: "covid_crash", name: "Crash COVID-19 (2020)", drop: 34 },
  { id: "subprime", name: "Crise Financeira (2008)", drop: 56 }
];

function generateSmartDiagnosis(enriched, totalCurrentValue) {
  const cats = { CORE: 0, SATELLITE: 0, CRYPTO: 0, OTHER: 0 };
  const sectors = {};
  let etfCount = 0;
  enriched.forEach(p => {
    const cat = p.category === "CORE" ? "CORE" : (p.category === "SATELLITE" || p.category === "SATÉLITE") ? "SATELLITE" : p.category === "CRYPTO" ? "CRYPTO" : "OTHER";
    cats[cat] += p.valAtual;
    const sector = p.setor || "Outros";
    sectors[sector] = (sectors[sector] || 0) + p.valAtual;
    const type = getAssetType(p.ticker, p.mkt);
    if (type === "etf") etfCount++;
  });
  const corePct = (cats.CORE / totalCurrentValue) * 100;
  const satPct = (cats.SATELLITE / totalCurrentValue) * 100;
  const cryPct = (cats.CRYPTO / totalCurrentValue) * 100;
  const forces = [], risks = [], actions = [];
  if (corePct >= 60) forces.push("Base 'Core' sólida."); else risks.push(`Base 'Core' (${corePct.toFixed(0)}%) baixa.`);
  if (satPct > 40) risks.push(`Excesso de 'Satélites' (${satPct.toFixed(0)}%).`);
  if (cryPct > 12) risks.push(`Exposição Cripto (${cryPct.toFixed(0)}%) elevada.`);
  if (corePct < 65) actions.push("Priorizar aportes no CORE (ex: VWCE).");
  return { corePct, satPct, cryPct, forces, risks, actions };
}

function calculatePortfolioStrategicScore(enriched, diagnosis, totalValue) {
  let strategicScore = 80; // Base neutra para um portfólio equilibrado

  // 1. Avaliação de Core (O coração da estratégia)
  if (diagnosis.corePct >= 70) strategicScore += 15;
  else if (diagnosis.corePct >= 50) strategicScore += 5;
  else strategicScore -= 20;

  // 2. Penalização por Cripto Excessiva
  if (diagnosis.cryPct > 15) strategicScore -= 20;
  else if (diagnosis.cryPct > 10) strategicScore -= 5;

  // 3. Penalização por Satélites / Temáticos excessivos
  if (diagnosis.satPct > 40) strategicScore -= 15;

  // 4. Concentração em ativos individuais
  const topAsset = enriched.sort((a,b) => b.valAtual - a.valAtual)[0];
  if (topAsset && (topAsset.valAtual / totalValue) > 0.35) strategicScore -= 10;

  // 5. Penalização por sobreposição (Simples: muitos ETFs)
  const etfCount = enriched.filter(p => getAssetType(p.ticker, p.mkt) === "etf").length;
  if (etfCount > 8) strategicScore -= 10;

  return clamp(strategicScore, 0, 100);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

const getBase64Image = async (path) => {
  try {
    const response = await fetch(path);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (e) { return null; }
};

export async function generatePortfolioReport() {
  const modal = document.getElementById("reportModal"), content = document.getElementById("reportContent"), loader = document.getElementById("reportLoader");
  if (!modal || !content) return;
  modal.classList.remove("hidden"); content.innerHTML = ""; content.appendChild(loader);

  try {
    const [ativosSnap, acoesSnap, stratSnap] = await Promise.all([
      getDocs(collection(db, "ativos")), getDocs(collection(db, "acoesDividendos")), getDoc(doc(db, "config", "strategy"))
    ]);
    const acoesMap = new Map();
    acoesSnap.forEach(d => { const x = d.data(); if (x.ticker) acoesMap.set(String(x.ticker).toUpperCase(), x); });
    const grupos = new Map();
    ativosSnap.forEach(docu => {
      const d = docu.data(), ticker = String(d.ticker || "").toUpperCase(); if (!ticker) return;
      const g = grupos.get(ticker) || { ticker, nome: d.nome || ticker, qtd: 0, investido: 0, realizado: 0, setor: d.setor || "Outros" };
      const q = Number(d.quantidade || 0), p = Number(d.precoCompra || 0);
      if (q > 0) { g.investido += q * p; g.qtd += q; }
      else if (q < 0) { const avg = g.qtd > 0 ? g.investido / g.qtd : 0; g.realizado += (p - avg) * Math.abs(q); g.investido -= Math.abs(q) * avg; g.qtd += q; }
      grupos.set(ticker, g);
    });
    const activePositions = Array.from(grupos.values()).filter(g => g.qtd > 0.0001);
    let totalInvested = 0, totalCurrentValue = 0, totalScoreWeight = 0;
    let componentsSum = { R: 0, V: 0, T: 0, D: 0, E: 0, S: 0 };
    let weightsSum = { R: 0, V: 0, T: 0, D: 0, E: 0, S: 0 };

    const enriched = activePositions.map(p => {
      const mkt = acoesMap.get(p.ticker) || {};
      const precoAtual = Number(mkt.valorStock || mkt.price || 0), valAtual = p.qtd * precoAtual, profit = valAtual - p.investido;
      const scoreObj = calculateLucroMaximoScore(mkt), score = scoreObj.score || 0.5;
      
      totalInvested += p.investido; totalCurrentValue += valAtual; totalScoreWeight += score * valAtual;
      
      Object.keys(componentsSum).forEach(k => { 
        componentsSum[k] += (scoreObj.components[k] || 0) * valAtual; 
        weightsSum[k] += (scoreObj.finalWeights[k] || 0) * valAtual;
      });
      const stratDoc = stratSnap.exists() ? stratSnap.data() : { tickers: {} };
      const dynTickers = stratDoc.tickers || {};
      let category = "NÃO DEFINIDA"; if (dynTickers[p.ticker] && dynTickers[p.ticker].category !== "NONE") category = dynTickers[p.ticker].category;
      return { ...p, precoAtual, valAtual, profit, profitPct: p.investido > 0 ? (profit/p.investido)*100 : 0, score, category: category.toUpperCase(), mkt };
    });
    const globalScore = totalCurrentValue > 0 ? (totalScoreWeight / totalCurrentValue) * 100 : 0;
    const components = {}; 
    Object.keys(componentsSum).forEach(k => { 
      // Só incluímos se o peso desse componente no portfólio for superior a 1%
      if (weightsSum[k] / totalCurrentValue > 0.01) {
        components[k] = totalCurrentValue > 0 ? (componentsSum[k] / totalCurrentValue) * 100 : 0; 
      }
    });
    const diagnosis = generateSmartDiagnosis(enriched, totalCurrentValue);
    const strategicScore = calculatePortfolioStrategicScore(enriched, diagnosis, totalCurrentValue);
    
    // O Score Final é 70% Qualidade dos Ativos + 30% Saúde da Estratégia
    const weightedAssetScore = totalCurrentValue > 0 ? (totalScoreWeight / totalCurrentValue) * 100 : 0;
    const finalHealthScore = (weightedAssetScore * 0.6) + (strategicScore * 0.4);

    const PILLAR_NAMES = { R: "Crescimento (R)", V: "Valuation (V)", T: "Tendência (T)", D: "Dividendos (D)", E: "Eficiência (E)", S: "Solvência (S)" };

    content.innerHTML = renderReportUI({ 
      totalInvested, totalCurrentValue, 
      globalProfit: totalCurrentValue - totalInvested, 
      globalProfitPct: totalInvested > 0 ? ((totalCurrentValue - totalInvested)/totalInvested)*100 : 0, 
      globalScore: finalHealthScore, 
      components, enriched, diagnosis, pillarNames: PILLAR_NAMES,
      originalScore: weightedAssetScore
    });
    initReportCharts(enriched);

    const btnPrint = document.getElementById("btnReportPrint");
    if (btnPrint) {
      const newBtn = btnPrint.cloneNode(true); btnPrint.parentNode.replaceChild(newBtn, btnPrint);
      newBtn.addEventListener("click", () => { exportPortfolioToPDF({ totalInvested, totalCurrentValue, globalProfit: totalCurrentValue - totalInvested, globalProfitPct: totalInvested > 0 ? ((totalCurrentValue - totalInvested)/totalInvested)*100 : 0, globalScore: finalHealthScore, components, enriched, diagnosis, pillarNames: PILLAR_NAMES }); });
    }
  } catch (err) { console.error(err); content.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Erro: ${err.message}</div>`; }
}

function renderReportUI(data) {
  const { totalInvested, totalCurrentValue, globalProfit, globalProfitPct, globalScore, components, enriched } = data;
  const fmtEUR = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  return `
    <style>
      .report-modal-body { color: #1e293b; font-family: 'Inter', sans-serif; }
      .report-header { margin-bottom: 24px; padding: 24px; background: #1e293b; color: white; display: flex; align-items: center; justify-content: space-between; border-radius: 8px 8px 0 0; }
      .report-card { background: white; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 20px; border-radius: 8px; }
      .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
      .kpi-item { padding: 12px; border: 1px solid #f1f5f9; border-radius: 6px; }
      .kpi-v { display: block; font-size: 1.1rem; font-weight: 700; color: #0f172a; }
      .kpi-l { font-size: 0.65rem; color: #64748b; text-transform: uppercase; font-weight: 600; }
      .report-section-title { font-size: 0.9rem; font-weight: 800; text-transform: uppercase; color: #0f172a; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; padding: 10px; background: #f8fafc; color: #475569; font-size: 0.65rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
      td { padding: 10px; border-bottom: 1px solid #f1f5f9; font-size: 0.75rem; }
    </style>
    <div class="report-modal-body">
      <div class="report-header">
        <div>
          <h1 style="margin:0; font-size: 1.8rem; font-weight: 900; letter-spacing: -0.03em;">APPFinance</h1>
          <p style="margin:0; color: rgba(255,255,255,0.7); font-size:0.8rem;">Relatório de Performance Consolidado • ${new Date().toLocaleDateString("pt-PT")}</p>
        </div>
        <img src="icons/icon-192.png" style="width:50px; filter: brightness(0) invert(1);">
      </div>
      <div class="report-card">
        <div class="report-section-title">1. Resumo Executivo</div>
        <div class="kpi-grid">
          <div class="kpi-item"><span class="kpi-l">Património</span><span class="kpi-v">${fmtEUR(totalCurrentValue)}</span></div>
          <div class="kpi-item"><span class="kpi-l">Investido</span><span class="kpi-v">${fmtEUR(totalInvested)}</span></div>
          <div class="kpi-item"><span class="kpi-l">P/L Total</span><span class="kpi-v" style="color:${globalProfit>=0?'#22c55e':'#ef4444'}">${fmtEUR(globalProfit)} (${globalProfitPct.toFixed(1)}%)</span></div>
          <div class="kpi-item" style="border-color:#4f46e5; background: rgba(79, 70, 229, 0.05);">
            <span class="kpi-l" style="color:#4f46e5;">Health Score</span>
            <span class="kpi-v" style="color:#4f46e5;">${data.globalScore.toFixed(0)}/100</span>
          </div>
        </div>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
        <div class="report-card"><div class="report-section-title">2. Diagnóstico de Score</div>
          <div style="display:grid; gap:8px;">${Object.entries(data.components).map(([k,v])=>`<div style="font-size:0.75rem;"><div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span>${data.pillarNames[k]}</span><strong>${v.toFixed(0)}%</strong></div><div style="height:4px; background:#f1f5f9; border-radius:2px;"><div style="width:${v}%; height:100%; background:${v>70?'#22c55e':v>40?'#4f46e5':'#ef4444'};"></div></div></div>`).join('')}</div>
        </div>
        <div class="report-card"><div class="report-section-title">3. Stress Test</div>
          <div style="font-size:0.75rem;">${CRISES_HISTORY.map(c=>`<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>${c.name}</span><span style="color:#ef4444;">-${fmtEUR(totalCurrentValue*c.drop/100)}</span></div>`).join('')}</div>
        </div>
      </div>
      <div class="report-card">
        <div class="report-section-title">4. Alocação e Diversificação</div>
        <div style="display:flex; justify-content:space-around;">
          <div style="width:31%; text-align:center;"><canvas id="chartReportStrategy"></canvas></div>
          <div style="width:31%; text-align:center;"><canvas id="chartReportAssets"></canvas></div>
          <div style="width:31%; text-align:center;"><canvas id="chartReportSectors"></canvas></div>
        </div>
      </div>
      <div class="report-card" style="border-left: 4px solid #4f46e5;"><div class="report-section-title">5. Diagnóstico AI</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; font-size:0.75rem;">
           <div><h4 style="color:#ef4444;margin:0 0 5px;">Riscos</h4><ul>${data.diagnosis.risks.map(r=>`<li>${r}</li>`).join('')}</ul></div>
           <div><h4 style="color:#4f46e5;margin:0 0 5px;">Ações</h4><ul>${data.diagnosis.actions.map(a=>`<li>${a}</li>`).join('')}</ul></div>
        </div>
      </div>
      <div class="report-card"><div class="report-section-title">6. Detalhe do Portfólio</div>
        <table><thead><tr><th>Ativo</th><th>P. Médio</th><th>Atual</th><th>P/L</th><th>Score</th></tr></thead>
          <tbody>${enriched.sort((a,b)=>b.valAtual-a.valAtual).map(p=>`<tr><td><strong>${p.ticker}</strong></td><td>${fmtEUR(p.investido/p.qtd)}</td><td>${fmtEUR(p.precoAtual)}</td><td style="color:${p.profit>=0?'#22c55e':'#ef4444'}">${p.profitPct.toFixed(1)}%</td><td><span style="background:${p.score>0.7?'#22c55e':p.score>0.4?'#4f46e5':'#ef4444'};color:white;padding:2px 5px;border-radius:3px;">${(p.score*100).toFixed(0)}</span></td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

function initReportCharts(enriched) {
  const PALETTE = ["#4F46E5", "#22C55E", "#EAB308", "#EF4444", "#06B6D4", "#F59E0B", "#A855F7"];
  const create = (id, labels, data, colors) => {
    const ctx = document.getElementById(id); if (!ctx) return;
    new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: true, aspectRatio: 1, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, font: { size: 9 } } } } } });
  };
  const strats = new Map(); enriched.forEach(e => strats.set(e.category || "N/D", (strats.get(e.category || "N/D") || 0) + e.valAtual));
  create("chartReportStrategy", Array.from(strats.keys()), Array.from(strats.values()), PALETTE);
  const top7 = enriched.slice(0, 7); create("chartReportAssets", top7.map(e => e.ticker), top7.map(e => e.valAtual), PALETTE);
  const sectors = new Map(); enriched.forEach(e => sectors.set(e.setor || "Outros", (sectors.get(e.setor || "Outros") || 0) + e.valAtual));
  create("chartReportSectors", Array.from(sectors.keys()), Array.from(sectors.values()), PALETTE);
}

async function exportPortfolioToPDF(data) {
  const { totalCurrentValue, totalInvested, globalProfit, globalProfitPct, globalScore, components, enriched, diagnosis } = data;
  const jsPDFLib = window.jspdf ? window.jspdf.jsPDF : (window.jsPDF ? window.jsPDF : null); if (!jsPDFLib) return;
  const doc = new jsPDFLib('p', 'pt', 'a4'), pageWidth = doc.internal.pageSize.getWidth(), pageHeight = doc.internal.pageSize.getHeight(), margin = 40; let currY = 40;
  const fmtEUR = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  const line = (y) => { doc.setDrawColor(230); doc.setLineWidth(0.5); doc.line(margin, y, pageWidth - margin, y); };

  doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 100, 'F');
  const logo = await getBase64Image("icons/icon-192.png");
  if (logo) doc.addImage(logo, 'PNG', margin, 25, 50, 50);
  doc.setFontSize(22); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.text("APPFinance", margin + 65, 60);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(200); doc.text(`Relatório de Performance • ${new Date().toLocaleDateString("pt-PT")}`, margin + 65, 75);

  currY = 130; doc.setFontSize(12); doc.setTextColor(30); doc.setFont("helvetica", "bold"); doc.text("1. Resumo Executivo", margin, currY); currY += 10; line(currY); currY += 25;
  const kpis = [ { l: "PATRIMÓNIO", v: fmtEUR(totalCurrentValue) }, { l: "INVESTIDO", v: fmtEUR(totalInvested) }, { l: "LUCRO TOTAL", v: `${fmtEUR(globalProfit)} (${globalProfitPct.toFixed(1)}%)`, c: globalProfit>=0?[34,197,94]:[239,68,68] }, { l: "HEALTH SCORE", v: `${globalScore.toFixed(0)}/100`, c: [79, 70, 229] } ];
  let kX = margin; kpis.forEach(k => { doc.setFontSize(7); doc.setTextColor(120); doc.text(k.l, kX, currY); if (k.c) doc.setTextColor(k.c[0], k.c[1], k.c[2]); else doc.setTextColor(30); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text(k.v, kX, currY + 12); kX += 130; });

  currY += 60; doc.setFontSize(12); doc.setTextColor(30); doc.text("2. Diagnóstico & Stress Test", margin, currY); currY += 10; line(currY); currY += 25;
  Object.entries(components).forEach(([k, v], i) => { const y = currY + i * 15; doc.setFontSize(8); doc.setTextColor(80); doc.text(`${data.pillarNames[k]}`, margin, y); doc.setFillColor(240); doc.rect(margin + 80, y - 6, 80, 4, 'F'); const clr = v>70?[34,197,94]:v>40?[79,70,229]:[239,68,68]; doc.setFillColor(clr[0], clr[1], clr[2]); doc.rect(margin + 80, y - 6, (v/100)*80, 4, 'F'); doc.text(`${v.toFixed(0)}%`, margin + 165, y); });
  let sY = currY; CRISES_HISTORY.slice(0, 5).forEach((c, i) => { const y = sY + i * 15; doc.setFontSize(8); doc.setTextColor(80); doc.text(c.name, margin + 220, y); doc.setTextColor(239, 68, 68); doc.text(`-${fmtEUR(totalCurrentValue*c.drop/100)}`, pageWidth - margin, y, { align: "right" }); });

  currY += 100; doc.setFontSize(12); doc.setTextColor(30); doc.setFont("helvetica", "bold"); doc.text("3. Alocação Visual", margin, currY); currY += 10; line(currY); currY += 25;
  const cSize = 120;
  const draw = (id, x, y, title, dataMap) => {
    const can = document.getElementById(id); if (can) try { doc.addImage(can.toDataURL("image/png"), 'PNG', x, y, cSize, cSize); } catch(e){}
    doc.setFontSize(7); doc.setTextColor(100); doc.text(title, x + cSize/2, y + cSize + 10, { align: "center" });
    let legY = y + cSize + 25; doc.setFontSize(6);
    Array.from(dataMap.entries()).slice(0, 4).forEach(([lbl, val], i) => {
      const pct = (val/totalCurrentValue*100).toFixed(0); doc.text(`${lbl}: ${pct}%`, x + cSize/2, legY, { align: "center" }); legY += 8;
    });
  };
  const strats = new Map(); enriched.forEach(e => strats.set(e.category || "N/D", (strats.get(e.category || "N/D") || 0) + e.valAtual));
  draw("chartReportStrategy", margin, currY, "Estratégia", strats);
  const assetsMap = new Map(); enriched.slice(0, 4).forEach(e => assetsMap.set(e.ticker, e.valAtual));
  draw("chartReportAssets", margin + 175, currY, "Top Ativos", assetsMap);
  const sectors = new Map(); enriched.forEach(e => sectors.set(e.setor || "Outros", (sectors.get(e.setor || "Outros") || 0) + e.valAtual));
  draw("chartReportSectors", margin + 350, currY, "Setores", sectors);

  currY += cSize + 80; doc.setFontSize(12); doc.setTextColor(79, 70, 229); doc.text("4. Diagnóstico AI", margin, currY); currY += 8; line(currY); currY += 20;
  doc.setFontSize(8); doc.setTextColor(50); diagnosis.risks.slice(0,2).forEach(r => { doc.text(`! ${r}`, margin, currY); currY += 12; });
  diagnosis.actions.slice(0,2).forEach(a => { doc.setFont("helvetica", "bold"); doc.text(`> ${a}`, margin, currY); currY += 12; doc.setFont("helvetica", "normal"); });
  doc.setFontSize(7); doc.setTextColor(180); doc.text("Página 1 de 2 • Relatório APPFinance", pageWidth/2, pageHeight - 20, { align: "center" });

  doc.addPage(); currY = 50; doc.setFontSize(14); doc.setTextColor(30); doc.setFont("helvetica", "bold"); doc.text("5. Detalhe do Portfólio", margin, currY); currY += 10; line(currY); currY += 20;
  const tBody = enriched.sort((a,b)=>b.valAtual-a.valAtual).map(p => [ p.ticker, p.qtd.toFixed(2), fmtEUR(p.investido/p.qtd), fmtEUR(p.precoAtual), fmtEUR(p.valAtual), `${p.profitPct.toFixed(1)}%`, (p.score*100).toFixed(0) ]);
  doc.autoTable({ startY: currY, head: [['Ticker', 'Qtd', 'Médio', 'Atual', 'Valor', 'P/L', 'Score']], body: tBody, margin: { left: margin, right: margin }, styles: { fontSize: 7, cellPadding: 3 }, headStyles: { fillColor: [30, 41, 59] } });
  doc.setFontSize(7); doc.setTextColor(180); doc.text("Página 2 de 2 • Gerado por Antigravity AI", pageWidth/2, pageHeight - 20, { align: "center" });
  doc.save(`Relatorio_APPFinance_${new Date().toISOString().slice(0,10)}.pdf`);
}
