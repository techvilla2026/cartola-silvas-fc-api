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

## Endpoints

- `GET /live-snapshots/:season/coverage`
- `GET /live-snapshots/:season/rounds`
- `GET /live-snapshots/:season/round/:round`
- `GET /live-snapshots/:season/round/:round/latest`
- `GET /live-snapshots/:season/round/:round/latest-valid-pre-round`
- `GET /live-snapshots/:season/snapshot/:snapshotId`
- `GET /live-snapshots/:season/integrity`

## Recuperacao de falha

Se uma captura falhar antes de salvar, execute novamente. A escrita usa arquivo temporario e rename atomico para evitar JSON parcial.

Se uma auditoria acusar hash invalido, trate o snapshot como corrompido e nao use em avaliacao.
