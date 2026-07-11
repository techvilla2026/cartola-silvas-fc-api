# Changelog

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
