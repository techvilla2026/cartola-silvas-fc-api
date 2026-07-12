# Auditoria de Storage em Producao

Build: 4.5.4

## Estado atual

| Campo | Valor |
| --- | --- |
| `CURRENT_STORAGE_MODE` | `LOCAL_FILESYSTEM` |
| `CURRENT_SCHEDULER_MODE` | `GITHUB_ACTIONS_ACTIVE` |
| `CURRENT_DEPLOY_MODE` | `RENDER_WEB_SERVICE_ASSUMED_FROM_CONTEXT` |
| `SNAPSHOT_DATA_TRACKED_BY_GIT` | `true` |
| `PRODUCTION_PERSISTENCE_SAFE` | `true` |

Nao ha `render.yaml` no repositorio. O workflow `.github/workflows/live-snapshot-capture.yml` esta confirmado como executado externamente. O backend escreve snapshots em `data/live-snapshots` usando filesystem local em runtime. Os snapshots reais existentes estao versionados no Git.

## Render

Documentacao oficial consultada:

- https://render.com/docs/disks
- https://render.com/docs/cronjobs

Pontos confirmados pela documentacao:

- o filesystem padrao dos servicos Render e efemero;
- sem Persistent Disk, alteracoes locais sao perdidas em restart ou redeploy;
- Persistent Disk preserva mudancas locais, mas depende de configuracao/plano;
- Render Cron Jobs nao acessam Persistent Disk.

Pontos nao confirmados neste repositorio:

- plano Render atual;
- existencia de Persistent Disk no servico real;
- configuracao de auto deploy;
- permissao de escrita persistente compartilhada entre job e Web Service.

## Matriz de decisao

| Arquitetura | Persistencia | Custo | Backend acessa dados? | Decisao |
| --- | --- | --- | --- | --- |
| Render Cron + filesystem local | Nao segura | desconhecido | nao garantido | rejeitada |
| Render Cron + Persistent Disk | Cron nao acessa disk | desconhecido | nao garantido | rejeitada |
| GitHub Actions + commit dos snapshots | segura via Git | gratuita em geral, sujeita a limites | sim apos deploy/pull | selecionada |
| GitHub Actions + storage externo | segura | depende do storage | sim se integrado | bloqueada sem credenciais/storage |
| Servico externo + endpoint protegido | depende do storage | desconhecido | sim se storage persistente | bloqueada sem storage |
| Captura manual | segura se commitada | gratuita | sim apos deploy/pull | fallback operacional |

## Decisao

`SELECTED_PRODUCTION_ARCHITECTURE=GITHUB_ACTIONS_AUTOMATED_COMMIT_ACTIVE`

`SELECTION_REASON`: snapshots versionados por commit controlado no Git sobrevivem a restart/redeploy e ficam disponiveis ao backend apos o deploy do repositorio.

`PRODUCTION_AUTOMATION_STATUS=READY`

Status final: `READY`, porque GitHub Actions, execucao real, branch `main`, persistencia por Git e Render Auto-Deploy `ON_COMMIT` foram confirmados externamente.

## Alternativas rejeitadas

- Render Cron + filesystem local: risco de perda por filesystem efemero.
- Render Cron + Persistent Disk: Cron Jobs nao acessam Persistent Disk.
- Endpoint protegido: nao resolve persistencia sem storage duravel.
- Workflow sem allowlist: rejeitado por risco de alterar arquivos fora de `data/live-snapshots`.

## Suposicoes nao resolvidas

- `Render plan is still UNKNOWN, but not required for official Git persistence`.
- `Persistent Disk is still UNKNOWN, but not used as official persistence`.
- `External object storage is NOT_CONFIGURED`.
