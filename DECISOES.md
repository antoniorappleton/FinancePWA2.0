# DECISOES.md

## Adenda D9: Avaliação à luz de crises, bolhas e histórico
**Prompt de execução para o Claude Code.** Objetivo: elevar a app de "boa estrutura" para "avaliação robusta de qualquer portfólio à luz de crashes, ciclos de crescimento, bolhas e valuation integrado com o histórico da própria empresa". Executar por passos pequenos, verificáveis, aditivos.

### Regras anti-erro (todas as tarefas)
1. **Aditivo, nunca destrutivo.** Cada nova camada (histórico, bolha, correlação de crise) é um *complemento*; se os dados faltarem, o motor **degrada para o comportamento atual com confiança mais baixa** — nunca falha nem penaliza o ativo por lhe faltar histórico.
2. **Um conceito por commit**, com teste que falha antes / passa depois.
3. **Scorecards e report renderizam sempre**; sem imports indefinidos.
4. **Não alterar** a filosofia (VWCE nunca vendido, sem timing) nem os motores de score/reserva já fixados (D5/D7/D8).
5. Ao fim de cada passo: Portfolio Intelligence abre, consola limpa, 7 scorecards presentes.

---

### D9.1 — Fechar o vocabulário de setor no stress test · **Bug ativo**
Em `engines/stress-test.js`, adicionar **"Utilidades"** e **"Comunicações"** a `sectorDrops` nos 7 cenários (valuation/quality/correlation já as têm; só o stress falta). Valores com base histórica:
- **Utilidades** (defensivas, sensíveis a taxas): covid -0.10 · gfc_2008 -0.30 · dotcom -0.10 · rate_hike_2022 -0.25 · tech_bear -0.05 · energy_crisis -0.12 · global_recession -0.20.
- **Comunicações** (tech-like no dotcom, mista noutros): covid -0.20 · gfc_2008 -0.40 · dotcom -0.60 · rate_hike_2022 -0.30 · tech_bear -0.35 · energy_crisis -0.12 · global_recession -0.35.
- *Aceitação:* EDP, CEG, QDVK apanham o drop de Utilidades (não o `defaultDrop`); GOOGL/META/NOS apanham Comunicações. O 2008 do portfólio deve descer de -53% para perto de -50%.

### D9.2 — Valuation relativa ao histórico da própria empresa · **A maior lacuna**
O `engines/valuation.js` é só relativo ao setor. Adicionar uma camada **time-series**: comparar o múltiplo atual (PE, PB, EV/EBITDA) com a **mediana e o percentil dos últimos 5–10 anos da própria empresa**.
- **Primeiro, verificar a disponibilidade dos dados** (ver "Ficheiros necessários"): se `acoesDividendos` guardar séries/agregados históricos (ex.: `pe_hist_median_5y`, `pe_percentil`), consumi-los; se não existirem, criar os campos e um passo de ingestão a partir da ferramenta de reconstrução P/E que já existe.
- **Score final de valuation = combinação** do relativo-ao-setor (cross-sectional) com o relativo-ao-histórico (time-series), ex.: 60/40. Sem histórico → 100% setorial, confiança reduzida (não penalizar).
- Sinalizar `value trap` (barato vs setor mas caro vs próprio histórico) e `re-rating` (caro vs setor mas barato vs próprio histórico).
- *Aceitação:* um ativo a negociar acima do seu percentil 80 histórico é marcado "esticado vs histórico" mesmo que o PE setorial pareça normal; sem dados históricos, o score iguala o atual com flag de confiança.

### D9.3 — Índice de euforia/bolha (ativo e carteira) · **Novo**
Novo módulo `engines/bubble.js` que devolve 0–100 por ativo e agregado, combinando: valuation esticado (percentil histórico alto — D9.2), preço parabólico (1y muito acima da média histórica e distância extrema acima da SMA200), RSI extremo, e — ao nível da carteira — concentração temática num só tema quente (via `thematicExposure`). Emitir aviso a partir de um limiar configurável (`config/strategy.bubbleWarnPct`, default 70) e ligar às observações.
- *Aceitação:* uma carteira concentrada num tema em euforia (valuation alto + parabólico + RSI>75) dispara aviso de bolha; uma carteira equilibrada não.

### D9.4 — Correlação condicional ao regime (realismo de crash) · **Novo**
Em `engines/correlation.js`, manter a matriz setorial como base e aplicar um **uplift em regimes de stress**: em `risk_off`/`recession`, aproximar as correlações de pares de 1 (ex.: `corr_efetiva = corr + (1 - corr) * k`, com `k` ≈ 0.4 nesses regimes, 0 nos normais). O score de resiliência/diversificação passa a refletir que a diversificação falha na crise.
- *Aceitação:* em `recession`, a correlação média sobe e a resiliência desce face ao mesmo portfólio em `risk_on`.

### D9.5 — `detectRegime` alimentado pelo painel de risco · **Novo**
Em `engines/macro.js`, substituir o stub por deteção com o painel que o utilizador já acompanha: **HY OAS + MOVE + VIX** (e curva de juros se disponível), com limiares documentados, para *sugerir* o regime (continua editável em Definições). Regra dos três indicadores (todos em stress → risk_off/recession) alinhada com a filosofia documentada.
- *Aceitação:* com VIX+MOVE+HY OAS todos em stress, `detectRegime` sugere `risk_off`; caso contrário mantém o selecionado pelo utilizador.

### D9.6 — Relatório de cobertura de dados · **Novo (barato, informa tudo)**
Função utilitária que percorre as posições e lista, por ativo, os campos críticos em falta (beta, fundamentais de stock, composição de ETF, histórico de múltiplos). Mostrar no Portfolio Intelligence como "Qualidade de dados: X%". Sem isto, o utilizador não sabe que metade do risco corre sobre placeholders.
- *Aceitação:* a app indica claramente que ativos têm beta/fundamentais/histórico em falta.

---

### Ordem sugerida
**D9.1 (bug) → D9.6 (cobertura) → D9.2 (histórico) → D9.3 (bolha) → D9.4 (correlação de crise) → D9.5 (regime).**
D9.2–D9.5 são as que dão a "consciência histórica"; D9.1 e D9.6 destravam e informam.

### Encerramento
Gerar `RESUMO_D9.md`: o que ficou parametrizado, que campos de dados novos são precisos, e que ativos ainda não têm histórico/beta para a avaliação plena.
