# Build 5.2.0 - Contexto real da rodada

Esta build adiciona contexto calculavel ao backend, sem alterar a Previsao SLVS
oficial, a Nota da Analise, a selecao do time, o Flutter ou os snapshots
historicos. Todos os sinais novos possuem semantica explicita e sao retornados
como dados internos SLVS, nunca como probabilidade oficial.

## Fontes reais

- `GET /mercado/status`: rodada, temporada e fechamento do mercado.
- `GET /partidas`: confrontos do Brasileirao, datas, mando, placares, status,
  posicao na tabela e a sequencia recente publicada pelo Cartola.
- `GET /atletas/mercado`: atleta, clube, posicao, media, pontos, scouts,
  status e precos; o endpoint e opcional para manter o contexto de partidas
  disponivel quando o mercado estiver temporariamente indisponivel.
- `data/historical/2026/*/post-round.json`: resultados reais anteriores,
  usados somente antes da data do confronto avaliado.
- ultimo snapshot vivo valido: fallback stale ja existente quando o upstream
  falha.

Nenhum dado de Copa do Brasil, Libertadores ou Sul-Americana e criado. Essas
competicoes continuam contratos preparados e `UNAVAILABLE_SOURCE_NOT_CONFIGURED`
sem uma fonte integrada.

## Indices internos

Todos os indices sao limitados a 0-100, deterministas e retornam `null` quando
nao ha amostra suficiente.

### `offensiveStrength`

Calculado com os ultimos cinco jogos oficiais encerrados antes do confronto:

```text
goalRate       = clamp(media de gols marcados / 3 * 50, 0, 50)
regularity     = (vitorias + 0.5 * empates) / amostra * 15
sampleConfidence = min(amostra, 5) / 5 * 10
venueAdjustment = clamp((media no mando - media geral) * 5, -5, 5)
indice = clamp(goalRate + regularity + sampleConfidence + venueAdjustment)
```

`venueAdjustment` fica `null` quando nao existem pelo menos dois jogos no
mando avaliado. O detalhe dos componentes acompanha o indice para auditoria.

### `defensiveStrength`

Usa os mesmos jogos e a mesma janela:

```text
goalRate       = clamp((1 - media de gols sofridos / 3) * 45, 0, 45)
regularity     = (vitorias + 0.5 * empates) / amostra * 15
sampleConfidence = min(amostra, 5) / 5 * 10
venueAdjustment = clamp((media geral sofrida - media no mando) * 5, -5, 5)
indice = clamp(goalRate + regularity + sampleConfidence + venueAdjustment)
```

### `cleanSheetIndex`

Estimativa de confronto, nao probabilidade: `0.6 * defesa propria + 0.3 *
(100 - ataque adversario) + mando (+5 casa/-5 fora) + 0.1 * forma recente`.
O campo e acompanhado de `SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY`.

### `concedingRiskIndex`

Estimativa de risco: `0.55 * ataque adversario + 0.35 * (100 - defesa propria)
- mando + 0.1 * (100 - forma recente)`. Quanto maior, maior o risco interno
estimado; nao representa odd nem chance oficial.

### `offensiveOpportunityIndex`

Indice para meias, atacantes e laterais ofensivos: `0.55 * ataque proprio +
0.35 * (100 - defesa adversaria) + mando + 0.1 * forma`. Nao e probabilidade
de gol.

## Calendario e multi-competicao

Por partida o backend retorna:

- data do ultimo e do proximo jogo;
- `restDaysBeforeCurrentMatch` e `restDaysAfterCurrentMatch`;
- partidas nos sete dias anteriores e seguintes;
- `fixtureCongestionIndex` e motivos;
- `rotationRiskIndex` como estimativa de congestionamento, sem afirmar poupanca;
- categoria de importancia do proximo jogo quando a competicao real e conhecida.

Somente Brasileirao esta integrado. A estrutura de competicoes permanece
preparada, mas sem calendario externo inventado.

## Contexto por atleta

`athleteContexts` e `GET /brasileirao/player-context-contract` reservam campos
para:

- goleiro: SG estimate, risco de sofrer gol, ataque adversario, mando, forma
  defensiva, descanso, congestionamento e risco de rodizio;
- lateral/zagueiro: SG estimate, risco, ataque adversario, defesa propria e
  mando;
- meia/atacante: oportunidade ofensiva, defesa adversaria, ataque proprio,
  mando, descanso, congestionamento e risco.

Provaveis, desfalques, lesoes, suspensoes e risco de banco permanecem
`UNAVAILABLE_SOURCE_NOT_CONFIGURED`. Nao ha scraping nesta build.

## Banco e Reserva de Luxo

O payload publico de `/cartola/time/:timeId` pode conter o campo bruto
`reservas`, mas nao fornece uma especificacao versionada confiavel para
quantidade, posicoes permitidas, regra de substituicao ou Reserva de Luxo.
`/cartola/reserve-rules-contract` expõe esses campos como `null` e marca
`doNotInfer: true`. O Flutter nao deve fabricar reservas ate existir fonte
oficial.

## Diagnostico

`GET /diagnostics/team-context` permite auditar casos como Ivan sem blacklist.
Quando os atletas existem no mercado atual, o retorno compara Ivan, Pedro
Rangel, Everson, Rossi e Carlos Miguel, alem dos cinco goleiros com maior media
real disponivel. Nomes ausentes sao listados como indisponiveis, sem placeholder.

## Formacoes

`GET /brasileirao/formation-contract` reconhece 4-3-3, 4-4-2, 3-4-3, 3-5-2,
5-3-2 e 4-5-1. A formacao 4-5-1 e apenas contrato nesta build:
`1 GOL + 2 LAT + 2 ZAG + 5 MEI + 1 ATA + 1 TEC`.

## Limites conhecidos

- Nao existe fonte oficial integrada de xG, finalizacoes, odds, desfalques ou
  provaveis escalacoes.
- O endpoint `/partidas` representa a competicao do Cartola; outras
  competicoes seguem indisponiveis ate existir fonte validada.
- Amostras pequenas retornam `PARTIAL`/`INSUFFICIENT_SAMPLE` e preservam
  `null`; zero real continua diferente de dado ausente.
- A qualidade dos indices depende da cobertura historica local e do upstream.
- Os sinais novos nao alteram automaticamente o motor oficial nesta build.
