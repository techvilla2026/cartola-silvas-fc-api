# cartola-silvas-fc-api

Backend proxy do Cartola FC para o aplicativo Meu Time Ideal Web.

Este servidor evita que a versao Web do app Flutter precise chamar diretamente `https://api.cartolafc.globo.com` a partir do navegador, reduzindo problemas de CORS. As rotas retornam dados reais da API oficial do Cartola FC, sem mocks, fallbacks ficticios ou alteracao silenciosa do conteudo recebido.

A Build 4.5.3 prepara GitHub Actions para snapshots vivos pre-rodada em `live-pre-round-snapshot/v1`, com execucao horaria, commit automatico controlado, allowlist de arquivos, protecao de snapshots imutaveis e simulacao local sem push. A automacao de producao fica `PARTIALLY_READY` ate o workflow ser revisado/ativado e o auto deploy do Render ser confirmado.

## Endpoints

### `GET /`

Retorna informacoes basicas do servico:

```json
{
  "service": "cartola-silvas-fc-api",
  "status": "online",
  "version": "4.5.3",
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
https://utimeideal.netlify.app
```

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

Em producao Render, o modo atual permanece `PRODUCTION_AUTOMATION_STATUS=PARTIALLY_READY`: o workflow esta preparado, mas nao foi executado nesta build e o auto deploy do Render nao esta confirmado no repositorio.

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
