# Politica de Commit Automatico de Snapshots

Build: 4.5.3

## Objetivo

Permitir que o workflow persista apenas dados de snapshots vivos e impedir qualquer alteracao automatica de codigo, configuracao, historico, backtests, secrets ou dependencias.

## Allowlist

Permitido:

```text
data/live-snapshots/<season>/automation-status.json
data/live-snapshots/<season>/round-*/manifest.json
data/live-snapshots/<season>/round-*/change-history.json
data/live-snapshots/<season>/round-*/snapshots/*.json
```

Proibido:

```text
src/
scripts/
test/
docs/
server.js
package.json
package-lock.json
README.md
CHANGELOG.md
.env
node_modules/
data/historical/
data/backtests/
qualquer outro caminho
```

## Snapshots imutaveis

Arquivos novos em `snapshots/*.json` sao permitidos. Arquivos de snapshot que ja existem em `HEAD` nao podem ser modificados, deletados ou renomeados.

## Deletes e renames

Deletes automaticos sao rejeitados. Renames sao rejeitados.

## automation-status

Campos volateis nao geram commit isolado:

- `lastRunAt`;
- `executionId`;
- `processId`;
- `duration`;
- `nextRecommendedCheckAt`;
- `secondsToClosing`;
- `lockReleased`;
- `lastSuccessfulRunAt`.

Mudancas materiais podem gerar commit:

- `CAPTURED`;
- `FAILED`;
- mudanca material de `reason`;
- mudanca de `round`;
- mudanca de `snapshotId`;
- mudanca de `auditStatus`;
- `failureCount`;
- `consecutiveFailureCount`;
- alertas;
- `marketClosingAt`;
- estado de producao.

Se apenas campos volateis mudarem, o validador restaura `automation-status.json` a partir de `HEAD` antes do commit.

## Identidade do bot

```text
user.name = slvs-snapshot-bot
user.email = slvs-snapshot-bot@users.noreply.github.com
```

Mensagem:

```text
chore(snapshot): automatic pre-round capture
```

## Push seguro

O workflow executa `git pull --rebase` antes do push. Se houver conflito, o workflow falha. Nao usa `--force` nem `--force-with-lease`.
