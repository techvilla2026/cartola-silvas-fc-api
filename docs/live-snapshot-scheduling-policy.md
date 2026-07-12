# Politica de Agendamento de Snapshots

Build: 4.5.1

## Objetivo

Decidir quando uma captura pre-rodada deve ser gravada, evitando duplicatas sem mudanca relevante e aumentando a frequencia perto do fechamento.

## Janelas internas

| Distancia ate fechamento | Janela | Proxima verificacao recomendada |
| --- | --- | --- |
| Mais de 72h | `MORE_THAN_72_HOURS` | 24h |
| 72h a 24h | `SEVENTY_TWO_TO_TWENTY_FOUR_HOURS` | 12h |
| 24h a 6h | `TWENTY_FOUR_TO_SIX_HOURS` | 3h |
| 6h a 1h | `SIX_TO_ONE_HOURS` | 1h |
| Ultima hora | `LAST_HOUR` | 15min |
| Ultimos 15min | `LAST_15_MINUTES` | captura final permitida |

## Motivos de captura ou skip

- `FIRST_VALID_SNAPSHOT`
- `SIGNIFICANT_CHANGE`
- `DAILY_CHECKPOINT`
- `CLOSING_WINDOW`
- `FINAL_SAFETY_CAPTURE`
- `NO_PREVIOUS_VALID_SNAPSHOT`
- `MARKET_CLOSED`
- `NO_SIGNIFICANT_CHANGE`
- `TOO_SOON`
- `UNKNOWN_MARKET_STATE`

## Roles

- `FIRST_VALID`
- `CHECKPOINT`
- `SIGNIFICANT_CHANGE`
- `CLOSING_WINDOW`
- `FINAL_PRE_CLOSE`
- `INVALID_AUDIT_CAPTURE`

## Ambiente de deploy

A politica interna recomenda frequencias menores que uma hora na janela final, mas o ambiente externo pode nao suportar isso. Nesse caso, a automacao externa deve chamar o script com a melhor frequencia disponivel e deixar a politica decidir se grava ou pula.
