// js/utils/reportGenerator.js
import { db } from "../firebase-config.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { calculateLucroMaximoScore, parseSma } from "./scoring.js";

const CRISES_HISTORY = [
  { id: "likely_now", name: "⚠️ Cenário Provável Atual", drop: 13 },
  { id: "geo_mod", name: "📉 Crise Geopolítica Moderada", drop: 11.5 },
  { id: "rus_ukraine", name: "⚔️ Invasão da Ucrânia (2022)", drop: 24 },
  { id: "covid_crash", name: "🦠 Crash COVID-19 (2020)", drop: 34 },
  { id: "subprime", name: "📉 Crise Financeira (2008)", drop: 56 }
];

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
  const profitColor = globalProfit >= 0 ? "var(--success, #22c55e)" : "var(--destructive, #ef4444)";
  
  // Sort recommendations (Top 3 scores)
  const recommendations = [...enriched]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return `
    <div class="report-header" style="margin-bottom: 24px; text-align: center;">
      <h1 style="font-size: 2rem; margin-bottom: 8px;">Análise de Saúde da Carteira</h1>
      <p class="muted">Análise consolidada baseada em dados de mercado em tempo real e algoritmos de scoring.</p>
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
      </div>
    </div>

    <div class="report-grid">
      <!-- Distribuição por Ativo -->
      <div class="report-card">
        <h3>Alocação por Ativo</h3>
        <div class="report-chart-container">
          <canvas id="chartReportAssets"></canvas>
        </div>
      </div>

      <!-- Distribuição por Setor -->
      <div class="report-card">
        <h3>Diversificação Setorial</h3>
        <div class="report-chart-container">
          <canvas id="chartReportSectors"></canvas>
        </div>
      </div>
      
      <!-- Stress Test -->
      <div class="report-card">
        <h3>Stress Test (Cenários de Crise)</h3>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${CRISES_HISTORY.map(c => {
            const impact = totalCurrentValue * (c.drop / 100);
            return `
              <div class="stress-test-item">
                <div class="stress-test-info">
                  <span class="stress-test-name">${c.name}</span>
                  <span class="muted" style="font-size: 0.7rem;">Queda de ${c.drop}%</span>
                </div>
                <span class="stress-test-impact">-${fmtEUR(impact)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="report-grid">
      <!-- Top Recomendações -->
      <div class="report-card" style="grid-column: span 2;">
        <h3>Insights de Investimento (Top Scores)</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
          ${recommendations.map(r => `
            <div class="report-kpi" style="background: rgba(var(--primary-rgb, 0,0,0), 0.03); border: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span class="rec-ticker">${r.ticker}</span>
                <span style="font-weight: 800; color: var(--premium);">${(r.score * 100).toFixed(0)} pts</span>
              </div>
              <div style="font-size: 0.8rem; line-height: 1.4;">
                <strong>${r.nome}</strong><br>
                <span class="muted">Posição: ${fmtEUR(r.valAtual)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Sugestões de Otimização -->
      <div class="report-card">
        <h3>Sugestões de Otimização</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${(() => {
            const suggestions = [];
            
            // 1. Draggers (Low score, high weight)
            const draggers = enriched.filter(e => e.score < 0.45 && (e.valAtual / totalCurrentValue) > 0.1);
            draggers.forEach(d => {
              suggestions.push({
                type: "danger",
                icon: "fa-arrow-down",
                text: `<strong>${d.ticker}</strong> está a prejudicar o score global (${(d.score*100).toFixed(0)} pts). Considera reduzir exposição.`
              });
            });

            // 2. Opportunities (High score, low weight)
            const opps = enriched.filter(e => e.score > 0.75 && (e.valAtual / totalCurrentValue) < 0.05);
            opps.forEach(o => {
              suggestions.push({
                type: "success",
                icon: "fa-arrow-up",
                text: `<strong>${o.ticker}</strong> tem excelente score (${(o.score*100).toFixed(0)} pts) mas baixo peso. Ideal para reforço.`
              });
            });

            // 3. Diversification
            const sectors = new Map();
            enriched.forEach(e => sectors.set(e.setor, (sectors.get(e.setor) || 0) + e.valAtual));
            for (const [sec, val] of sectors.entries()) {
              const ratio = val / totalCurrentValue;
              const isGlobal = sec.toLowerCase().includes("global") || 
                               sec.toLowerCase().includes("world") || 
                               sec.toLowerCase().includes("múltiplos") ||
                               sec.toLowerCase().includes("etf");
              
              const threshold = isGlobal ? 0.75 : 0.4;

              if (ratio > threshold) {
                suggestions.push({
                  type: isGlobal ? "success" : "warning",
                  icon: isGlobal ? "fa-shield-alt" : "fa-exclamation-triangle",
                  text: isGlobal 
                    ? `Excelente base: tens <strong>${((ratio)*100).toFixed(0)}%</strong> em ativos globais/diversificados (${sec}). Isso garante estabilidade e reduz risco setorial.`
                    : `Concentração elevada em <strong>${sec}</strong> (${((ratio)*100).toFixed(0)}%). Considera diversificar em outros setores.`
                });
              }
            }

            // 4. Global Trend Alert
            const bearishValue = enriched.filter(e => {
              const sma200 = parseSma(e.mkt.sma200, e.precoAtual) || 0;
              return e.precoAtual > 0 && sma200 > 0 && e.precoAtual < sma200;
            }).reduce((sum, e) => sum + e.valAtual, 0);

            if (bearishValue / totalCurrentValue > 0.5) {
              suggestions.push({
                type: "warning",
                icon: "fa-chart-line",
                text: "Mais de 50% da tua carteira está em tendência de queda (abaixo da SMA200). Evita reforçar estas posições até haver sinal de inversão."
              });
            }

            // 5. High Performance / Profit Taking
            const winners = enriched.filter(e => {
              const rsi = Number(e.mkt.rsi_14 || 50);
              const distSMA50 = e.precoAtual / (parseSma(e.mkt.sma50, e.precoAtual) || e.precoAtual);
              return e.profitPct > 45 && (rsi > 72 || distSMA50 > 1.15);
            });
            winners.forEach(w => {
              suggestions.push({
                type: "info",
                icon: "fa-hand-holding-usd",
                text: `<strong>${w.ticker}</strong> está com lucros excelentes (${w.profitPct.toFixed(0)}%) mas tecnicamente 'esticado'. Considera realizar lucros parciais.`
              });
            });

            if (suggestions.length === 0) {
              return '<p class="muted" style="font-size: 0.85rem;">Portfólio equilibrado. Nenhuma ação crítica recomendada de momento.</p>';
            }

            return suggestions.map(s => `
              <div style="font-size: 0.8rem; display: flex; gap: 10px; align-items: flex-start; padding: 8px; background: var(--muted); border-radius: 8px; border-left: 4px solid ${s.type === 'success' ? '#22c55e' : s.type === 'warning' ? '#f59e0b' : s.type === 'danger' ? '#ef4444' : '#3b82f6'}">
                <i class="fas ${s.icon}" style="margin-top: 3px; color: ${s.type === 'success' ? '#22c55e' : s.type === 'warning' ? '#f59e0b' : s.type === 'danger' ? '#ef4444' : '#3b82f6'}"></i>
                <span>${s.text}</span>
              </div>
            `).join('');
          })() }
        </div>
      </div>
    </div>
  `;
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
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          position: 'right', 
          labels: { 
            boxWidth: 10, 
            font: { size: 10 },
            color: 'var(--foreground)'
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
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          position: 'right', 
          labels: { 
            boxWidth: 10, 
            font: { size: 10 },
            color: 'var(--foreground)'
          } 
        }
      }
    }
  });
}
