# AVAILABILITY_SIGNALS_V1

Contrato versionado para sinais de disponibilidade pre-jogo.

## Regra principal

Somente sinais `SAFE_PRE_MATCH` podem ser consumidos por experimentos de Availability.
Sinais `UNSAFE_POST_MATCH` e `UNKNOWN_TIMING` sao bloqueados. Sinais `MISSING` ficam registrados como lacuna, sem valor inventado.

## Classes

- SAFE_PRE_MATCH: conhecido antes da rodada, com fonte/proveniencia auditavel.
- UNSAFE_POST_MATCH: conhecido apenas depois da rodada.
- UNKNOWN_TIMING: existe potencialmente, mas sem timestamp seguro.
- MISSING: nao existe na base atual.

## Sinais

- recentPlayedRate: SAFE_PRE_MATCH; fonte historical participation history; campo participationFeaturesForPlayer.recentParticipationRate.
- allPlayedRate: SAFE_PRE_MATCH; fonte historical participation history; campo participationFeaturesForPlayer.allParticipationRate.
- consecutiveAppearances: SAFE_PRE_MATCH; fonte historical participation history; campo participationFeaturesForPlayer.consecutivePlayed.
- consecutiveAbsences: SAFE_PRE_MATCH; fonte historical participation history; campo participationFeaturesForPlayer.consecutiveDidNotPlay.
- participationSampleSize: SAFE_PRE_MATCH; fonte historical participation history; campo participationFeaturesForPlayer.sampleSize.
- gamesBeforeRound: SAFE_PRE_MATCH; fonte historical pre-round reconstruction; campo pre.players[].gamesBeforeRound.
- priceBeforeRound: SAFE_PRE_MATCH; fonte historical pre-round reconstruction; campo pre.players[].priceBeforeRound.
- averageBeforeRound: SAFE_PRE_MATCH; fonte historical pre-round reconstruction; campo pre.players[].averageBeforeRound.
- accumulatedPointsBeforeRound: SAFE_PRE_MATCH; fonte historical pre-round reconstruction; campo pre.players[].accumulatedPointsBeforeRound.
- homeAway: SAFE_PRE_MATCH; fonte historical fixture context; campo pre.players[].homeAway.
- opponent: SAFE_PRE_MATCH; fonte historical fixture context; campo pre.players[].opponent.
- statusBeforeRound: MISSING; fonte historical pre-round reconstruction; campo pre.players[].statusBeforeRound.
- probableFlag: MISSING; fonte not configured; campo N/A.
- doubtFlag: MISSING; fonte not configured; campo N/A.
- injuryFlag: MISSING; fonte not configured; campo N/A.
- suspensionFlag: MISSING; fonte not configured; campo N/A.
- starterFlag: UNKNOWN_TIMING; fonte lineup source not configured; campo N/A.
- recentMinutesAverage: MISSING; fonte minutes source not configured; campo N/A.
- actualPlayedTarget: UNSAFE_POST_MATCH; fonte historical post-round; campo post.players[].played.
- actualPoints: UNSAFE_POST_MATCH; fonte historical post-round; campo post.players[].points.
- roundScouts: UNSAFE_POST_MATCH; fonte historical post-round; campo post.players[].scouts.

