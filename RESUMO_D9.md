# RESUMO_D9.md — Execução da Adenda D9

Estado após execução de [DECISOES.md](DECISOES.md) (Adenda D9). Todos os passos são aditivos: nenhum motor existente foi removido ou teve o seu comportamento por defeito alterado quando os dados novos faltam.

## O que ficou parametrizado

### D9.1 — Vocabulário de setor no stress test (bug corrigido)
`js/engines/stress-test.js`: "Utilidades" e "Comunicações" adicionados a `sectorDrops` nos 7 cenários (valores documentados na Adenda D9.1). Antes, estes dois setores caíam sempre no `defaultDrop` genérico do cenário. Testado: script ad-hoc confirma falha antes / passagem depois, incluindo verificação num snapshot pré-fix extraído do git HEAD.

### D9.6 — Relatório de cobertura de dados
Novo `js/engines/data-coverage.js` (`dataCoverageReport`). Por ativo, verifica: Beta, Fundamentais de stock (PE, ROIC, ROE, D/E, EPS YoY) ou Composição de ETF (TER, nº holdings) consoante a categoria, e Histórico de múltiplos (campos D9.2). Devolve `overallPct` (média ponderada por valor) e lista de ativos com dados em falta. Integrado no ecrã Portfolio Intelligence como "📊 Qualidade de dados: X%" (novo cartão no topo dos resultados, `js/screens/portfolio-intel.js` + `screens/portfolio-intel.html`).

### D9.2 — Valuation relativa ao histórico da própria empresa
`js/engines/valuation.js`: nova camada time-series (`scoreHistoricalPE`) que lê `pe_percentil` (percentil do PE actual nos últimos 5-10 anos da própria empresa) e `pe_hist_median_5y`. Quando disponível, o score final de valuation passa a ser 60% cross-sectional (vs. setor) + 40% time-series (vs. próprio histórico); sem dados, mantém-se 100% setorial e marca `historicalConfidence: "reduzida"`. Duas flags novas: `value_trap` (barato vs. setor, caro vs. próprio histórico) e `re_rating` (caro vs. setor, barato vs. próprio histórico); classificação ganha o sufixo "— esticado vs histórico" sempre que o percentil próprio ≥ 80, mesmo que o PE setorial pareça normal.

**Achado da verificação de disponibilidade de dados (obrigatória antes deste passo):** nenhum documento em `acoesDividendos` tem `pe_percentil` ou `pe_hist_median_5y` — nem existe no repositório qualquer "ferramenta de reconstrução P/E" (procurado em `scratch/`, `js/`, `*.py`, `*.gs`; nada encontrado). A premissa da Adenda D9.2 sobre essa ferramenta já existir não se confirmou. A camada está pronta e testada, mas hoje **degrada sempre para 100% setorial** em todos os ativos — sem efeito visível até existir uma ingestão real de histórico de múltiplos (ver secção "Campos novos" abaixo).

### D9.3 — Índice de euforia/bolha
Novo `js/engines/bubble.js`: `assetBubbleScore` (0–100 por ativo, combina percentil de valuation D9.2, distância à SMA200, retorno 1y, RSI) e `portfolioBubbleIndex` (agregado ponderado por valor + bónus de concentração temática quando o tema dominante tem exposição ≥30% e score médio ≥60). Limiar de aviso configurável via `config/strategy.bubbleWarnPct` (default 70). Ligado a `generatePortfolioObservations` (`js/engines/observations.js`) — emite observação `warning` quando `bubble.warning` é verdadeiro. Wired em `runFullAnalysis()` de `portfolio-intel.js`.

### D9.4 — Correlação condicional ao regime
`js/engines/correlation.js`: `correlationMatrix(portfolio, regime)` aceita agora o regime macro. Em `risk_off`/`recession`, cada correlação de par é ajustada por `corr + (1 - corr) * 0.4` antes de entrar na matriz, na deteção de clusters e no `avgCorrelation`. Em regimes normais, `k=0` (comportamento idêntico ao anterior). `portfolio-intel.js` e `reportGenerator.js` passam o `regime` já resolvido de `config/strategy.macroRegime`. Verificado: mesma carteira tem `avgCorrelation` mais alta e `resilienceScore` (`risk.js`) mais baixo em `recession` do que em `risk_on`.

### D9.5 — `detectRegime` alimentado pelo painel de risco
`js/engines/macro.js`: `detectRegime({ hyoas, move, vix, yieldCurve })` substitui o stub anterior. Limiares alinhados com as zonas "Stress" já usadas em `js/screens/risco-panel.js` (HY OAS > 6%, MOVE > 150, VIX > 30). Regra dos três indicadores: só sugere regime quando os 3 estão simultaneamente em stress (`risk_off`, ou `recession` se a curva de juros estiver invertida); caso contrário devolve `null` para que o chamador **preserve o regime escolhido pelo utilizador** em vez de o substituir silenciosamente. Fallback legado (`vix`/`inflation`/`fedRate`) mantido para compatibilidade, também sem forçar um default quando nada dispara.

**Nota de integração:** não encontrei nenhum controlo de UI existente para `config/strategy.macroRegime` em Definições (procurado em `settings.html`/`settings.js`) — o campo parece ser editado directamente no Firestore. `detectRegime` está pronto e testado, mas não foi ligado a um badge de sugestão no ecrã porque não há hoje um selector de regime para anexar essa sugestão. Fica como follow-up se for pedido.

### Task à parte — Sugestões de compra/venda removidas
Antes do D9, foi removido o plano de ações do Portfólio Inteligente ("Reforçar"/"Reduzir", "MODO SEM LIMITES ACTIVO", "Plano core-protected...") em `js/screens/portfolio-intel.js` e `screens/portfolio-intel.html`. O gráfico da Fronteira Eficiente (Monte Carlo, 1200 simulações) e os KPIs de Sharpe mantêm-se — só o plano de ações accionável foi retirado. A função `protectCoreAnchorWeights`, usada só por esse plano, foi removida por estar morta.

## Campos de dados novos necessários (ainda não existem em `acoesDividendos`)
- `pe_percentil` — percentil (0–100) do PE actual na distribuição dos últimos 5–10 anos da própria empresa.
- `pe_hist_median_5y` — mediana do PE próprio nos últimos 5 anos (contexto, não usado no score directamente).
- Consumidos por: `valuation.js` (D9.2) e, por extensão, `bubble.js` (D9.3, componente "valuation esticado"). Sem eles, ambos degradam de forma segura (D9.2 → 100% setorial; D9.3 → essa componente do índice de bolha simplesmente não pesa no score).
- Não existe ferramenta de ingestão/reconstrução destes campos no repositório — é um passo em aberto, separado desta Adenda.

## Ativos sem histórico/beta suficiente para avaliação plena
A partir de um snapshot local (`tmp/current_acoesDividendos_firestore.json`, 129 documentos — pode estar desatualizado face ao Firestore ao vivo):
- **81 de 129 ativos (63%)** não têm `beta` válido (campo ausente ou fora de [0.1, 3.0]) — caem no fallback beta=1.0 do stress test (`validBeta` em `normalize.js`), sinalizado como `betaEstimated: true`.
- **129 de 129 (100%)** não têm `pe_percentil`/`pe_hist_median_5y` — a camada D9.2 está 100% em modo degradado hoje.
- Para uma leitura exacta e actual, por ativo, usar o novo cartão "Qualidade de dados" no Portfolio Intelligence (D9.6), que lê os dados ao vivo do Firestore em vez do snapshot local.

## Verificação
Cada passo tem um script Node ad-hoc em `scratchpad` (falha antes / passa depois, quando aplicável) — não ficaram no repositório por serem descartáveis, conforme combinado. Todos os ficheiros tocados passam `node --check`. Não foi possível correr a app no browser nesta sessão (sem servidor local disponibilizado) — recomenda-se abrir o Portfolio Intelligence manualmente para confirmar visualmente os 7 scorecards e o novo cartão de cobertura de dados antes de dar o D9 como fechado.
