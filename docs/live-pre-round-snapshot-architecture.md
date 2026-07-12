# Arquitetura de Snapshot Pre-Rodada Vivo

Build: 4.5.0

## Objetivo

Registrar snapshots imutaveis dos dados reais disponiveis antes do fechamento de uma rodada do Cartola FC.

Schema:

```text
live-pre-round-snapshot/v1
```

## Fontes

- `/mercado/status`
- `/atletas/mercado`
- `/partidas`

Os dados sao capturados da API publica do Cartola FC sem credenciais e sem armazenar elenco pessoal de usuario.

## Temporalidade

Cada snapshot registra:

- `capturedAt`: horario local da captura no backend em ISO-8601 UTC.
- `marketClosingAt`: derivado de `fechamento.timestamp` retornado por `/mercado/status`.
- `capturePhase`: `PRE_MARKET_CLOSE`, `POST_MARKET_CLOSE` ou `UNKNOWN`.
- `isValidPreRoundSnapshot`: `true` somente quando existe fechamento conhecido e `capturedAt < marketClosingAt`.

## Imutabilidade

Snapshots ficam em:

```text
data/live-snapshots/{season}/round-{round}/snapshots/{snapshotId}.json
```

O backend nao sobrescreve snapshot existente. Multiplas capturas da mesma rodada sao permitidas.

## Hash e Integridade

Cada snapshot possui:

- algoritmo: `sha256`;
- canonicalizacao: `canonical-json/v1`;
- `contentHash`.

A auditoria recalcula o hash e compara com o manifest.

## Manifest

Cada rodada possui `manifest.json` com:

- total de snapshots;
- total valido pre-rodada;
- primeiro snapshot;
- ultimo snapshot;
- ultimo snapshot valido;
- hashes.

## Disponibilidade

`dataAvailability` registra explicitamente `AVAILABLE`, `UNAVAILABLE`, `NOT_CAPTURED` ou `NOT_APPLICABLE` para mercado, atletas, clubes, partidas, scouts, motor, escala do usuario e Central.

## Motor

Quando o snapshot e valido pre-fechamento, o backend executa o motor de paridade existente:

```text
flutter-parity-engine/4.3.1
```

O Comparador permanece `NOT_EVALUATED` porque nao ha captura automatica de elenco pessoal.
