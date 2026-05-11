# 💰 APPFinance PWA 2.0

**APPFinance** é uma Progressive Web App (PWA) moderna e robusta projetada para gestão inteligente de investimentos. Focada na análise qualitativa e quantitativa de ativos financeiros e no acompanhamento rigoroso do portfólio, a aplicação utiliza algoritmos proprietários para identificar as melhores oportunidades do mercado.

---

## 🚀 Funcionalidades Principais

- **📊 Dashboard Dinâmico**: Visão em tempo real do valor total investido, lucro acumulado e gestão de capital via **Smart DCA**.
- **🧠 Portfolio Intel (Novo)**: Uma suite de análise avançada que utiliza motores de IA e financeira para auditar a saúde do portfólio.
- **📈 Diagramas de Fatores**: Visualização em radar (teia de aranha) das exposições a Growth, Value, Quality, Momentum, Defensive e Cyclical.
- **🌡️ Saúde do Portfólio**: Score de estabilidade estrutural baseado em diversificação (HHI), concentração e dependência de mega-caps.
- **🌪️ Stress Testing**: Simulação de crises históricas (COVID, 2008, Dotcom) para prever drawdowns e perdas estimadas.
- **🌐 Análise Temática**: Deteção automática de exposição a temas como IA, Electrificação, Cibersegurança e Decomposição de ETFs.
- **💼 Gestão de Portfólio**: Registro completo de movimentos com cálculo automático de Preço Médio e Lucro Realizado.

---

## 🧠 Motores de Cálculo e IA

A APPFinance utiliza uma arquitetura modular de motores (`engines`) para processar dados financeiros brutos em *insights* acionáveis:

### 1. Algoritmo "Lucro Máximo" (Core Engine)
O pilar central da aplicação, localizado em `js/utils/scoring.js`. Avalia cada ativo de 0 a 100 com base em:
- **Crescimento (R)**: Crescimento de EPS (Lucro por Ação) YoY e aceleração de lucros.
- **Valor (V)**: Média de P/E, P/FCF e PEG Ratio ajustados por setor.
- **Tendência (T)**: Momentum técnico (distância das médias móveis SMA50/200).
- **Dividendos (D)**: Yield anualizado e sustentabilidade.
- **Eficiência (E)**: Qualidade operacional medida por ROIC e Margens.

### 2. Motor de Fatores (Factor Exposure)
Localizado em `js/engines/factors.js`. Desconstrói o DNA de cada ativo em 6 dimensões quantitativas para visualização no gráfico de radar.
*Nota: Utiliza proxies de performance para ETFs de modo a garantir que o perfil de "Growth" é capturado mesmo sem dados fundamentais diretos.*

### 3. Gestão de Capital e War Chest
Localizado em `js/utils/capitalManager.js`. Define o estado do mercado (Sobrevalorizado/Subvalorizado) e recomenda:
- **Smart DCA**: Ajuste do investimento mensal (ex: investir 150% se o mercado estiver barato).
- **War Chest**: Alocação automática para reserva de oportunidade.

---

## 📂 Estrutura do Projeto

```bash
FinancePWA2.0/
├── js/
│   ├── engines/     # 🧠 Motores de análise (Health, Factors, Risk, Stress, Themes)
│   ├── screens/     # 📱 Lógica de UI (Dashboard, Portfolio Intel, Atividade)
│   ├── utils/       # 🧮 Algoritmos base (scoring.js, capitalManager.js, normalize.js)
│   ├── components/  # 📊 Componentes visuais (Charts, Treemap)
│   └── main.js      # 🚀 Inicialização e Routing
├── screens/         # 📁 Templates HTML parciais
├── style.css        # 🎨 Design System (Glassmorphism & Dark Mode)
└── index.html       # 🏠 Ponto de entrada PWA
```

---

## 🛠️ Tecnologias e Precisão de Dados

- **Firebase Firestore**: Base de dados real-time para ativos e cotações.
- **Sistema de Tickers Canónicos**: Garantia de consistência entre diferentes bolsas (ex: `AAPL.US` e `AAPL` são tratados como o mesmo ativo para análise).
- **Normalização Financeira**: Tratamento de strings, percentagens e valores "N/A" para evitar erros de cálculo (`js/utils/normalize.js`).

---

## 📄 Licença e Desenvolvimento

Este projeto é desenvolvido por **Antonio Appleton** como uma ferramenta profissional de gestão de património pessoal.

---
*v2.0 - Optimized for Portfolio Intelligence & Factor Analysis*
