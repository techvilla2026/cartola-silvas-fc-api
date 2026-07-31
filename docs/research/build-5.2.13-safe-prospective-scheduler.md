# Build 5.2.13 - Safe Prospective Pre-Match Scheduler

## Resultado

O scheduler prospectivo foi preparado em workflow separado, com `workflow_dispatch`, cron a cada 30 minutos, concorrencia por ref, Node 22, `npm ci`, timeout de 15 minutos e nenhum deploy. O deadline da API do Cartola permanece a fonte de verdade; os horarios da R22 nao foram codificados.

Estado inicial:

- workflow: `PREPARED_DRY_RUN`;
- persistencia: `PREPARED_BUT_DISABLED`;
- scheduler: `READY_FOR_MANUAL_DISPATCH`;
- escrita: desabilitada;
- commit: desabilitado.

## Auditoria do workflow anterior

`.github/workflows/live-snapshot-capture.yml` captura snapshots operacionais aproximadamente a cada hora, usa `contents: write`, concorrencia por ref, testes, auditoria, allowlist e commits do bot. Ele prova que Git automatizado funciona, mas opera em `data/live-snapshots` e possui semantica diferente. Reutilizar o mesmo estado criaria risco de staging cruzado, conflito de commits e confusao entre live snapshot e controle prospectivo. Por isso apenas os padroes de seguranca foram reaproveitados.

## Persistencia avaliada

- commit Git restrito: escolhido e preparado;
- artifact temporario: util para diagnostico, insuficiente como registro canonico;
- storage persistente do backend: indisponivel no runner;
- endpoint privado autenticado: nao criado nesta build;
- execucao manual local: fallback operacional.

Somente estes caminhos podem ser persistidos:

- `data/research/2026/pre-match-availability/**`;
- `data/research/2026/prospective-availability-controls.json`.

Qualquer outro arquivo resulta em `UNEXPECTED_FILE_CHANGE`. O workflow nao usa `git add .`, `git add -A`, rebase ou force push. O commit futuro inclui `[skip render]`; antes de habilitar, a politica de skip de deploy do provedor deve ser confirmada.

## Exit codes

- `0`: `CAPTURE_CREATED`, `ALREADY_CAPTURED`, `OUTSIDE_CAPTURE_WINDOW`, `ROUND_NOT_READY` e mercado fechado com captura valida;
- `2`: `MISSED_CAPTURE` ou mercado fechado sem captura valida;
- `3`: `SOURCE_UNAVAILABLE`;
- `4`: `TEMPORAL_VALIDATION_FAILED`;
- `5`: `UNEXPECTED_FILE_CHANGE` na persistencia;
- `1`: erro inesperado.

## Garantias cientificas

R20 permanece `PENDING_OUTCOME`; R21 e reportada como `MISSED_PROSPECTIVE_CAPTURE`; nenhum live snapshot e convertido em snapshot prospectivo. Baseline, V1, V2, thresholds, motor, formulas, Promotion State, Flutter, snapshots historicos e backtests nao foram alterados.

## `.gitattributes`

As regras `-text` impedem conversao de finais de linha em snapshots JSON. A inclusao da regra nao reescreve arquivos existentes; hashes foram comparados antes e depois da build.
