# Schema historico

Schema pos-rodada atual:

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

Arquivos `pre-round.json` usam o schema:

```text
historical-pre-round-data/v2
```

Campos raiz:

- `schemaVersion`
- `season`
- `round`
- `generatedAt`
- `sourceRounds`
- `leakageStatus`
- `players`
- `matches`
- `metadata`
- `readiness`

Jogador:

- `athleteId`
- `name`
- `nickname`
- `clubId`
- `positionId`
- `priceBeforeRound`
- `averageBeforeRound`
- `gamesBeforeRound`
- `accumulatedPointsBeforeRound`
- `accumulatedScoutsBeforeRound`
- `statusBeforeRound`
- `opponent`
- `homeAway`
- `fieldProvenance`
- `eligibleForBacktest`
- `ineligibilityReasons`

Continuam indisponiveis ou inseguros:

- `statusBeforeRound`
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
