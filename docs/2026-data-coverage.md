# Cobertura dos dados historicos 2026

Data da coleta: 2026-07-11.

Endpoint oficial de status consultado: `https://api.cartolafc.globo.com/mercado/status`.

Resultado relevante:

```text
temporada=2026
rodada_atual=19
status_mercado=1
mercado_pos_rodada=true
rodada_final=38
```

Como a rodada 19 ainda estava futura/nao encerrada na data da auditoria, a ultima rodada encerrada usada para coleta foi a **Rodada 18**.

## Tabela por rodada

| round | source | athletesCount | scoredAthletesCount | matchesCount | clubsCount | hasPrices | hasPoints | hasScouts | hasAverage | hasStatus | hasMatches | hasResults | collectedAt | validationStatus |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | caRtola | 691 | 335 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:52.303Z | VALID_WITH_WARNINGS |
| 2 | caRtola | 704 | 306 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:54.395Z | VALID_WITH_WARNINGS |
| 3 | caRtola | 708 | 301 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:55.157Z | VALID_WITH_WARNINGS |
| 4 | caRtola | 706 | 235 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:55.587Z | VALID_WITH_WARNINGS |
| 5 | caRtola | 719 | 272 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:56.209Z | VALID_WITH_WARNINGS |
| 6 | caRtola | 724 | 336 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:56.647Z | VALID_WITH_WARNINGS |
| 7 | caRtola | 731 | 334 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:57.443Z | VALID_WITH_WARNINGS |
| 8 | caRtola | 732 | 333 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:57.898Z | VALID_WITH_WARNINGS |
| 9 | caRtola | 736 | 342 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:58.376Z | VALID_WITH_WARNINGS |
| 10 | caRtola | 740 | 334 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:58.811Z | VALID_WITH_WARNINGS |
| 11 | caRtola | 743 | 332 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:59.263Z | VALID_WITH_WARNINGS |
| 12 | caRtola | 745 | 339 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:39:59.699Z | VALID_WITH_WARNINGS |
| 13 | caRtola | 747 | 333 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:40:00.172Z | VALID_WITH_WARNINGS |
| 14 | caRtola | 750 | 335 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:40:01.004Z | VALID_WITH_WARNINGS |
| 15 | caRtola | 750 | 333 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:40:02.173Z | VALID_WITH_WARNINGS |
| 16 | caRtola | 754 | 333 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:40:02.612Z | VALID_WITH_WARNINGS |
| 17 | caRtola | 761 | 333 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:40:03.016Z | VALID_WITH_WARNINGS |
| 18 | caRtola | 774 | 338 | 10 | 20 | true | true | true | true | true | true | true | 2026-07-11T21:40:03.463Z | VALID_WITH_WARNINGS |

## Totais

- Rodadas coletadas: 1-18.
- Rodadas ausentes entre 1 e 18: nenhuma.
- Registros de atletas coletados: 13.215.
- Atletas que entraram em campo: 5.804.
- Partidas coletadas: 180.
- Clubes por rodada: 20.
- Tamanho total do dataset persistido: 10,4 MB em 72 arquivos.

## Reconstrucao pre-rodada v2

- Rodadas READY: 17.
- Rodadas PARTIALLY_READY: 0.
- Rodadas NOT_READY: 1.
- Atletas elegiveis para backtest: 12.365.
- Atletas inelegiveis: 850.
- Vazamento PASS: 18 rodadas.
- Vazamento WARNING: 0 rodadas.
- Vazamento FAIL: 0 rodadas.

## Divergencias de validacao

- Jogadores ausentes na fonte primaria contra oficial: 49.
- Jogadores extras na fonte primaria contra oficial: 37.
- Diferencas de pontuacao: 108.
- Diferencas de preco: 0, pois a fonte oficial de validacao nao expõe preco historico por rodada.
- Diferencas de scout: 10.060.
- Diferencas de partidas: 0.
- Total: 10.254.
