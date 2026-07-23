# Contexto Real da Rodada - Build 5.0.0

A Build 5.0.0 cria a primeira camada de inteligencia real do Brasileirao para o backend. Ela prepara sinais estruturados para uso futuro pelo Motor SLVS, mas nao altera pesos, formulas, selecao oficial, snapshots, backtests antigos ou o Flutter.

## Fontes Utilizadas

Fonte real integrada nesta fase:

- Cartola FC API publica `/partidas`
- Cartola FC API publica `/mercado/status`
- Snapshots vivos pre-rodada ja persistidos, apenas como fallback stale
- Backtests historicos congelados `build-4.3.2`, apenas para avaliacao previsao x resultado
- Dados historicos locais `data/historical/2026`, apenas para forma recente e casa/fora sem vazamento

Fontes preparadas, mas ainda sem integracao confiavel nesta build:

- Copa do Brasil
- Libertadores
- Sul-Americana
- Desfalques
- Provaveis escalacoes
- Escalacoes confirmadas
- Probabilidade de titularidade

Campos sem fonte confiavel retornam `null` ou `UNAVAILABLE_SOURCE_NOT_CONFIGURED`. Zero continua reservado para valores reais iguais a zero.

## Cache e Fallback

Politica documentada em `real-round-context-cache-policy/v1`:

- agenda futura: TTL conceitual de 900 segundos;
- jogo ao vivo: TTL conceitual de 60 segundos;
- resultado encerrado: TTL conceitual de 21600 segundos;
- se o upstream falhar, o backend tenta usar cache em memoria;
- se nao houver cache, usa o ultimo snapshot vivo valido como fallback stale;
- dado valido anterior nao e apagado quando o upstream falha.

Os endpoints retornam `sourceStatus`, `stale`, `lastSuccessfulUpdate` e `upstreamError` quando aplicavel.

## Prevencao de Vazamento Temporal

Para rodada atual, o contexto usa dados oficiais atuais apenas como contexto read-only. Para avaliacao historica, a comparacao previsao x resultado usa somente previsoes ja registradas antes do resultado nos backtests congelados.

Regras:

- nao recalcular snapshots antigos;
- nao gerar previsao retroativa;
- nao usar oracle como feature;
- nao misturar jogos futuros com metricas de forma recente.

## Calendario Multicompeticao

A arquitetura representa competicoes com status por fonte. Nesta fase, apenas Brasileirao possui dados reais integrados. Copa do Brasil, Libertadores e Sul-Americana ficam como contratos preparados.

Sinais por clube:

- jogo anterior;
- proximo jogo;
- horas/dias desde o jogo anterior;
- horas/dias ate o proximo jogo;
- partidas nos ultimos 7 dias;
- partidas nos proximos 7 dias;
- `fixtureCongestion`;
- `rotationRiskSignal`;
- marcadores de competicoes importantes proximas, quando existirem dados reais.

## Congestionamento

Thresholds centralizados em `fixture-congestion-thresholds/v1`:

- descanso curto: menos de 72 horas;
- descanso moderado: menos de 120 horas;
- partida importante proxima: ate 96 horas;
- janela de avaliacao: 7 dias;
- tres ou mais partidas na janela: alto congestionamento;
- duas partidas na janela: medio congestionamento.

O campo `fixtureCongestion` retorna `level` e `reasons`. O backend nao afirma que um clube vai poupar jogadores.

## Endpoints

- `GET /brasileirao/round-context`
- `GET /brasileirao/results`
- `GET /brasileirao/team-context/:teamId`
- `GET /brasileirao/calendar-context/:teamId`
- `GET /brasileirao/player-context-contract`
- `GET /research/real-round-evaluation`
- `GET /research/context-feature-diagnostics`

## Research Lab

Novos candidatos preparados para estudos offline:

- `context-home-away-candidate`
- `context-recent-form-candidate`
- `context-rest-candidate`
- `context-fixture-congestion-candidate`
- `context-combined-candidate`

Eles nao sao promovidos automaticamente e nao afetam o Motor SLVS oficial nesta build.
