# Contrato de Storage de Snapshots

Build: 4.5.2

## Objetivo

Separar regras de captura da forma de persistencia. A implementacao atual continua usando filesystem local, mas agora segue um contrato que permite futura troca por storage Git, Persistent Disk ou object storage.

## Operacoes obrigatorias

- `readManifest`
- `writeManifestAtomic`
- `listRounds`
- `listSnapshots`
- `readSnapshot`
- `writeSnapshotImmutable`
- `readAutomationStatus`
- `writeAutomationStatusAtomic`
- `readChangeHistory`
- `writeChangeHistoryAtomic`
- `exists`
- `healthCheck`

## Implementacao atual

`LiveSnapshotRepository` implementa o contrato como `LOCAL_FILESYSTEM`.

Garantias locais:

- escrita atomica com arquivo temporario e rename;
- snapshot imutavel por caminho/id;
- manifest regravado atomicamente;
- status e historico regravados atomicamente;
- lock local por arquivo exclusivo;
- health-check sem destruir dados reais.

Limitacao:

O lock e o storage local protegem apenas processos que compartilham o mesmo filesystem. Isso nao resolve persistencia distribuida nem concorrencia entre ambientes isolados.
