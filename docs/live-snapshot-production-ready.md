# Snapshots Vivos em Producao

Build: 4.5.4

## Arquitetura final

```text
GitHub Actions horario
-> executa politica de snapshots
-> valida allowlist
-> commita somente dados permitidos
-> push seguro
-> Render Auto-Deploy On Commit
-> backend publicado le arquivos versionados
```

## Status

```text
productionAutomationStatus=READY
workflowActivationStatus=ACTIVE
schedulerFrequency=HOURLY
gitPersistenceMode=AUTOMATED_COMMIT_ACTIVE
runtimeStorageMode=LOCAL_EPHEMERAL
officialPersistenceMode=GIT_AUTOMATED_COMMITS
renderAutoDeployConfirmed=true
renderAutoDeployMode=ON_COMMIT
```

## Persistencia

O filesystem local do Render continua efemero e nao e a fonte oficial de persistencia. A persistencia oficial e o repositorio Git, por commits automaticos controlados em `data/live-snapshots`.

## Limitacao temporal

O workflow roda uma vez por hora. A politica interna ainda recomenda 15 minutos na ultima hora, mas a infraestrutura atual nao garante essa granularidade.

## Saude

Verificar:

```text
GET /live-snapshots/2026/production-health
GET /live-snapshots/2026/storage-health
GET /live-snapshots/2026/automation-status
```

`production-health` lista `readinessChecks` com `PASS`, `WARNING` ou `FAIL`.

## Pausar

Para pausar, desabilite o workflow no GitHub Actions. Nao altere snapshots manualmente.

## Reativar

Reative o workflow, execute `workflow_dispatch` com `dry_run=true`, revise o resumo e depois execute uma rodada real se necessario.

## Se o workflow falhar

- verificar `disallowedChanges`;
- confirmar se houve arquivo proibido, delete, rename ou snapshot imutavel modificado;
- nao usar push force;
- corrigir a causa e reexecutar.

## Se Render nao fizer deploy

- confirmar Auto-Deploy `ON_COMMIT`;
- conferir se o commit automatico chegou ao branch `main`;
- executar deploy manual se necessario;
- validar endpoints publicados apos o deploy.
