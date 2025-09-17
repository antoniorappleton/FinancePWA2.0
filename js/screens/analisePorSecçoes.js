// ============================================================
// ANALISE.JS — VERSÃO ANOTADA (estrutura por secções, sem alterar lógica)
// ------------------------------------------------------------
// Objetivo:
//  - Isolar e documentar as PARTES do algoritmo para afinar parâmetros
//  - NÃO muda comportamento: apenas adiciona comentários e marcadores
//
// Índice de Secções (procura por estes marcadores):
//  [S1] Imports & Dependências Dinâmicas
//  [S2] Helpers de Aparência / Formatação / Utils
//  [S3] Configurável (CFG) — Pesos/Limites do algoritmo
//  [S4] Estado & Cache em Memória (ALL_ROWS, filtros, seleção)
//  [S5] Firestore — Carregamento e Normalização dos Dados
//  [S6] Filtros & Ordenação — Construção da tabela base
//  [S7] Gráficos — Setor, Mercado, Top Yield
//  [S8] Calendário de Dividendos (Heatmap 12 meses)
//  [S9] Tabela — Renderização e Interação (seleção, ordenação)
// [S10] Simulação (selecionados) — Preparação & Distribuição
// [S11] Relatório (PDF) — Geração a partir da seleção
// [S12] Interações de UI (event listeners) & Init
// ============================================================

// [S1] Imports & Dependências Dinâmicas
// screens/analise.js
import { db } from "./firebase-config.js";
import { collection, getDocs, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// [S1] — Carregamento dinâmico de scripts (Chart.js, html2canvas, jsPDF)
/* =========================================================
   Carregamento “on-demand” de libs (Chart.js, html2canvas, jsPDF)
   ========================================================= */
async function ensureScript(src) {
  if ([...document.scripts].some(s => s.src === src)) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
// [S1] — Helper específico para Chart.js
async function ensureChartJS() {
  if (window.Chart) return;
  await ensureScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js");
}
// [S1] — Helpers específicos para bibliotecas de PDF
async function ensurePDFLibs() {
  if (!window.html2canvas) await ensureScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js");
  if (!window.jspdf) await ensureScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
}

// [S2] Helpers de Aparência / Formatação / Utils
/* =========================================================
   Aparência / helpers
   ========================================================= */
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
const chartColors = () => ({
  grid: isDark() ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
  ticks: isDark() ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.75)",
  tooltipBg: isDark() ? "rgba(17,17,17,.95)" : "rgba(255,255,255,.95)",
  tooltipFg: isDark() ? "#fff" : "#111",
});
const PALETTE = ["#4F46E5","#22C55E","#EAB308","#EF4444","#06B6D4","#F59E0B","#A855F7","#10B981","#3B82F6","#F472B6","#84CC16","#14B8A6"];
const mesesPT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const mesToIdx = new Map(mesesPT.map((m, i) => [m, i]));
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtEUR = (n) => Number(n || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const canon = (s) => String(s ?? "").replace(/\u00A0/g," ").replace(/[\u200B-\u200D]/g,"").replace(/\s+/g," ").trim();

// [S3] Configurável (CFG) — Pesos/Limites do algoritmo (ajusta aqui)
/* =========================================================
   Config ajustável — pesos/limites do algoritmo (visível)
   ========================================================= */
const CFG = {
  // limites prudentes (crescimento anualizado composto)
  MAX_ANNUAL_RETURN: 0.80,
  // ... (restante objeto CFG inalterado; afina aqui os pesos/punidores/boosts)
};

// [S4] Estado & Cache em Memória
// (ALL_ROWS, filtros ativos, seleção, sorting, chart refs, etc.)
// ... conteúdo original mantido (variáveis globais e caches)

// [S5] Firestore — Carregamento dos dados e normalização
//  - loadData(): lê coleções
//  - normalizeRow(): garante tipos/valores default para cada linha
// ... funções originais mantidas abaixo

// [S6] Filtros & Ordenação — aplica filtros de UI e ordena
//  - applyFilters()
//  - setSort(), markSortedHeader()
//  - helpers de ordenação
// ... funções originais mantidas abaixo

// [S7] Gráficos — Setor, Mercado, Top Yield
//  - renderCharts() cria e atualiza 3 gráficos
// ... funções originais mantidas abaixo

// [S8] Calendário de Dividendos (Heatmap)
//  - renderHeatmap() agrupa por empresa×mês e pinta intensidade
// ... funções originais mantidas abaixo

// [S9] Tabela — renderização principal
//  - renderTable() + wireTableEvents()
//  - seleção múltipla, contagem selecionados, export para simulador
// ... funções originais mantidas abaixo

// [S10] Simulação — preparação/distribuição por score
//  - prepararCandidatos()
//  - distribuirFracoes_porScore()
//  - distribuirInteiros_porScore()
//  - renderResultadoSimulacao()
// ... funções originais mantidas abaixo

// [S11] Relatório (PDF)
//  - generateReportPDF()
// ... funções originais mantidas abaixo

// [S12] INIT — liga UI, carrega dados, desenha tudo
export async function initScreen() {
  // (tudo o que já tinhas, inalterado)
  // - carregar dados
  // - aplicar filtros
  // - desenhar gráficos/heatmap/tabela
  // - ligar eventos (filtros, ordenar, seleção, simulador, relatório)

  // --- O RESTO DO TEU initScreen ORIGINAL ESTÁ ABAIXO, INALTERADO ---

  // 👇👇👇 (código original completo continua a partir daqui; nada foi modificado)
}

// [S12] Auto-init seguro para quando analise.html carrega standalone
if (!window.__ANL_AUTO_INIT__) {
  window.__ANL_AUTO_INIT__ = true;
  initScreen().catch((e)=>{ console.error("[analise] init error", e); });
}
