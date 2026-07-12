# Operacao de Snapshots Vivos

## Dry-run

```bash
npm run live:snapshot:capture -- --season=2026 --dry-run
```

Coleta, monta e valida o snapshot, mas nao grava arquivos.

## Captura real local

```bash
npm run live:snapshot:capture -- --season=2026
```

Se o mercado estiver pre-fechamento e houver `marketClosingAt`, o snapshot sera salvo.

## Captura invalida apenas para auditoria

```bash
npm run live:snapshot:capture -- --season=2026 --force-invalid-capture
```

Mesmo salvo, o snapshot continua com `isValidPreRoundSnapshot: false`.

## Auditoria

```bash
npm run live:snapshot:audit -- --season=2026
```

Verifica manifest, arquivos, schema, hash e validade temporal.

## Diagnostico de storage

```bash
npm run live:snapshot:storage-check -- --season=2026
```

Verifica leitura, escrita, escrita atomica e imutabilidade sem destruir dados reais. No modo atual, o resultado esperado e `WARNING`, porque o storage local funciona, mas a persistencia em producao Render nao esta confirmada.

## Validador de commit automatico

```bash
npm run live:snapshot:validate-changes -- --json
```

Usado pelo workflow para permitir somente arquivos em `data/live-snapshots` e bloquear codigo, configuracao, historico, backtests, deletes, renames e modificacao de snapshots ja versionados.

## Simulacao do workflow

```bash
npm run live:snapshot:workflow-simulate
```

Executa uma simulacao local em repositorio temporario, sem commit nem push reais.

## Automacao segura

```bash
npm run live:snapshot:auto -- --season=2026
```

Executa a captura em modo controlado. A automacao sempre consulta dados reais, monta um candidato em memoria e decide se deve gravar com base na politica de janelas e no fingerprint logico.

Simular sem gravar:

```bash
npm run live:snapshot:auto -- --season=2026 --dry-run
```

Forcar captura manual apenas quando o candidato for valido pre-fechamento:

```bash
npm run live:snapshot:auto -- --season=2026 --force --reason=MANUAL_AUDIT
```

Resultados possiveis:

- `CAPTURED`: snapshot valido gravado e auditado.
- `SKIPPED`: execucao valida, mas sem motivo suficiente para novo snapshot.
- `DRY_RUN_CAPTURE_RECOMMENDED`: dry-run detectou que uma captura seria gravada.
- `FAILED`: erro de coleta, escrita ou auditoria.

Cada execucao recebe `executionId` e usa lock local com expiracao. O lock local protege apenas execucoes no mesmo filesystem.

## GitHub Actions

A Build 4.5.4 mantém workflow horario ativo e confirmado externamente. `SKIPPED` e sucesso operacional. Se apenas campos volateis de `automation-status` mudarem, o workflow nao cria commit.

## Endpoints

- `GET /live-snapshots/:season/coverage`
- `GET /live-snapshots/:season/rounds`
- `GET /live-snapshots/:season/round/:round`
- `GET /live-snapshots/:season/round/:round/latest`
- `GET /live-snapshots/:season/round/:round/latest-valid-pre-round`
- `GET /live-snapshots/:season/round/:round/change-history`
- `GET /live-snapshots/:season/round/:round/final-pre-close`
- `GET /live-snapshots/:season/round/:round/schedule-status`
- `GET /live-snapshots/:season/snapshot/:snapshotId`
- `GET /live-snapshots/:season/integrity`
- `GET /live-snapshots/:season/automation-status`
- `GET /live-snapshots/:season/production-health`
- `GET /live-snapshots/:season/storage-health`
- `GET /live-snapshots/:season/automation-lock`

## Recuperacao de falha

Se uma captura falhar antes de salvar, execute novamente. A escrita usa arquivo temporario e rename atomico para evitar JSON parcial.

Se uma auditoria acusar hash invalido, trate o snapshot como corrompido e nao use em avaliacao.

Execucoes simultaneas devem ser impedidas no agendador externo. Os snapshots usam ids imutaveis e escrita atomica para evitar arquivo parcial ou sobrescrita acidental.
