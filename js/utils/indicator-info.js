// js/utils/indicator-info.js

export const INDICATOR_INFO = {
  // Valuation
  p_e: {
    nome: "P/E Ratio (Preço/Lucro)",
    desc: "Relação entre o preço atual da ação e o lucro por ação (EPS). Indica quanto os investidores estão dispostos a pagar por cada euro de lucro.",
    vantagem: "Geralmente, um P/E mais baixo que a média do setor indica que a empresa pode estar subvalorizada.",
    ancoras: { lo: 10, hi: 25 },
    invertido: true // Menor é melhor
  },
  forward_p_e: {
    nome: "Forward P/E",
    desc: "P/E baseado nas estimativas de lucro para os próximos 12 meses.",
    vantagem: "Se for menor que o P/E atual, sugere crescimento esperado nos lucros.",
    ancoras: { lo: 8, hi: 22 },
    invertido: true
  },
  peg: {
    nome: "PEG Ratio",
    desc: "Rácio P/E dividido pela taxa de crescimento do EPS. Ajusta a avaliação ao crescimento da empresa.",
    vantagem: "Um PEG abaixo de 1.0 é frequentemente considerado excelente (crescimento barato).",
    ancoras: { lo: 0.5, hi: 1.5 },
    invertido: true
  },
  p_s: {
    nome: "P/S Ratio (Preço/Vendas)",
    desc: "Preço da ação dividido pelas vendas por ação.",
    vantagem: "Útil para empresas que ainda não têm lucro, mas têm vendas sólidas.",
    ancoras: { lo: 1, hi: 5 },
    invertido: true
  },
  p_b: {
    nome: "P/B Ratio (Preço/Valor Contabilístico)",
    desc: "Preço da ação dividido pelo valor patrimonial (Book Value).",
    vantagem: "Abaixo de 1.0 pode indicar que a empresa vale menos que os seus ativos líquidos (potencial 'barganha').",
    ancoras: { lo: 1, hi: 3 },
    invertido: true
  },
  p_fcf: {
    nome: "P/FCF (Preço/Fluxo de Caixa Livre)",
    desc: "Preço da ação dividido pelo Free Cash Flow por ação.",
    vantagem: "Mede quanto se paga pela capacidade real da empresa gerar dinheiro vivo.",
    ancoras: { lo: 10, hi: 20 },
    invertido: true
  },

  // Rentabilidade (Efficiency)
  roe: {
    nome: "ROE (Return on Equity)",
    desc: "Retorno sobre o capital próprio. Mede a eficiência com que a empresa usa o dinheiro dos acionistas.",
    vantagem: "Valores acima de 15-20% são sinal de excelente rentabilidade.",
    ancoras: { lo: 0.1, hi: 0.25 },
    invertido: false // Maior é melhor
  },
  roa: {
    nome: "ROA (Return on Assets)",
    desc: "Retorno sobre os ativos totais. Indica quão rentável a empresa é em relação aos seus ativos.",
    vantagem: "Valores acima de 5% são geralmente bons.",
    ancoras: { lo: 0.05, hi: 0.15 },
    invertido: false
  },
  roic: {
    nome: "ROIC (Return on Invested Capital)",
    desc: "Retorno sobre o Capital Investido. Mede a rentabilidade do capital total (próprio + dívida).",
    vantagem: "Considerado um dos melhores indicadores de qualidade do negócio (Moat). Acima de 12-15% é ótimo.",
    ancoras: { lo: 0.08, hi: 0.2 },
    invertido: false
  },
  gross_margin: {
    nome: "Margem Bruta",
    desc: "Percentagem da receita que sobra após os custos diretos de produção.",
    vantagem: "Margens altas indicam poder de marca ou barata cadeia de produção.",
    ancoras: { lo: 0.2, hi: 0.5 },
    invertido: false
  },
  oper_margin: {
    nome: "Margem Operacional",
    desc: "Lucro operacional dividido pela receita total.",
    vantagem: "Mostra a eficiência do negócio central antes de juros e impostos.",
    ancoras: { lo: 0.1, hi: 0.25 },
    invertido: false
  },
  profit_margin: {
    nome: "Margem Líquida",
    desc: "Percentagem da receita que sobra como lucro líquido final.",
    vantagem: "Indica a saúde final do negócio após todas as despesas.",
    ancoras: { lo: 0.05, hi: 0.2 },
    invertido: false
  },

  // Saúde Financeira (Solvency/Liquidity)
  current_ratio: {
    nome: "Current Ratio (Liquidez Corrente)",
    desc: "Ativos correntes divididos pelos passivos correntes. Mede a capacidade de pagar dívidas a curto prazo.",
    vantagem: "Acima de 1.0-1.5 indica boa segurança financeira imediata.",
    ancoras: { lo: 1, hi: 2 },
    invertido: false
  },
  debt_eq: {
    nome: "Dívida/Capital Próprio (Debt/Equity)",
    desc: "Rácio entre o passivo total e o capital próprio.",
    vantagem: "Abaixo de 0.5-1.0 é preferível; muita dívida aumenta o risco de falência.",
    ancoras: { lo: 0.5, hi: 2 },
    invertido: true
  },
  quick_ratio: {
    nome: "Quick Ratio",
    desc: "Capacidade de pagar dívidas imediatas sem depender da venda de inventários.",
    vantagem: "Quanto maior, mais líquida é a empresa.",
    ancoras: { lo: 1, hi: 2 },
    invertido: false
  },

  // Crescimento (Growth)
  eps_next_y: {
    nome: "Crescimento EPS (Próximo Ano)",
    desc: "Crescimento esperado do Lucro por Ação para o próximo ano.",
    vantagem: "Crescimento positivo robusto (>10%) é o motor do preço da ação.",
    ancoras: { lo: 0, hi: 0.2 },
    invertido: false
  },
  eps_next_5y: {
    nome: "Crescimento EPS (5 anos)",
    desc: "Crescimento anual médio esperado para os próximos 5 anos.",
    vantagem: "Previsões estáveis a longo prazo dão confiança no modelo de negócio.",
    ancoras: { lo: 0.05, hi: 0.15 },
    invertido: false
  },
  sales_y_y_ttm: {
    nome: "Crescimento Vendas (YoY)",
    desc: "Crescimento da receita face ao ano anterior.",
    vantagem: "Crucial para validar se o lucro vem de expansão real e não apenas cortes de custos.",
    ancoras: { lo: 0, hi: 0.15 },
    invertido: false
  },

  // Técnico / Momentum
  rsi_14: {
    nome: "RSI (14 dias)",
    desc: "Indicador de força relativa. Mede a velocidade das mudanças de preço.",
    vantagem: "Abaixo de 30 indica 'Oversold' (oportunidade); acima de 70 indica 'Overbought' (caro).",
    ancoras: { lo: 30, hi: 70 },
    invertido: false // É um oscilador, scoring precisa ser especial
  },
  beta: {
    nome: "Beta",
    desc: "Mede a volatilidade da ação em relação ao mercado (S&P 500).",
    vantagem: "Beta < 1 significa menos volátil; Beta > 1 significa mais oscilação que a média.",
    ancoras: { lo: 0.8, hi: 1.5 },
    invertido: true
  },
  high_52w_dist: {
    nome: "Distância Topo 52s",
    desc: "Percentagem de queda desde o ponto mais alto do último ano.",
    vantagem: "Estar perto do topo (<5%) indica forte tendência de alta (momentum).",
    ancoras: { lo: -0.3, hi: -0.05 },
    invertido: false
  },
  div_grow_5y: {
    nome: "Cresc. Dividendo (5a)",
    desc: "Taxa anual média de crescimento dos dividendos nos últimos 5 anos.",
    vantagem: "Crescimento sustentável (>10%) indica um negócio sólido e gerador de caixa.",
    ancoras: { lo: 0, hi: 0.15 },
    invertido: false
  },
  eps_grow_5y: {
    nome: "Cresc. Lucro (5a)",
    desc: "Taxa anual média de crescimento do Lucro por Ação (EPS) nos últimos 5 anos.",
    vantagem: "Valida se a empresa está a expandir os seus lucros de forma consistente a longo prazo.",
    ancoras: { lo: 0, hi: 0.2 },
    invertido: false
  },

  // ─── Algoritmos e Scoring ───────────────────────────────────────────────
  score_v2: {
    nome: "Score V2 (Motor Principal)",
    desc: "Sistema multi-fator que combina quatro motores — Qualidade, Momentum, Valorização e Risco — num score final 0-100. Cada motor tem peso ajustável pelo regime macro e pelo estilo de investimento configurado.",
    vantagem: "Acima de 65 indica ativo com fundamentos sólidos e dinâmica favorável. Abaixo de 40 sugere reavaliar a tese de investimento.",
    ancoras: { lo: 40, hi: 70 },
    invertido: false
  },
  motor_qualidade: {
    nome: "Motor de Qualidade",
    desc: "Avalia a saúde intrínseca do negócio: ROIC, ROE, margens operacional e bruta, crescimento de receita e free cash flow. Penaliza empresas com consistência fraca.",
    vantagem: "Score alto (>65) indica empresa com vantagem competitiva sustentável (moat). Combina bem com um horizonte de longo prazo.",
    ancoras: { lo: 40, hi: 70 },
    invertido: false
  },
  motor_momentum: {
    nome: "Motor de Momentum",
    desc: "Mede a força da tendência de preço: posição face à SMA50 e SMA200, RSI 14d, golden cross e variação de preço anual. Cap interno de 25 pontos para evitar overfit em tendências extremas.",
    vantagem: "Score alto indica que o mercado confirma a tese. Útil para timing de reforço — não para decisão isolada.",
    ancoras: { lo: 35, hi: 65 },
    invertido: false
  },
  motor_valorizacao: {
    nome: "Motor de Valorização",
    desc: "Compara P/E, PEG, P/FCF e EV/EBITDA com médias históricas e setoriais. Um ativo pode ter boa qualidade mas score de valorização baixo se estiver a negociar a um prémio elevado.",
    vantagem: "Score alto (>60) indica que o ativo está razoavelmente ou bem precificado. Combinar com qualidade para filtrar 'value traps'.",
    ancoras: { lo: 35, hi: 65 },
    invertido: false
  },
  motor_risco: {
    nome: "Motor de Risco",
    desc: "Avalia exposição ao risco de mercado e financeiro: beta, rácio dívida/capital próprio, bid-ask spread e cobertura de juros. Penaliza ativos com alavancagem excessiva ou baixa liquidez.",
    vantagem: "Score alto significa menor risco estimado. Para portfólios conservadores, pesar este motor mais que o momentum.",
    ancoras: { lo: 40, hi: 70 },
    invertido: false
  },
  confidence_shrinkage: {
    nome: "Confidence Shrinkage",
    desc: "Mecanismo automático que puxa o score V2 para o neutro (50) quando o ativo tem dados insuficientes. Quanto menor a cobertura de dados, maior a penalização — evitando scores extremos baseados em informação parcial.",
    vantagem: "Protege contra sobreconfiança em ativos com dados escassos. Um score de 72 com dados completos é muito mais fiável do que 72 com 40% de cobertura.",
    ancoras: null,
    invertido: null
  },
  macro_regime: {
    nome: "Regime Macro",
    desc: "Ajuste dinâmico dos pesos dos quatro motores ao ciclo económico atual: high_rates (taxas altas), risk_on (expansão), risk_off (contração) ou stagflation (estagflação). Configurado em Definições → Estratégia.",
    vantagem: "Em high_rates, valorização e qualidade têm mais peso; em risk_on, momentum ganha relevância. O regime correto evita distorções de score em diferentes fases do ciclo.",
    ancoras: null,
    invertido: null
  },
  stress_test: {
    nome: "Stress Test",
    desc: "Simulação de perda máxima estimada do portfólio em 7 crises históricas: COVID-19 (2020), Crise Financeira Global (2008), Bolha Dotcom (2000-2002), Subida de Taxas (2022), Bear Market Tech, Crise Energética e Recessão Global Profunda. Usa beta e exposição setorial real.",
    vantagem: "Permite antecipar o pior cenário plausível e decidir se a reserva de crise está dimensionada para o absorver.",
    ancoras: null,
    invertido: null
  },
  robustness_crisis: {
    nome: "Robustez em Crise",
    desc: "Score 0-100 calculado a partir da queda média simulada nos 7 cenários de stress. 0 = portfólio muito frágil; 100 = fortaleza. Fórmula: 100 + quedaMedia × 2.",
    vantagem: "Acima de 75 o portfólio sobrevive bem à maioria dos cenários. Abaixo de 55 considera reforçar a reserva de liquidez ou reduzir ativos de alto beta.",
    ancoras: { lo: 40, hi: 75 },
    invertido: false
  },
  resilience_score: {
    nome: "Resiliência Estrutural",
    desc: "Score de robustez estrutural do portfólio baseado em diversificação setorial, correlação média entre ativos e beta médio ponderado. Calculado pelo motor risk.js — independente do stress test.",
    vantagem: "Portfólios com baixa correlação interna e diversificação setorial equilibrada obtêm scores mais altos. Complementa a Robustez em Crise que é scenario-based.",
    ancoras: { lo: 40, hi: 70 },
    invertido: false
  },
  portfolio_health: {
    nome: "Saúde do Portfólio",
    desc: "Score global 0-100 combinando saúde estrutural (60%) com resiliência (40%). Penaliza concentrações acima dos limites dinâmicos (Single Stock >10%, Sector ETF >25%, etc.) e ativos em alerta crítico.",
    vantagem: "Acima de 70 o portfólio está bem estruturado. Abaixo de 50, priorizar os alertas críticos antes de novas compras.",
    ancoras: { lo: 50, hi: 75 },
    invertido: false
  },
  crisis_ladder: {
    nome: "Escada de Crise",
    desc: "Tabela de deploys progressivos da reserva de liquidez em função da queda do mercado. Por omissão: -5%→10%, -10%→25%, -15%→50%, -25%→75%, -50%→100% da reserva. Configurável em config/strategy.",
    vantagem: "Evita deploys emocionais (tudo de uma vez) e aproveita quedas progressivas com capitais escalonados. A reserva nunca é comprometida antes de tempo.",
    ancoras: null,
    invertido: null
  }
};
