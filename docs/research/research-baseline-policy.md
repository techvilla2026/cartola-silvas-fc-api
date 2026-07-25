# Research Baseline Policy

RESEARCH_BASELINE_1_0 e imutavel depois de VALID.

Comparacoes futuras devem usar baselineComparisonContract e declarar rounds, targets, metricas, denominadores, regras de elegibilidade, formacao, capitao e leakageStatus.

Se qualquer requisito essencial divergir, comparable=false e deltas globais nao devem ser calculados.

Mudancas de target, snapshot, denominador, formula oficial, regra de elegibilidade, schema incompativel, leakage ou hash divergente invalidam a baseline.

Documentacao, endpoint read-only, correcao visual e novo candidato experimental que apenas compara contra a baseline nao invalidam a baseline.
