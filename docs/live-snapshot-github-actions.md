# GitHub Actions de Snapshots Vivos

Build: 4.5.3

## Status

`workflowActivationStatus=NOT_ACTIVATED`

O workflow foi preparado, mas nao foi executado nesta build. Nao houve commit, push ou deploy.

## Workflow

Arquivo:

```text
.github/workflows/live-snapshot-capture.yml
```

Gatilhos:

- `schedule`: uma vez por hora;
- `workflow_dispatch`: execucao manual segura.

Nao ha gatilho `push`, para evitar loop de commit/deploy/captura.

## Frequencia

`schedulerFrequency=HOURLY`

A politica interna continua decidindo se grava ou pula:

- `>72h`: 24h;
- `72-24h`: 12h;
- `24-6h`: 3h;
- `6-1h`: 1h;
- ultima hora: 15min recomendado internamente;
- ultimos 15min: captura final permitida.

Limitacao: GitHub Actions rodando uma vez por hora nao garante capturas a cada 15 minutos na ultima hora.

## Concorrencia

O workflow usa:

```yaml
concurrency:
  group: live-snapshot-capture-${{ github.ref }}
  cancel-in-progress: false
```

Isso impede execucoes simultaneas no mesmo branch e nao cancela uma execucao que ja pode estar escrevendo snapshot. O lock interno continua como segunda camada.

## Permissoes

```yaml
permissions:
  contents: write
```

Essa permissao e necessaria apenas para commit/push dos arquivos permitidos. Nenhuma permissao adicional foi concedida.

## Inputs manuais

- `season`, padrao `2026`;
- `dry_run`, padrao `false`.

Nao ha input para `force`, `now`, path, comando, script ou branch arbitraria.

## Fluxo

1. checkout;
2. setup-node;
3. `npm ci`;
4. `npm run test:live-snapshot-ci`;
5. `npm run live:snapshot:storage-check`;
6. `npm run live:snapshot:auto -- --strict`;
7. `npm run live:snapshot:audit`;
8. `npm run live:snapshot:validate-changes -- --json --restore-volatile`;
9. commit somente se houver mudanca material permitida;
10. `git pull --rebase`;
11. `git push`;
12. GitHub Step Summary.

## Deploy Render

`renderAutoDeployConfirmed=UNKNOWN`

Se Render auto deploy estiver ativo, o fluxo esperado e:

GitHub commit automatico -> Render deploy -> Web Service recebe arquivos versionados -> endpoints leem snapshots.

Sem confirmacao do auto deploy, a producao fica `PARTIALLY_READY`, nao totalmente automatizada.
