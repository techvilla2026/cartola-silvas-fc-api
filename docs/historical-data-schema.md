# Schema historico

Schema atual:

```text
historical-round-data/v1
```

## HistoricalRoundData

Campos raiz:

- `schemaVersion`
- `season`
- `round`
- `source`
- `sourceVersion`
- `collectedAt`
- `validatedAt`
- `validationStatus`
- `marketContext`
- `players`
- `matches`
- `clubs`
- `positions`
- `statuses`
- `metadata`

## Player

- `athleteId`
- `name`
- `nickname`
- `abbreviatedName`
- `clubId`
- `clubName`
- `positionId`
- `statusId`
- `price`
- `priceVariation`
- `average`
- `points`
- `games`
- `played`
- `scouts`
- `rawSourceReference`

Ausencia de dado e representada por `null` ou campo ausente. A normalizacao nao transforma ausencia em zero.

## Match

- `matchId`
- `round`
- `homeClubId`
- `awayClubId`
- `date`
- `venue`
- `homeScore`
- `awayScore`
- `valid`
- `status`
- `rawSourceReference`

## PRE_ROUND_DATA

Arquivos `pre-round.json` existem para preservar a separacao conceitual necessaria ao backtest futuro. Nesta build, os dados historicos pre-rodada nao foram reconstruidos com seguranca, entao os campos abaixo sao marcados em `marketContext.notAvailableForLeakFreeBacktest`:

- `priceBeforeRound`
- `averageBeforeRound`
- `gamesBeforeRound`
- `statusBeforeRound`
- `accumulatedScoutsBeforeRound`
- `lineupProbabilityBeforeRound`
- `matchResultsBeforeRound`

## POST_ROUND_DATA

Arquivos `post-round.json` contêm jogadores da fonte primaria e partidas/resultados do Cartola oficial publico.

## HistoricalValidationReport

Schema:

```text
historical-validation-report/v1
```

Campos:

- `season`
- `round`
- `primarySource`
- `validationSource`
- `playersCompared`
- `matchesCompared`
- `missingPlayers`
- `extraPlayers`
- `pointsDifferences`
- `priceDifferences`
- `scoutDifferences`
- `matchDifferences`
- `validationStatus`
