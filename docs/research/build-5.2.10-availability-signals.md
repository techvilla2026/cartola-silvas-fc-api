# Build 5.2.10 - Collect More Availability Signals

Baseline: RESEARCH_BASELINE_1_0 (VALID, freeze ACTIVE).
Contrato: AVAILABILITY_SIGNALS_V1.
Dataset: 12043 jogador-rodadas; validacao 3658.

## Resultado

Nenhum modelo foi promovido e `AVAILABILITY_V2_SIGNAL_AUGMENTED` nao foi criado nesta build.
Nao criado nesta build: os sinais seguros com alta cobertura ja estao majoritariamente embutidos na V2 ou sao apenas contexto; os sinais realmente incrementais (provavel, lesao, suspensao, titularidade, minutos) estao ausentes/sem timing seguro.

## Sinais seguros

- recentPlayedRate
- allPlayedRate
- consecutiveAppearances
- consecutiveAbsences
- participationSampleSize
- gamesBeforeRound
- priceBeforeRound
- averageBeforeRound
- accumulatedPointsBeforeRound
- homeAway
- opponent

## Sinais bloqueados ou ausentes

- statusBeforeRound: MISSING
- probableFlag: MISSING
- doubtFlag: MISSING
- injuryFlag: MISSING
- suspensionFlag: MISSING
- starterFlag: UNKNOWN_TIMING
- recentMinutesAverage: MISSING
- actualPlayedTarget: UNSAFE_POST_MATCH
- actualPoints: UNSAFE_POST_MATCH
- roundScouts: UNSAFE_POST_MATCH

## FN/FP da V2

FN: 360. FP: 427.

## Thresholds

Achado operacional: threshold 0.45; recall 0.8226; FP 537.
Threshold altera decisao operacional, mas nao altera Brier/ECE do score probabilistico V2.

## Proxima prioridade

ADD_VERSIONED_PREMATCH_STATUS_AND_LINEUP_SOURCE: COLLECT_EXTERNAL_AVAILABILITY_SOURCE.

