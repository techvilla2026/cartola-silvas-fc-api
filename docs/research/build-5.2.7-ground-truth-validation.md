# Build 5.2.7 - Ground Truth Validation

Auditoria read-only do target historico de participacao e dos denominadores TopK.

DidNotPlay reavaliados: 7055.
TARGET_MISSING: 0. TARGET_AMBIGUOUS: 0.
Top1/Top3/Top5 audited didNotPlayRate: 0/0/0.
Reliability PARTICIPATION_TARGET: PARTIALLY_RELIABLE.

## Conclusao

O TopK global legado nao selecionou atletas com played=false; os 7055 didNotPlay existem no universo pos-rodada, mas ficam fora dos grupos TopK auditados.

Nenhum snapshot, backtest original, motor oficial ou formula foi alterado.

