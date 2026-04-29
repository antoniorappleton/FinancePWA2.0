// js/utils/reportGenerator.js
import { db } from "../firebase-config.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { calculateLucroMaximoScore, parseSma } from "./scoring.js";

const CRISES_HISTORY = [
  { id: "likely_now", name: "Cenário Provável Atual", drop: 13 },
  { id: "geo_mod", name: "Crise Geopolítica Moderada", drop: 11.5 },
  { id: "rus_ukraine", name: "Invasão da Ucrânia (2022)", drop: 24 },
  { id: "covid_crash", name: "Crash COVID-19 (2020)", drop: 34 },
  { id: "subprime", name: "Crise Financeira (2008)", drop: 56 }
];

// Helper para converter imagem local em Base64 para o jsPDF
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

  // Show modal and loader
  modal.classList.remove("hidden");
  content.innerHTML = "";
  content.appendChild(loader);

  try {
    // 1. Fetch Data
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

    // 2. Process Movements into Current Positions
    const grupos = new Map();
    ativosSnap.forEach(docu => {
      const d = docu.data();
      const ticker = String(d.ticker || "").toUpperCase();
      if (!ticker) return;

      // Ignorar Criptomoedas
      const s = String(d.setor || d.sector || "").toLowerCase();
      const m = String(d.mercado || d.market || "").toLowerCase();
      if (s.includes("cripto") || s.includes("crypto") || m.includes("cripto") || m.includes("crypto")) return;

      const g = grupos.get(ticker) || {
        ticker,
        nome: d.nome || ticker,
        qtd: 0,
        investido: 0,
        realizado: 0,
        setor: d.setor || d.sector || "Outros",
        mercado: d.mercado || d.market || "Outros"
      };

      const q = Number(d.quantidade || 0);
      const p = Number(d.precoCompra || 0);

      if (q > 0) {
        g.investido += q * p;
        g.qtd += q;
      } else if (q < 0) {
        const avgPrice = g.qtd > 0 ? g.investido / g.qtd : 0;
        g.realizado += (p - avgPrice) * Math.abs(q);
        g.investido -= Math.abs(q) * avgPrice;
        g.qtd += q;
      }
      grupos.set(ticker, g);
    });

    const activePositions = Array.from(grupos.values()).filter(g => g.qtd > 0.0001);
    
    // 3. Enrich with Market Data & Scoring
    let totalInvested = 0;
    let totalCurrentValue = 0;
    let totalYieldAnual = 0;
    let totalScoreWeight = 0;
    let totalR = 0, totalV = 0, totalT = 0, totalD = 0, totalE = 0, totalS = 0;

    const enriched = activePositions.map(p => {
      const mkt = acoesMap.get(p.ticker) || {};
      const precoAtual = Number(mkt.valorStock || mkt.price || 0);
      const valAtual = p.qtd * precoAtual;
      const profit = valAtual - p.investido;
      const profitPct = p.investido > 0 ? (profit / p.investido) * 100 : 0;
      const yieldAnual = Number(mkt.dividendoAnual || mkt.yield || 0);
      
      const scoreObj = calculateLucroMaximoScore(mkt);
      const score = scoreObj.score || 0.5;

      totalInvested += p.investido;
      totalCurrentValue += valAtual;
      totalScoreWeight += score * valAtual;

      // Weighted components
      totalR += (scoreObj.components.R || 0) * valAtual;
      totalV += (scoreObj.components.V || 0) * valAtual;
      totalT += (scoreObj.components.T || 0) * valAtual;
      totalD += (scoreObj.components.D || 0) * valAtual;
      totalE += (scoreObj.components.E || 0) * valAtual;
      totalS += (scoreObj.components.S || 0) * valAtual;

      const absYield = precoAtual > 0 ? (yieldAnual / 100) * valAtual : 0;
      totalYieldAnual += absYield;

      return {
        ...p,
        precoAtual,
        valAtual,
        profit,
        profitPct,
        score,
        absYield,
        mkt
      };
    });

    const globalScore = totalCurrentValue > 0 ? (totalScoreWeight / totalCurrentValue) * 100 : 0;
    
    // Final Component Scores (0-100)
    const components = {
      R: totalCurrentValue > 0 ? (totalR / totalCurrentValue) * 100 : 0,
      V: totalCurrentValue > 0 ? (totalV / totalCurrentValue) * 100 : 0,
      T: totalCurrentValue > 0 ? (totalT / totalCurrentValue) * 100 : 0,
      D: totalCurrentValue > 0 ? (totalD / totalCurrentValue) * 100 : 0,
      E: totalCurrentValue > 0 ? (totalE / totalCurrentValue) * 100 : 0,
      S: totalCurrentValue > 0 ? (totalS / totalCurrentValue) * 100 : 0
    };
    const globalProfit = totalCurrentValue - totalInvested;
    const globalProfitPct = totalInvested > 0 ? (globalProfit / totalInvested) * 100 : 0;
    const globalYieldPct = totalCurrentValue > 0 ? (totalYieldAnual / totalCurrentValue) * 100 : 0;

    // 4. Render UI
    content.innerHTML = renderReportUI({
      totalInvested,
      totalCurrentValue,
      globalProfit,
      globalProfitPct,
      globalScore,
      globalYieldPct,
      totalYieldAnual,
      enriched,
      components
    });

    // 5. Initialize Charts
    initReportCharts(enriched);

    // 6. Bind PDF Export Button (novo)
    const btnPrint = document.getElementById("btnReportPrint");
    if (btnPrint) {
      // Remover listener antigo para não duplicar
      const newBtn = btnPrint.cloneNode(true);
      btnPrint.parentNode.replaceChild(newBtn, btnPrint);
      newBtn.addEventListener("click", () => {
        exportPortfolioToPDF({
          totalInvested,
          totalCurrentValue,
          globalProfit,
          globalProfitPct,
          globalScore,
          globalYieldPct,
          totalYieldAnual,
          enriched,
          components
        });
      });
    }

  } catch (err) {
    console.error("Erro ao gerar relatório:", err);
    content.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--destructive);">
      <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 12px;"></i>
      <p>Erro ao processar o relatório. Por favor, tenta novamente.</p>
      <small>${err.message}</small>
    </div>`;
  }
}

function renderReportUI(data) {
  const { totalInvested, totalCurrentValue, globalProfit, globalProfitPct, globalScore, globalYieldPct, totalYieldAnual, enriched, components } = data;
  
  const fmtEUR = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  const fmtPct = n => (n || 0).toFixed(2) + "%";
  const profitColor = globalProfit >= 0 ? "var(--success, #22c55e)" : "var(--destructive, #ef4444)";
  
  // Sort recommendations (Top 3 scores)
  const recommendations = [...enriched]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return `
    <div class="report-header" style="margin-bottom: 24px; text-align: center; background: white; padding: 20px; border-radius: 12px; box-shadow: var(--shadow-sm);">
      <h1 style="font-size: 1.8rem; margin-bottom: 4px; color: var(--foreground);">Relatório Consolidado de Investimentos</h1>
      <p class="muted" style="font-size: 0.9rem;">Gerado em ${new Date().toLocaleDateString("pt-PT")} • Baseado em algoritmos de saúde financeira</p>
    </div>

    <div class="report-grid">
      <!-- Resumo Executivo -->
      <div class="report-card" style="grid-column: span 2;">
        <h3>Resumo Executivo</h3>
        <div class="report-kpi-grid">
          <div class="report-kpi">
            <span class="kpi-label">Património Total</span>
            <span class="kpi-value">${fmtEUR(totalCurrentValue)}</span>
          </div>
          <div class="report-kpi">
            <span class="kpi-label">Capital Investido</span>
            <span class="kpi-value">${fmtEUR(totalInvested)}</span>
          </div>
          <div class="report-kpi">
            <span class="kpi-label">Lucro/Prejuízo Total</span>
            <span class="kpi-value" style="color: ${profitColor}">${fmtEUR(globalProfit)} (${globalProfitPct.toFixed(2)}%)</span>
          </div>
          <div class="report-kpi" style="border: 2px solid var(--premium); background: rgba(var(--primary-rgb), 0.05);">
            <span class="kpi-label">Portfolio Health Score</span>
            <span class="kpi-value" style="color: var(--premium);">${globalScore.toFixed(0)}/100</span>
          </div>
        </div>
      </div>

      <!-- Diagnóstico do Score -->
      <div class="report-card" style="grid-column: span 2;">
        <h3>Diagnóstico Detalhado do Score</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
          <div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${[
                { label: "Crescimento & EPS (R)", val: components.R },
                { label: "Valuation & P/E (V)", val: components.V },
                { label: "Tendência Técnica (T)", val: components.T },
                { label: "Dividendos (D)", val: components.D },
                { label: "Eficiência (E)", val: components.E },
                { label: "Solvência (S)", val: components.S }
              ].map(c => `
                <div style="font-size: 0.75rem;">
                  <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                    <span>${c.label}</span>
                    <strong>${c.val.toFixed(0)}%</strong>
                  </div>
                  <div style="height: 6px; background: var(--muted); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${c.val}%; height: 100%; background: ${c.val > 70 ? 'var(--success)' : c.val > 40 ? 'var(--premium)' : '#ef4444'};"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div style="background: var(--muted); padding: 16px; border-radius: 12px; font-size: 0.8rem; line-height: 1.5;">
            <p style="margin-top: 0;"><strong>Porquê 49/100?</strong></p>
            <p>O score não é apenas uma média dos fundamentos. Ele é <strong>ajustado pelo risco (volatilidade)</strong>. Para <strong>ETFs Acumulativos (Acc)</strong>, o peso dos dividendos é automaticamente redistribuído para os outros pilares, garantindo que não és penalizado pela ausência de distribuição.</p>
            <p style="margin-bottom: 0;"><strong>Dica para subir o Score:</strong><br>
            ${(() => {
              const lowest = Object.entries(components).sort((a,b) => a[1] - b[1])[0];
              const tips = {
                R: "Procura empresas com crescimento de lucros (EPS) mais estável.",
                V: "A tua carteira está 'cara' (P/E alto). Considera ativos com valuation mais atrativo.",
                T: "Muitos ativos estão em tendência de queda. Aguarda pela inversão acima da SMA200.",
                D: "O rendimento de dividendos é baixo ou instável face ao preço pago.",
                E: "Foca em empresas com melhor ROIC e margens operacionais mais largas.",
                S: "Atenção ao endividamento (Debt/Equity) de algumas das tuas posições."
              };
              return `🚨 O teu ponto mais fraco é <strong>${lowest[0]}</strong>. ${tips[lowest[0]]}`;
            })()}
            </p>
          </div>
        </div>
      <!-- Gráficos de Alocação -->
      <div class="report-card">
        <h3>Alocação por Ativo</h3>
        <div style="height: 250px;"><canvas id="chartReportAssets"></canvas></div>
      </div>
      <div class="report-card">
        <h3>Alocação por Setor</h3>
        <div style="height: 250px;"><canvas id="chartReportSectors"></canvas></div>
      </div>
    </div>

    <!-- TABELA DETALHADA DE ATIVOS -->
    <div class="report-card" style="grid-column: span 2; margin-top: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="margin: 0;">Detalhamento do Portfólio</h3>
        <span class="muted" style="font-size: 0.8rem;">${enriched.length} Ativos Ativos</span>
      </div>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; min-width: 800px;">
          <thead>
            <tr style="border-bottom: 2px solid var(--border); text-align: left;">
              <th style="padding: 10px 4px;">Ativo</th>
              <th style="padding: 10px 4px;">Qtd</th>
              <th style="padding: 10px 4px;">Preço Médio</th>
              <th style="padding: 10px 4px;">Preço Atual</th>
              <th style="padding: 10px 4px;">Investido</th>
              <th style="padding: 10px 4px;">Val. Atual</th>
              <th style="padding: 10px 4px;">Lucro/Prejuízo</th>
              <th style="padding: 10px 4px; text-align: center;">Score</th>
            </tr>
          </thead>
          <tbody>
            ${enriched.sort((a, b) => b.valAtual - a.valAtual).map(p => {
              const color = p.profit >= 0 ? "var(--success)" : "var(--destructive)";
              const avgPrice = p.qtd > 0 ? p.investido / p.qtd : 0;
              return `
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 10px 4px;">
                    <div style="font-weight: 700;">${p.ticker}</div>
                    <div class="muted" style="font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">${p.nome}</div>
                  </td>
                  <td style="padding: 10px 4px;">${p.qtd.toFixed(4)}</td>
                  <td style="padding: 10px 4px;">${fmtEUR(avgPrice)}</td>
                  <td style="padding: 10px 4px;">${fmtEUR(p.precoAtual)}</td>
                  <td style="padding: 10px 4px;">${fmtEUR(p.investido)}</td>
                  <td style="padding: 10px 4px; font-weight: 600;">${fmtEUR(p.valAtual)}</td>
                  <td style="padding: 10px 4px; color: ${color}; font-weight: 500;">
                    ${fmtEUR(p.profit)}<br>
                    <small>(${p.profitPct.toFixed(2)}%)</small>
                  </td>
                  <td style="padding: 10px 4px; text-align: center;">
                    <div style="background: ${p.score > 0.7 ? 'var(--success)' : p.score > 0.4 ? 'var(--premium)' : '#ef4444'}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; display: inline-block;">
                      ${(p.score * 100).toFixed(0)}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function ensurePDFLibs() {
  const scripts = [
    { id: 'js-jspdf', url: "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js" },
    { id: 'js-jspdf-autotable', url: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js" }
  ];

  for (const s of scripts) {
    if (!document.getElementById(s.id)) {
      await new Promise((resolve) => {
        const sc = document.createElement("script");
        sc.id = s.id;
        sc.src = s.url;
        sc.onload = resolve;
        document.head.appendChild(sc);
      });
    }
  }
}

/**
 * Geração de PDF profissional A4 compatível
 */
export async function exportPortfolioToPDF(data) {
  const { totalInvested, totalCurrentValue, globalProfit, globalProfitPct, globalScore, globalYieldPct, totalYieldAnual, enriched, components } = data;
  
  await ensurePDFLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let currY = margin;

  const fmtEUR = n => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n);
  const fmtPct = n => (n || 0).toFixed(2) + "%";

  // Helpers
  const drawLine = (y) => {
    doc.setDrawColor(230);
    doc.line(margin, y, pageWidth - margin, y);
  };

  // Carregar Logo
  const logoBase64 = await getBase64Image("icons/icon-192.png");

  // --- CABEÇALHO ---
  doc.setFillColor(30, 41, 59); // Slate 800
  doc.rect(0, 0, pageWidth, 100, 'F');
  
  // Linha decorativa
  doc.setFillColor(79, 70, 229); // Premium Indigo
  doc.rect(0, 97, pageWidth, 3, 'F');

  if (logoBase64) {
    doc.addImage(logoBase64, 'PNG', margin, 25, 45, 45);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("APPFINANCE", margin + 55, 50);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("RELATÓRIO DE PERFORMANCE & ESTRATÉGIA", margin + 55, 65);
  
  doc.setTextColor(200);
  doc.setFontSize(9);
  doc.text(`Data: ${new Date().toLocaleString("pt-PT")}`, margin, 85);
  doc.text(`Relatório Gerado dinamicamente via Algoritmos de IA`, pageWidth - margin, 85, { align: "right" });
  
  currY = 130;

  // --- RESUMO EXECUTIVO (KPIs) ---
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("1. Resumo Executivo", margin, currY);
  currY += 20;
  drawLine(currY);
  currY += 30;

  // Desenhar cartões de KPI
  const kpis = [
    { label: "Património Total", val: fmtEUR(totalCurrentValue) },
    { label: "Capital Investido", val: fmtEUR(totalInvested) },
    { label: "Lucro/Prejuízo", val: `${fmtEUR(globalProfit)} (${fmtPct(globalProfitPct)})`, color: globalProfit >= 0 ? [34, 197, 94] : [239, 68, 68] },
    { label: "Health Score", val: `${globalScore.toFixed(0)}/100`, color: [79, 70, 229] }
  ];

  let kpiX = margin;
  const kpiWidth = (pageWidth - 2 * margin) / 4;
  kpis.forEach(k => {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.setFont("helvetica", "normal");
    doc.text(k.label, kpiX, currY);
    
    doc.setFontSize(11);
    if (k.color) doc.setTextColor(k.color[0], k.color[1], k.color[2]);
    else doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.text(k.val, kpiX, currY + 15);
    kpiX += kpiWidth;
  });

  currY += 50;

  // --- DIAGNÓSTICO DO SCORE ---
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("2. Diagnóstico do Score Global", margin, currY);
  currY += 20;
  drawLine(currY);
  currY += 25;

  const scoreItems = [
    { label: "Crescimento & EPS (R)", val: components.R },
    { label: "Valuation & P/E (V)", val: components.V },
    { label: "Tendência Técnica (T)", val: components.T },
    { label: "Dividendos (D)", val: components.D },
    { label: "Eficiência (E)", val: components.E },
    { label: "Solvência (S)", val: components.S }
  ];

  scoreItems.forEach((it, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = margin + col * ((pageWidth - 2 * margin) / 2 + 10);
    const y = currY + row * 35;

    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.setFont("helvetica", "normal");
    doc.text(it.label, x, y);
    doc.setFont("helvetica", "bold");
    doc.text(`${it.val.toFixed(0)}%`, x + 160, y);

    // Barra de progresso
    doc.setFillColor(240);
    doc.rect(x, y + 5, 180, 6, 'F');
    const color = it.val > 70 ? [34, 197, 94] : it.val > 40 ? [79, 70, 229] : [239, 68, 68];
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x, y + 5, (it.val / 100) * 180, 6, 'F');
  });

  currY += 120;

  // --- GRÁFICOS (Captura de Canvas) ---
  doc.setFontSize(14);
  doc.setTextColor(50);
  doc.setFont("helvetica", "bold");
  doc.text("3. Alocação e Diversificação", margin, currY);
  currY += 20;
  drawLine(currY);
  currY += 20;

  try {
    const canvasAssets = document.getElementById("chartReportAssets");
    const canvasSectors = document.getElementById("chartReportSectors");
    
    if (canvasAssets) {
      const imgData = canvasAssets.toDataURL("image/png");
      // Formato quadrado para garantir círculo perfeito
      doc.addImage(imgData, 'PNG', margin, currY, 230, 230);
    }
    if (canvasSectors) {
      const imgData = canvasSectors.toDataURL("image/png");
      doc.addImage(imgData, 'PNG', margin + 260, currY, 230, 230);
    }
  } catch (e) {
    doc.setFontSize(10);
    doc.text("[Gráficos não disponíveis no PDF]", margin, currY + 20);
  }

  currY += 240;

  // --- STRESS TEST ---
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("4. Stress Test (Simulação de Crises)", margin, currY);
  currY += 20;
  drawLine(currY);
  currY += 25;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  
  CRISES_HISTORY.forEach((c, i) => {
    const impact = totalCurrentValue * (c.drop / 100);
    const y = currY + i * 22;
    doc.setTextColor(50);
    doc.text(`> ${c.name}`, margin, y);
    doc.setTextColor(150);
    doc.text(`${c.drop}%`, margin + 220, y);
    doc.setTextColor(239, 68, 68);
    doc.setFont("helvetica", "bold");
    doc.text(`-${fmtEUR(impact)}`, pageWidth - margin, y, { align: "right" });
    doc.setFont("helvetica", "normal");
  });

  // --- RODAPÉ DA PRIMEIRA PÁGINA ---
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`Página 1 de 2`, pageWidth / 2, pageHeight - 20, { align: "center" });

  // --- SEGUNDA PÁGINA (TABELA DETALHADA) ---
  doc.addPage();
  currY = margin;

  doc.setTextColor(50, 50, 50);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("5. Detalhamento do Portfólio (Tabela Completa)", margin, currY);
  currY += 20;
  drawLine(currY);
  currY += 15;

  const tableData = enriched.sort((a, b) => b.valAtual - a.valAtual).map(p => [
    { content: `${p.ticker}\n${p.nome.substring(0, 25)}`, styles: { fontStyle: 'bold' } },
    p.qtd.toFixed(4),
    fmtEUR(p.investido / p.qtd),
    fmtEUR(p.precoAtual),
    fmtEUR(p.investido),
    fmtEUR(p.valAtual),
    { content: `${fmtEUR(p.profit)}\n(${p.profitPct.toFixed(1)}%)`, styles: { textColor: p.profit >= 0 ? [34, 197, 94] : [239, 68, 68] } },
    { content: (p.score * 100).toFixed(0), styles: { halign: 'center', fontStyle: 'bold', textColor: p.score > 0.7 ? [34, 197, 94] : [79, 70, 229] } }
  ]);

  doc.autoTable({
    startY: currY,
    head: [['Ativo / Empresa', 'Qtd', 'P. Médio', 'P. Atual', 'Investido', 'Val. Atual', 'Lucro/Prej.', 'Score']],
    body: tableData,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 5 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 100 },
      7: { cellWidth: 40 }
    }
  });

  // Insights finais (depois da tabela)
  currY = doc.lastAutoTable.finalY + 30;
  if (currY > pageHeight - 100) {
    doc.addPage();
    currY = margin;
  }

  doc.setTextColor(50);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("6. Notas de Otimização Algorítmica", margin, currY);
  currY += 20;
  drawLine(currY);
  currY += 20;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80);
  
  const notes = [
    "• O Portfolio Health Score é ajustado pelo risco e volatilidade histórica dos ativos.",
    "• Ativos em tendência de queda (abaixo da SMA200) penalizam a pontuação técnica.",
    "• Diversificação setorial equilibrada reduz a exposição a riscos sistémicos.",
    "• Este relatório é gerado de forma dinâmica com dados de fecho do mercado mais recentes."
  ];

  notes.forEach(n => {
    doc.text(n, margin, currY);
    currY += 15;
  });

  // RODAPÉ FINAL
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`Relatório Gerado por Antigravity AI • APPFinance PWA • Página 2 de 2`, pageWidth / 2, pageHeight - 20, { align: "center" });

  // Guardar PDF
  doc.save(`APPFinance_Relatorio_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function initReportCharts(enriched) {
  const totalVal = enriched.reduce((sum, e) => sum + e.valAtual, 0);
  const fmt = n => new Intl.NumberFormat("pt-PT", { 
    style: "currency", 
    currency: "EUR", 
    maximumFractionDigits: 0 
  }).format(n);

  const assetData = enriched.map(e => e.valAtual);
  const assetLabels = enriched.map(e => {
    const pct = totalVal > 0 ? (e.valAtual / totalVal) * 100 : 0;
    return `${e.ticker} (${pct.toFixed(1)}% | ${fmt(e.valAtual)})`;
  });

  const sectors = new Map();
  enriched.forEach(e => {
    const s = e.setor || "Outros";
    sectors.set(s, (sectors.get(s) || 0) + e.valAtual);
  });

  const sectorLabels = Array.from(sectors.keys()).map(s => {
    const val = sectors.get(s);
    const pct = totalVal > 0 ? (val / totalVal) * 100 : 0;
    return `${s} (${pct.toFixed(1)}% | ${fmt(val)})`;
  });

  const PALETTE = ["#4F46E5", "#22C55E", "#EAB308", "#EF4444", "#06B6D4", "#F59E0B", "#A855F7"];

  new Chart(document.getElementById("chartReportAssets"), {
    type: 'doughnut',
    data: {
      labels: assetLabels,
      datasets: [{
        data: assetData,
        backgroundColor: assetLabels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { 
          position: 'bottom', 
          labels: { 
            boxWidth: 8, 
            font: { size: 9 },
            color: '#444'
          } 
        }
      }
    }
  });

  new Chart(document.getElementById("chartReportSectors"), {
    type: 'doughnut',
    data: {
      labels: sectorLabels,
      datasets: [{
        data: Array.from(sectors.values()),
        backgroundColor: Array.from(sectors.keys()).map((_, i) => PALETTE[(i + 2) % PALETTE.length]),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { 
          position: 'bottom', 
          labels: { 
            boxWidth: 8, 
            font: { size: 9 },
            color: '#444'
          } 
        }
      }
    }
  });
}
