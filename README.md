# 💰 APPFinance PWA 2.0

**APPFinance** é uma Progressive Web App (PWA) de nível profissional e arquitetura robusta, concebida para a gestão e otimização avançada de património e investimentos pessoais. O projeto baseia-se numa filosofia *Mobile-First* com estética *premium* (Glassmorphism e Dark Mode dinâmico) e corre localmente de forma isolada ou sincronizado em tempo real com o **Firebase Firestore**.

O grande diferencial da APPFinance é a sua suite de **Motores Quantitativos (Engines)** e algoritmos de *Portfolio Intelligence* desenvolvidos para avaliar a qualidade dos ativos, mitigar riscos de correlação, prever o impacto de crises de mercado, decompor ETFs e otimizar aportes mensais de forma contracíclica.

---

## 🚀 Principais Funcionalidades

A aplicação está estruturada em torno de cinco ecrãs principais e uma suite robusta de motores analíticos em segundo plano:

### 1. 📊 Dashboard Executivo e Smart DCA
*   **Visão Patrimonial Consolidada:** Cálculo em tempo real do valor total investido, valor atual de mercado, lucro/prejuízo acumulado (nominal e percentual).
*   **Gestão Dinâmica de Liquidez:** Identificação do estado de valorização global da carteira para determinar o tamanho ideal da reserva de oportunidade (**War Chest**).
*   **Smart DCA (Dollar Cost Average):** Sugestão de multiplicação de aportes de acordo com as condições de mercado (ex.: investir 150% do aporte base se o mercado estiver subvalorizado, ou reduzir para 50% e acumular caixa se estiver sobrevalorizado).

### 2. 🧠 Portfolio Intel (Análise Quantitativa Avançada)
*   **Score de Saúde Estrutural:** Diagnóstico de estabilidade da carteira baseado no número de posições, diversificação setorial, categorias de ativos e cálculo de concentração.
*   **Diagrama de Fatores (Exposição Multifactorial):** Gráfico de radar (teia de aranha) exibindo a inclinação (*tilt*) do portfólio para os fatores de mercado: *Growth*, *Value*, *Quality*, *Momentum*, *Defensive* e *Cyclical*.
*   **Análise Temática e Drivers Económicos:** Decomposição e mapeamento de ativos a megatendências estruturais do futuro (ex.: IA & Computing Power, Eletrificação, Defesa e Automação Industrial).
*   **Decomposição de ETFs e Sobreposição (Overlap):** Análise dos portfólios internos de ETFs (como VWCE, IWDA, VUSA) para somar as alocações diretas e indiretas dos ativos subjacentes, expondo a concentração real oculta em empresas como Apple, Microsoft e Nvidia.
*   **Matriz de Correlação e Agrupamento (Clustering):** Geração de uma matriz de correlação inter-ativos baseada nas dinâmicas de setor e beta histórico, com deteção automática de agrupamentos redundantes (correlação $\ge 0.65$).
*   **Simulação de Testes de Stress (Stress Testing):** Simulação de drawdowns históricos e perdas financeiras em euros perante crises como o Crash do COVID-19, Crise de 2008, Bolha Dotcom, e cenários de recessão global.

### 3. 💼 Registo de Atividade e Performance Histórica
*   **Timeline de Transações:** Registo cronológico detalhado de compras, vendas e ajustes de saldo.
*   **Cálculo Automatizado de Preço Médio (PM):** Algoritmo de controlo de custódia que recalcula o custo médio de aquisição por ativo de forma dinâmica a cada transação de compra, sem ser afetado por vendas parciais, permitindo também o cálculo preciso do **Lucro Realizado** acumulado.

### 4. 📈 Análise e Screening Individual de Ativos
*   **Algoritmo "Lucro Máximo" (Scoring Proprietário):** Avaliação de 0 a 100 da atratividade e qualidade fundamental/técnica de cada ação, ETF ou Criptomoeda.
*   **Métricas Técnicas de Momentum:** Acompanhamento dinâmico do preço em relação às médias móveis de 50 e 200 dias (SMA50/SMA200) e cálculo do RSI-14.
*   **Diagnóstico de Demonstrações Financeiras:** Visualização rápida de múltiplos de avaliação (P/E, PEG, P/FCF), rentabilidade operacional (ROIC, ROE, Margem Operacional), solvabilidade (Current Ratio, Debt-to-Equity) e dividendos.

### 5. 🛠️ Utilitários, Wisebudget e Relatórios
*   **Wisebudget Theme Categorization:** Motor de categorização inteligente das dimensões do orçamento doméstico (Wisebudget), com normalização de strings e remoção de acentos para filtragem robusta de despesas recorrentes (água, telemóvel, empregada, etc.).
*   **Exportação de Relatório Estratégico PDF:** Gerador automático de relatórios em formato PDF estruturado (`jsPDF` + `AutoTable`), com renderização dinâmica e inclusão das imagens em Base64 dos gráficos reais do portfólio gerados pelo `Chart.js`.

---

## 📂 Estrutura do Projeto

A arquitetura do projeto segue um padrão modular limpo, separando a lógica visual (HTML parciais), estilos visuais centralizados, rotas de controlo e os motores de processamento de dados (Javascript modular):

```bash
FinancePWA2.0/
├── js/
│   ├── components/            # Componentes reutilizáveis de interface
│   │   ├── help.js            # Sistema global de documentação e ajuda interativa
│   │   └── treemap.js         # Motor de renderização do mapa visual de Holdings (Treemap)
│   │
│   ├── engines/               # 🧠 Motores de Cálculo Quantitativo e Analítico
│   │   ├── correlation.js     # Matriz de correlação inter-ativos e clustering
│   │   ├── dna.js             # Assinatura estrutural e características da carteira
│   │   ├── economic-drivers.js# Exposição macroeconómica e vetores setoriais
│   │   ├── etf-overlap.js     # Decomposição de ETFs e agregação de exposição real
│   │   ├── factors.js         # Cálculo das pontuações multifactoriais (Growth, Value, etc.)
│   │   ├── macro.js           # Monitorização de indicadores macro globais
│   │   ├── momentum.js        # Lógica matemática de tendências técnicas e RSI
│   │   ├── observations.js    # Geração automática de alertas de risco e sugestões
│   │   ├── portfolio-health.js# Algoritmo de pontuação de saúde e estabilidade (HHI)
│   │   ├── quality.js         # Pontuação de eficiência operacional e qualidade financeira
│   │   ├── rebalance.js       # Motor de rebalanceamento sistemático contra alvos
│   │   ├── risk-contrib.js    # Cálculo da contribuição marginal de risco de cada ativo
│   │   ├── risk.js            # Análise de volatilidade, desvio padrão, Sharpe e Beta
│   │   ├── score-v2.js        # Variações e iterações do score qualitativo
│   │   ├── sizing.js          # Otimização do peso máximo sugerido com base no risco
│   │   ├── stress-test.js     # Simulação matemática de crises e drawdowns históricos
│   │   ├── temporal.js        # Análises temporais e evolutivas da carteira
│   │   ├── thematic.js        # Mapeamento e classificação por temas de futuro (IA, etc.)
│   │   └── valuation.js       # Avaliação comparativa de múltiplos fundamentais
│   │
│   ├── screens/               # 📱 Controladores lógicos (JS) associados aos ecrãs
│   │   ├── analise.js         # Gestão do ecrã de análise individual e fundamentais
│   │   ├── analisePorSecçoes.js# Divisão visual por secções na interface
│   │   ├── atividade.js       # Processamento de transações, PM e timeline
│   │   ├── auth.js            # Controlo de sessão e autenticação via Firebase
│   │   ├── dashboard.js       # Agregação de dados gerais, gráficos e Smart DCA
│   │   ├── portfolio-intel.js # Orquestração da suite Portfolio Intel
│   │   ├── settings.js        # Definições da API, alvos de ativos e Wisebudget
│   │   └── simulador.js       # Lógica do ecrã do simulador financeiro
│   │
│   ├── utils/                 # 🧮 Algoritmos base e utilitários transversais
│   │   ├── capitalManager.js  # Lógica de War Chest, Smart DCA e plano de crise
│   │   ├── decisionHelpers.js # Funções auxiliares para tomadas de decisão estruturadas
│   │   ├── indicator-info.js  # Configuração visual (cores, limites) de indicadores
│   │   ├── maintenance.js     # Rotinas de limpeza e manutenção de dados locais
│   │   ├── normalize.js       # Limpeza e sanitização de dados brutos e texto (SOT)
│   │   ├── num.js             # Ajudas numéricas rápidas
│   │   ├── reportGenerator.js # Motor de compilação e exportação de PDF estratégicos
│   │   └── scoring.js         # Algoritmo de Scoring Core ("Lucro Máximo")
│   │
│   ├── firebase-config.js     # Inicialização e configuração de credenciais Firebase
│   ├── help-data.js           # Dicionário de termos e documentação integrada
│   ├── main.js                # 🚀 Ponto de entrada JS, Router SPA e registo SW
│   └── script.js              # Scripts globais legados
│
├── screens/                   # 📁 Templates parciais HTML (Injetados dinamicamente)
│   ├── analise.html           # Interface de análise de ativos
│   ├── atividade.html         # Painel de transações e detalhe de posições
│   ├── auth.html              # Ecrã de login e registo de utilizadores
│   ├── dashboard.html         # Página inicial e KPIs principais
│   ├── portfolio-intel.html   # Hub de análise quantitativa avançada
│   ├── settings.html          # Painel de configurações do portfólio
│   └── simulador.html         # Interface dos simuladores de juros e crises
│
├── icons/                     # Ícones PWA para múltiplos tamanhos de ecrã
├── img/                       # Recursos de imagem e logótipos
├── index.html                 # 🏠 HTML Principal (Ecrã de entrada único)
├── manifest.json              # Configurações do manifesto PWA
├── service-worker.js          # Cache e suporte Offline da PWA
├── style.css                  # 🎨 Folha de estilos centralizada (Design System)
└── ultima atualização.txt     # Histórico de alterações e changelog
```

---

## 🧮 Principais Algoritmos e Implementação

A APPFinance conta com uma estrutura rigorosa de processamento quantitativo. Abaixo estão descritos os principais algoritmos desenvolvidos e os respetivos ficheiros onde residem:

### 1. Core Engine: Algoritmo "Lucro Máximo"
*   **Ficheiro:** [`js/utils/scoring.js`](file:///c:/Users/Antonio.Appleton/Documents/ProgramingCourse/GitProjectos/FinancePWA2.0/js/utils/scoring.js) (função `calculateLucroMaximoScore`)
*   **Funcionamento:** Avalia a qualidade fundamental e técnica de um ativo financeiro, convertendo várias dimensões em pontuações de $0.0$ a $1.0$ (exibidas como $0$-$100$ na UI):
    1.  **Crescimento (R):** Combina o crescimento homólogo (YoY) e futuro de lucros por ação (EPS) com a taxa de valorização anualizada da cotação.
    2.  **Valor (V):** Penaliza múltiplos elevados com base no P/E histórico, PEG Ratio e P/FCF.
    3.  **Tendência (T):** Analisa se o preço está acima das médias móveis SMA50 e SMA200 (momento técnico favorável) e avalia o RSI-14.
    4.  **Dividendos (D):** Mede a atratividade do Dividend Yield anualizado.
    5.  **Eficiência (E):** Avalia a rentabilidade operacional recorrendo ao ROIC, ROE e Margem Operacional.
    6.  **Solvabilidade (S):** Estuda a robustez do balanço com recurso ao Current Ratio e rácio de Dívida sobre Capital Próprio.
*   **Pesos Dinâmicos por Classe de Ativo:**
    *   **Ações:** Aplica os pesos base (R: 10%, V: 25%, T: 15%, D: 15%, E: 25%, S: 10%) ou os multiplicadores personalizados ajustados pelo utilizador nas definições.
    *   **ETFs:** Pontua com base em Tendência Técnica (40%), Diversificação (25%), Custo/TER (15%), Liquidez (10%) e Volatilidade (10%).
    *   **Cripto:** Avalia sobretudo a Tendência Técnica (45%), Momentum de Curto Prazo (20%) e Volatilidade (25%).

### 2. Motor de Saúde Estrutural do Portfólio
*   **Ficheiro:** [`js/engines/portfolio-health.js`](file:///c:/Users/Antonio.Appleton/Documents/ProgramingCourse/GitProjectos/FinancePWA2.0/js/engines/portfolio-health.js) (função `portfolioHealth`)
*   **Funcionamento:** Consolida quatro vetores para medir a solidez global da estrutura:
    1.  **Diversificação (30%):** Utiliza o Índice Herfindahl-Hirschman (HHI) (soma dos quadrados dos pesos de cada posição) em conjunto com a contagem de posições distintas, setores independentes e classes de ativos.
    2.  **Concentração (25%):** Monitoriza a exposição conjunta nas top 1, top 3 e top 5 posições, aplicando penalizações se excederem os limiares prudentes (ex.: top 5 acima de 40% do portfólio).
    3.  **Dependência de Mega-Caps (15%):** Identifica se o portfólio está excessivamente exposto a um grupo estático de 34 empresas gigantes globais de tecnologia e finanças (ex.: AAPL, MSFT, NVDA, GOOGL, JPM, etc.), limitando a pontuação se a dependência for maior que 60% ou menor que 20%.
    4.  **Volatilidade (30%):** Calcula o Beta ponderado de toda a carteira como proxy para a volatilidade sistémica.
*   **Resultados:** Classificação qualitativa da carteira (Excelente, Saudável, Razoável, Necessita Atenção ou Crítico) e cálculo do **Score de Risco Oculto** (baseado no inverso dos scores de concentração e mega-caps).

### 3. Motor de Testes de Stress (Stress Testing)
*   **Ficheiro:** [`js/engines/stress-test.js`](file:///c:/Users/Antonio.Appleton/Documents/ProgramingCourse/GitProjectos/FinancePWA2.0/js/engines/stress-test.js) (função `stressTest`)
*   **Funcionamento:** Prevê a perda de capital em euros e a percentagem de drawdown total do portfólio simulando crises históricas. O cálculo é feito ativo a ativo com base na **correlação histórica de perdas por setor** ajustado pelo **Beta individual do ativo** (um ativo com Beta mais elevado amplifica a queda base do setor).
*   **Cenários Simulados:**
    *   *Crash COVID-19 (Março 2020)*
    *   *Crise Financeira Global (2008)*
    *   *Bolha Dotcom (2000-2002)*
    *   *Subida de Taxas de Juro (2022)*
    *   *Bear Market das Tecnológicas (NASDAQ -40%)*
    *   *Crise Energética Europeia (2022)*
    *   *Recessão Global Profunda (Hipotética)*
*   **Pontuação de Resiliência:** Devolve uma nota de 0 a 100 baseada na média de drawdown simulado em todos os cenários.

### 4. Motor de Sobreposição de ETFs (ETF Overlap)
*   **Ficheiro:** [`js/engines/etf-overlap.js`](file:///c:/Users/Antonio.Appleton/Documents/ProgramingCourse/GitProjectos/FinancePWA2.0/js/engines/etf-overlap.js) (função `analyzeETFOverlap`)
*   **Funcionamento:** Resolve o problema de diversificação ilusória:
    1.  Decompõe a composição interna de ETFs conhecidos (VWCE, IWDA, VUSA, CSPX, QDVE, EUNL) com base na alocação real dos seus principais componentes.
    2.  Calcula a **Exposição Efetiva**: Consolida a percentagem direta que o utilizador tem de uma ação individual com a percentagem indireta que possui dessa mesma ação de forma fracionada através de todos os ETFs da carteira.
    3.  Calcula a **Sobreposição de Pares de ETFs**: Verifica se dois ETFs partilham os mesmos ativos subjacentes, avisando quando o rácio de sobreposição for superior a 60% (indicando possível duplicação de custos e objetivos de investimento idênticos).
    4.  Despoleta alertas se a exposição efetiva real de algum ativo ultrapassar os 8% do património total.

### 5. Matriz de Correlação e Agrupamento (Clustering)
*   **Ficheiro:** [`js/engines/correlation.js`](file:///c:/Users/Antonio.Appleton/Documents/ProgramingCourse/GitProjectos/FinancePWA2.0/js/engines/correlation.js) (função `correlationMatrix`)
*   **Funcionamento:** Cria uma matriz de relação bidirecional entre todos os ativos do portfólio.
    1.  A correlação base entre os ativos é estimada através de uma matriz institucional de correlação entre setores económicos de mercado.
    2.  O rácio é adaptado consoante o tipo de ativo (ex.: correlação baixa entre equities e commodities/metais como Gold/Silver; correlação controlada para ETFs globais).
    3.  Ajusta o resultado final baseando-se na proximidade dos coeficientes Beta de ambos os ativos.
    4.  **Algoritmo de Clustering:** Agrupa ativos cuja correlação cruzada seja superior a $0.65$ em "clusters" temáticos ou de setor, alertando para o risco de acoplamento excessivo quando um cluster agrupar 3 ou mais ativos.

### 6. Gestão de Capital e Escalonamento de Crise
*   **Ficheiro:** [`js/utils/capitalManager.js`](file:///c:/Users/Antonio.Appleton/Documents/ProgramingCourse/GitProjectos/FinancePWA2.0/js/utils/capitalManager.js)
*   **Funcionamento:** Define regras contracíclicas automáticas para otimizar os fluxos de caixa e investimentos mensais:
    1.  **Regra do Estado de Mercado:** Calcula a média ponderada do score de *Valuation* (V) de todos os ativos em carteira. Se a média de Valuation for $> 0.65$, assume mercado "Subvalorizado" (Ativos baratas); se for $< 0.35$, assume mercado "Sobrevalorizado" (Mercado caro); caso contrário, assume estado "Neutro".
    2.  **Cálculo do War Chest:** Recomenda o montante ideal a manter sob a forma de liquidez de reserva de oportunidade consoante o estado detetado (60-80% em mercados caros; 10-25% em mercados baratos).
    3.  **Algoritmo de Desdobramento de Crise (Crisis Deployment):** Recomenda o ritmo de utilização da reserva acumulada no War Chest com base na dimensão do drawdown da bolsa (ex.: resgatar 10% da reserva a quedas de 5%; resgatar 30% a quedas de 10%; 60% a quedas de 20%; 100% se a queda for igual ou superior a 30%).

### 7. Motor de Higienização de Dados (Sanitization Engine)
*   **Ficheiro:** [`js/utils/normalize.js`](file:///c:/Users/Antonio.Appleton/Documents/ProgramingCourse/GitProjectos/FinancePWA2.0/js/utils/normalize.js)
*   **Funcionamento:** Garante a estabilidade da aplicação limpando dados "sujos" obtidos por ferramentas de raspagem de dados (*scraping*):
    *   **Normalização de Números:** Converte expressões textuais do tipo `"24.42bn USD"`, `"1.5M"`, `"350k"` ou parêntesis negativos `"(1,200.50)"` em números flutuantes padrão (`Float`). Deteta e resolve a alternância entre a notação decimal europeia/portuguesa (vírgula) e anglo-saxónica (ponto).
    *   **Tratamento de Strings Especiais:** Mapeia de forma unificada valores nulos ou erros de grelhas como `"#N/A"`, `"- "`, `"NaN"`, `"undefined"`, transformando-os em `NaN` seguro para processamento sem interromper a execução.
    *   **Normalização de Tickers Canónicos:** Remove sufixos de mercado (ex.: `.DE`, `.AS`, `.LS`, `:EUR`) e resolve sinónimos de cotação para garantir que o mesmo ativo negociado em diferentes praças (ex.: `QDVF` e `QDVE`) é processado como uma única entidade de custódia.
    *   **Cálculo do Score de Confiança da Informação:** Analisa a densidade de preenchimento dos metadados de cada ativo, ponderando com 70% a presença de dados críticos (preço, setor, beta, múltiplos principais) e 30% a dados adicionais (margens operacionais, indicadores técnicos secundários) para atribuir uma nota de fiabilidade dos dados integrados na base de dados.

---

## 🛠️ Tecnologias Utilizadas

*   **Padrão PWA:** Service Workers modernos estruturados com estratégia *Network-First* para HTML/JS (garantia de receber atualizações do código) e *Cache-First* para folhas de estilo, ícones e fontes.
*   **Base de Dados:** Integração com **Firebase Firestore** para a recolha, sincronização em tempo real e persistência de dados de transações (`ativos`) e registo histórico de cotações (`acoesDividendos`).
*   **Visualização Gráfica:** Biblioteca **Chart.js** para renderizar os diagramas em radar de fatores, gráficos circulares de alocação de ativos, setores e estratégias.
*   **Relatórios:** **jsPDF** em conjunto com a extensão **jspdf-autotable** para processar o layout do relatório final, transformando os gráficos do ecrã em dados Base64 e convertendo os dados em tabelas estruturadas de alta definição.
*   **Estilo CSS:** Interface desenhada com CSS Vanilla, utilizando variáveis centralizadas (Design Tokens) para margens, cores e gradientes de luxo, efeitos de Glassmorphism nos painéis e flexibilidade adaptativa em telemóveis.

---

## 🚀 Como Executar Localmente

Como a aplicação é uma Progressive Web App pura assente em Javascript modular de nível cliente, a execução local é extremamente simples:

1.  **Clonar o Repositório:**
    ```bash
    git clone https://github.com/antoniorappleton/FinancePWA2.0.git
    cd FinancePWA2.0
    ```
2.  **Iniciar um Servidor Local:**
    Qualquer servidor web estático serve para correr a aplicação localmente. Podes usar o `Live Server` do VS Code ou via terminal:
    ```bash
    # Usando Python
    python -m http.server 8000
    
    # Ou usando Node.js (se instalado globalmente)
    npx serve
    ```
3.  **Aceder no Navegador:**
    Abre o navegador e acede a `http://localhost:8000` (ou a porta fornecida pelo teu servidor).

*Nota de Desenvolvimento:* Quando executada a partir de `localhost` ou `127.0.0.1`, a aplicação ativa automaticamente uma rotina em `js/main.js` para limpar qualquer cache antigo e desregistar o Service Worker de produção. Isto previne conflitos com outras PWAs que tenhas ativas em desenvolvimento e garante que as tuas alterações ao código se refletem de imediato após a atualização da página (*refresh*).

---
*v2.4 - Desenvolvido por Antonio Appleton • Otimizado para Análise de Fatores, Saúde de Portfólio e Inteligência Financeira Avançada*
