# PLANO_RECONCILIACAO.md — Desenho-alvo (alinhado a DECISOES.md)
**Versão:** 27/06/2026 · Fase 3 finalizada com decisões do utilizador

> Fonte de verdade das decisões: `DECISOES.md`.
> Bugs B/E/G/F/Crypto-morta já implementados nesta sessão — marcados ✅.
> Fases 4–5 (refactoring maior) **precisam de aprovação antes de começar**.

---

## Estado após esta sessão

### ✅ Já implementado (bugs claros, commit-ready)

| Bug | Ficheiro(s) | O que mudou |
|---|---|---|
| **B** — HEALTHY_LIMITS duplicado | `risk.js` | Removida cópia local; importa `HEALTHY_LIMITS` de `normalize.js` |
| **E** — setor bruto sem normalização | `risk.js` | Adicionado `_EN_TO_PT_SECTOR` + `_sectorKey()`; usado em `portfolioRiskDecomposition` |
| **F** — CRISIS_DROPS código morto | `risk.js` | Removido `const CRISIS_DROPS` |
| **G** — thresholds de unidade errada | `decisionHelpers.js` | Corrigido para `5/10/15/25/50` (em %) alinhado com escada D5.2 |
| Crypto morta | `normalize.js` | Removida chave `"Crypto": 0.05` de `HEALTHY_LIMITS` |
| Comentário enganador QDVF | `normalize.js` | Corrigido JSDoc: removido exemplo `"QDVF.DE" -> "QDVE"` |

**Critérios de teste para os bugs implementados:**
```
getReforcoSuggestion(-0.01, 1000, 90, 10) → pctReforco=0, rangeMin=0  (queda <5%)
getReforcoSuggestion(-0.10, 1000, 90, 10) → pctReforco=0.25 (queda 10%)
getReforcoSuggestion(-0.15, 1000, 90, 10) → pctReforco=0.50 (queda 15%)
getReforcoSuggestion(-0.25, 1000, 90, 10) → pctReforco=0.75 (queda 25%)
getReforcoSuggestion(-0.50, 1000, 90, 10) → pctReforco=1.00 (queda 50%)

// HEALTHY_LIMITS["Single Stock"] === 0.10 em todos os pontos de uso
// "Technology" e "Tecnologia" somam no mesmo balde em portfolioRiskDecomposition
```

---

## Decisões canónicas (DECISOES.md)

### D1 — Motor de score único
- `scoreAssetV2` é o único motor.
- `calculateLucroMaximoScore` torna-se **adaptador fino** (chama V2, mapeia resultado para contrato legacy).
- Transformador canónico: `styleToMultipliers`. Remover `v1MultipliersToV2`.
- Regime sempre explícito: lido de `config/strategy.macroRegime`; sem default silencioso.
- Caminhos legacy/hybrid eliminados; V2 + confidence shrinkage lida com dados finos.
- **Critério de aceitação:** mesmo ativo + mesmo styleAlloc + mesmo regime → mesmo número em todos os ecrãs.

### D2 — Cap de ação individual
- Novo campo Firestore: `config/strategy.singleStockCapPct` (default 10).
- Tabela única = `normalize.js` HEALTHY_LIMITS (já feito para Bug B).
- Aviso a 0.8× do cap (ex: 8% se cap=10%).

### D3 — Limiar setorial
- Novo campo Firestore: `config/strategy.sectorConcentrationLimitPct` (default 35).
- Aplica-se **só ao satélite** (exclui Broad Market ETF).
- Um valor usado por `sizing.js`, `rebalance.js` e `risk.js` (macroRisk).

### D4 — "Resiliência"
- "Resiliência" = Definição A (`risk.js → resilienceScore`): correlação/beta/concentração.
- Definição B (`stress-test.js → resilience`) renomeada para **"Robustez em crise"**.

### D5 — Reserva e escada de crise
- Novo campo: `config/strategy.cashReservePct` (default 22; banda neutra 20–25%).
- `CAPITAL_STRATEGY` recentrado: NEUTRAL ≈ 20–25%, OVERVALUED ≈ 30–40%, UNDERVALUED ≈ 10–15%.
- `crisisLadder` como lista configurável em Firestore (default = tabela abaixo).
- `getCrisisDeployment` lê a escada; `dashboard.js:836` remove `0.1` hardcoded.

**Escada canónica (D5.2):**
| Queda | % reserva a mobilizar (cumulativo) |
|---|---|
| -5%  | 10% |
| -10% | 25% |
| -15% | 50% |
| -25% | 75% |
| -50% | 100% |

### D6 — Canonicalização de ticker
- `canonicalTicker` é pública; `cleanTicker`/`canon` tornam-se internas/delegam.
- QDVF e QDVE mantêm-se **separados** (são ETFs de setores distintos).
- Comentário enganador em `normalize.js` corrigido ✅.

---

## Fase 4 — Implementação (aguarda aprovação)

### 4.1 Adaptador único + eliminação de legacy/hybrid
**Ficheiros afetados:** `utils/scoring.js`, `engines/score-v2.js`

Passos:
1. Alterar assinatura de `calculateLucroMaximoScore`:
   ```js
   export function calculateLucroMaximoScore(acao, period = "1y", styleAlloc = null, regime = null)
   ```
2. Corpo: chamar sempre `scoreAssetV2(acao, styleToMultipliers(styleAlloc), regime ?? "high_rates")` — o `scoreAssetV2` está em `score-v2.js` (importar de lá).
3. Mapear resultado V2 para contrato legacy:
   ```js
   {
     score: clamp(v2.finalScore / 100, 0, 1),
     components: { R: eng.momentum.score/100, V: eng.valuation.score/100,
                   T: eng.momentum.score/100, D: fallback.D,
                   E: eng.quality.score/100,  S: eng.risk.score/100 },
     mode: "v2",
     v2,                    // objeto V2 completo
     readiness              // para backward compat dos ecrãs que o usam
   }
   ```
4. Remover funções `applyAdaptiveScoring`, `hybridComponents`, `v1MultipliersToV2`, `scoreETF`, `scoreCrypto`, `scoreStock` (são o legacy interno), funções auxiliares sem uso externo (`scorePE`, `scoreEPS`, etc.).
5. `SCORING_CFG` e `getUserWeights` mantêm-se para outros consumidores que os usem diretamente (verificar).

### 4.2 Transformador único de estilo
**Ficheiros afetados:** `utils/scoring.js`, `screens/analise.js`, `screens/dashboard.js`, `screens/simulador.js`, `screens/settings.js`

Passos:
1. Remover `v1MultipliersToV2` de `scoring.js` (já é letra morta após 4.1).
2. `settings.js:533` e `simulador.js:781`: alterar para passar `styleAlloc` (formato `{growth,value,div,qual}`) em vez de `styleAdjWeights` (formato v1). Estes ecrãs já têm acesso a `strategy.styleAlloc` ou equivalente.
3. Garantir que `styleToMultipliers` é o único ponto de conversão estilo→multiplicadores.

### 4.3 Regime explícito em todos os caminhos
**Ficheiros afetados:** `screens/analise.js`, `screens/dashboard.js`, `screens/simulador.js`, `screens/settings.js`, `components/asset-deep-panel.js`

Passos:
1. Cada um destes ecrãs já faz (ou deve fazer) fetch de `config/strategy`. Expor `strategy.macroRegime` como parâmetro em `calculateLucroMaximoScore`.
2. `asset-deep-panel.js`: ler `window._strategy?.macroRegime` (exposto pelo ecrã pai via `window._strategy`).
3. Se regime não disponível, usar `"high_rates"` mas logar `console.warn("[scoring] regime não definido, usando 'high_rates' como fallback")`.

### 4.4 Limites dinâmicos via config
**Ficheiros afetados:** `utils/normalize.js`, `engines/sizing.js`, `engines/rebalance.js`, `engines/risk.js`

Passos:
1. Adicionar campos a `config/strategy`: `singleStockCapPct`, `sectorConcentrationLimitPct`, `cashReservePct`, `crisisLadder`.
2. Criar helper `getConcentrationLimits(strategy)` que retorna HEALTHY_LIMITS com override de `singleStockCapPct`:
   ```js
   export function getConcentrationLimits(strategy = {}) {
     const cap = Number(strategy.singleStockCapPct || 10) / 100;
     return { ...HEALTHY_LIMITS, "Single Stock": cap };
   }
   ```
3. `sizing.js`: substituir `RULES.maxSinglePosition = 0.10` por `getConcentrationLimits(strategy)["Single Stock"]`.
4. `rebalance.js`: substituir `SECTOR_LIMIT = 0.35` por `(strategy.sectorConcentrationLimitPct || 35) / 100`.
5. `risk.js → portfolioRiskDecomposition`: substituir limiar `0.40` por `(strategy.sectorConcentrationLimitPct || 35) / 100`.

### 4.5 Política de capital recentrada
**Ficheiros afetados:** `utils/capitalManager.js`, `screens/dashboard.js`

Passos:
1. Refatorar `CAPITAL_STRATEGY` para ser gerada a partir de `cashReservePct`:
   ```js
   export function buildCapitalStrategy(cashReservePct = 22) {
     const base = cashReservePct / 100;
     return {
       OVERVALUED:   { reserveMin: base * 1.4, reserveMax: base * 1.8, dcaFactor: 0.5 },
       NEUTRAL:      { reserveMin: base * 0.9, reserveMax: base * 1.1, dcaFactor: 1.0 },
       UNDERVALUED:  { reserveMin: base * 0.4, reserveMax: base * 0.7, dcaFactor: 1.5 }
     };
   }
   ```
2. Refatorar `getCrisisDeployment(drawdown, currentWarChest, crisisLadder)` para ler a escada de `crisisLadder` (default = D5.2 table).
3. `dashboard.js:836`: substituir `getCrisisDeployment(0.1, ...)` por `getCrisisDeployment(firstRungs[0].drawdownPct / 100, ...)` onde `firstRungs` vem da `crisisLadder`.

### 4.6 Resiliência vs Robustez em crise (D4)
**Ficheiros afetados:** `engines/stress-test.js`, `screens/portfolio-intel.js`, `utils/reportGenerator.js`

Passos:
1. `stress-test.js`: renomear campo `resilience` → `robustnessCrisis` no retorno de `stressTest()`.
2. `portfolio-intel.js → renderStressTests`: atualizar referência de `stress.resilience` → `stress.robustnessCrisis` e label "Robustez em crise".
3. `reportGenerator.js`: atualizar referência na narrativa.

### 4.7 Canonicalização de ticker (D6)
**Ficheiros afetados:** `utils/scoring.js`, `utils/normalize.js`

Passos:
1. Mover `canon` e `normalizeSector` de `scoring.js` para `normalize.js` (sem alterar comportamento).
2. `scoring.js`: re-exportar de `normalize.js` para backward compat: `export { canon, normalizeSector } from "../utils/normalize.js"`.
3. `cleanTicker` em `scoring.js`: deprecar internamente — passar a delegar em `canonicalTicker` de `normalize.js`.
4. `portfolio-intel.js:122`: simplificar `canonicalTicker(cleanTicker(x.ticker))` → `canonicalTicker(x.ticker)`.

### 4.8 Labels informativos (K)
**Ficheiros afetados:** `screens/atividade.js` (ou onde for chamado `getEstrategiaAlternativa`)

Passos:
1. Localizar todos os pontos onde `getEstrategiaAlternativa` é renderizado.
2. Adicionar label "Estratégia alternativa (apenas informativa)" e não mostrar para ativos de categoria `"Broad Market ETF"`.

---

## Fase 5 — Testes e verificação

### Unitários (critérios de aceitação obrigatórios)

```js
// D1 — Paridade de score
const s1 = scoreAssetV2(vwce, styleToMultipliers(alloc), regime).finalScore;
const s2 = calculateLucroMaximoScore(vwce, "1y", alloc, regime).v2.finalScore;
assert(s1 === s2); // mesmo número em ambos os caminhos

// D2 — Limites
assert(getConcentrationLimits({ singleStockCapPct: 8 })["Single Stock"] === 0.08);
assert(HEALTHY_LIMITS["Commodity"] === 0.12);
assert(!("Crypto" in HEALTHY_LIMITS)); // chave morta removida ✅

// D5 — Escada correta
assert(getReforcoSuggestion(-0.03, 1000, 90, 10).rangeMin === 0);   // <5% → sem reforço ✅
assert(getReforcoSuggestion(-0.10, 1000, 90, 10).rangeMin > 0);     // 10% → reforço ✅
assert(getReforcoSuggestion(-0.50, 1000, 90, 10).rangeMax > 0);     // 50% → reforço máx ✅

// E — Normalização setorial
const portfolio = [
  { valAtual: 2000, mkt: { setor: "Technology" } },
  { valAtual: 2000, mkt: { setor: "Tecnologia" } },
  { valAtual: 6000, mkt: { setor: "Outros" } }
];
const { decomposition } = portfolioRiskDecomposition(portfolio, 10000, 0.3);
// "Technology" e "Tecnologia" agora somam → 40% Tech → macroRisk > 0
assert(decomposition.macro > 0);
```

### Regressão
- Score médio ponderado (V2) do portfolio conhecido (investido 7428,82 €, VWCE ~68,6%) não deve variar mais de ±2 pontos após o refactor.
- Nenhuma posição aberta deve desaparecer da lista após as alterações.

---

## Esquema de config final (`config/strategy`)

```js
{
  // Já existentes
  macroRegime: "high_rates",                    // string
  styleAlloc: { growth:25, value:25, div:25, qual:25 },

  // Novos (Fase 4)
  singleStockCapPct: 10,                        // number (D2)
  sectorConcentrationLimitPct: 35,              // number (D3)
  cashReservePct: 22,                           // number (D5)
  crisisLadder: [                               // array (D5.2)
    { drawdownPct: 5,  deployPct: 10 },
    { drawdownPct: 10, deployPct: 25 },
    { drawdownPct: 15, deployPct: 50 },
    { drawdownPct: 25, deployPct: 75 },
    { drawdownPct: 50, deployPct: 100 }
  ]
}
```

Todos os motores leem daqui. Nenhum limite hardcoded sobrevive.

---

## ⏸ AGUARDA APROVAÇÃO PARA FASE 4

Responde "avançar" (ou com ajustes específicos) para dar início à implementação.

A ordem recomendada é: **4.1 → 4.2 → 4.3** (motor unificado primeiro) → **4.4 → 4.5** (config dinâmica) → **4.6 → 4.7 → 4.8** (housekeeping).
