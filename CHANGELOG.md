# Changelog

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
