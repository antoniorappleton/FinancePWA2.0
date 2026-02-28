# Orçamento Mensal para APIs Financeiras - 92 Tickers

## Indicadores Necessários (identificados no código)

### 1. Dados de Preço e Crescimento
| Indicador | Campo no Código | Descrição |
|-----------|----------------|-----------|
| Preço atual | `valorStock` | Preço da ação |
| Taxa crescimento 1 semana | `taxaCrescimento_1semana` | Variação % 7 dias |
| Taxa crescimento 1 mês | `taxaCrescimento_1mes` | Variação % 30 dias |
| Taxa crescimento 1 ano | `taxaCrescimento_1ano` | Variação % 365 dias |
| SMA50 | `SMA50` | Média móvel 50 dias |
| SMA200 | `SMA200` | Média móvel 200 dias |

### 2. Dados de Dividendos
| Indicador | Campo no Código | Descrição |
|-----------|----------------|-----------|
| Dividendo por pagamento | `dividendo` | Valor por distribuição |
| Dividendo médio 24m | `dividendoMedio24m` | Média anual 24 meses |
| Periodicidade | `periodicidade` | Mensal/Trimestral/Semestral/Anual |
| Mês pagamento | `mes` | Mês de recebimento |
| Dividend Yield | `yield` | Rendimento % |

### 3. Dados Fundamentalistas
| Indicador | Campo no Código | Descrição |
|-----------|----------------|-----------|
| P/E Ratio | `pe`, `peRatio` | Preço/Lucro |
| EV/Ebitda | `evEbitda` | Enterprise Value/EBITDA |
| EPS YoY | `epsYoY` | Crescimento EPS ano a ano |
| ROIC | `roic`, `ROIC` | Return on Invested Capital |
| Market Cap | `marketCap` | Capitalização de mercado |
| EV | `EV` | Enterprise Value |
| EBITDA | `ebitda` | Lucro antes de juros, impostos, depreciação e amortização |

### 4. Metadados
| Indicador | Campo no Código |
|-----------|----------------|
| Nome | `nome` |
| Setor | `setor` |
| Mercado | `mercado` |
| Ticker | `ticker` |

---

## Análise por API

### 1. Financial Modeling Prep (FMP)
**URL:** https://site.financialmodelingprep.com/

| Plano | Preço/Mês | Requests | Tickers/Dia | Indicadores Incluídos |
|-------|-----------|----------|-------------|----------------------|
| Starter | $0 (Grátis) | 250/mês | ~8/day | Preço básico |
| Starter | $29 | 1.500/dia | ~50/day | Preço + Dividendos |
| Professional | $79 | 5.000/dia | ~160/day | **Todos os indicadores** |
| Enterprise | $199 | 15.000/dia | 500+/day | Completo + Tempo real |

**Para 92 tickers (atualização diária):**
- **92 tickers × 1 request cada = 92 requests/dia**
- **92 × 30 dias = 2.760 requests/mês**

**Custo FMP:** Professional ($79/mês) ✓

### 2. Alpha Vantage
**URL:** https://www.alphavantage.co/

| Plano | Preço/Mês | Requests | Limite |
|-------|-----------|----------|--------|
| Free | $0 | 25/day | 5/min |
| Standard | $25 | 75/day | 5/min |
| Premium | $50 | 150/day | 60/min |
| Enterprise | $250 | 500+/day | 60/min |

**Para 92 tickers:**
- **92 tickers × 5 indicadores = 460 requests/dia** (muito acima do limite)
- **Alpha Vantage NÃO é viável** para este volume

### 3. Finnhub
**URL:** https://finnhub.io/

| Plano | Preço/Mês | Requests | Notas |
|-------|-----------|----------|-------|
| Free | $0 | 60/sec | Limitado |
| Starter | $19 | 500/day | Базовый |
| Professional | $49 | 5.000/day | **Suficiente** |
| Enterprise | $199 | Ilimitado | Completo |

**Para 92 tickers:**
- **92 tickers × 1 request = 92 requests/dia**
- **92 × 30 = 2.760 requests/mês**

**Custo Finnhub:** Professional ($49/mês) ✓

---

## Resumo do Orçamento

| API | Plano Necessário | Custo Mensal | Adequado? |
|-----|------------------|---------------|-----------|
| **FMP** | Professional | **$79** | ✅ SIM |
| Alpha Vantage | Premium mínimo | $50+ | ❌ NÃO |
| Finnhub | Professional | **$49** | ✅ SIM |

---

## Opções Recomendadas

### ✅ Opção 1: Finnhub + FMP (Recomendada)
- **Finnhub ($49):** Preços, SMAs, crescimento
- **FMP Starter ($29):** Dividendos, fundamentalistas
- **Total: $78/mês**

### ✅ Opção 2: Apenas FMP Professional
- **FMP Professional ($79):** Todos os indicadores
- **Vantagem:** Uma única API, tudo incluso
- **Total: $79/mês**

### ✅ Opção 3: Apenas Finnhub Professional
- **Finnhub Professional ($49):** Preços, SMAs, alguns fundamentalistas
- **Custo mais baixo:** $49/mês
- **Limitação:** Pode não ter todos os dados de dividendos

---

## Cálculo Detalhado para 92 Tickers

### Usando FMP Professional ($79):
```
Requests necessários/dia:
- Quote: 92 (preço atual)
- Income Statement: 92 (dividendos)
- Key Metrics: 92 (P/E, EV/EBITDA, etc.)
- Historical Data: 92 (SMA, crescimento)

Total: ~370 requests/dia
Mensal: ~11.100 requests
Limite FMP Professional: 5.000/dia = 150.000/mês ✅
```

### Usando Finnhub Professional ($49):
```
Requests necessários/dia:
- Stock Price: 92
- Stock Metric: 92
- Stock Symbol Lookup: 1

Total: ~185 requests/dia
Mensal: ~5.550 requests
Limite Finnhub Professional: 5.000/dia = 150.000/mês ✅
```

---

## Conclusão

| Cenário | Custo Mensal | Recomendação |
|---------|---------------|---------------|
| Mínimo (Finnhub) | **$49** | Preços + SMA apenas |
| Completo (FMP) | **$79** | **RECOMENDADO** |
| Combinado | $78 | Finnhub + FMP Starter |

**Para ter TODOS os 92 tickers com TODOS os indicadores necessários (preços, dividendos, P/E, EV/EBITDA, ROIC, SMA50, SMA200, crescimento):**

➡️ **Custo mensal mínimo: $79/mês (FMP Professional)**

---

## Alternativas Gratuitas (Limitadas)

1. **Yahoo Finance (via yfinance Python):**Grátis mas precisa de servidor
2. **Yahoo Finance API (rápida):** ~2.000 requests/hora (instável)
3. **Google Finance:** Apenas preços (não tem todos indicadores)

Para 92 tick diária completa, **ers com atualizaçãopago é necessário**.
