# 💰 APPFinance PWA 2.0

**APPFinance** é uma Progressive Web App (PWA) moderna e robusta projetada para gestão inteligente de investimentos. Focada na análise qualitativa e quantitativa de ativos financeiros e no acompanhamento rigoroso do portfólio, a aplicação utiliza algoritmos proprietários para identificar as melhores oportunidades do mercado.

---

## 🚀 Funcionalidades Principais

- **📊 Dashboard Dinâmico**: Visão em tempo real do valor total investido, lucro acumulado (realizado e não realizado) e taxa de sucesso face aos objetivos.
- **📈 Treemap de Oportunidades**: Visualização interativa das 10 principais ações baseada no algoritmo **Score Lucro Máximo**, com legendas dinâmicas que refletem os pesos definidos pelo utilizador.
- **💼 Gestão de Portfólio**: Registro completo de compras e vendas com cálculo automático de **Preço Médio Ponderado** e rentabilidade.
- **🧮 Simulador de Objetivos**: Ferramenta "Wizard" para projetar o investimento necessário para atingir lucros específicos num horizonte temporal definido.
- **⚙️ Configuração Personalizada**: Ajuste dos pesos (Weights) utilizados nos algoritmos de cálculo, sincronizados automaticamente com a UI de análise.
- **📱 PWA Ready**: Experiência nativa em mobile com suporte para instalação, ícones personalizados e acesso via navegador.

---

## 🧠 Algoritmos e Lógica de Cálculo

A APPFinance destaca-se pelo uso de lógica financeira avançada (Qualidade + Crescimento) para apoiar a decisão de investimento:

### 1. Score Lucro Máximo (Multicritério)
O algoritmo de pontuação avalia cada ativo de 0 a 1 em cinco pilares fundamentais:
- **Crescimento (R)**: Média ponderada entre a variação do preço (`priceChange`) e o crescimento real dos lucros (**EPS YoY**).
- **Valor (V)**: Análise do P/E Ratio (Preço/Lucro) com curvas de normalização.
- **Tendência (T)**: Avaliação técnica comparando o preço com as médias móveis SMA50 e SMA200.
- **Dividendos (D)**: Pontuação baseada no *Dividend Yield* anualizado.
- **Eficiência (E)**: Combinação entre o **EV/Ebitda** (valor operacional) e o **ROIC** (Retorno sobre o Capital Investido), ajustada por setor.

**Fórmula Base**:  
`Score = (W.R * R_Comp + W.V * V + W.T * T + W.D * D + W.E * E_Comp) * RiskAdj`  
*Onde `R_Comp` e `E_Comp` integram as novas métricas de qualidade empresarial.*

### 2. Anualização e Realism Cap
Para garantir projeções realistas nas simulações:
- As taxas de crescimento são normalizadas usando `Math.pow(1 + taxa, frequencia) - 1`.
- Um **"Realism Cap"** é aplicado para amortecer taxas excessivamente altas, evitando projeções financeiras impossíveis.

### 3. Gestão de Portfólio (Weighted Average Cost)
- **Lucro Realizado**: Calculado no momento da venda comparando o preço de saída com o custo médio ponderado atual.
- **Taxa de Sucesso**: Medida pela relação entre o lucro gerado e os objetivos financeiros definidos para cada ativo.

---

## 🛠️ Stack Tecnológica

- **Frontend**: HTML5 Semântico, Vanilla JavaScript (ES6+ Modules), CSS3 (Modern UI com Glassmorphism).
- **Base de Dados**: [Firebase Firestore](https://firebase.google.com/) para persistência de dados em tempo real.
- **Gráficos**: [Chart.js](https://www.chartjs.org/) e componentes customizados para Treemaps.
- **Ícones**: Font Awesome e ícones PWA personalizados.

---

## 📂 Estrutura do Projeto

```bash
FinancePWA2.0/
├── js/
│   ├── screens/     # Lógica específica de cada ecrã (Dashboard, Simulador, etc.)
│   ├── utils/       # Algoritmos de cálculo (scoring.js)
│   ├── components/  # Componentes reutilizáveis (Treemap.js)
│   └── main.js      # Router e inicialização da app
├── screens/         # Ficheiros HTML parciais carregados dinamicamente
├── icons/           # Assets visuais para a PWA
├── index.html       # Estrutura base da aplicação
├── manifest.json    # Configuração PWA para instalação
└── style.css        # Design system e estilos globais
```

---

## ⚙️ Instalação e Configuração

1. Clone o repositório:
   ```bash
   git clone https://github.com/antoniorappleton/FinancePWA2.0.git
   ```
2. Configure o seu projeto Firebase:
   - Crie um projeto no console do Firebase.
   - Ative o **Firestore Database**.
   - Copie as credenciais para o ficheiro `js/firebase-config.js`.
3. Abra o ficheiro `index.html` usando um Live Server.

---

## 📄 Licença

Este projeto foi desenvolvido por Antonio Appleton como parte do seu curso de programação.
