# cartola-silvas-fc-api

Backend proxy do Cartola FC para o aplicativo Meu Time Ideal Web.

Este servidor evita que a versao Web do app Flutter precise chamar diretamente `https://api.cartolafc.globo.com` a partir do navegador, reduzindo problemas de CORS. As rotas retornam dados reais da API oficial do Cartola FC, sem mocks, fallbacks ficticios ou alteracao silenciosa do conteudo recebido.

## Endpoints

### `GET /`

Retorna informacoes basicas do servico:

```json
{
  "service": "cartola-silvas-fc-api",
  "status": "online",
  "version": "4.2.1",
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

A Build 4.3.0 adiciona o primeiro backtest historico real do backend para o Brasileirao/Cartola FC 2026. Ele mede uma politica historica explicita e versionada, sem otimizar pesos e sem alterar o Flutter.

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

Executar backtest:

```bash
npm run backtest -- --season=2026 --from=2 --to=18
```

Gerar relatorio:

```bash
npm run backtest:report -- --season=2026
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

## Backtest

Resultados persistidos:

```text
data/backtests/2026/build-4.3.0/
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

## Tratamento de erros

Falhas de rede, timeout ou respostas nao JSON da API oficial retornam JSON consistente com identificacao de erro upstream. Respostas JSON da API oficial sao repassadas com o status HTTP recebido.
