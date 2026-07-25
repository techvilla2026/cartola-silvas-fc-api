# Build 5.2.12 - Prospective Availability Evaluation

Esta build avalia prospectivamente snapshots de `PRE_MATCH_AVAILABILITY_SOURCE_V1` e prepara captura automatica segura antes do deadline.

## Snapshot R20

- Snapshot escolhido: `pre-match-2026-r20-20260724233025-648962cc`.
- Regra de escolha: usar `FINAL` valido quando existir; caso contrario usar `PRIMARY` valido.
- Status temporal: `SAFE_PRE_MATCH`.
- Deadline: `2026-07-25T21:29:00.000Z`.
- Avaliacao atual: `PENDING_OUTCOME`, pois `data/historical/2026/round-20/post-round.json` ainda nao existe.

## Metricas

Quando o outcome existir, a avaliacao usa somente `post.players[].played`.
Nao infere participacao por pontos, scouts ou presenca em lista.

Modelos comparados:

- `AVAILABILITY_V1`
- `AVAILABILITY_V2_CALIBRATED` threshold oficial `0.50`
- `AVAILABILITY_V2_CALIBRATED` threshold experimental `0.45`

O threshold `0.45` nao altera a probabilidade da V2 e nao altera o threshold oficial.

## Auto Capture

Janelas:

- `PRIMARY`: entre 6h e 2h antes do deadline.
- `FINAL`: entre 90min e 30min antes do deadline.

Reason codes:

- `CAPTURE_CREATED`
- `ALREADY_CAPTURED`
- `OUTSIDE_CAPTURE_WINDOW`
- `MARKET_CLOSED`
- `ROUND_NOT_READY`
- `SOURCE_UNAVAILABLE`
- `TEMPORAL_VALIDATION_FAILED`

## Risco

- `CAPTURE_AT_RISK`: deadline em menos de 2h e sem captura valida.
- `MISSED_CAPTURE`: deadline passou e nenhuma captura valida existe.

## Agendamento

Recomendacao operacional: GitHub Actions scheduled workflow chamando `npm run research:auto-capture-pre-match -- --dry-run` em validacao e, quando ativado pelo operador, sem deploy automatico. Como alternativa imediata, executar manualmente antes de cada deadline.

Nenhum modelo foi promovido.
