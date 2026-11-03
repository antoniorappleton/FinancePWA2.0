# AUDIT_SCORING.md — Auditoria da Camada de Scoring
**Versão:** 27/06/2026 · Gerado por análise estática completa do repositório

---

## FASE 1 — INVENTÁRIO

### 1.1 Pontos de chamada de `calculateLucroMaximoScore` e `scoreAssetV2`

| Função | Ficheiro (linha aprox.) | Ecrã/Contexto | Escala resultado | Multiplicadores | Regime |
|---|---|---|---|---|---|
| `calculateLucroMaximoScore` | `analise.js:1097` | Mesa de Análise — sorting cards | 0–1 (`.score`) | nenhum | n/a |
| `calculateLucroMaximoScore` | `analise.js:1398` | Mesa de Análise — linhas simulação | 0–1 (`.score`) | nenhum | n/a |
| `calculateLucroMaximoScore` | `analise.js:1426` | Mesa de Análise — coluna principal | 0–1 (`.score`) | nenhum | n/a |
| `calculateLucroMaximoScore` | `dashboard.js:1152` | Dashboard — top scorers | 0–1 (`.score`) | nenhum (`getUserWeights` disponível mas não passado) | n/a |
| `calculateLucroMaximoScore` | `simulador.js:781` | Simulador — ativos | 0–1 (`.score`) | `styleAdjWeights` (formato v1: R/V/T/D/E/S) | n/a |
| `calculateLucroMaximoScore` | `settings.js:533` | Settings — preview de estilo | 0–1 (`.score`) | `styleAdjWeights` (formato v1) | n/a |
| `calculateLucroMaximoScore` | `capitalManager.js:58` | Capital Manager — estado portfolio | 0–1 (`.components.V`) — só V | nenhum | n/a |
| `calculateLucroMaximoScore` | `reportGenerator.js:189` | Relatório — lado legacy/V2 simultâneos | 0–1 (`.score`) | nenhum | n/a |
| `scoreAssetV2` | `portfolio-intel.js:169` | Portfolio Intel — scorecards portfolio | 0–100 (`.finalScore`) | `styleToMultipliers(strategy.styleAlloc)` | `strategy.macroRegime \|\| "high_rates"` |
| `scoreAssetV2` | `portfolio-intel.js:178` | Portfolio Intel — Entry Planner lista | 0–100 (`.finalScore`) | `styleToMultipliers(strategy.styleAlloc)` | `strategy.macroRegime \|\| "high_rates"` |
| `scoreAssetV2` | `reportGenerator.js:188` | Relatório — lado V2 | 0–100 (`.finalScore`) | `styleToMultipliers(strategy.styleAlloc)` | `strategy.macroRegime \|\| "high_rates"` |
| `scoreAssetV2` | `asset-deep-panel.js:37` | Painel lateral por ativo | 0–100 (`.finalScore`) | **nenhum** | **default `"high_rates"`** |
| `scoreAssetV2` ← via `applyAdaptiveScoring` | `scoring.js:351` | Dentro de `calculateLucroMaximoScore` quando `readiness.ready=true` | 0–100 internamente → `/100` → 0–1 | `v1MultipliersToV2(customMultipliers)` | **NÃO PASSADO → default `"high_rates"`** |

**Resumo da escala:** Portfolio Intel e painel lateral produzem 0–100. Mesa de Análise, Simulador, Dashboard, Relatório (via `calculateLucroMaximoScore`) produzem 0–1 (com possível conversão visual para %). Isso não é o problema principal — o problema são os pesos diferentes que chegam ao mesmo motor V2.

---

### 1.2 Onde se define o `regime` e como é calculado

**Fonte canónica (quando existe):**
- `portfolio-intel.js:133` → `const regime = strategy.macroRegime || "high_rates"`
- `reportGenerator.js` → mesma lógica sobre `config/strategy` Firestore
- O utilizador seleciona o regime em Settings, gravado em `config/strategy.macroRegime`

**Onde o regime é ignorado (silencioso):**
- `scoring.js:351` → `scoreAssetV2(acao, v1MultipliersToV2(customMultipliers))` — **regime não passado** → `"high_rates"` hardcoded mesmo que o utilizador tenha selecionado outro
- `asset-deep-panel.js:37` → `scoreAssetV2(market)` — **nem multipliers nem regime** → defaults totais

**Default global em `score-v2.js:16`:**
```js
export function scoreAssetV2(asset, styleMultipliers = null, regime = "high_rates")
```
O default `"high_rates"` é silencioso — nenhum aviso é emitido quando é usado.

---

### 1.3 Transformadores estilo→multiplicadores

**Transformador A: `styleToMultipliers(styleAlloc)` — em `score-v2.js:199`**
- **Entrada:** `{growth, value, div, qual}` em percentagem (somam ≈100)
- **Saída:** `{quality, momentum, valuation, risk}` para dimensões V2
  ```js
  quality   = 1 + (qual/100 * 1.5) + (div/100 * 0.5)
  momentum  = 1 + (growth/100 * 1.5)
  valuation = 1 + (value/100 * 2.0)
  risk      = 1 + (qual/100 * 1.0) + (div/100 * 0.5)
  ```
- **Usado por:** `portfolio-intel.js`, `reportGenerator.js`

**Transformador B: `v1MultipliersToV2(m)` — em `scoring.js:385`**
- **Entrada:** `{R, T, V, D, E, S}` (multiplicadores v1 das 6 componentes)
- **Saída:** `{momentum, valuation, quality, risk}` para dimensões V2
  ```js
  momentum  = (m.R + m.T) / 2    // média de Rentabilidade e Tendência
  valuation = m.V
  quality   = m.E
  risk      = m.S
  ```
- **Usado por:** `scoring.js → applyAdaptiveScoring`; indiretamente `simulador.js` e `settings.js` quando passam `customMultipliers` em formato v1

**Comparação de impacto (exemplo com styleAlloc={growth:25, value:25, div:25, qual:25}):**
- `styleToMultipliers` → quality=1.50, momentum=1.375, valuation=1.50, risk=1.375
- `v1MultipliersToV2({R:1.2, T:1.1, V:1.3, E:1.2, S:1.0})` → quality=1.2, momentum=1.15, valuation=1.3, risk=1.0
- Os dois transformadores não produzem resultados equivalentes mesmo para o mesmo ativo com as mesmas preferências de utilizador.

**`getUserWeights()`** em `scoring.js:9`: lê `localStorage["userWeights"]` (formato v1 R/V/T/D/E/S). Disponível mas não é passado automaticamente nas chamadas de `analise.js` e `dashboard.js`.

**`SCORING_CFG`** em `scoring.js:16`: pesos base legacy `{R:0.1, V:0.25, T:0.15, D:0.15, E:0.25, S:0.1}` — usados no caminho legacy/hybrid quando `readiness.ready=false`.

---

### 1.4 Limites de concentração — todas as definições

| Tipo de ativo | `normalize.js` HEALTHY_LIMITS | `risk.js` HEALTHY_LIMITS (local) | `sizing.js` RULES | `rebalance.js` SECTOR_LIMIT | `risk.js` macroRisk |
|---|---|---|---|---|---|
| Broad Market ETF | **70%** | **70%** | — | — | — |
| Sector ETF | **25%** | **20%** ⚠ | — | — | — |
| Thematic ETF | **15%** | **10%** ⚠ | — | — | — |
| Single Stock | **10%** | **8%** ⚠ | 10% | — | — |
| Speculative Asset | **5%** | **4%** ⚠ | — | — | — |
| Satellite Asset | **8%** | **5%** ⚠ | — | — | — |
| Commodity | **12%** | *(ausente)* ⚠ | — | — | — |
| Crypto | **5%** *(chave morta)* | *(ausente)* | — | — | — |
| Concentração setorial | — | — | **30%** | **35%** | **>40%** |

**Quem usa cada tabela:**
- `rebalance.js` → importa `HEALTHY_LIMITS` de `normalize.js` ✓
- `portfolio-intel.js` → importa `HEALTHY_LIMITS` de `normalize.js` ✓
- `risk.js → calculateConcentrationRisk()` → usa a **cópia local** (valores mais restritivos)
- `sizing.js → calculatePositionSize()` → usa `RULES.maxSinglePosition = 0.10` e `RULES.maxSectorExposure = 0.30`

**"Crypto" morta:** `getAssetCategory()` em `normalize.js` nunca retorna `"Crypto"` — retorna `"Speculative Asset"` para cripto. A chave `Crypto: 0.05` em `HEALTHY_LIMITS` nunca é acionada.

---

### 1.5 Definições de "resiliência"

**Definição A — `portfolioRiskDecomposition` em `risk.js:88`:**
```js
resilienceScore = (100 - correlationRisk) * 0.4 + (100 - volatilityRisk) * 0.3 + conc.score * 0.3
```
- Componentes: correlação entre ativos, beta ponderado, concentração por categoria
- **Alimenta:** `portfolio-intel.js → renderResilience()` → campo `piResilience` → **"RESILIÊNCIA %" do relatório/ecrã**
- Escala: 0–100, quanto maior melhor

**Definição B — `stressTest` em `stress-test.js:218`:**
```js
resilience = Math.round(clamp(100 + avgDrop * 2, 0, 100))
```
- Onde `avgDrop` = média de `portfolioDropPct` em % (ex: -25 para queda média de 25%)
- **Alimenta:** `stress.resilience` → usado em `reportGenerator.js` narrativa e `portfolio-intel.js → renderStressTests()`
- Escala: 0–100, quanto maior melhor

**Conclusão:** São dois números distintos, ambos chamados "resiliência", com metodologias e valores diferentes. A label do ecrã principal mostra o da Definição A.

---

### 1.6 Dados de crise: `SCENARIOS` vs `CRISIS_DROPS`

**`SCENARIOS` em `stress-test.js`** (7 cenários, dados a nível setorial):
```
covid_2020, gfc_2008, dotcom_2000, rate_hike_2022, tech_bear, energy_crisis, global_recession
```
- Cada cenário tem: `sectorDrops` (por setor), `defaultDrop`, `recoveryMonths`, `duration`
- **Usado por:** `stressTest()` → chamado em `portfolio-intel.js` e `reportGenerator.js`

**`CRISIS_DROPS` em `risk.js:14`** (5 crises, dados simples):
```js
const CRISIS_DROPS = {
  covid: { name: "COVID-19", avgDrop: -0.34, techDrop: -0.32, energyDrop: -0.55 },
  gfc: { name: "Crise Financeira", avgDrop: -0.56, ... },
  ...
}
```
- **Confirmado código morto:** não é referenciado em nenhuma função, não é exportado. Nunca influencia nenhum output.

---

## FASE 2 — CONTRADIÇÕES

### (A) Divergência de score do mesmo ativo entre ecrãs

**Três causas confirmadas, com exemplo numérico:**

Assunção: utilizador tem `strategy.macroRegime = "risk_on"` e `strategy.styleAlloc = {growth:25, value:25, div:25, qual:25}`.

**Caminho Mesa de Análise (`analise.js` → `calculateLucroMaximoScore` → `applyAdaptiveScoring`):**

Para VWCE (ETF com `readiness.ready=true`):
1. Chama `scoreAssetV2(vwce, v1MultipliersToV2(null))` = `scoreAssetV2(vwce, null)`
2. Regime default `"high_rates"` → `weightAdjust = {quality:1.2, momentum:0.8, valuation:1.5, risk:1.0}`
3. BASE_WEIGHTS após regime: quality=0.420, momentum=0.120, valuation=0.450, risk=0.200 → normaliz.: Q=0.353, M=0.101, V=0.378, R=0.168
4. Ajuste ETF: Q×0.8, V×0.7, M×1.2, R×1.5 → normaliz.: **Q≈0.307, M≈0.132, V≈0.288, R≈0.274**
5. Sem multiplicadores de estilo.

**Caminho Portfolio Intel (`portfolio-intel.js` → `scoreAssetV2` direto):**

Para VWCE:
1. Chama `scoreAssetV2(vwce, styleToMultipliers({growth:25,value:25,div:25,qual:25}), "risk_on")`
2. `styleMult = {quality:1.50, momentum:1.375, valuation:1.50, risk:1.375}`
3. Regime `"risk_on"` → `weightAdjust = {quality:0.8, momentum:1.5, valuation:0.7, risk:0.6}`
4. BASE_WEIGHTS após regime → normaliz.: Q=0.347, M=0.250 (após cap), V=0.259, R=0.144
5. Ajuste ETF: Q×0.8, V×0.7, M×1.2, R×1.5 → normaliz. prévia: Q=0.278, M=0.300, V=0.181, R=0.216
6. Após styleMult: Q×1.50, M×1.375, V×1.50, R×1.375 → **Q≈0.298, M≈0.295, V≈0.194, R≈0.212**

**Resultado:** O peso do **momentum varia de 13% para 30%** para o mesmo ativo. Para um ativo com momentum forte, isso pode produzir uma diferença de 8–15 pontos no score final.

**Causa 1 — Dois transformadores de estilo:**
`v1MultipliersToV2(null)` → sem ajuste de estilo. `styleToMultipliers(styleAlloc)` → boost de 50% em quality e valuation. Para o mesmo utilizador com as mesmas preferências.

**Causa 2 — Regime inconsistente:**
Mesa de Análise usa sempre `"high_rates"` (momentum penalizado). Portfolio Intel usa o regime real do utilizador (ex. `"risk_on"` onde momentum é boosted de 1.5×). O resultado diverge especialmente para ativos com forte momentum.

**Causa 3 — Gating por readiness:**
Para ativos com dados finos (ex. ação sem roic/roe/beta), `readiness.ready=false` → Mesa de Análise retorna modo "hybrid" ou "legacy" (cálculo completamente diferente com pesos R/V/T/D/E/S e escala 0–1 sem shrinkage nem prior). Portfolio Intel passa esses mesmos ativos por `scoreAssetV2` diretamente e obtém V2 completo com prior de 50 e shrinkage.

---

### (B) HEALTHY_LIMITS duplicado com valores diferentes — **Bug claro**

`risk.js` tem cópia local de `HEALTHY_LIMITS` com valores **mais restritivos** que `normalize.js`:

| Categoria | normalize.js (fonte) | risk.js (local) | Diferença |
|---|---|---|---|
| Single Stock | 10% | **8%** | -2pp |
| Sector ETF | 25% | **20%** | -5pp |
| Thematic ETF | 15% | **10%** | -5pp |
| Speculative Asset | 5% | **4%** | -1pp |
| Satellite Asset | 8% | **5%** | -3pp |
| Commodity | 12% | **ausente** → usa `|| 0.10` fallback (10%) | |

**Impacto visível:** `calculateConcentrationRisk()` (usada para "Risco Concentração" no Portfolio Intel) e `rebalanceSuggestions()` (usada para "Rebalanceamento") discordam para os mesmos ativos. Uma ação a 9% é "OK" para rebalance mas "em concentração" para risk decomposition.

---

### (C) Limiar setorial triplo — Divergência de estratégia a reconciliar

| Motor | Limiar | Ação |
|---|---|---|
| `sizing.js` `RULES.maxSectorExposure` | **30%** | Bloqueia/avisa novas entradas |
| `rebalance.js` `SECTOR_LIMIT` | **35%** | Sugere redução setorial |
| `risk.js` `portfolioRiskDecomposition` | **>40%** | Penaliza em macroRisk score |

Os três são independentes e podem dar mensagens contraditórias. Com 32% num setor: sizing avisa, rebalance não sugere nada, risk não penaliza.

Adicionalmente, `portfolioRiskDecomposition` usa o setor **em bruto** (Bug E abaixo), agravando a inconsistência.

---

### (D) Duas definições de "resiliência" — Decidir canónica

Ver §1.5. Ambas estão no mesmo ecrã (Portfolio Intel), sob nomes similares mas com valores e metodologias distintas. O "RESILIÊNCIA %" exibido vem de `riskDecomp.resilienceScore` (Definição A). O `stress.resilience` (Definição B) aparece no texto do stress test mas não está explicitamente labelado como "resiliência" no ecrã.

**Impacto:** o utilizador pode ver 72% de resiliência (A) mas stress resilience de 45% (B) sem entender a diferença.

---

### (E) `portfolioRiskDecomposition` usa setor bruto sem `normalizeSector` — **Bug claro**

Em `risk.js:76–78`:
```js
const sectorMap = {};
for (const p of portfolio) {
  const s = String(p.mkt?.setor || p.setor || "Outros");  // sem normalizeSector!
  sectorMap[s] = (sectorMap[s] || 0) + ...;
}
```

"Technology" e "Tecnologia" são contados como dois setores distintos. "TECNOLOGIA", "Tecnologia", "tech" também. Se o portfolio tiver AAPL (`setor="Technology"`) + CEG (`setor="Energia"`) + NVDA (`setor="Tecnologia"`), o macroRisk da seção Tech nunca ultrapassa o limiar de 40% mesmo que a exposição real seja 50%.

O bug também se propaga para `calculateConcentrationRisk()` pois usa a mesma `portfolioRiskDecomposition` indiretamente... não, espera: `calculateConcentrationRisk` usa `getAssetCategory` (correto). Mas `portfolioRiskDecomposition → sectorMap` usa string bruta. O output `decomposition.macro` está portanto subavaliado sempre que há inconsistência nos campos `setor`.

---

### (F) `CRISIS_DROPS` em `risk.js` — código morto confirmado

```js
const CRISIS_DROPS = {
  covid: { name: "COVID-19 (2020)", avgDrop: -0.34, techDrop: -0.32, energyDrop: -0.55 },
  ...
}
```

- Definido como `const` local (linha 14).
- Não é referenciado em nenhuma função de `risk.js`.
- Não é exportado.
- Não é importado em nenhum outro ficheiro.
- O `stressTest` em `stress-test.js` tem os seus próprios dados completos (`SCENARIOS`) com mais detalhe.

Duplica parcialmente `SCENARIOS` com valores ligeiramente diferentes (ex. covid avgDrop=-0.34 em ambos, mas CRISIS_DROPS tem techDrop=-0.32 vs SCENARIOS.covid_2020.sectorDrops.Tecnologia=-0.28).

---

### (G) Bug de unidades em `getReforcoSuggestion` — **Bug claro**

Em `decisionHelpers.js:73–80`:
```js
const quedaAbs = -drawdown * 100;  // ex: drawdown=-0.15 → quedaAbs=15
let pctReforco = 0.25;
if (quedaAbs >= 0.30) pctReforco = 1.0;    // 15 >= 0.30 → SEMPRE TRUE
else if (quedaAbs >= 0.20) pctReforco = 0.75;
else if (quedaAbs >= 0.10) pctReforco = 0.50;
else if (quedaAbs >= 0.05) pctReforco = 0.25;
```

**Problema:** `quedaAbs` está em percentagem (valor=15 para queda 15%) mas os thresholds são frações (0.30, 0.20, ...). Para qualquer queda > 0.3% (ou seja, praticamente sempre), `quedaAbs >= 0.30` é verdade → `pctReforco = 1.0` **sempre**.

**Resultado para o utilizador:** o reforço sugerido é sempre 100% do investido atual, independentemente da queda real. Uma queda de 1% e uma de 25% produzem a mesma sugestão.

**Correção:** os thresholds devem ser `30`, `20`, `10`, `5` (em unidades de %).

---

### (H) Três escadas de crise — Reconciliar com plano documentado

**Escada 1 — `getCrisisDeployment` (`capitalManager.js:129`):**
| Queda mercado | % war chest a mobilizar |
|---|---|
| ≥ 5% | 10% |
| ≥ 10% | 30% |
| ≥ 20% | 60% |
| ≥ 30% | 100% |

**Escada 2 — `getReforcoSuggestion` (`decisionHelpers.js`) — BUGGED:**
(Intenção original: 5%→25%, 10%→50%, 20%→75%, 30%→100% do *investido na posição*)
Atualmente retorna sempre 100% devido ao Bug G.

**Escada 3 — Filosofia documentada:**
- -15%: mobilizar metade da reserva (50%)
- -20%: mobilizar o restante (100%)

**Divergência tripla:** Nenhuma das três escadas corresponde ao plano documentado. A escada 1 começa em 5% (muito cedo) e usa 60% a -20% (não 100%). A filosofia usa -15% como primeiro gatilho.

**`dashboard.js:836` — 0.1 hardcoded:**
```js
getCrisisDeployment(0.1, recommendation.amount).amountToDeploy
```
A dashboard mostra sempre "Se o mercado cair 10%..." com 0.1 fixo. Não reflete o plano nem é configurável.

---

### (I) Reserva-alvo 40% (capitalManager NEUTRAL) vs ~20% documentado — **Divergência de estratégia**

`capitalManager.js:18–19`:
```js
NEUTRAL: { reserveMin: 0.30, reserveMax: 0.50, ... }  // mid = 40%
```
`UNDERVALUED: { reserveMin: 0.10, reserveMax: 0.25 }` // mid = 17.5%
`OVERVALUED: { reserveMin: 0.60, reserveMax: 0.80 }`  // mid = 70%

A filosofia diz **~20%** de reserva de liquidez. O estado NEUTRAL implica 40% (médio de [30%, 50%]). Só UNDERVALUED (17.5%) se aproxima dos 20% documentados, mas esse estado implica "mercado barato" — condição que não é a normal.

**Pergunta para o utilizador:** os valores de CAPITAL_STRATEGY devem ser ajustados? Proposta na Fase 3.

---

### (J) Dupla canonicalização de ticker + comentário enganador + chave morta

**`canonicalTicker` vs `cleanTicker`:**
- `canonicalTicker(ticker)` em `normalize.js:129`: exportado, trata `XETR:DAVV`, `DAVV:FRA:EUR`, `VWCE.DE`, aplica ALIASES map
- `cleanTicker(t)` em `scoring.js:506`: lógica similar mas sem ALIASES, sem mapa de deduplicação

Ambos coexistem e são usados em ficheiros diferentes. `portfolio-intel.js:122` chama `canonicalTicker(cleanTicker(x.ticker))` — redundante mas funcional.

**Comentário enganador em `normalize.js:127`:**
```js
 * Examples: "VWCE.DE" -> "VWCE", "QDVF.DE" -> "QDVE", "VOO.US" -> "VOO"
```
O mapeamento `QDVF → QDVE` **não existe** no objeto `ALIASES` (linhas 143–151). QDVF e QDVE existem como tickers separados em `thematicTickers` (normalize.js:190) e `getAssetType` (scoring.js:473–474). Se o utilizador tem dados de QDVF na BD, eles nunca são fundidos com QDVE.

**Chave "Crypto" morta em `HEALTHY_LIMITS` de `normalize.js`:**
`getAssetCategory()` nunca retorna `"Crypto"` — retorna `"Speculative Asset"` para BTC/ETH/etc. A chave `Crypto: 0.05` é letra morta.

---

### (K) `getEstrategiaAlternativa` incentiva vender-e-recomprar — Marcar como informativo

Em `decisionHelpers.js:103–116`:
```js
export function getEstrategiaAlternativa(lucroAtual, precoAtual, qtd) {
  // Calcula "preço de reentrada" para venda com prejuízo + recompra mais barato
  ...
}
```

Esta função é chamada nos cards de atividade e apresenta um "Preço de Reentrada" que implicitamente incentiva a venda seguida de recompra para realizar prejuízo fiscal. Isso contradiz a filosofia "nunca vender o núcleo VWCE, sem market timing". Deve ser relabelada como "Estratégia Alternativa (apenas informativa)" e não recomendada como ação.

---

## SUMÁRIO DE SEVERIDADE

| ID | Tipo | Severidade | Impacto no utilizador |
|---|---|---|---|
| B | Bug claro | 🔴 Alto | Mensagens de concentração contraditórias entre ecrãs |
| E | Bug claro | 🔴 Alto | MacroRisk subestimado quando setores têm nomes inconsistentes |
| G | Bug claro | 🔴 Alto | Sugestão de reforço sempre 100% do investido |
| A | Causa-raiz divergência | 🟠 Médio-Alto | Mesmo ativo → scores diferentes em ecrãs diferentes (8–15 pts) |
| C | Divergência estratégia | 🟠 Médio | Limiar setorial triple → mensagens contraditórias |
| D | Ambiguidade | 🟡 Médio | Dois "resiliência" sem distinção clara |
| F | Código morto | 🟡 Baixo | Nenhum (não afeta outputs, confunde manutenção) |
| H | Divergência plano | 🟠 Médio | Escada de crise não alinhada com filosofia documentada |
| I | Divergência estratégia | 🟠 Médio-Alto | Reserva recomendada 40% vs 20% documentado |
| J | Qualidade código | 🟡 Baixo | Risco de deduplicação incorreta de tickers |
| K | Filosofia | 🟡 Baixo | Incentivo implícito a timing (informativo) |
