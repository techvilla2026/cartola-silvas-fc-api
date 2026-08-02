# Build 5.2.15 - Controlled Real Prospective Capture Activation

## Objetivo

Preparar a ativacao real do scheduler prospectivo sem executar captura fora das janelas PRIMARY e FINAL. A API do Cartola e o deadline atual continuam sendo a fonte de verdade.

## Modos remotos

- `dry-run`: padrao, nunca grava.
- `preflight`: valida configuracao, allowlist, bot e capacidade de push com `git push --dry-run`; nao cria arquivo, commit ou captura.
- `live`: somente disponivel quando `PRE_MATCH_CAPTURE_WRITE_ENABLED=true` e `PRE_MATCH_CAPTURE_COMMIT_ENABLED=true`.
- `scheduled`: segue as mesmas Repository Variables; com ambas falsas opera em dry-run.

Se apenas uma variavel estiver ativa, a execucao falha com `INVALID_ACTIVATION_CONFIGURATION` antes do scheduler.

## Persistencia e deploy

A persistencia permite somente:

- `data/research/{season}/pre-match-availability/**`
- `data/research/{season}/prospective-availability-controls.json`

O commit usa paths explicitos, bot identificado, push normal e mensagem `chore(research): capture pre-match R{round} {captureType} [skip render]`. Nao existe etapa de deploy. O Render reconhece `[skip render]`; a confirmacao operacional final deve observar os Events do primeiro commit real.

## Ativacao manual futura

Somente depois de preflight remoto aprovado, configure simultaneamente no GitHub, em **Settings > Secrets and variables > Actions > Variables**:

- `PRE_MATCH_CAPTURE_WRITE_ENABLED=true`
- `PRE_MATCH_CAPTURE_COMMIT_ENABLED=true`

Execute um dispatch `live` fora da janela e confirme `OUTSIDE_CAPTURE_WINDOW`, `actionTaken: NONE`, nenhum arquivo e nenhum commit. A primeira captura deve ocorrer naturalmente na janela PRIMARY.

## Preservacoes

Nao foram alterados motor oficial, formulas, modelos de disponibilidade, thresholds, baseline, snapshots historicos, backtests, Promotion State ou Flutter.
