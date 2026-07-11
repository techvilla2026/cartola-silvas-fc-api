# Metodo de reconstrucao pre-rodada

Build: 4.2.1.

## Regra de nao vazamento

Para simular a Rodada N, somente dados conhecidos ate o fim da Rodada N-1 podem alimentar acumulados. O pre-round v2 nao contem pontos da propria rodada, scouts da propria rodada, placares, resultados ou variacao de preco como feature direta.

## Metodo

- `gamesBeforeRound`: `post-round` da Rodada N-1.
- `averageBeforeRound`: media acumulada no `post-round` da Rodada N-1.
- `accumulatedPointsBeforeRound`: soma de pontos reais das rodadas 1 ate N-1.
- `accumulatedScoutsBeforeRound`: acumulado da fonte primaria caRtola ate N-1.
- `priceBeforeRound`: `price - priceVariation` da Rodada N, validado por amostra contra o preco observado no fim da Rodada N-1.
- `statusBeforeRound`: indisponivel, pois nao ha evidencia temporal suficiente.
- partidas: confronto, mando, data e local; placares removidos.

## Rodada 1

A Rodada 1 nao possui rodada anterior. Ela foi marcada como `NOT_READY`, sem fabricar media, jogos, scouts, pontos acumulados ou status.

## Provenance

Cada campo reconstruido possui `fieldProvenance` com metodo, rodada-fonte, arquivo-fonte, grau de seguranca, observacao e permissao de uso no backtest.

## Prontidao

- READY: confrontos completos, sem vazamento, e pelo menos 70% dos atletas com historico anterior suficiente.
- PARTIALLY_READY: alguma cobertura util, mas abaixo do criterio READY.
- NOT_READY: sem historico anterior ou sem cobertura util.
