# Prontidao para backtest

Status:

```text
PARTIALLY_READY
```

## Rodadas utilizaveis

18 rodadas foram coletadas, da Rodada 1 ate a Rodada 18 de 2026. Nao ha rodadas ausentes nesse intervalo.

## Campos pre-rodada

Nao ha reconstrucao segura de dados historicos pre-rodada nesta build.

Marcados como `notAvailableForLeakFreeBacktest`:

- `priceBeforeRound`
- `averageBeforeRound`
- `gamesBeforeRound`
- `statusBeforeRound`
- `accumulatedScoutsBeforeRound`
- `lineupProbabilityBeforeRound`
- `matchResultsBeforeRound`

## Campos pos-rodada

Disponiveis:

- atleta;
- nome/apelido;
- clube;
- posicao;
- status;
- preco da fonte historica;
- variacao de preco;
- media;
- pontos;
- jogos;
- entrou em campo;
- scouts;
- partidas;
- mandante/visitante;
- estadio/local;
- placar oficial;
- validade da partida.

## Risco de vazamento futuro

O dataset ainda nao deve ser usado diretamente para simular decisoes pre-rodada, porque preco, media, status, jogos e scouts historicos podem representar estado pos-rodada ou acumulado. Usar esses campos como se estivessem disponiveis antes do fechamento da rodada causaria vazamento futuro.

## Metricas que podem ser calculadas agora

- Distribuicao de pontos pos-rodada.
- Cobertura de atletas e clubes por rodada.
- Validacao de resultados/partidas.
- Analise exploratoria de scouts com ressalva de granularidade.
- Auditoria de divergencias entre caRtola e Cartola oficial.

## Limitacoes

- 10.254 divergencias contra a fonte oficial de validacao.
- Scouts da fonte primaria nao devem ser considerados equivalentes aos scouts oficiais por rodada sem investigacao adicional.
- Cartola oficial publico nao expõe preco historico por rodada no endpoint de validacao usado.
- Footstats nao foi confirmada como API publica utilizavel.
- Backtest sem vazamento ainda depende de reconstruir snapshots pre-rodada confiaveis.
