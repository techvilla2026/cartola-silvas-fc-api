# Prontidao para backtest

Status:

```text
PARTIALLY_READY
```

## Rodadas utilizaveis

18 rodadas foram coletadas, da Rodada 1 ate a Rodada 18 de 2026. A reconstrucao pre-rodada v2 classificou 17 rodadas como READY e a Rodada 1 como NOT_READY.

## Campos pre-rodada

Disponiveis no schema `historical-pre-round-data/v2`:

- confrontos sem placar;
- adversario;
- mando;
- `gamesBeforeRound`;
- `accumulatedPointsBeforeRound`;
- `accumulatedScoutsBeforeRound`;
- `averageBeforeRound`;
- `priceBeforeRound`, reconstruido por `price - priceVariation` e validado contra a rodada anterior quando possivel.

Continuam indisponiveis ou inseguros:

- `statusBeforeRound`
- `lineupProbabilityBeforeRound`
- qualquer resultado/placar pre-rodada.

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

O verificador de vazamento passou em 18/18 rodadas. O dataset ainda deve ser usado com filtro de elegibilidade por atleta e sem usar `statusBeforeRound`.

## Metricas que podem ser calculadas agora

- Distribuicao de pontos pos-rodada.
- Cobertura de atletas e clubes por rodada.
- Validacao de resultados/partidas.
- Analise exploratoria de scouts com ressalva de granularidade.
- Auditoria de divergencias entre caRtola e Cartola oficial.

## Limitacoes

- 10.254 divergencias contra a fonte oficial de validacao.
- Scouts da fonte primaria podem ser usados apenas como acumulados da propria fonte; nao devem ser considerados equivalentes aos scouts oficiais por rodada sem investigacao adicional.
- Cartola oficial publico nao expõe preco historico por rodada no endpoint de validacao usado.
- Footstats nao foi confirmada como API publica utilizavel.
- Rodada 1 permanece inelegivel por nao ter rodada anterior.
