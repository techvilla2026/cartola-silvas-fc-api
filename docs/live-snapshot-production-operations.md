# Operacao de Producao dos Snapshots

Build: 4.5.4

## Status

`PRODUCTION_AUTOMATION_STATUS=READY`

A automacao segura existe no backend, o workflow GitHub Actions esta confirmado, a execucao real foi confirmada e o Render Auto-Deploy esta confirmado como `ON_COMMIT`.

## Checks locais

```bash
npm run live:snapshot:storage-check -- --season=2026
npm run live:snapshot:audit -- --season=2026
npm run live:snapshot:auto -- --season=2026 --dry-run
npm run live:snapshot:validate-changes -- --json
npm run live:snapshot:workflow-simulate
```

## Endpoints operacionais

- `GET /live-snapshots/:season/production-health`
- `GET /live-snapshots/:season/storage-health`
- `GET /live-snapshots/:season/automation-lock`

Esses endpoints nao expõem caminhos locais, secrets, variaveis de ambiente ou stack traces.

## Lock

Cada execucao automatica recebe `executionId` e tenta adquirir um lock local. O lock registra:

- `executionId`;
- `createdAt`;
- `expiresAt`;
- `season`;
- `round`;
- processo local.

Locks expirados sao recuperados. Locks ativos de outra execucao nao sao removidos.

## Recuperacao de falhas

O status operacional registra:

- `failureCount`;
- `consecutiveFailureCount`;
- `lastSuccessfulRunAt`;
- `lastFailureAt`;
- `errorCode`;
- `errorMessage` seguro.

Falhas nao apagam o ultimo snapshot valido nem promovem snapshot pos-fechamento.

## Alertas

Alertas expostos:

- `NO_VALID_SNAPSHOT`;
- `NO_RECENT_EXECUTION`;
- `CLOSING_SOON_WITHOUT_RECENT_VALID_SNAPSHOT`;
- `CONSECUTIVE_FAILURES`;
- `LOCK_STALE_RECOVERED`;
- `AUDIT_FAILURE`;
- `LOCK_ACTIVE`.

Nenhum alerta envia e-mail, WhatsApp ou push nesta build.

## GitHub Actions preparado

Arquivo:

```text
.github/workflows/live-snapshot-capture.yml
```

Caracteristicas:

- schedule horario;
- workflow_dispatch com `season` e `dry_run`;
- concurrency por branch;
- `contents: write`;
- `npm ci`;
- `test:live-snapshot-ci`;
- storage-check;
- automacao strict;
- auditoria;
- validate-changes;
- commit/push apenas de mudancas materiais permitidas.

## Persistencia oficial

```text
runtimeStorageMode=LOCAL_EPHEMERAL
officialPersistenceMode=GIT_AUTOMATED_COMMITS
```

O filesystem local continua sendo runtime. A persistencia oficial e feita por commits controlados no Git e deploy Render On Commit.

## Operacao recomendada

Usar `docs/live-snapshot-production-activation-checklist.md` para auditorias futuras, pausas e reativacoes. Esta build local nao executou workflow real, commit, push ou deploy.
