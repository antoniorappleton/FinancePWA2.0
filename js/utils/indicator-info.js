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
  }
};
