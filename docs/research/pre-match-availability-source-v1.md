# PRE_MATCH_AVAILABILITY_SOURCE_V1

Contrato canonico para snapshots prospectivos de disponibilidade pre-jogo.

Campos principais: `schemaVersion`, `sourceDefinitionVersion`, `season`, `round`, `capturedAt`, `roundDeadline`, `captureRelationToDeadline`, `sources`, `players`, `coverage`, `snapshotFingerprint`.

Cada jogador preserva `statusRaw`, `statusNormalized`, flags de disponibilidade quando existirem, `sourceId`, `sourceTimestamp`, `captureTimestamp`, `temporalSafety` e `confidence`.

Classes temporais: `SAFE_PRE_MATCH`, `UNKNOWN_TIMING`, `POST_MATCH_BLOCKED`.

