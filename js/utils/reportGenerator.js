// js/utils/reportGenerator.js
import { db } from "../firebase-config.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { calculateLucroMaximoScore, getAssetType } from "./scoring.js";

let chartInstances = {};

const CRISES_HISTORY = [
  { id: "likely_now", name: "Cenário Provável Atual", drop: 13 },
  { id: "geo_mod", name: "Crise Geopolítica Moderada", drop: 11.5 },
  { id: "rus_ukraine", name: "Invasão da Ucrânia (2022)", drop: 24 },
  { id: "covid_crash", name: "Crash COVID-19 (2020)", drop: 34 },
  { id: "subprime", name: "Crise Financeira (2008)", drop: 56 }
];

function generateSmartDiagnosis(enriched, totalValue) {
  const cats = { CORE: 0, SATELLITE: 0, CRYPTO: 0, OTHER: 0 };
  const sectors = {};
  const types = { stock: 0, etf: 0, crypto: 0 };
  
  enriched.forEach(p => {
    const type = getAssetType(p.ticker, p.mkt);
    types[type] += p.valAtual;
    const s = p.setor || "Outros";
    sectors[s] = (sectors[s] || 0) + p.valAtual;

    const isCore = (type === "etf" && ["CORE", "VWCE", "IWDA", "VUSA", "CSPX", "EUNL", "VGWL"].some(k => (p.ticker + p.nome).toUpperCase().includes(k)));
    if (type === "crypto") cats.CRYPTO += p.valAtual;
    else if (isCore) cats.CORE += p.valAtual;
    else cats.SATELLITE += p.valAtual;
  });

  const total = Math.max(1, totalValue);
  const corePct = (cats.CORE / total) * 100;
  const satPct = (cats.SATELLITE / total) * 100;
  const cryPct = (cats.CRYPTO / total) * 100;

  const forces = [], risks = [], actions = [];
  if (corePct >= 60) forces.push("Estratégia CORE robusta.");
  else risks.push(`Base CORE fraca (${corePct.toFixed(0)}%).`);
  if (cryPct > 15) risks.push(`Exposição Cripto excessiva.`);
  if (Object.keys(sectors).length < 5) actions.push("Diversificar mais setores.");

  return { corePct, satPct, cryPct, forces, risks, actions, sectors, types };
}

function calculatePortfolioScoreV2(data) {
  const { assetAvg, diag, totalValue, enriched } = data;
  let structureScore = 70;
  if (diag.corePct >= 60 && diag.corePct <= 80) structureScore = 100;
  else if (diag.corePct >= 40) structureScore = 80;
  const divScore = Math.min(100, Object.keys(diag.sectors).length * 15 + enriched.length * 2);
  const finalScore = (assetAvg * 0.35) + (structureScore * 0.25) + (divScore * 0.20) + (80 * 0.20);
  return {
    total: Math.max(0, Math.min(100, finalScore || 0)),
    breakdown: { assets: assetAvg, structure: structureScore, diversification: divScore, risk: 80 }
  };
}

export async function generatePortfolioReport() {
  const modal = document.getElementById("reportModal"), content = document.getElementById("reportContent"), loader = document.getElementById("reportLoader");
  if (!modal || !content) return;
  modal.classList.remove("hidden"); content.innerHTML = ""; content.appendChild(loader);

  try {
    const [ativosSnap, acoesSnap] = await Promise.all([getDocs(collection(db, "ativos")), getDocs(collection(db, "acoesDividendos"))]);
    const acoesMap = new Map(); acoesSnap.forEach(d => { const x = d.data(); if (x.ticker) acoesMap.set(String(x.ticker).toUpperCase(), x); });
    
    const grupos = new Map();
    ativosSnap.forEach(docu => {
      const d = docu.data(), t = String(d.ticker || "").toUpperCase(); if (!t) return;
      const g = grupos.get(t) || { ticker: t, nome: d.nome || t, qtd: 0, investido: 0, setor: d.setor || "Outros" };
      if (Number(d.quantidade) > 0) { g.investido += Number(d.quantidade) * Number(d.precoCompra); g.qtd += Number(d.quantidade); }
      grupos.set(t, g);
    });

    const activePositions = Array.from(grupos.values()).filter(g => g.qtd > 0.001);
    let totalValue = 0, totalScoreWeight = 0, totalInvested = 0;
    const enriched = activePositions.map(p => {
      const mkt = acoesMap.get(p.ticker) || {};
      const precoAtual = Number(mkt.valorStock || mkt.price || 0), valAtual = p.qtd * precoAtual;
      const scoreObj = calculateLucroMaximoScore(mkt);
      totalValue += valAtual; totalInvested += p.investido;
      totalScoreWeight += (scoreObj.score * 100) * valAtual;
      return { ...p, precoAtual, valAtual, score: scoreObj.score, mkt, category: scoreObj.assetType };
    });

    const assetAvg = totalValue > 0 ? (totalScoreWeight / totalValue) : 0;
    const diag = generateSmartDiagnosis(enriched, totalValue);
    const scoreV2 = calculatePortfolioScoreV2({ assetAvg, diag, totalValue, enriched });

    content.innerHTML = renderReportUI({ totalValue, totalInvested, enriched, diag, scoreV2 });
    initReportCharts(enriched, diag);

    document.getElementById("btnReportPrint").addEventListener("click", () => exportPortfolioToPDF({ totalValue, totalInvested, enriched, diag, scoreV2 }));

  } catch (err) { console.error(err); content.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Erro: ${err.message}</div>`; }
}

function renderReportUI(data) {
  const { totalValue, totalInvested, scoreV2, diag, enriched } = data;
  const fmt = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  const globalProfit = totalValue - totalInvested;
  const globalProfitPct = totalInvested > 0 ? (globalProfit / totalInvested) * 100 : 0;

  return `
    <style>
      .report-v2 { font-family: 'Inter', sans-serif; color: #1e293b; background: #f8fafc; padding: 0; }
      .header-v2 { background: #1e293b; color: white; padding: 25px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center; }
      .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; padding: 20px; }
      .kpi-card { background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center; }
      .kpi-val { font-size: 1.1rem; font-weight: 800; display: block; color: #0f172a; }
      .kpi-lbl { font-size: 0.65rem; color: #64748b; text-transform: uppercase; font-weight: 700; }
      .main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 0 20px 20px 20px; }
      .section-v2 { background: white; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; }
      .title-v2 { font-size: 0.85rem; font-weight: 800; text-transform: uppercase; color: #1e293b; margin-bottom: 15px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
      .chart-container { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; padding: 20px; background: white; margin: 0 20px 20px 20px; border-radius: 12px; border: 1px solid #e2e8f0; }
      .chart-box { height: 260px; text-align: center; }
    </style>
    <div class="report-v2">
      <div class="header-v2">
        <div><h1 style="margin:0; font-size:1.5rem;">APPFinance</h1><p style="margin:0; opacity:0.7; font-size:0.8rem;">Relatório Estratégico de Performance</p></div>
        <img src="icons/icon-192.png" style="width:45px; filter: brightness(0) invert(1);">
      </div>

      <div class="kpi-row">
        <div class="kpi-card"><span class="kpi-lbl">Património</span><span class="kpi-val">${fmt(totalValue)}</span></div>
        <div class="kpi-card"><span class="kpi-lbl">Investido</span><span class="kpi-val">${fmt(totalInvested)}</span></div>
        <div class="kpi-card"><span class="kpi-lbl">Lucro/Prejuízo</span><span class="kpi-val" style="color:${globalProfit>=0?'#22c55e':'#ef4444'}">${fmt(globalProfit)} (${globalProfitPct.toFixed(1)}%)</span></div>
        <div class="kpi-card" style="border-left: 4px solid #4f46e5;"><span class="kpi-lbl" style="color:#4f46e5;">Health Score</span><span class="kpi-val" style="color:#4f46e5;">${scoreV2.total.toFixed(0)}/100</span></div>
      </div>

      <div class="chart-container">
        <div class="chart-box"><canvas id="chartStrat"></canvas><div class="kpi-lbl">Estratégia</div></div>
        <div class="chart-box"><canvas id="chartAssets"></canvas><div class="kpi-lbl">Principais Ativos</div></div>
        <div class="chart-box"><canvas id="chartSectors"></canvas><div class="kpi-lbl">Setores</div></div>
      </div>

      <div class="main-grid">
        <div class="section-v2">
          <div class="title-v2">Diagnóstico de Score V2</div>
          <div style="display:grid; gap:12px;">
            ${Object.entries(scoreV2.breakdown).map(([k,v]) => `
              <div>
                <div style="display:flex; justify-content:space-between; font-size:0.7rem; font-weight:700; margin-bottom:3px;">
                  <span style="text-transform:uppercase;">${k}</span><span>${v.toFixed(0)}%</span>
                </div>
                <div style="height:6px; background:#f1f5f9; border-radius:3px; overflow:hidden;">
                  <div style="width:${v}%; height:100%; background:#4f46e5;"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="section-v2">
          <div class="title-v2">Stress Test (Cenários)</div>
          <div style="font-size:0.75rem;">
            ${CRISES_HISTORY.map(c => `
              <div style="display:flex; justify-content:space-between; margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid #f8fafc;">
                <span>${c.name}</span><span style="color:#ef4444; font-weight:700;">-${fmt(totalValue * c.drop / 100)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="section-v2" style="margin: 0 20px 20px 20px;">
        <div class="title-v2">Detalhamento do Portfólio</div>
        <table style="width:100%; border-collapse:collapse; font-size:0.7rem;">
          <thead><tr style="text-align:left; color:#64748b; background:#f8fafc;"><th style="padding:8px;">Ativo</th><th>Tipo</th><th>Investido</th><th>Atual</th><th>Lucro</th><th>Score</th></tr></thead>
          <tbody>
            ${enriched.sort((a,b)=>b.valAtual-a.valAtual).map(p => `
              <tr style="border-top:1px solid #f1f5f9;">
                <td style="padding:8px;"><strong>${p.ticker}</strong><br><span style="font-size:0.6rem; color:#94a3b8;">${p.nome}</span></td>
                <td><span style="padding:2px 6px; background:#f1f5f9; border-radius:4px; font-size:0.6rem; font-weight:700;">${p.category.toUpperCase()}</span></td>
                <td>${fmt(p.investido)}</td>
                <td>${fmt(p.valAtual)}</td>
                <td style="color:${(p.valAtual-p.investido)>=0?'#22c55e':'#ef4444'}">${(((p.valAtual-p.investido)/p.investido)*100).toFixed(1)}%</td>
                <td><div style="font-weight:700;">${(p.score*100).toFixed(0)}</div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function initReportCharts(enriched, diag) {
  const fmt = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  const PALETTE = ["#4F46E5", "#22C55E", "#EAB308", "#EF4444", "#06B6D4", "#F59E0B", "#A855F7"];
  
  const config = (labels, data) => {
    const total = data.reduce((a, b) => a + b, 0);
    const enrichedLabels = labels.map((l, i) => {
      const val = data[i];
      const pct = total > 0 ? (val / total * 100).toFixed(1) : 0;
      return `${l}: ${pct}% (${fmt(val)})`;
    });

    return { 
      type: 'doughnut', 
      data: { labels: enrichedLabels, datasets: [{ data, backgroundColor: PALETTE, borderWidth: 0 }] }, 
      options: { 
        responsive: true,
        maintainAspectRatio: true,
        cutout: '70%', 
        plugins: { 
          legend: { 
            display: true, 
            position: 'bottom',
            labels: { boxWidth: 10, font: { size: 9, weight: 'bold' }, padding: 12 }
          } 
        } 
      } 
    };
  };

  if (chartInstances.strat) chartInstances.strat.destroy();
  if (chartInstances.assets) chartInstances.assets.destroy();
  if (chartInstances.sectors) chartInstances.sectors.destroy();

  chartInstances.strat = new Chart(document.getElementById('chartStrat'), config(['CORE', 'SATELLITE', 'CRYPTO'], [diag.corePct, diag.satPct, diag.cryPct]));
  
  const topA = enriched.sort((a,b)=>b.valAtual-a.valAtual).slice(0,5);
  chartInstances.assets = new Chart(document.getElementById('chartAssets'), config(topA.map(a=>a.ticker), topA.map(a=>a.valAtual)));
  
  const sKeys = Object.keys(diag.sectors).sort((a,b)=>diag.sectors[b]-diag.sectors[a]).slice(0,5);
  chartInstances.sectors = new Chart(document.getElementById('chartSectors'), config(sKeys, sKeys.map(k=>diag.sectors[k])));
}

async function exportPortfolioToPDF(data) {
  const { totalValue, totalInvested, scoreV2, diag, enriched } = data;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'pt', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let currY = 0;

  const fmtEUR = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  const line = (y) => { doc.setDrawColor(241, 245, 249); doc.setLineWidth(1); doc.line(margin, y, pageWidth - margin, y); };

  // --- PÁGINA 1: DASHBOARD EXECUTIVO ---
  // Cabeçalho Navy
  doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 100, 'F');
  const logoB64 = await getBase64Image("icons/icon-192.png");
  if (logoB64) doc.addImage(logoB64, 'PNG', margin, 25, 50, 50);
  doc.setFontSize(22); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.text("APPFinance", margin + 65, 55);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(200); doc.text(`Relatório de Performance Estratégica • ${new Date().toLocaleDateString("pt-PT")}`, margin + 65, 75);

  // 1. Resumo Executivo
  currY = 130; doc.setFontSize(12); doc.setTextColor(30); doc.setFont("helvetica", "bold"); doc.text("1. Resumo Executivo", margin, currY); currY += 10; line(currY); currY += 25;
  const kpis = [
    { l: "PATRIMÓNIO", v: fmtEUR(totalValue) },
    { l: "INVESTIDO", v: fmtEUR(totalInvested) },
    { l: "LUCRO TOTAL", v: `${fmtEUR(totalValue-totalInvested)} (${(((totalValue-totalInvested)/totalInvested)*100).toFixed(1)}%)`, c: (totalValue-totalInvested)>=0?[34,197,94]:[239,68,68] },
    { l: "HEALTH SCORE", v: `${scoreV2.total.toFixed(0)}/100`, c: scoreV2.total >= 70 ? [34, 197, 94] : (scoreV2.total < 40 ? [239, 68, 68] : [79, 70, 229]) }
  ];
  let kX = margin; kpis.forEach(k => { doc.setFontSize(7); doc.setTextColor(120); doc.text(k.l, kX, currY); if (k.c) doc.setTextColor(k.c[0], k.c[1], k.c[2]); else doc.setTextColor(30); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text(k.v, kX, currY + 12); kX += 130; });

  // 2. Diagnóstico & Stress Test
  currY += 60; doc.setFontSize(12); doc.setTextColor(30); doc.text("2. Diagnóstico & Stress Test", margin, currY); currY += 10; line(currY); currY += 25;
  
  // Coluna Score Breakdown
  Object.entries(scoreV2.breakdown).forEach(([k, v], i) => { 
    const y = currY + i * 15; doc.setFontSize(8); doc.setTextColor(80); doc.text(k.toUpperCase(), margin, y); 
    doc.setFillColor(240); doc.rect(margin + 80, y - 6, 80, 4, 'F'); doc.setFillColor(79, 70, 229); doc.rect(margin + 80, y - 6, (v/100)*80, 4, 'F'); 
    doc.text(`${v.toFixed(0)}%`, margin + 165, y); 
  });
  
  // Coluna Stress Test
  let sY = currY; CRISES_HISTORY.forEach((c, i) => { 
    const y = sY + i * 15; doc.setFontSize(8); doc.setTextColor(80); doc.text(c.name, margin + 220, y); 
    doc.setTextColor(239, 68, 68); doc.text(`-${fmtEUR(totalValue*c.drop/100)}`, pageWidth - margin, y, { align: "right" }); 
  });

  // 3. Alocação Visual (Gráficos Reais)
  currY += 100; doc.setFontSize(12); doc.setTextColor(30); doc.setFont("helvetica", "bold"); doc.text("3. Alocação Visual", margin, currY); currY += 10; line(currY); currY += 10;
  
  const imgW = 165, imgH = 220; // Ajustado para incluir legendas sem distorcer
  if (chartInstances.strat) doc.addImage(chartInstances.strat.toBase64Image(), 'PNG', margin, currY, imgW, imgH);
  if (chartInstances.assets) doc.addImage(chartInstances.assets.toBase64Image(), 'PNG', margin + 175, currY, imgW, imgH);
  if (chartInstances.sectors) doc.addImage(chartInstances.sectors.toBase64Image(), 'PNG', margin + 350, currY, imgW, imgH);

  // --- PÁGINA 2: DETALHAMENTO ---
  doc.addPage(); 
  doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setFontSize(10); doc.setTextColor(255); doc.text("4. Detalhamento do Portfólio", margin, 25);

  doc.autoTable({
    startY: 60, margin: { left: margin, right: margin },
    head: [['Ativo', 'Tipo', 'Investido', 'Atual', 'Lucro', 'Score']],
    body: enriched.sort((a,b)=>b.valAtual-a.valAtual).map(p => [
      p.ticker, p.category.toUpperCase(), fmtEUR(p.investido), fmtEUR(p.valAtual), 
      `${(((p.valAtual-p.investido)/p.investido)*100).toFixed(1)}%`, (p.score*100).toFixed(0)
    ]),
    theme: 'striped', 
    headStyles: { fillColor: [30, 41, 59] }, 
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'center' } },
    didParseCell: function(data) {
      if (data.section === 'body') {
        if (data.column.index === 4) {
          const val = parseFloat(data.cell.raw);
          if (val > 0) data.cell.styles.textColor = [34, 197, 94];
          else if (val < 0) data.cell.styles.textColor = [239, 68, 68];
        }
        if (data.column.index === 5) {
          const val = parseInt(data.cell.raw);
          if (val >= 70) data.cell.styles.textColor = [34, 197, 94];
          else if (val < 40) data.cell.styles.textColor = [239, 68, 68];
          else data.cell.styles.textColor = [234, 179, 8];
        }
      }
    }
  });

  doc.setFontSize(7); doc.setTextColor(150); doc.text("APPFinance Portfolio Report • Este documento é gerado dinamicamente via algoritmos de IA.", margin, doc.internal.pageSize.getHeight() - 20);

  doc.save(`APPFinance_Report_V2_${new Date().toISOString().slice(0,10)}.pdf`);
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
