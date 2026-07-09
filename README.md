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
  "version": "3.5.0",
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

## Tratamento de erros

Falhas de rede, timeout ou respostas nao JSON da API oficial retornam JSON consistente com identificacao de erro upstream. Respostas JSON da API oficial sao repassadas com o status HTTP recebido.
