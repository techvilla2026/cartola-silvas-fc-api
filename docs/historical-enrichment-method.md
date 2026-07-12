# Metodo de Enriquecimento Historico

Build: 4.3.2

## Dataset

Saida:

```text
data/historical/2026-enriched/round-XX/
  pre-round-enriched.json
  provenance.json
  validation.json
  leakage.json
```

Schema:

```text
historical-pre-round-enriched-data/v1
```

## Campos reconstruidos

Para a Rodada N, o enriquecimento le somente rodadas anteriores a N.

- `pointsLast1BeforeRound`: ultima pontuacao conhecida antes da rodada.
- `pointsLast3BeforeRound`: ate tres pontuacoes anteriores.
- `averageLast3BeforeRound`: media dessas pontuacoes.
- `variationLast1BeforeRound`: variacao de preco da ultima rodada anterior.
- `appearancesLast3BeforeRound`: quantidade de aparicoes usadas.
- `negativeScoresLast3BeforeRound`: quantidade de pontuacoes negativas.
- `scoresAbove5Last3BeforeRound`: quantidade de pontuacoes 5+.

## Campos nao reconstruidos

- `statusBeforeRound`: indisponivel por falta de snapshot seguro.
- `lineupProbabilityBeforeRound`: indisponivel.
- `historicalScoutsBeforeRound`: `disabled`, pois as divergencias entre fontes impedem uso como scouts oficiais.

## Vazamento

O verificador falha se:

- forma recente incluir a propria rodada;
- placar aparecer no pre-round;
- status for marcado como capturado apos fechamento;
- scouts forem habilitados sem revisao.

Na execucao 2026, rodadas 2 a 18: 17 PASS, 0 warnings, 0 fails.
