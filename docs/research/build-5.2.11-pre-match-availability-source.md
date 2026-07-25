# Build 5.2.11 - Pre-Match Availability Source V1

Cria uma fonte prospectiva, versionada e auditavel de sinais pre-jogo de disponibilidade.

## Fontes integradas

- Cartola FC `/mercado/status` para rodada e deadline.
- Cartola FC `/atletas/mercado` para atletas, clubes, posicoes e status.
- Cartola FC `/partidas` para contexto de confrontos.
- Entrada manual curada opcional com audit trail e timestamp.

## Fontes recusadas

- free-news-scraping: NOT_RECOMMENDED; Nao ha fonte estruturada, timestamp canonico ou garantia de termos.
- setoristas-lineup-social: UNRELIABLE; Pode ser util futuramente com curadoria manual, mas nao como integracao automatica.
- licensed-injury-suspension-minutes: REQUIRES_LICENSE; Nao integrar sem contrato/licenca e timestamps pre-jogo.

## Garantias

- Snapshot imutavel por captureId.
- Fingerprint SHA-256 canonico.
- Validacao capturedAt < deadline.
- `UNKNOWN_TIMING` e `POST_MATCH_BLOCKED` nao entram em modelo.
- Threshold 0.50 preservado; 0.45 e apenas pesquisa operacional.
- R19 continua fora da baseline.

