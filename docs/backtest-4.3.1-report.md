# Backtest 4.3.1 - Paridade Flutter

## O que foi testado

Esta build reproduz no backend as regras auditadas do Flutter para previsao, Nota da analise, qualidade dos dados, selecao 4-3-3, capitao/vice e categorias objetivas da Central Inteligente.

## Dados usados

- Temporada: 2026
- Rodadas avaliadas: 2 a 18
- Schema historico: historical-pre-round-data/v2
- Leakage: PASS
- Previsoes avaliadas: 5126

## Politicas

- Engine: flutter-parity-engine/4.3.1
- Previsao: flutter-score-prediction-parity/4.3.1
- Nota: flutter-analysis-score-parity/4.3.1
- Qualidade dos dados: flutter-data-quality-parity/4.3.1
- Selecao: flutter-ideal-team-parity/4.3.1
- Capitao: flutter-captain-parity/4.3.1

## Fidelidade

Regras reproduzidas: Formula de previsao por media, bonus de media alta, bonus de mando, clamp e arredondamento.; Qualidade dos dados com pesos, redutores, bonus de dados completos e faixas internas.; Nota da analise com pesos, componentes, limitador por qualidade e faixas.; Selecao 4-3-3 por status, media, mando, preco e id.; Capitao e vice por previsao, Nota, qualidade dos dados e media..

Diferencas historicas assumidas: Status historico indisponivel foi mantido vazio, como componente neutro/conservador.; Dados recentes do mercado Flutter, como pontos_num e variacao_num atuais, foram zerados por nao existirem de forma pre-rodada segura.; Scouts historicos acumulados nao foram usados na qualidade por divergencia documentada entre fontes..

Nao reproduzido: Comparador historico, por falta de elenco real do usuario antes de cada rodada.; Tecnico na avaliacao do time, por falta de dados historicos seguros suficientes no mesmo contrato..

## Resultados principais

- MAE: 2.8634
- RMSE: 4.0369
- Bias: -0.8372
- Erro mediano: 2
- Dentro de +-1: 28.62%
- Dentro de +-2: 50.70%
- Dentro de +-3: 66.95%
- Dentro de +-5: 83.52%
- Pontos acumulados do motor 4.3.1: 518.4
- Pontos acumulados do baseline: 518.4

## Comparacao com 4.3.0

- Build 4.3.0: 515
- Build 4.3.1: 518.4
- Diferenca acumulada: 3.4
- Resultado: RIGHT_HIGHER

## Baseline

- Vitorias: 0
- Empates: 17
- Derrotas: 0
- Diferenca media: 0
- Diferenca acumulada: 0

## Capitao

- Melhor do time: 11.76%
- Top 3: 29.41%
- Negativo: 5.88%
- Media real: 4.2455
- Distancia media para o melhor: 4.6294

## Posicoes

| Posicao | Qtd | MAE | RMSE | Bias |
| --- | ---: | ---: | ---: | ---: |
| GOL | 331 | 3.4459 | 4.4312 | -1.1577 |
| ATA | 1423 | 2.9996 | 4.4125 | -0.9668 |
| MEI | 1799 | 2.5043 | 3.6222 | -0.5901 |
| LAT | 792 | 3.2942 | 4.3059 | -1.0851 |
| ZAG | 781 | 2.7585 | 3.7605 | -0.7828 |

## Faixas da Nota

- Fraca: 4761 atletas, media real 3.2503, mediana 2, 5+ 25.65%, 8+ 12.31%, 10+ 6.74%.
- Regular: 365 atletas, media real 5.1342, mediana 3.9, 5+ 42.19%, 8+ 25.21%, 10+ 18.36%.

## Central Inteligente

- bestCaptain: EVALUATED, 11 avaliacoes, media real 5.5273.
- bestViceCaptain: EVALUATED, 10 avaliacoes, media real 3.11.
- bestDefense: EVALUATED, 7 avaliacoes, media real 3.2.
- bestDifferential: PARTIALLY_EVALUATED, 8 avaliacoes, media real 2.15.
- risingPlayer: PARTIALLY_EVALUATED, 12 avaliacoes, media real 5.15.
- playerToAvoid: EVALUATED, 12 avaliacoes, media real 4.2167.
- bestValue: EVALUATED, 6 avaliacoes, media real 2.05.
- roundAlert: PARTIALLY_EVALUATED, 12 avaliacoes, media real 4.2167.

Comparador: NOT_EVALUATED - Nao ha elenco real historico do usuario antes da rodada; o projeto Flutter usa UserLineupRepository em tempo atual..

## Conclusao

O motor foi portado com fidelidade nas regras que dependem de campos historicos seguros. A ausencia de status, dados recentes de mercado e scouts oficiais por rodada ainda impede paridade absoluta. Nao houve calibracao, otimizacao, machine learning, deploy, push ou alteracao no Flutter.
