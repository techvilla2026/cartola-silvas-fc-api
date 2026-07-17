# Laboratorio Historico do Motor - Build 4.7.0

A Build 4.7.0 adiciona uma camada de pesquisa offline para diagnosticar o motor historico `flutter-parity-enriched-engine/4.3.2` usando apenas artefatos ja persistidos em `data/backtests/2026/build-4.3.2`.

O laboratorio nao altera o motor oficial, nao altera o Flutter, nao reescreve dados historicos, nao toca nos snapshots vivos e nao promove candidatos automaticamente.

## Fonte dos dados

- Temporada: 2026.
- Build fonte: `build-4.3.2`.
- Rodadas avaliadas: 2 a 18.
- Politica temporal: decisoes congeladas antes da comparacao pos-rodada.
- Dados recentes: reconstruidos somente a partir de rodadas anteriores.
- Oracle: usado apenas para medir regret, nunca como feature do motor.

## Artefatos

Os artefatos ficam em:

```text
data/research/2026/
```

Arquivos principais:

- `audit.json`
- `engine-diagnostics.json`
- `ranking-diagnostics.json`
- `ideal-team-diagnostics.json`
- `captain-diagnostics.json`
- `ablation-study.json`
- `experiments-summary.json`
- `promotion-gate.json`
- `research-health.json`
- `experiments/{candidateId}.json`

Todos carregam schema versionado, temporada, versao do motor, fingerprints, rodadas de entrada, rodadas avaliadas, warnings e limitacoes.

## Comandos

```bash
npm run research:audit
npm run research:diagnostics
npm run research:ranking
npm run research:ideal-team
npm run research:captain
npm run research:ablation
npm run research:experiments
npm run research:walk-forward
npm run research:promotion-gate
npm run research:all
npm run research:check
```

`research:all` executa auditoria, diagnosticos, estudo de ablation, candidatos walk-forward, promotion gate e health final. Se a auditoria historica falhar, experimentos validos sao interrompidos.

## Promotion Gate

A politica fica em:

```text
config/engine-experiment-policy.json
```

Estados permitidos:

- `REJECTED`
- `INSUFFICIENT_EVIDENCE`
- `PROMISING`
- `ELIGIBLE_FOR_SHADOW_TEST`

O estado `PROMOTED` e proibido nesta build. Shadow mode fica apenas preparado, sem ativacao.

## Endpoints

Os endpoints sao somente leitura e nao executam calculo pesado na requisicao:

- `GET /research/engine-audit`
- `GET /research/engine-diagnostics`
- `GET /research/ranking-diagnostics`
- `GET /research/ideal-team-diagnostics`
- `GET /research/captain-diagnostics`
- `GET /research/ablation-study`
- `GET /research/experiments`
- `GET /research/experiments/:candidateId`
- `GET /research/promotion-gate`
- `GET /research/research-health`

## Limites

- Nao ha elenco historico real do usuario para o Comparador.
- Status pre-rodada historico permanece indisponivel.
- Scouts historicos divergentes continuam fora do motor oficial.
- A amostra de 17 rodadas pode ser insuficiente para promocao estatistica.
