# cartola-silvas-fc-api

Backend proxy do Cartola FC para o aplicativo Meu Time Ideal Web.

Este servidor evita que a versao Web do app Flutter precise chamar diretamente `https://api.cartolafc.globo.com` a partir do navegador, reduzindo problemas de CORS. As rotas retornam dados reais da API oficial do Cartola FC, sem mocks, fallbacks ficticios ou alteracao silenciosa do conteudo recebido.

A Build 5.2.12 adiciona avaliacao prospectiva da fonte pre-jogo e auto-captura segura antes do deadline, preservando CORS Netlify, laboratorio historico offline, Motor SLVS oficial, `AVAILABILITY_V1`, `AVAILABILITY_V2_CALIBRATED`, threshold oficial 0.50 e automacao de snapshots vivos em `READY`. Os indices abaixo sao sinais internos SLVS explicaveis; nao sao probabilidades oficiais.

## Endpoints

### `GET /`

Retorna informacoes basicas do servico:

```json
{
  "service": "cartola-silvas-fc-api",
  "status": "online",
  "version": "5.2.12",
  "focus": "Brasileirao/Cartola FC"
}
```

### `GET /health`

Endpoint simples para monitoramento:

```json
{
  "status": "ok",
  "timestamp": "2026-07-08T00:00:00.000Z",
  "uptime": 12.34
}
```

### `GET /cartola/mercado`

Proxy para:

```text
https://api.cartolafc.globo.com/atletas/mercado
```

### `GET /cartola/status`

Proxy para:

```text
https://api.cartolafc.globo.com/mercado/status
```

### `GET /cartola/partidas`

Proxy para:

```text
https://api.cartolafc.globo.com/partidas
```

### `GET /cartola/times?q=NOME`

Proxy para:

```text
https://api.cartolafc.globo.com/times?q=NOME
```

O parametro `q` e obrigatorio. Buscas vazias retornam HTTP 400.

Exemplo:

```bash
curl "http://localhost:3000/cartola/times?q=Silvas"
```

### `GET /cartola/time/:timeId`

Proxy para:

```text
https://api.cartolafc.globo.com/time/id/:timeId
```

Retorna o elenco publico real do time no Cartola FC, incluindo os campos enviados pela API oficial, como time, atletas, reservas, capitao, formacao, patrimonio, pontos, rodada e dados do tecnico.

O parametro `timeId` e obrigatorio e deve ser um numero inteiro positivo.

Exemplo:

```bash
curl "http://localhost:3000/cartola/time/16068219"
```

### `GET /diagnostics/team-context`

Diagnostico read-only de um confronto real. Aceita `matchId` ou o par
`homeClubId` + `awayClubId`. Retorna forca ofensiva/defensiva, forma recente,
desempenho casa/fora, descanso, congestionamento, risco de rodizio como
estimativa SLVS, SG estimate, risco de sofrer gol e oportunidade ofensiva.

Exemplo:

```bash
curl "http://localhost:3000/diagnostics/team-context?homeClubId=263&awayClubId=277"
```

O diagnostico tambem inclui comparacao de goleiros encontrados no mercado real
(incluindo Ivan, Pedro Rangel, Everson, Rossi e Carlos Miguel quando presentes),
sem criar jogadores ausentes.

### `GET /brasileirao/formation-contract`

Contrato read-only das formacoes que o Flutter pode consumir. Inclui 4-3-3,
4-4-2, 3-4-3, 3-5-2, 5-3-2 e 4-5-1. O backend nao monta times nesta build.

### `GET /cartola/reserve-rules-contract`

Explicita o que o endpoint publico do Cartola fornece sobre reservas e o que
continua indisponivel. Quantidade, posicoes permitidas, substituicao e Reserva
de Luxo permanecem `null` enquanto nao houver uma fonte oficial versionada.

### `GET /historical/2026/coverage`

Retorna a cobertura historica persistida localmente para 2026. Nao faz coleta externa durante a requisicao.

### `GET /historical/2026/rounds`

Lista as rodadas historicas persistidas.

### `GET /historical/2026/round/:round`

Retorna os dados pos-rodada persistidos da rodada.

### `GET /historical/2026/round/:round/pre`

Retorna o arquivo pre-rodada persistido no schema `historical-pre-round-data/v2`, com provenance por campo, elegibilidade por atleta e checagem de vazamento.

### `GET /historical/2026/round/:round/post`

Retorna os dados pos-rodada persistidos.

### `GET /historical/2026/round/:round/validation`

Retorna o relatorio de validacao cruzada da rodada.

### `GET /historical/2026/backtest-readiness`

Retorna a prontidao por rodada para backtest sem vazamento.

### `GET /historical/2026/leakage-report`

Retorna o resultado do verificador de vazamento dos arquivos pre-rodada.

### `GET /historical/2026/scout-divergences`

Retorna a analise agregada das divergencias de scouts.

## CORS

O CORS permite explicitamente origens locais de desenvolvimento e o dominio publico atual:

```text
https://meutimeideal.netlify.app
```

O dominio legado `https://utimeideal.netlify.app` permanece permitido por compatibilidade. Origens locais `localhost` e `127.0.0.1` sao aceitas com portas variaveis. Requisicoes sem `Origin`, como chamadas servidor-servidor ou abertura direta no navegador, continuam funcionando sem cabecalho CORS.

Para adicionar outros dominios sem alterar o codigo, use a variavel de ambiente `ALLOWED_ORIGINS` com valores separados por virgula:

```bash
ALLOWED_ORIGINS=https://novo-dominio.com,https://outro-dominio.com
```

## Variaveis de ambiente

| Variavel | Descricao | Padrao |
| --- | --- | --- |
| `PORT` | Porta HTTP do servidor | `3000` |
| `ALLOWED_ORIGINS` | Origens extras permitidas no CORS, separadas por virgula | vazio |
| `CARTOLA_TIMEOUT_MS` | Timeout das chamadas para a API oficial do Cartola | `8000` |

## Execucao local

```bash
npm install
npm start
```

Depois acesse:

```text
http://localhost:3000
```

## Testes

```bash
npm test
```

Os testes usam `node:test` e `assert` nativos.

## Laboratorio historico do motor

A Build 4.7.0 gera artefatos de pesquisa offline a partir dos resultados reais ja persistidos em `data/backtests/2026/build-4.3.2`. O laboratorio nao altera formulas, pesos, Flutter, snapshots vivos, backtests existentes ou dados historicos fonte.

Gerar todos os artefatos:

```bash
npm run research:all
```

Verificar contratos persistidos:

```bash
npm run research:check
```

Comandos individuais:

```bash
npm run research:audit
npm run research:diagnostics
npm run research:ranking
npm run research:ideal-team
npm run research:captain
npm run research:ablation
npm run research:experiments
npm run research:walk-forward
npm run research:promotion-gate
npm run research:multi-round-calibration
npm run research:availability-calibration
npm run research:evidence-dashboard
npm run research:ground-truth-validation
```

Artefatos persistidos:

```text
data/research/2026/audit.json
data/research/2026/engine-diagnostics.json
data/research/2026/ranking-diagnostics.json
data/research/2026/ideal-team-diagnostics.json
data/research/2026/captain-diagnostics.json
data/research/2026/ablation-study.json
data/research/2026/experiments-summary.json
data/research/2026/promotion-gate.json
data/research/2026/research-health.json
data/research/2026/multi-round-calibration.json
data/research/2026/availability-calibration.json
data/research/2026/slvs-evidence-dashboard.json
data/research/2026/ground-truth-validation.json
data/research/2026/ground-truth-topk-audit.json
data/research/2026/experiments/{candidateId}.json
```

Endpoints somente leitura:

- `GET /research/engine-audit`
- `GET /research/engine-diagnostics`
- `GET /research/ranking-diagnostics`
- `GET /research/ideal-team-diagnostics`
- `GET /research/captain-diagnostics`
- `GET /research/ablation-study`
- `GET /research/experiments`
- `GET /research/experiments/:candidateId`
- `GET /research/promotion-gate`
- `GET /research/research-health`
- `GET /research/round-validation/:round`
- `GET /research/multi-round-calibration`
- `GET /research/availability-calibration`
- `GET /research/evidence-dashboard`
- `GET /research/ground-truth-validation`
- `GET /research/ground-truth-topk-audit`

O promotion gate usa `config/engine-experiment-policy.json`, permite apenas `REJECTED`, `INSUFFICIENT_EVIDENCE`, `PROMISING` e `ELIGIBLE_FOR_SHADOW_TEST`, e nunca retorna `PROMOTED` nesta build.

## Contexto real da rodada

A Build 5.2.0 adiciona endpoints read-only para transformar dados reais disponiveis em contexto estruturado para evolucao futura do Motor SLVS. Estes sinais nao alteram a nota oficial, os pesos ou as formulas atuais.

Endpoints:

- `GET /brasileirao/round-context`
- `GET /brasileirao/results`
- `GET /brasileirao/team-context/:teamId`
- `GET /brasileirao/calendar-context/:teamId`
- `GET /brasileirao/player-context-contract`
- `GET /brasileirao/formation-contract`
- `GET /cartola/reserve-rules-contract`
- `GET /diagnostics/team-context`
- `GET /research/real-round-evaluation`
- `GET /research/context-feature-diagnostics`
- `GET /research/round-validation/:round`

Fonte real integrada nesta fase:

- Cartola FC API publica `/partidas`
- Cartola FC API publica `/mercado/status`
- Dados historicos locais e backtests congelados apenas para avaliacao sem vazamento

Copa do Brasil, Libertadores, Sul-Americana, desfalques, provaveis escalacoes e titularidade ficam com contrato preparado e status `UNAVAILABLE_SOURCE_NOT_CONFIGURED` quando nao houver fonte confiavel.

Documentacao:

- `docs/real-round-context-architecture.md`

## Research Lab 5.2.12

A Build 5.2.12 audita o snapshot prospectivo R20, cria avaliacao que usa apenas `post.players[].played` quando o outcome existir e adiciona auto-captura idempotente com janelas `PRIMARY` e `FINAL`.

Comandos:

```bash
npm run research:auto-capture-pre-match -- --dry-run
npm run research:evaluate-pre-match -- --round=20
```

Endpoints read-only:

```text
GET /research/pre-match-availability/capture-status
GET /research/pre-match-availability/evaluation/:round
GET /research/pre-match-availability/comparison/:round
```

Documentacao:

```text
docs/research/build-5.2.12-prospective-availability-evaluation.md
docs/research/pre-match-auto-capture.md
```

O threshold `0.45` permanece apenas experimental; o threshold oficial `0.50` nao foi alterado.

## Research Lab 5.2.11

A Build 5.2.11 cria o contrato `PRE_MATCH_AVAILABILITY_SOURCE_V1` para capturas prospectivas de disponibilidade antes do deadline da rodada. A fonte integrada usa endpoints publicos do Cartola ja presentes no backend: `/mercado/status`, `/atletas/mercado` e `/partidas`; entrada manual curada fica opcional e auditavel.

Artefatos:

```text
data/research/2026/pre-match-availability/
data/research/2026/manual-pre-match-input/
data/research/2026/prospective-availability-controls.json
docs/research/build-5.2.11-pre-match-availability-source.md
docs/research/pre-match-availability-source-v1.md
```

Comandos:

```bash
npm run research:capture-pre-match -- --round=20
npm run research:evaluate-pre-match -- --round=20
```

Endpoints read-only:

```text
GET /research/pre-match-availability
GET /research/pre-match-availability/latest
GET /research/pre-match-availability/round/:round
GET /research/pre-match-availability/coverage
GET /research/prospective-controls
```

Cada snapshot salva `capturedAt`, `roundDeadline`, `captureRelationToDeadline`, `minutesBeforeDeadline`, `snapshotFingerprint`, lista de fontes, cobertura e previsoes congeladas de pesquisa: `probabilityV1`, `probabilityV2`, decisao V2 threshold 0.50 e decisao experimental V2 threshold 0.45. O threshold oficial nao muda.

## Research Lab 5.2.10

A Build 5.2.10 cria o contrato `AVAILABILITY_SIGNALS_V1` e o artefato `availability-signals.json` para inventariar sinais pre-jogo de disponibilidade. O contrato classifica cada sinal como `SAFE_PRE_MATCH`, `UNSAFE_POST_MATCH`, `UNKNOWN_TIMING` ou `MISSING`, bloqueando sinais pos-jogo e sem timestamp seguro.

Artefatos:

```text
data/research/2026/availability-signals.json
docs/research/build-5.2.10-availability-signals.md
docs/research/availability-signals-v1.md
```

Comando:

```bash
npm run research:availability-signals
```

Endpoints read-only:

```text
GET /research/availability-signals
GET /research/availability-signals/coverage
GET /research/availability-signals/false-negatives
GET /research/availability-signals/thresholds
```

O artefato registra matriz de cobertura, dataset estruturado por temporada/rodada/atleta, analise dos falsos negativos e falsos positivos da V2, grid de thresholds, auditoria de fontes externas e controle prospectivo da R19. Nenhum modelo e promovido automaticamente; `AVAILABILITY_V2_SIGNAL_AUGMENTED` nao foi criado por falta de sinais incrementais seguros com cobertura historica suficiente.

## Research Lab 5.2.9

A Build 5.2.9 cria a variante experimental `AVAILABILITY_V2_CALIBRATED`. Ela usa a `RESEARCH_BASELINE_1_0` como contrato de comparacao, preserva `AVAILABILITY_V1` e avalia calibração probabilistica de `DID_PLAY` vs `DID_NOT_PLAY` com split temporal.

Artefatos:

```text
data/research/2026/availability-recalibration.json
docs/research/build-5.2.9-availability-recalibration.md
```

Comando:

```bash
npm run research:availability-recalibration
```

Endpoint read-only:

```text
GET /research/availability-recalibration
```

A avaliacao usa treino nas rodadas 2-13 e validacao nas rodadas 14-18. Nenhum modelo e promovido automaticamente; a recomendacao final fica persistida no artefato.

## Research Lab 5.2.8

A Build 5.2.8 cria a linha de base cientifica congelada `RESEARCH_BASELINE_1_0`. Ela registra referencias, hashes, fingerprints, rodadas, targets, metricas, modelos, denominadores e estados do Promotion Gate sem copiar datasets em massa.

Artefatos:

```text
data/research/2026/baselines/research-baseline-1.0.json
data/research/2026/baselines/research-baseline-1.0-manifest.json
data/research/2026/baselines/research-baseline-1.0-metrics.json
data/research/2026/baselines/research-baseline-1.0-target-audit.json
docs/research/build-5.2.8-research-baseline-1.0.md
docs/research/research-baseline-policy.md
```

Comandos:

```bash
npm run research:baseline
npm run research:baseline:check
```

Endpoints read-only:

```text
GET /research/baseline
GET /research/baseline/manifest
GET /research/baseline/metrics
GET /research/baseline/validity
```

A baseline usa `PARTICIPATION_TARGET_V1`, `RESEARCH_METRICS_V1`, `post.players[].played` como fonte canonica de participacao e congela os denominadores auditados: Top1 85, Top3 255, Top5 425, Top10 850, Time Ideal 113 e Capitao 11. A Rodada 19 permanece separada como `ROUND_19_CONTROL_CASE`.

## Research Lab 5.2.7

A Build 5.2.7 cria uma auditoria read-only do ground truth historico de participacao. Ela reconstrói Top1/Top3/Top5/Top10, Time Ideal e capitao com atletas congelados antes do pos-jogo, fazendo left join por `athleteId` e preservando denominadores mesmo quando o target esta ausente.

Gerar artefatos e relatorios:

```bash
npm run research:ground-truth-validation
```

Artefatos:

```text
data/research/2026/ground-truth-validation.json
data/research/2026/ground-truth-topk-audit.json
docs/research/build-5.2.7-ground-truth-validation.md
docs/research/round-19-ground-truth-audit.md
```

Endpoints somente leitura:

- `GET /research/ground-truth-validation`
- `GET /research/ground-truth-topk-audit`

Contratos adicionados:

- `DID_PLAY`, `DID_NOT_PLAY`, `SCORE_UNAVAILABLE`, `TARGET_MISSING` e `TARGET_AMBIGUOUS` sao classificacoes canonicas.
- `actualPoints=null` sozinho nao define que o atleta nao jogou.
- `actualPoints=0` ou negativo pode ser `DID_PLAY`.
- `gamesDelta` e scouts sao evidencias complementares, nao fonte unica da verdade.
- Artefatos antigos permanecem preservados; a auditoria cria arquivos separados.

## Research Lab 5.2.6

A Build 5.2.6 cria o Painel de Evidencias SLVS para consolidar o motor oficial, candidatos experimentais, qualidade dos dados, evidencias positivas/negativas/inconclusivas, limitacoes e Promotion Gate central. Nenhum candidato e promovido automaticamente.

Gerar o artefato e o relatorio:

```bash
npm run research:evidence-dashboard
```

Artefatos:

```text
data/research/2026/slvs-evidence-dashboard.json
docs/research/build-5.2.6-evidence-dashboard.md
```

Endpoint somente leitura:

- `GET /research/evidence-dashboard`

Contratos adicionados:

- `evidenceRecord` padroniza `POSITIVE`, `NEGATIVE`, `INCONCLUSIVE` e `DATA_LIMITATION`.
- `overallEvidenceScore` e indice interno, `probability=false`, e nao promove modelos.
- Evidencia isolada da Rodada 19 fica separada de evidencia multirrodada.
- Ausencia de artefato ou campo fica `DATA_NOT_AVAILABLE`, nunca zero inventado.
- A proxima prioridade de pesquisa e sugerida em modo read-only.

## Research Lab 5.2.5

A Build 5.2.5 cria `AVAILABILITY_V1` em Shadow Mode para separar potencial tecnico de confiabilidade de participacao. O `participationReliabilityScore` e indice interno SLVS em escala 0-100, com `metricType=internal_index` e `probability=false`; ele nao e probabilidade de jogar nem de titularidade.

Gerar o artefato e os relatorios:

```bash
npm run research:availability-calibration
```

Artefatos:

```text
data/research/2026/availability-calibration.json
docs/research/build-5.2.5-availability-learning.md
docs/research/round-19-availability-learning.md
```

Endpoint somente leitura:

- `GET /research/availability-calibration`

Contratos adicionados:

- Rodada N usa somente historico de participacao ate N-1.
- `didPlayActual` e `didNotPlayActual` entram apenas como target de avaliacao.
- `INSUFFICIENT_DATA` nao e tratado como baixa confiabilidade.
- Sinais ausentes como titularidade, minutos, lesao, suspensao e provavel escalacao permanecem indisponiveis.
- Nenhuma regra nominal e nenhuma promocao automatica entram no motor oficial.

## Research Lab 5.2.4

A Build 5.2.4 cria uma calibracao multirrodada experimental para auditar capitao, SG V1/V2, Shadow Mode por posicao, N/A pos-jogo, dataQualityScore, Time Ideal, Capture Rate e promotion gate. Ela nao altera o Motor SLVS oficial, formulas, snapshots, backtests historicos ou Flutter.

Gerar o artefato e o relatorio:

```bash
npm run research:multi-round-calibration
```

Artefatos:

```text
data/research/2026/multi-round-calibration.json
docs/research/build-5.2.4-multi-round-learning.md
```

Endpoint somente leitura:

- `GET /research/multi-round-calibration`

Contratos adicionados:

- Capitao experimental aceita apenas ATA e MEI; GOL, LAT, ZAG e TEC sao inelegiveis.
- N/A pos-jogo separa `PRE_MATCH_ELIGIBLE`, `POST_MATCH_DID_NOT_PLAY` e `POST_MATCH_SCORE_UNAVAILABLE`.
- Shadow Mode por posicao compara ranking oficial congelado com candidatos V2 sem promocao automatica.
- Best Predicted XI e Best Actual XI usam apenas jogadores elegiveis pre-rodada; pontos reais entram somente como alvo.
- Promotion gate continua bloqueando promocao automatica para o motor oficial.

## Research Lab 5.2.3

A Build 5.2.3 cria a validacao walk-forward da Rodada 19 como laboratorio de calibracao historica. A previsao usa apenas snapshots capturados antes de cada jogo; resultados reais entram somente depois como alvo de avaliacao.

Gerar o artefato e o relatorio:

```bash
npm run research:round-validation
```

Artefatos:

```text
data/research/2026/round-19-validation.json
docs/research/round-19-learning-report.md
```

Endpoint somente leitura:

- `GET /research/round-validation/19`

Contratos adicionados:

- `cleanSheetIndexV1` e `cleanSheetIndexV2` retornam indice interno, nao probabilidade.
- `displayScore` limita a exibicao a 95 e preserva `rawScore`.
- `matchupStrengthGap` usa escala interna de -100 a +100.
- Diferenciais reais exigem ownership/popularidade; sem isso `differentialEligibilityAvailable=false`.
- Valorizacao sem modelo futuro e exposta como `valueType=historical_variation`.
- Custo-beneficio exige qualidade minima, previsao disponivel e status elegivel.
- Best Possible XI e melhor formacao real sao benchmarks pos-rodada.
- Promotion gate permite `REJECTED`, `EXPERIMENTAL` e `PROMOTABLE`, sem promocao automatica.

## Dados historicos

A Build 4.3.0 adicionou o primeiro backtest historico real do backend para o Brasileirao/Cartola FC 2026. A Build 4.3.1 adicionou o motor de paridade com as regras auditadas do Flutter. A Build 4.3.2 adiciona um dataset historico enriquecido com forma recente reconstruida somente a partir de rodadas anteriores, sem alterar formulas, pesos ou o Flutter.

Fonte primaria:

```text
caRtola - https://github.com/henriquepgomide/caRtola
```

Fonte secundaria de validacao:

```text
Cartola FC API publica - https://api.cartolafc.globo.com
```

Coletar dados:

```bash
npm run historical:collect -- --season=2026 --from=1 --to=18 --force
```

Auditar dados persistidos:

```bash
npm run historical:audit -- --season=2026 --to=18
```

Reconstruir pre-rodada v2:

```bash
npm run historical:reconstruct-pre -- --season=2026 --from=1 --to=18 --force
```

Verificar vazamento:

```bash
npm run historical:check-leakage -- --season=2026 --from=1 --to=18
```

Enriquecer pre-rodada historico:

```bash
npm run historical:enrich -- --season=2026 --from=2 --to=18 --force
```

Auditar enriquecimento:

```bash
npm run historical:enrich:audit -- --season=2026
```

Verificar vazamento do enriquecido:

```bash
npm run historical:enrich:check-leakage -- --season=2026 --from=2 --to=18
```

Executar backtest:

```bash
npm run backtest -- --season=2026 --from=2 --to=18
```

Gerar relatorio:

```bash
npm run backtest:report -- --season=2026
```

Executar backtest com paridade Flutter:

```bash
npm run backtest:flutter-parity -- --season=2026 --from=2 --to=18
```

Gerar relatorio da paridade Flutter:

```bash
npm run backtest:flutter-parity:report -- --season=2026
```

Comparar builds:

```bash
npm run backtest:compare -- --season=2026 --left=4.3.0 --right=4.3.1
```

Executar backtest com dados enriquecidos:

```bash
npm run backtest:flutter-parity-enriched -- --season=2026 --from=2 --to=18
```

Gerar relatorio enriquecido:

```bash
npm run backtest:flutter-parity-enriched:report -- --season=2026
```

Comparar todas as builds:

```bash
npm run backtest:compare-all -- --season=2026
```

Estrutura:

```text
data/historical/2026/round-01/pre-round.json
data/historical/2026/round-01/post-round.json
data/historical/2026/round-01/validation.json
```

Documentacao:

- `docs/historical-data-audit.md`
- `docs/2026-data-coverage.md`
- `docs/historical-data-schema.md`
- `docs/backtest-data-readiness.md`
- `docs/pre-round-reconstruction-method.md`
- `docs/2026-scout-divergence-analysis.md`
- `docs/leakage-validation.md`
- `docs/backtest-4.3.0-report.md`
- `docs/flutter-engine-parity-audit.md`
- `docs/backtest-4.3.1-report.md`
- `docs/backtest-4.3.0-vs-4.3.1.md`
- `docs/historical-missing-data-audit.md`
- `docs/historical-enrichment-method.md`
- `docs/backtest-4.3.2-report.md`
- `docs/backtest-4.3.0-vs-4.3.1-vs-4.3.2.md`
- `docs/live-pre-round-snapshot-architecture.md`
- `docs/live-snapshot-operations.md`
- `docs/live-snapshot-automation-plan.md`
- `docs/live-snapshot-scheduling-policy.md`
- `docs/live-snapshot-change-detection.md`
- `docs/live-snapshot-render-automation.md`
- `docs/live-snapshot-production-storage-audit.md`
- `docs/live-snapshot-storage-contract.md`
- `docs/live-snapshot-production-operations.md`
- `docs/live-snapshot-github-actions.md`
- `docs/live-snapshot-automatic-commit-policy.md`
- `docs/live-snapshot-production-activation-checklist.md`
- `docs/live-snapshot-production-ready.md`
- `docs/engine-research-lab.md`
- `docs/real-round-context-architecture.md`

## Backtest

Resultados persistidos:

```text
data/backtests/2026/build-4.3.0/
data/backtests/2026/build-4.3.1/
data/backtests/2026/build-4.3.2/
data/historical/2026-enriched/
data/live-snapshots/2026/
```

Endpoints:

- `GET /backtests/2026/latest`
- `GET /backtests/2026/summary`
- `GET /backtests/2026/rounds`
- `GET /backtests/2026/round/:round`
- `GET /backtests/2026/metrics/prediction`
- `GET /backtests/2026/metrics/team`
- `GET /backtests/2026/metrics/captain`
- `GET /backtests/2026/metrics/score-bands`
- `GET /backtests/2026/comparison/baseline-average`
- `GET /backtests/2026/builds`
- `GET /backtests/2026/build/4.3.1/summary`
- `GET /backtests/2026/build/4.3.1/round/:round`
- `GET /backtests/2026/build/4.3.1/metrics/prediction`
- `GET /backtests/2026/build/4.3.1/metrics/team`
- `GET /backtests/2026/build/4.3.1/metrics/captain`
- `GET /backtests/2026/build/4.3.1/metrics/score-bands`
- `GET /backtests/2026/build/4.3.1/metrics/central-intelligence`
- `GET /backtests/2026/compare/4.3.0/4.3.1`
- `GET /historical/2026/enriched/coverage`
- `GET /historical/2026/enriched/round/:round`
- `GET /historical/2026/enriched/leakage-report`
- `GET /backtests/2026/build/4.3.2/summary`
- `GET /backtests/2026/build/4.3.2/round/:round`
- `GET /backtests/2026/build/4.3.2/metrics/prediction`
- `GET /backtests/2026/build/4.3.2/metrics/team`
- `GET /backtests/2026/build/4.3.2/metrics/captain`
- `GET /backtests/2026/build/4.3.2/metrics/score-bands`
- `GET /backtests/2026/compare/all`

## Snapshots vivos pre-rodada

Executar dry-run:

```bash
npm run live:snapshot:capture -- --season=2026 --dry-run
```

Capturar snapshot local:

```bash
npm run live:snapshot:capture -- --season=2026
```

Auditar integridade:

```bash
npm run live:snapshot:audit -- --season=2026
```

Executar automacao segura:

```bash
npm run live:snapshot:auto -- --season=2026
```

Simular a decisao da automacao sem gravar arquivos:

```bash
npm run live:snapshot:auto -- --season=2026 --dry-run
```

Verificar storage local:

```bash
npm run live:snapshot:storage-check -- --season=2026
```

Validar mudancas permitidas para commit automatico:

```bash
npm run live:snapshot:validate-changes -- --json
```

Simular o workflow sem commit nem push:

```bash
npm run live:snapshot:workflow-simulate
```

A automacao grava apenas snapshots validos pre-fechamento quando a politica indicar primeira captura valida, checkpoint de janela, mudanca significativa ou captura final de seguranca. Quando nao houver mudanca relevante, retorna `SKIPPED` e atualiza o status da automacao sem criar snapshot duplicado.

Em producao Render, o modo atual e `PRODUCTION_AUTOMATION_STATUS=READY`: GitHub Actions esta confirmado, a execucao real foi confirmada, a persistencia oficial e `GIT_AUTOMATED_COMMITS` e o Render Auto-Deploy esta confirmado como `ON_COMMIT`.

Endpoints:

- `GET /live-snapshots/2026/coverage`
- `GET /live-snapshots/2026/rounds`
- `GET /live-snapshots/2026/round/:round`
- `GET /live-snapshots/2026/round/:round/latest`
- `GET /live-snapshots/2026/round/:round/latest-valid-pre-round`
- `GET /live-snapshots/2026/round/:round/change-history`
- `GET /live-snapshots/2026/round/:round/final-pre-close`
- `GET /live-snapshots/2026/round/:round/schedule-status`
- `GET /live-snapshots/2026/snapshot/:snapshotId`
- `GET /live-snapshots/2026/integrity`
- `GET /live-snapshots/2026/automation-status`
- `GET /live-snapshots/2026/production-health`
- `GET /live-snapshots/2026/storage-health`
- `GET /live-snapshots/2026/automation-lock`

## Tratamento de erros

Falhas de rede, timeout ou respostas nao JSON da API oficial retornam JSON consistente com identificacao de erro upstream. Respostas JSON da API oficial sao repassadas com o status HTTP recebido.
