# Backtest Build 4.3.0

Temporada: 2026

## O que foi testado

Foi avaliada uma politica historica explicita do backend, nao o motor Flutter completo. A politica usa apenas dados pre-rodada v2: media antes da rodada, pontos acumulados, jogos anteriores, mando e preco pre-rodada para metricas de custo-beneficio.

## Auditoria do motor atual

No backend nao havia formulas de previsao, Nota da analise, Time Ideal, capitao, vice, custo-beneficio, recomendacoes, jogadores para evitar ou Comparador. Essas regras parecem existir fora deste backend, no aplicativo Flutter ou em camadas ainda nao portadas.

Por isso, a Build 4.3.0 criou uma Historical Evaluation Engine explicita e versionada:

- Engine: historical-evaluation-engine/4.3.0
- Politica de previsao: pre-round-average-homeaway-v1
- Politica de selecao: formation-4-3-3-top-predicted-v1
- Baseline: baseline-average-4-3-3-v1

## Dados excluidos

Nao foram usados statusBeforeRound, lineupProbabilityBeforeRound, placares/resultados da rodada como entrada, scouts oficiais divergentes da rodada, recomendacoes Flutter, jogadores para evitar ou comparador.

## Partes avaliadas

- Previsao por atleta.
- Nota da analise da politica historica.
- Time Ideal 4-3-3 sem tecnico.
- Capitao e vice.
- Casa x fora.
- Faixas de preco.
- Baseline por media pre-rodada.

## Partes nao avaliadas

- Recomendacoes positivas: NOT_EVALUATED.
- Jogadores para evitar: NOT_EVALUATED.
- Comparador: NOT_EVALUATED.
- Tecnico: NOT_EVALUATED na selecao inicial.

## Resultados principais

- Rodadas avaliadas: 17
- Rodadas puladas: 0
- Atletas elegiveis: 12043
- Previsoes avaliadas: 5126
- MAE: 3.0815
- RMSE: 4.1227
- Bias: 0.0915
- Erro mediano: 2.37
- Dentro de +/-1: 0.229
- Dentro de +/-2: 0.4331
- Dentro de +/-3: 0.5983
- Dentro de +/-5: 0.8104

## Motor x Baseline

- Pontos acumulados do motor: 515
- Pontos acumulados do baseline: 518.4
- Vitorias: 6
- Empates: 7
- Derrotas: 4
- Diferenca media: -0.2
- Diferenca acumulada: -3.4

## Capitao

- Melhor do time: 0.1765
- Top 3 do time: 0.4118
- Negativo: 0.0588
- Gap medio ao melhor: 3.3294

## Limitacoes

- Nao avalia recomendacoes, evitar jogadores ou comparador por falta de politica backend reproduzivel.
- Tecnico excluido da formacao inicial.
- Politica avaliada nao altera pesos nem aprende com resultados.

## Proximos passos

- Portar fielmente o motor Flutter real para o backend, se desejado.
- Investigar scouts divergentes antes de usa-los como feature forte.
- Avaliar recomendacoes, evitar jogadores e comparador quando houver politica backend reproduzivel.
- Rodar uma Build posterior para calibracao, sem alterar esta medicao.
