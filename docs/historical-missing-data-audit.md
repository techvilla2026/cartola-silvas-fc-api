# Auditoria de Dados Historicos Ausentes

Build: 4.3.2

## Resultado

Nao foi encontrada fonte publica, estavel e temporalmente comprovada para recuperar `statusBeforeRound` de 2026 por atleta e por rodada sem risco de vazamento.

Campos reconstruidos com seguranca:

- `pointsLast1BeforeRound`
- `pointsLast3BeforeRound`
- `averageLast3BeforeRound`
- `variationLast1BeforeRound`
- `appearancesLast3BeforeRound`
- `negativeScoresLast3BeforeRound`
- `scoresAbove5Last3BeforeRound`

Campos mantidos indisponiveis:

- `statusBeforeRound`
- `lineupProbabilityBeforeRound`
- scouts oficiais pre-rodada

## Fontes auditadas

| Fonte | URL | Licenca | Campos | Cobertura 2026 | Temporalidade | Adequacao |
| --- | --- | --- | --- | --- | --- | --- |
| Cartola API publica | https://api.cartolafc.globo.com | Nao informada | mercado atual, status atual, partidas atuais, time publico | Atual | Nao fornece snapshots historicos pre-rodada | Parcial para validacao atual; insuficiente para status historico |
| caRtola | https://github.com/henriquepgomide/caRtola | MIT | pontuacao, preco, media, scouts por rodada | Sim | Arquivos por rodada pos-evento | Adequada para forma recente anterior; inadequada para status pre-fechamento |
| Kaggle CartolaFC | https://www.kaggle.com/datasets/schiller/cartolafc | Ver pagina do dataset | dados historicos do Cartola | Historica | Nao comprovou snapshot pre-fechamento 2026 | Apenas referencia secundaria |
| Kaggle Cartola FC Brasil Scouts | https://www.kaggle.com/datasets/lgmoneda/cartola-fc-brasil-scouts | Ver pagina do dataset | scouts e pontuacoes | Historica | Foco em scouts/resultado | Nao habilita scouts oficiais sem validacao cruzada |
| thevtm/CartolaFCDados | https://github.com/thevtm/CartolaFCDados | Ver repositorio | status, clubes, atletas de edicoes passadas | Nao comprovada para 2026 | Sem garantia de captura pre-fechamento para a temporada atual | Nao usado |
| ge/Cartola paginas publicas | https://ge.globo.com/cartola/ | Globo | noticias, provaveis, contexto | Parcial/amostral | Conteudo editorial, nao dataset por atleta/rodada | Validacao amostral, nao fonte automatica |
| Footstats | https://footstats.com.br | Comercial/nao aberta | estatisticas esportivas | Indeterminada | Nao confirmada como fonte aberta exportavel | Nao usado |

## Decisoes

- Status nao foi inventado nem inferido.
- Ausencia de status permanece `unavailable`.
- Scouts ficam em `historicalScoutMode: disabled`.
- Forma recente usa somente `post-round.json` de rodadas anteriores.
- Nenhum arquivo original em `data/historical/2026/round-XX` foi sobrescrito.
