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

  const forces = [];
  const risks = [];
  const actions = [];

  // Avaliação de Estrutura
  if (corePct >= 60) forces.push("Base 'Core' sólida e bem estruturada.");
  else risks.push(`A base 'Core' (${corePct.toFixed(1)}%) está abaixo do ideal (60-80%).`);

  if (satPct > 40) risks.push(`Exposição elevada a ativos 'Satélite' (${satPct.toFixed(1)}%), aumentando a volatilidade.`);
  
  if (cryPct > 15) risks.push(`Peso excessivo em Criptoativos (${cryPct.toFixed(1)}%). Recomenda-se teto de 10%.`);

  // Avaliação de Concentração
  Object.entries(sectors).forEach(([s, val]) => {
    const p = (val / totalCurrentValue) * 100;
    if (p > 30) risks.push(`Concentração elevada no setor ${s} (${p.toFixed(1)}%).`);
  });

  if (etfCount > 5 && totalCurrentValue < 10000) {
    actions.push("Simplificar: tens muitos ETFs para o volume atual. Considera consolidar temáticos.");
  }

  // Ações Sugeridas
  if (corePct < 65) actions.push("Priorizar próximos aportes no CORE (ex: VWCE) para equilibrar o risco.");
  if (satPct > 35) actions.push("Evitar novos ativos temáticos; focar em consolidar os existentes.");
  if (cryPct > 10) actions.push("Rebalancear lucros de Cripto para ativos Core.");

  return { corePct, satPct, cryPct, forces, risks, actions };
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
  const modal = document.getElementById("reportModal");
  const content = document.getElementById("reportContent");
  const loader = document.getElementById("reportLoader");

  if (!modal || !content) return;

  modal.classList.remove("hidden");
  content.innerHTML = "";
  content.appendChild(loader);

  try {
    const [ativosSnap, acoesSnap, stratSnap] = await Promise.all([
      getDocs(collection(db, "ativos")),
      getDocs(collection(db, "acoesDividendos")),
      getDoc(doc(db, "config", "strategy"))
    ]);

    const acoesMap = new Map();
    acoesSnap.forEach(d => {
      const x = d.data();
      if (x.ticker) acoesMap.set(String(x.ticker).toUpperCase(), x);
    });

    const grupos = new Map();
    ativosSnap.forEach(docu => {
      const d = docu.data();
      const ticker = String(d.ticker || "").toUpperCase();
      if (!ticker) return;

      const g = grupos.get(ticker) || {
        ticker, nome: d.nome || ticker, qtd: 0, investido: 0, realizado: 0, setor: d.setor || "Outros"
      };

      const q = Number(d.quantidade || 0);
      const p = Number(d.precoCompra || 0);

      if (q > 0) { g.investido += q * p; g.qtd += q; }
      else if (q < 0) {
        const avg = g.qtd > 0 ? g.investido / g.qtd : 0;
        g.realizado += (p - avg) * Math.abs(q);
        g.investido -= Math.abs(q) * avg;
        g.qtd += q;
      }
      grupos.set(ticker, g);
    });

    const activePositions = Array.from(grupos.values()).filter(g => g.qtd > 0.0001);
    
    let totalInvested = 0, totalCurrentValue = 0, totalScoreWeight = 0;
    let componentsSum = { R: 0, V: 0, T: 0, D: 0, E: 0, S: 0 };

    const enriched = activePositions.map(p => {
      const mkt = acoesMap.get(p.ticker) || {};
      const precoAtual = Number(mkt.valorStock || mkt.price || 0);
      const valAtual = p.qtd * precoAtual;
      const profit = valAtual - p.investido;
      const scoreObj = calculateLucroMaximoScore(mkt);
      const score = scoreObj.score || 0.5;

      totalInvested += p.investido;
      totalCurrentValue += valAtual;
      totalScoreWeight += score * valAtual;

      Object.keys(componentsSum).forEach(k => {
        componentsSum[k] += (scoreObj.components[k] || 0) * valAtual;
      });

      const stratDoc = stratSnap.exists() ? stratSnap.data() : { tickers: {} };
      const dynTickers = stratDoc.tickers || {};
      let category = "NÃO DEFINIDA";
      if (dynTickers[p.ticker] && dynTickers[p.ticker].category !== "NONE") {
        category = dynTickers[p.ticker].category;
      }

      return {
        ...p, precoAtual, valAtual, profit, profitPct: p.investido > 0 ? (profit/p.investido)*100 : 0,
        score, category: category.toUpperCase()
      };
    });

    const globalScore = totalCurrentValue > 0 ? (totalScoreWeight / totalCurrentValue) * 100 : 0;
    const components = {};
    Object.keys(componentsSum).forEach(k => {
      components[k] = totalCurrentValue > 0 ? (componentsSum[k] / totalCurrentValue) * 100 : 0;
    });

    const diagnosis = generateSmartDiagnosis(enriched, totalCurrentValue);

    content.innerHTML = renderReportUI({
      totalInvested, totalCurrentValue, 
      globalProfit: totalCurrentValue - totalInvested,
      globalProfitPct: totalInvested > 0 ? ((totalCurrentValue - totalInvested)/totalInvested)*100 : 0,
      globalScore, components, enriched,
      diagnosis
    });

    initReportCharts(enriched);

    const btnPrint = document.getElementById("btnReportPrint");
    if (btnPrint) {
      const newBtn = btnPrint.cloneNode(true);
      btnPrint.parentNode.replaceChild(newBtn, btnPrint);
      newBtn.addEventListener("click", () => {
        exportPortfolioToPDF({
          totalInvested, totalCurrentValue, 
          globalProfit: totalCurrentValue - totalInvested,
          globalProfitPct: totalInvested > 0 ? ((totalCurrentValue - totalInvested)/totalInvested)*100 : 0,
          globalScore, components, enriched,
          diagnosis
        });
      });
    }

  } catch (err) {
    console.error(err);
    content.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Erro: ${err.message}</div>`;
  }
}

function renderReportUI(data) {
  const { totalInvested, totalCurrentValue, globalProfit, globalProfitPct, globalScore, components, enriched } = data;
  const fmtEUR = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  
  return `
    <style>
      .report-modal-body { color: #1e293b; font-family: 'Inter', -apple-system, sans-serif; line-height: 1.5; }
      .report-header { 
        margin-bottom: 32px; 
        padding: 32px; 
        background: #f8fafc; 
        border-radius: 12px; 
        border-left: 6px solid #1e293b;
        display: flex; 
        align-items: center; 
        justify-content: space-between;
      }
      .report-card { background: white; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      .report-section-title { 
        font-size: 1rem; 
        font-weight: 800; 
        color: #0f172a; 
        text-transform: uppercase; 
        letter-spacing: 0.05em;
        margin-bottom: 20px; 
        display: flex; 
        align-items: center; 
        gap: 10px; 
      }
      .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 20px; }
      .kpi-item { padding: 16px; border-radius: 8px; border: 1px solid #f1f5f9; background: #ffffff; }
      .kpi-v { display: block; font-size: 1.1rem; font-weight: 700; color: #0f172a; }
      .kpi-l { font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.025em; }
      
      .report-footer-legal { 
        margin-top: 40px; 
        padding: 24px; 
        border-top: 1px solid #e2e8f0; 
        font-size: 0.75rem; 
        color: #94a3b8; 
        text-align: center;
        font-style: italic;
      }
      
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; padding: 12px; background: #f8fafc; color: #475569; font-size: 0.7rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
      td { padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 0.8rem; }
    </style>

    <div class="report-modal-body">
      <div class="report-header">
        <div>
          <span style="background: #1e293b; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;">Private Report</span>
          <h1 style="margin: 8px 0 0; font-size: 2rem; font-weight: 800; color: #0f172a; letter-spacing: -0.02em;">Investment Outlook</h1>
          <p style="margin: 4px 0 0; color:#64748b; font-size:0.9rem;">Consolidado de Performance e Alocação Estratégica • ${new Date().toLocaleDateString("pt-PT")}</p>
        </div>
        <img src="icons/icon-192.png" alt="Logo" style="width: 70px; height: 70px; filter: grayscale(0.2);">
      </div>

      <div class="report-card">
        <div class="report-section-title"><i class="fas fa-chart-pie"></i> 1. Resumo Executivo</div>
        <div class="kpi-grid">
          <div class="kpi-item"><span class="kpi-l">Património Atual</span><span class="kpi-v">${fmtEUR(totalCurrentValue)}</span></div>
          <div class="kpi-item"><span class="kpi-l">Capital Investido</span><span class="kpi-v">${fmtEUR(totalInvested)}</span></div>
          <div class="kpi-item"><span class="kpi-l">P/L Total</span><span class="kpi-v" style="color:${globalProfit>=0?'#22c55e':'#ef4444'}">${fmtEUR(globalProfit)} (${globalProfitPct.toFixed(1)}%)</span></div>
          <div class="kpi-item" style="border-color:#4f46e5; background: rgba(79, 70, 229, 0.03);"><span class="kpi-l" style="color:#4f46e5;">Health Score</span><span class="kpi-v" style="color:#4f46e5;">${globalScore.toFixed(0)}/100</span></div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
        <div class="report-card">
          <div class="report-section-title"><i class="fas fa-shield-alt"></i> 2. Diagnóstico Fundamental</div>
          <div style="display: grid; gap: 12px; margin-top: 10px;">
            ${Object.entries(components).map(([k, v]) => `
              <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                  <span>Pilar ${k}</span><strong>${v.toFixed(0)}%</strong>
                </div>
                <div style="height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden;">
                  <div style="width: ${v}%; height: 100%; background: ${v > 70 ? '#22c55e' : v > 40 ? '#4f46e5' : '#ef4444'};"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="report-card">
          <div class="report-section-title"><i class="fas fa-layer-group"></i> 3. Divisão Estratégica</div>
          <div style="height: 220px; display: flex; align-items: center; justify-content: center;">
            <canvas id="chartReportStrategy"></canvas>
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
        <div class="report-card">
          <div class="report-section-title"><i class="fas fa-list-ul"></i> 4. Top Ativos</div>
          <div style="height: 220px;"><canvas id="chartReportAssets"></canvas></div>
        </div>
        <div class="report-card">
          <div class="report-section-title"><i class="fas fa-globe"></i> 5. Diversificação Setorial</div>
          <div style="height: 220px;"><canvas id="chartReportSectors"></canvas></div>
        </div>
      </div>

      <div class="report-card" style="border-left: 4px solid #4f46e5; background: #fdfdff;">
        <div class="report-section-title"><i class="fas fa-brain"></i> 7. Diagnóstico Estratégico AI</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">
          <div>
            <h4 style="color:#22c55e; font-size: 0.85rem; margin-bottom: 8px;"><i class="fas fa-check-circle"></i> Pontos Fortes</h4>
            <ul style="font-size: 0.8rem; padding-left: 18px; margin: 0; color: #475569;">
              ${data.diagnosis.forces.map(f => `<li>${f}</li>`).join('')}
            </ul>
          </div>
          <div>
            <h4 style="color:#ef4444; font-size: 0.85rem; margin-bottom: 8px;"><i class="fas fa-exclamation-triangle"></i> Riscos Detetados</h4>
            <ul style="font-size: 0.8rem; padding-left: 18px; margin: 0; color: #475569;">
              ${data.diagnosis.risks.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
          <div>
            <h4 style="color:#4f46e5; font-size: 0.85rem; margin-bottom: 8px;"><i class="fas fa-lightbulb"></i> Ações Recomendadas</h4>
            <ul style="font-size: 0.8rem; padding-left: 18px; margin: 0; color: #475569;">
              ${data.diagnosis.actions.map(a => `<li style="font-weight:600;">${a}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>

      <div class="report-card">
        <div class="report-section-title"><i class="fas fa-table"></i> 8. Detalhamento do Portfólio</div>
        <div style="overflow-x: auto;">
          <table>
            <thead><tr><th>Ativo</th><th>Qtd</th><th>P. Médio</th><th>Atual</th><th>Lucro/Prej.</th><th>Score</th></tr></thead>
            <tbody>
              ${enriched.sort((a,b)=>b.valAtual-a.valAtual).map(p => `
                <tr>
                  <td><strong>${p.ticker}</strong><br><small style="color:#64748b">${p.nome.substring(0,25)}</small></td>
                  <td>${p.qtd.toFixed(4)}</td>
                  <td>${fmtEUR(p.investido/p.qtd)}</td>
                  <td>${fmtEUR(p.precoAtual)}</td>
                  <td style="color:${p.profit>=0?'#22c55e':'#ef4444'}"><strong>${fmtEUR(p.profit)}</strong><br><small>(${p.profitPct.toFixed(1)}%)</small></td>
                  <td style="text-align:center;"><span class="badge-score" style="background:${p.score>0.7?'#22c55e':p.score>0.4?'#4f46e5':'#ef4444'};">${(p.score*100).toFixed(0)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="report-footer-legal">
        Este relatório é gerado automaticamente para fins informativos. Performance passada não é garantia de resultados futuros. 
        Mantenha a sua estratégia de longo prazo e consulte um consultor financeiro se necessário.
      </div>
    </div>
  `;
}

function initReportCharts(enriched) {
  const PALETTE = ["#4F46E5", "#22C55E", "#EAB308", "#EF4444", "#06B6D4", "#F59E0B", "#A855F7"];
  const totalVal = enriched.reduce((s, e) => s + e.valAtual, 0);
  const fmt = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  
  const createChart = (id, labels, data, colors) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: true, aspectRatio: 1,
        plugins: { 
          legend: { 
            display: true,
            position: 'bottom', 
            labels: { boxWidth: 8, font: { size: 9 }, padding: 10 } 
          } 
        }
      }
    });
  };

  const strats = new Map();
  enriched.forEach(e => strats.set(e.category || "N/D", (strats.get(e.category || "N/D") || 0) + e.valAtual));
  const STRAT_COLORS = { "CORE": "#4F46E5", "SATELLITE": "#F59E0B", "SATÉLITE": "#F59E0B", "N/D": "#94A3B8" };
  const stratLabels = Array.from(strats.keys()).map(k => {
    const v = strats.get(k);
    const p = totalVal > 0 ? (v / totalVal * 100).toFixed(1) : 0;
    return `${k}: ${fmt(v)} (${p}%)`;
  });
  createChart("chartReportStrategy", stratLabels, Array.from(strats.values()), Array.from(strats.keys()).map(k => STRAT_COLORS[k] || "#94A3B8"));

  const top7 = enriched.slice(0, 7);
  const assetLabels = top7.map(e => {
    const p = totalVal > 0 ? (e.valAtual / totalVal * 100).toFixed(1) : 0;
    return `${e.ticker}: ${fmt(e.valAtual)} (${p}%)`;
  });
  createChart("chartReportAssets", assetLabels, top7.map(e => e.valAtual), PALETTE);

  const sectors = new Map();
  enriched.forEach(e => sectors.set(e.setor || "Outros", (sectors.get(e.setor || "Outros") || 0) + e.valAtual));
  const sectorLabels = Array.from(sectors.keys()).map(k => {
    const v = sectors.get(k);
    const p = totalVal > 0 ? (v / totalVal * 100).toFixed(1) : 0;
    return `${k}: ${fmt(v)} (${p}%)`;
  });
  createChart("chartReportSectors", sectorLabels, Array.from(sectors.values()), PALETTE);
}

async function exportPortfolioToPDF(data) {
  const { totalCurrentValue, totalInvested, globalProfit, globalProfitPct, globalScore, components, enriched } = data;
  const jsPDFLib = window.jspdf ? window.jspdf.jsPDF : (window.jsPDF ? window.jsPDF : null);
  if (!jsPDFLib) { alert("Biblioteca jsPDF não encontrada!"); return; }

  const doc = new jsPDFLib('p', 'pt', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let currY = 60;

  const fmtEUR = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  const drawLine = (y) => { doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5); doc.line(margin, y, pageWidth - margin, y); };

  // Cabeçalho Premium
  doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 120, 'F');
  
  const logoB64 = await getBase64Image("icons/icon-192.png");
  if (logoB64) {
    doc.addImage(logoB64, 'PNG', margin, 35, 50, 50);
  }

  doc.setFontSize(24); doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold");
  doc.text("Investment Outlook", margin + 70, 65);
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(200);
  doc.text(`Análise Consolidada de Portfólio • ${new Date().toLocaleDateString("pt-PT")}`, margin + 70, 82);
  
  currY = 160;

  doc.setFontSize(14); doc.setTextColor(30); doc.setFont("helvetica", "bold");
  doc.text("1. Resumo Executivo", margin, currY);
  currY += 12; drawLine(currY); currY += 25;

  const kpis = [
    { l: "Património", v: fmtEUR(totalCurrentValue) },
    { l: "Investido", v: fmtEUR(totalInvested) },
    { l: "Lucro/Prejuízo", v: `${fmtEUR(globalProfit)} (${globalProfitPct.toFixed(1)}%)`, c: globalProfit >= 0 ? [34, 197, 94] : [239, 68, 68] },
    { l: "Health Score", v: `${globalScore.toFixed(0)}/100`, c: [79, 70, 229] }
  ];
  let kX = margin;
  kpis.forEach(k => {
    doc.setFontSize(8); doc.setTextColor(100); doc.setFont("helvetica", "normal"); doc.text(k.l, kX, currY);
    if (k.c) doc.setTextColor(k.c[0], k.c[1], k.c[2]); else doc.setTextColor(30);
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text(k.v, kX, currY + 14);
    kX += (pageWidth - 2 * margin) / 4;
  });
  currY += 60;

  doc.setTextColor(30); doc.setFontSize(14); doc.text("2. Diagnóstico de Score", margin, currY);
  currY += 12; drawLine(currY); currY += 25;
  Object.entries(components).forEach(([k, v], i) => {
    const x = margin + (i % 2) * 260; const y = currY + Math.floor(i / 2) * 35;
    doc.setFontSize(9); doc.setTextColor(80); doc.setFont("helvetica", "normal");
    doc.text(`Pilar ${k}`, x, y);
    doc.setFillColor(245, 247, 250); doc.rect(x, y + 6, 200, 6, 'F');
    const clr = v > 70 ? [34, 197, 94] : v > 40 ? [79, 70, 229] : [239, 68, 68];
    doc.setFillColor(clr[0], clr[1], clr[2]); doc.rect(x, y + 6, (v / 100) * 200, 6, 'F');
    doc.setFontSize(8); doc.text(`${v.toFixed(0)}%`, x + 210, y + 11);
  });
  currY += 120;

  doc.setFontSize(14); doc.text("3. Stress Test (Simulação de Crises)", margin, currY);
  currY += 12; drawLine(currY); currY += 25;
  CRISES_HISTORY.forEach((c, i) => {
    const y = currY + i * 22;
    doc.setFontSize(9); doc.setTextColor(50); doc.text(`> ${c.name}`, margin, y);
    doc.setTextColor(150); doc.text(`${c.drop}%`, margin + 200, y);
    doc.setTextColor(239, 68, 68); doc.setFont("helvetica", "bold");
    doc.text(`-${fmtEUR(totalCurrentValue * c.drop / 100)}`, pageWidth - margin, y, { align: "right" });
    doc.setFont("helvetica", "normal");
  });

  // --- DIAGNÓSTICO ESTRATÉGICO NO PDF ---
  currY += 130;
  doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(79, 70, 229);
  doc.text("4. Diagnóstico Estratégico AI", margin, currY);
  currY += 10; drawLine(currY); currY += 25;
  
  doc.setFontSize(9); doc.setTextColor(30); doc.setFont("helvetica", "bold");
  doc.text("Riscos e Sobreposições:", margin, currY);
  doc.setFont("helvetica", "normal"); doc.setTextColor(80);
  data.diagnosis.risks.forEach(r => { doc.text(`- ${r}`, margin + 10, currY + 12); currY += 12; });

  currY += 15;
  doc.setFontSize(9); doc.setTextColor(79, 70, 229); doc.setFont("helvetica", "bold");
  doc.text("Plano de Ação Sugerido:", margin, currY);
  doc.setFont("helvetica", "bold"); doc.setTextColor(30);
  data.diagnosis.actions.forEach(a => { doc.text(`> ${a}`, margin + 10, currY + 12); currY += 12; });

  // --- RODAPÉ LEGAL ---
  doc.setFontSize(7); doc.setTextColor(180);
  const legalText = "IMPORTANTE: Este documento é estritamente confidencial e destinado a fins informativos. O investimento em mercados financeiros envolve riscos. Performance passada não garante resultados futuros.";
  doc.text(legalText, pageWidth / 2, pageHeight - 35, { align: "center" });
  doc.text(`Página 1 de 3 • APPFinance Intelligence System`, pageWidth / 2, pageHeight - 20, { align: "center" });

  // --- PÁGINA 2: Gráficos ---
  doc.addPage(); currY = 60;
  doc.setFontSize(16); doc.setTextColor(30); doc.setFont("helvetica", "bold");
  doc.text("4. Análise Visual de Diversificação", margin, currY);
  currY += 12; drawLine(currY); currY += 40;

  const drawWithLegend = (id, title, x, y, size, dataMap, colors) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    doc.setFontSize(11); doc.setTextColor(50); doc.text(title, x, y - 10);
    doc.addImage(canvas.toDataURL("image/png", 1.0), 'PNG', x, y, size, size);
    
    let legY = y + 20;
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    Array.from(dataMap.entries()).slice(0, 10).forEach(([label, value], i) => {
      const pct = (value / totalCurrentValue * 100).toFixed(1);
      const c = colors[label] || colors[i % 7] || "#999";
      doc.setFillColor(c); doc.rect(x + size + 20, legY - 6, 6, 6, 'F');
      doc.setTextColor(60); doc.text(`${label}: ${pct}%`, x + size + 32, legY);
      legY += 14;
    });
  };

  const strats = new Map();
  enriched.forEach(e => strats.set(e.category, (strats.get(e.category) || 0) + e.valAtual));
  const S_COLORS = { "CORE": "#4F46E5", "SATELLITE": "#F59E0B", "SATÉLITE": "#F59E0B", "NÃO DEFINIDA": "#94A3B8" };
  drawWithLegend("chartReportStrategy", "Divisão Estratégica", margin, currY, 160, strats, S_COLORS);
  
  currY += 220;
  const assetsMap = new Map();
  enriched.slice(0, 10).forEach(e => assetsMap.set(e.ticker, e.valAtual));
  const PALETTE = ["#4F46E5", "#22C55E", "#EAB308", "#EF4444", "#06B6D4", "#F59E0B", "#A855F7"];
  drawWithLegend("chartReportAssets", "Top 10 Ativos", margin, currY, 160, assetsMap, PALETTE);
  
  doc.setFontSize(8); doc.setTextColor(180); doc.text("Página 2 de 3", pageWidth/2, pageHeight - 20, { align: "center" });

  // --- PÁGINA 3: Setores e Tabela ---
  doc.addPage(); currY = 60;
  const sectors = new Map();
  enriched.forEach(e => sectors.set(e.setor || "Outros", (sectors.get(e.setor || "Outros") || 0) + e.valAtual));
  drawWithLegend("chartReportSectors", "Diversificação por Setor", margin, currY, 160, sectors, PALETTE);
  
  currY += 220;
  doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(30);
  doc.text("5. Detalhamento das Posições", margin, currY);
  currY += 12; drawLine(currY); currY += 15;

  const tD = enriched.sort((a,b)=>b.valAtual-a.valAtual).map(p => [
    p.ticker, p.qtd.toFixed(2), fmtEUR(p.investido/p.qtd), fmtEUR(p.precoAtual), fmtEUR(p.valAtual),
    { content: `${p.profitPct.toFixed(1)}%`, styles: { textColor: p.profit>=0 ? [34, 197, 94] : [239, 68, 68] } },
    (p.score*100).toFixed(0)
  ]);

  doc.autoTable({
    startY: currY,
    head: [['Ticker', 'Qtd', 'Médio', 'Atual', 'Valor', 'P/L', 'Score']],
    body: tD,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [15, 23, 42] },
    didDrawPage: (d) => {
      doc.setFontSize(8); doc.setTextColor(180);
      doc.text(`Página ${doc.internal.getNumberOfPages()} de 3`, pageWidth/2, pageHeight - 20, { align: "center" });
    }
  });

  doc.save(`Relatorio_APPFinance_${new Date().toISOString().slice(0,10)}.pdf`);
}
