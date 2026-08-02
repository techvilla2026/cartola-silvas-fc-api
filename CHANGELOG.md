# Changelog

## 5.2.15 - 2026-08-01

- Adiciona modos `dry-run`, `preflight` e `live` ao dispatch prospectivo, preservando dry-run como padrao.
- Bloqueia configuracoes parciais: escrita e persistencia precisam ser ativadas juntas.
- Adiciona preflight sem escrita para allowlist, identidade do bot e `git push --dry-run`.
- Mantem commit restrito com `[skip render]`, sem deploy, force push ou staging amplo.
- Preserva baseline, modelos, thresholds, snapshots historicos, backtests e Flutter.


## 5.2.13 - 2026-07-31

- Prepara o workflow prospectivo separado `.github/workflows/research-pre-match-auto-capture.yml`, agendado a cada 30 minutos e em dry-run por padrao.
- Adiciona saida machine-readable `--json`, exit codes operacionais, alertas de risco e persistencia `GITHUB_COMMIT_RESTRICTED` preparada, mas desabilitada.
- Restringe persistencia a snapshots prospectivos e ao registry, bloqueando qualquer arquivo inesperado e proibindo staging amplo.
- Corrige `capture-status` para consultar a rodada e o deadline atuais da API, preservando consulta explicita por rodada.
- Adiciona `scheduler-readiness`, auditoria `missedProspectiveRounds` e registra R21 como captura prospectiva perdida sem reconstrucao.
- Protege bytes canonicos de snapshots com `.gitattributes`, sem regravar arquivos existentes.
- Mantem R20 `PENDING_OUTCOME`, baseline, V1, V2, threshold oficial 0.50, motor, formulas, Flutter, snapshots historicos e backtests intactos.

## 5.2.12 - 2026-07-24

- Adiciona avaliacao prospectiva para snapshots `PRE_MATCH_AVAILABILITY_SOURCE_V1`, usando somente `post.players[].played` como outcome canonico.
- Cria auto-captura pre-deadline com janelas `PRIMARY` e `FINAL`, idempotencia, dry-run, reason codes e bloqueio pos-deadline.
- Adiciona status de risco `CAPTURE_AT_RISK` e `MISSED_CAPTURE`.
- Adiciona `npm run research:auto-capture-pre-match`.
- Adiciona endpoints read-only `/research/pre-match-availability/capture-status`, `/evaluation/:round` e `/comparison/:round`.
- Atualiza o Painel de Evidencias com avaliacao prospectiva, status de captura, risco, threshold 0.45 experimental e proxima acao.
- Mantem Flutter, motor oficial, formulas, `AVAILABILITY_V1`, `AVAILABILITY_V2_CALIBRATED`, threshold oficial 0.50, baseline, snapshots/backtests originais, Promotion State, commit, push e deploy sem alteracao.

## 5.2.11 - 2026-07-24

- Adiciona `PRE_MATCH_AVAILABILITY_SOURCE_V1` para capturas prospectivas de disponibilidade pre-jogo.
- Integra fontes publicas ja usadas pelo projeto: `/mercado/status`, `/atletas/mercado` e `/partidas`.
- Cria snapshots imutaveis em `data/research/2026/pre-match-availability` com deadline, prova temporal, fingerprint SHA-256, cobertura e previsoes congeladas V1/V2.
- Adiciona entrada manual curada opcional com audit trail em `data/research/2026/manual-pre-match-input`.
- Cria registry `data/research/2026/prospective-availability-controls.json` para controles prospectivos.
- Adiciona scripts `research:capture-pre-match` e `research:evaluate-pre-match`.
- Adiciona endpoints read-only `/research/pre-match-availability`, `/latest`, `/round/:round`, `/coverage` e `/research/prospective-controls`.
- Atualiza o Painel de Evidencias com fonte pre-jogo, ultima captura, fingerprint, cobertura, controles prospectivos e status experimental do threshold 0.45.
- Mantem Flutter, motor oficial, formulas, `AVAILABILITY_V1`, `AVAILABILITY_V2_CALIBRATED`, baseline, snapshots/backtests originais, Promotion State, commit, push e deploy sem alteracao.

## 5.2.10 - 2026-07-24

- Adiciona a camada `AVAILABILITY_SIGNALS_V1` para inventario e contrato temporal de sinais pre-jogo.
- Cria `data/research/2026/availability-signals.json` com dataset por jogador-rodada, matriz de cobertura, qualidade, FN/FP, thresholds, auditoria externa e controle R19.
- Adiciona `npm run research:availability-signals` e endpoints read-only `/research/availability-signals`, `/coverage`, `/false-negatives` e `/thresholds`.
- Atualiza o Painel de Evidencias para mostrar sinais seguros/bloqueados, cobertura, erros V2, thresholds e a proxima prioridade de fonte pre-jogo versionada.
- Nao cria `AVAILABILITY_V3` nem promove `AVAILABILITY_V2_SIGNAL_AUGMENTED`; sinais incrementais seguros ainda nao possuem cobertura historica/timestamp suficiente.
- Mantem Flutter, motor oficial, formulas, `AVAILABILITY_V1`, `AVAILABILITY_V2_CALIBRATED`, snapshots, backtests originais, baseline congelada, commit, push e deploy sem alteracao.

## 5.2.9 - 2026-07-24

- Adiciona recalibracao experimental `AVAILABILITY_V2_CALIBRATED` contra `RESEARCH_BASELINE_1_0`.
- Cria `data/research/2026/availability-recalibration.json` com metricas binarias, Brier, log loss, ROC-AUC, PR-AUC, ECE, reliability bins, FP/FN e impacto downstream.
- Adiciona `npm run research:availability-recalibration` e endpoint read-only `GET /research/availability-recalibration`.
- Atualiza o Painel de Evidencias para mostrar experimento atual de Availability, comparacao com baseline e recomendacao.
- Mantem `AVAILABILITY_V1`, Promotion Gate, Flutter, motor oficial, formulas, snapshots, backtests originais, commit, push e deploy sem alteracao.

## 5.2.8 - 2026-07-24

- Cria a Research Baseline 1.0 (`RESEARCH_BASELINE_1_0`) como linha de base cientifica congelada.
- Adiciona artefatos `data/research/2026/baselines/research-baseline-1.0*.json` com manifesto, metricas, target audit e fingerprints.
- Adiciona comandos `npm run research:baseline` e `npm run research:baseline:check`.
- Adiciona endpoints read-only `GET /research/baseline`, `/research/baseline/manifest`, `/research/baseline/metrics` e `/research/baseline/validity`.
- Atualiza o Painel de Evidencias para exibir baseline ativa, validade, fingerprint e readiness de comparacao.
- Mantem Promotion Gate, Flutter, motor oficial, formulas, snapshots congelados, backtests originais, commit, push e deploy sem alteracao.

## 5.2.7 - 2026-07-23

- Adiciona auditoria Ground Truth Validation para target historico de participacao e denominadores TopK.
- Cria `data/research/2026/ground-truth-validation.json` e `data/research/2026/ground-truth-topk-audit.json`.
- Cria relatorios `docs/research/build-5.2.7-ground-truth-validation.md` e `docs/research/round-19-ground-truth-audit.md`.
- Adiciona endpoints read-only `GET /research/ground-truth-validation` e `GET /research/ground-truth-topk-audit`.
- Atualiza o Painel de Evidencias para incorporar o estado de confiabilidade do target auditado sem alterar Promotion Gate.
- Mantem Flutter, motor oficial, formulas, snapshots congelados, backtests originais, commit, push e deploy sem alteracao.

## 5.2.6 - 2026-07-23

- Adiciona Painel de Evidencias SLVS em `data/research/2026/slvs-evidence-dashboard.json`.
- Consolida catalogo de modelos, evidenceRecords, scorecards, qualidade dos dados, auditoria do target de participacao e promotion gate central.
- Cria endpoint read-only `GET /research/evidence-dashboard`.
- Cria relatorio `docs/research/build-5.2.6-evidence-dashboard.md`.
- Adiciona comando `npm run research:evidence-dashboard`.
- Mantem Motor SLVS oficial, Flutter, formulas, snapshots, backtests historicos, commit, push e deploy sem alteracao.

## 5.2.5 - 2026-07-23

- Adiciona calibracao experimental de disponibilidade pre-rodada em `data/research/2026/availability-calibration.json`.
- Cria `participationReliabilityScore` como indice interno SLVS, `probability=false`, sem chamar de probabilidade de titularidade.
- Adiciona `AVAILABILITY_V1`, ranking availability-aware, capitain availability-aware, XI availability-aware e diagnosticos de erro de disponibilidade.
- Cria endpoint read-only `GET /research/availability-calibration`.
- Cria relatorios `docs/research/build-5.2.5-availability-learning.md` e `docs/research/round-19-availability-learning.md`.
- Mantem Motor SLVS oficial, Flutter, formulas, snapshots, backtests historicos, commit, push e deploy sem alteracao.

## 5.2.4 - 2026-07-23

- Adiciona calibracao multirrodada experimental em `data/research/2026/multi-round-calibration.json`.
- Cria relatorio `docs/research/build-5.2.4-multi-round-learning.md`.
- Adiciona endpoint read-only `GET /research/multi-round-calibration`.
- Corrige a auditoria de capitao: somente ATA e MEI entram como elegiveis; GOL/LAT/ZAG/TEC sao rejeitados.
- Adiciona Shadow Mode por posicao, auditoria de GOL, `dataQualityScore` explicavel, separacao de N/A pos-jogo, Capture Rate, TopPotentialCaptureRate e promotion gate por candidato.
- Mantem Motor SLVS oficial, formulas, Flutter, snapshots, backtests historicos, commit, push e deploy sem alteracao.

## 5.2.3 - 2026-07-23

- Adiciona validacao walk-forward da Rodada 19 no Research Lab.
- Cria `data/research/2026/round-19-validation.json` e `docs/research/round-19-learning-report.md`.
- Adiciona endpoint read-only `GET /research/round-validation/:round`.
- Corrige a semantica do ranking de SG com `metricType=internal_index`, `probability=false`, `displayRecommendation=score`, `rawScore` preservado e `displayScore` limitado a 95.
- Adiciona `matchupStrengthGap` em escala interna de -100 a +100 e candidato offline `cleanSheetIndexV2`.
- Audita CAM, Flamengo, ranking SG V1/V2, aprendizado por posicao, caso Ivan, formacoes, Time Ideal e Best Possible XI.
- Explicita contratos para diferenciais sem ownership, valorizacao historica, custo-beneficio e promotion gate `REJECTED`/`EXPERIMENTAL`/`PROMOTABLE`.
- Mantem Motor SLVS oficial, Flutter, formulas de producao, snapshots existentes, backtests historicos, commit, push e deploy sem alteracao.

## 5.2.0 - 2026-07-23

- Enriquece o contexto real da rodada com indices internos deterministas de forca ofensiva, forca defensiva, SG, risco de sofrer gol e oportunidade ofensiva.
- Calcula forma recente em janela de cinco jogos oficiais anteriores ao confronto, com separacao casa/fora, descanso e prevencao de vazamento temporal.
- Expõe contexto por partida e por atleta para goleiros, defensores, meias e atacantes, sem alterar a Previsao SLVS oficial ou a selecao final.
- Adiciona diagnostico read-only `/diagnostics/team-context`, incluindo comparacao de goleiros reais quando presentes no mercado atual.
- Adiciona contratos read-only para 4-5-1 e para reservas/Reserva de Luxo, mantendo campos `null` quando a API publica nao fornece regra oficial.
- Mantem Brasileirao como unica competicao integrada; Copa do Brasil, Libertadores e Sul-Americana continuam indisponiveis sem fonte validada.
- Mantem provaveis, desfalques, lesoes, xG, odds e risco de rodizio confirmado como indisponiveis; `rotationRiskIndex` e apenas estimativa interna de calendario.
- Atualiza documentacao em `docs/build-5.2.0-real-context.md` e preserva todos os endpoints anteriores.
- Nao altera Flutter, backend externo, Motor SLVS oficial, formulas, snapshots historicos, Research Lab, commit, push ou deploy.

## 5.0.0 - 2026-07-21

- Cria a camada `real-round-context-engine/5.0.0` para contexto real da rodada.
- Normaliza partidas reais do Brasileirao a partir de `/partidas` e mercado atual a partir de `/mercado/status`.
- Adiciona endpoints read-only `/brasileirao/round-context`, `/brasileirao/results`, `/brasileirao/team-context/:teamId`, `/brasileirao/calendar-context/:teamId` e `/brasileirao/player-context-contract`.
- Adiciona avaliacao read-only `/research/real-round-evaluation` com previsoes historicas congeladas antes dos resultados.
- Adiciona `/research/context-feature-diagnostics` com candidatos offline de contexto, sem promocao automatica.
- Prepara contratos para Copa do Brasil, Libertadores, Sul-Americana, desfalques, provaveis escalacoes e titularidade sem inventar dados.
- Adiciona sinais explicaveis de congestionamento, descanso, forma recente e casa/fora quando ha amostra real suficiente.
- Documenta cache, fallback stale, prevencao de vazamento temporal e limites em `docs/real-round-context-architecture.md`.
- Atualiza o promotion gate para Build 5.0.0 mantendo promocao automatica bloqueada.
- Nao altera Flutter, Motor SLVS oficial, formulas, snapshots, backtests antigos, commit, push ou deploy.

## 4.7.1 - 2026-07-16

- Corrige a allowlist CORS do app publicado para `https://meutimeideal.netlify.app`.
- Preserva a origem legada `https://utimeideal.netlify.app` por compatibilidade.
- Mantem `localhost` e `127.0.0.1` com portas variaveis para desenvolvimento.
- Centraliza metodos, headers e max-age do preflight em constantes do servidor.
- Amplia headers permitidos para `Accept`, `Content-Type`, `Authorization` e `X-Requested-With`.
- Adiciona testes de CORS para Netlify, localhost, 127.0.0.1, origem desconhecida, requisicao sem `Origin`, preflight, rotas de busca, 404, erro upstream, research e endpoints existentes.
- Nao altera Flutter, motor oficial, formulas, snapshots, dados historicos, backtests, commit, push ou deploy.

## 4.7.0 - 2026-07-14

- Adiciona laboratorio historico offline do motor com artefatos versionados em `data/research/2026`.
- Adiciona auditoria `historical-engine-audit/v1` sobre cobertura, vazamento temporal, determinismo e duplicatas.
- Adiciona diagnosticos de erro, ranking, time ideal, capitao, ablation, experimentos walk-forward e promotion gate.
- Adiciona candidatos offline conservadores com treino/calibracao somente por rodadas anteriores.
- Adiciona `config/engine-experiment-policy.json` com estados permitidos e promocao automatica desativada.
- Adiciona endpoints somente leitura `/research/*`, sem computacao pesada por requisicao.
- Adiciona scripts `research:*`, aliases `storage-check` e `audit`, e documentacao em `docs/engine-research-lab.md`.
- Mantem motor oficial, Flutter, snapshots vivos, dados historicos, backtests anteriores, GitHub Actions, commit, push e deploy sem alteracao operacional.

## 4.5.4 - 2026-07-12

- Corrige falso `disallowedChanges` no resumo do workflow movendo arquivos temporarios para `$RUNNER_TEMP`.
- Padroniza o contrato do validador como `live-snapshot-change-validation/v1`.
- Faz `automation-status` com alteracoes apenas volateis ser restaurado e contado em `ignoredVolatileChanges`, sem aparecer como allowed/disallowed.
- Atualiza workflow para `actions/checkout@v5` e `actions/setup-node@v6`, com Node 22 no runner.
- Adiciona configuracao auditavel `config/live-snapshot-production.json`.
- Atualiza `production-health` para retornar `READY` quando GitHub Actions, execucao real, Render On Commit, snapshot valido e auditoria PASS estiverem confirmados.
- Separa `runtimeStorageMode=LOCAL_EPHEMERAL` de `officialPersistenceMode=GIT_AUTOMATED_COMMITS`.
- Atualiza `storage-health` com `runtimeFilesystem`, `officialPersistence` e `overallStatus`.
- Amplia `workflow-simulate` para cobrir SKIPPED limpo, CAPTURED, paths proibidos, snapshot imutavel e status volatil/material.
- Nao altera Flutter, motor, snapshots existentes, historico, backtests, commit, push ou deploy.

## 4.5.3 - 2026-07-12

- Prepara workflow GitHub Actions para captura horaria de snapshots vivos.
- Adiciona `.github/workflows/live-snapshot-capture.yml` com `workflow_dispatch`, `schedule`, `concurrency`, permissao minima `contents: write`, `npm ci`, testes CI, storage-check, automacao strict, auditoria e commit controlado.
- Adiciona allowlist de arquivos permitidos para commit automatico.
- Adiciona `live:snapshot:validate-changes` para rejeitar paths proibidos, deletes, renames e modificacao de snapshots ja versionados.
- Adiciona tratamento semantico de `automation-status` para evitar commit quando so campos volateis mudam.
- Adiciona `live:snapshot:workflow-simulate` para simular decisoes de workflow sem commit nem push.
- Adiciona `test:live-snapshot-ci`.
- Atualiza `production-health` para `GITHUB_ACTIONS_PREPARED`, frequencia `HOURLY`, `workflowActivationStatus=NOT_ACTIVATED` e `gitPersistenceMode=AUTOMATED_COMMIT_PREPARED`.
- Mantem `productionAutomationStatus=PARTIALLY_READY` porque Render auto deploy nao esta confirmado no repositorio.
- Nao executa workflow real, commit, push ou deploy.

## 4.5.2 - 2026-07-12

- Audita persistencia e agendamento de producao dos snapshots vivos.
- Documenta que o storage atual e `LOCAL_FILESYSTEM` e nao e seguro para producao Render sem persistencia confirmada.
- Adiciona contrato de storage para snapshots vivos.
- Migra `LiveSnapshotRepository` para implementar operacoes atomicas, imutaveis, health-check e lock local.
- Adiciona `npm run live:snapshot:storage-check`.
- Adiciona `executionId` por execucao automatica.
- Adiciona lock local com expiracao, recuperacao de stale lock e liberacao em sucesso, skip e erro controlado.
- Adiciona contadores `failureCount`, `consecutiveFailureCount`, `lastSuccessfulRunAt` e `lastFailureAt`.
- Adiciona alertas operacionais sem envio externo.
- Adiciona endpoints somente leitura `production-health`, `storage-health` e `automation-lock`.
- Mantem `PRODUCTION_AUTOMATION_STATUS=BLOCKED` ate existir storage/scheduler persistente confirmado.
- Nao cria workflow ativo, nao faz commit, push ou deploy automatico.

## 4.5.1 - 2026-07-12

- Adiciona automacao segura de snapshots vivos pre-rodada via `live:snapshot:auto`.
- Centraliza a politica de captura por janelas ate o fechamento do mercado.
- Define motivos de captura/skip e `snapshotRole` para snapshots automaticos.
- Adiciona fingerprint logico que ignora campos volateis e detecta mudancas esportivas relevantes.
- Evita duplicatas quando nao ha mudanca significativa e a janela minima ainda nao venceu.
- Preserva primeiro snapshot valido, mudancas significativas, checkpoints e captura final pre-fechamento.
- Persiste `automation-status.json` por temporada.
- Persiste `change-history.json` por rodada, sem duplicar o snapshot completo.
- Adiciona endpoints somente leitura de status da automacao, historico de mudancas, captura final pre-fechamento e status de agenda.
- Documenta politica de agendamento, deteccao de mudancas e alternativas de automacao no Render.
- Nao cria endpoint publico de escrita, workflow ativo, deploy, commit ou push automatico.

## 4.5.0 - 2026-07-12

- Cria o sistema oficial de snapshots vivos pre-rodada.
- Adiciona schema `live-pre-round-snapshot/v1`.
- Coleta dados reais de `/mercado/status`, `/atletas/mercado` e `/partidas`.
- Registra `capturedAt`, `marketClosingAt`, `capturePhase` e `isValidPreRoundSnapshot`.
- Persiste snapshots imutaveis em `data/live-snapshots`.
- Adiciona manifest por rodada, escrita atomica e hash SHA-256 canonico.
- Adiciona auditoria de integridade de snapshots.
- Executa o motor `flutter-parity-engine/4.3.1` somente quando a captura e valida pre-fechamento.
- Mantem elenco pessoal como `NOT_APPLICABLE` e Comparador como `NOT_EVALUATED`.
- Adiciona scripts `live:snapshot:capture` e `live:snapshot:audit`.
- Adiciona endpoints somente leitura `/live-snapshots`.
- Nao altera Flutter, formulas, pesos, backtests anteriores, deploy ou git remoto.

## 4.3.2 - 2026-07-12

- Audita fontes publicas para status pre-rodada, dados recentes, scouts historicos e campos ausentes.
- Mantem `statusBeforeRound` indisponivel por falta de snapshot publico temporalmente seguro.
- Reconstrui forma recente usando somente rodadas anteriores.
- Cria dataset derivado `data/historical/2026-enriched`.
- Adiciona leakage checker especifico do dataset enriquecido.
- Adiciona backtest `flutter-parity-enriched-engine/4.3.2`.
- Adiciona comandos `historical:enrich`, `historical:enrich:audit`, `historical:enrich:check-leakage`, `backtest:flutter-parity-enriched`, `backtest:flutter-parity-enriched:report` e `backtest:compare-all`.
- Adiciona endpoints somente leitura para historico enriquecido e comparacao geral.
- Nao altera formulas, pesos, Flutter, builds anteriores, deploy ou git remoto.

## 4.3.1 - 2026-07-11

- Audita as regras reais do Flutter para previsao, Nota da analise, qualidade dos dados, selecao 4-3-3, capitao/vice, Central Inteligente e Comparador.
- Adiciona `flutter-parity-engine/4.3.1` sem alterar o Flutter.
- Adiciona comandos `backtest:flutter-parity`, `backtest:flutter-parity:report` e `backtest:compare`.
- Persiste resultados em `data/backtests/2026/build-4.3.1`.
- Cria `parity-manifest.json` com arquivos Flutter auditados e hashes SHA-256.
- Adiciona endpoints somente leitura por build e comparacao entre 4.3.0 e 4.3.1.
- Mantem status historico como indisponivel/neutro, nao usa scouts divergentes como oficiais e nao cria elenco ficticio do usuario.
- Nao otimiza pesos, nao treina modelos, nao faz deploy e nao altera o aplicativo Flutter.

## 4.3.0 - 2026-07-11

- Adiciona Historical Evaluation Engine versionada.
- Adiciona CLI `backtest`, `backtest:round` e `backtest:report`.
- Persiste resultados em `data/backtests/2026/build-4.3.0`.
- Calcula metricas de previsao, posicao, faixas de nota, casa/fora, custo-beneficio, time, capitao e baseline.
- Adiciona endpoints somente leitura de backtest.
- Documenta que o motor completo do Flutter nao existe no backend e que recomendacoes/comparador ficaram `NOT_EVALUATED`.
- Nao altera pesos, nao otimiza e nao treina modelos.

## 4.2.1 - 2026-07-11

- Reconstrui `pre-round.json` em schema `historical-pre-round-data/v2`.
- Adiciona provenance por campo e elegibilidade por atleta.
- Adiciona scripts `historical:reconstruct-pre`, `historical:check-leakage` e `historical:scout-divergences`.
- Adiciona endpoints de prontidao, vazamento e divergencias.
- Mantem status pre-rodada indisponivel por falta de evidencia temporal segura.
- Classifica 17 rodadas como READY e a Rodada 1 como NOT_READY.
- Mantem o backtest fora do escopo.

## 4.2.0 - 2026-07-11

- Adiciona arquitetura historica separada em `src/historical`.
- Adiciona coleta real 2026 com caRtola como fonte primaria.
- Adiciona validacao secundaria com endpoints publicos oficiais do Cartola.
- Persiste `pre-round.json`, `post-round.json`, `validation.json` e `manifest.json`.
- Adiciona scripts `historical:collect` e `historical:audit`.
- Adiciona endpoints internos de consulta historica.
- Documenta auditoria de fontes, cobertura 2026, schema e prontidao para backtest.
- Mantem backtest fora do escopo.
