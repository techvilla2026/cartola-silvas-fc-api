# Build 5.2.9 - Availability Recalibration

Baseline: RESEARCH_BASELINE_1_0 (VALID).
Modelo novo: AVAILABILITY_V2_CALIBRATED. AVAILABILITY_V1 preservado: true.
Split temporal: treino 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13; validacao 14, 15, 16, 17, 18.

## Metricas globais

V1 Brier 0.1649; ECE 0.106006; Balanced Accuracy 0.7813.
V2 Brier 0.153291; ECE 0.040604; Balanced Accuracy 0.783.
Delta Brier -0.011609; Delta ECE -0.065402; Delta recall -0.0587.

## FP/FN

V1 FP 557; FN 268.
V2 FP 427; FN 360.

## Downstream

Top5 V1 didNotPlayRate 0; V2 0.
Time Ideal V1 media pontos 52.56; V2 52.72.

## Recommendation

NEEDS_MORE_DATA. Nenhum modelo foi promovido automaticamente.

## Limitacoes

- Status pre-rodada e majoritariamente indisponivel.
- Sem fontes confiaveis de lesao, suspensao, minutos e titularidade.
- Target permanece PARTIALLY_RELIABLE por divergencias semanticas raw documentadas na baseline.
- Validacao usa holdout temporal 14-18; precisa de novas rodadas para promocao real.

