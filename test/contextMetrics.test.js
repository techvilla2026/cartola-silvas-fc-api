const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const { once } = require("node:events");

const { createApp } = require("../server");
const {
  buildAthleteContext,
  buildFormationContract,
  buildMatchContext,
  buildReserveRulesContract,
  buildTeamPerformanceContext,
  calculateDefensiveStrength,
  calculateOffensiveStrength,
  fixtureForTeam
} = require("../src/realRoundContext/metrics");
const { normalizeRoundPayload } = require("../src/realRoundContext/normalizer");
const { buildRoundContext, buildTeamContextDiagnostic } = require("../src/realRoundContext/service");

const clubs = {
  1: { id: 1, name: "AAA", officialName: "Clube A" },
  2: { id: 2, name: "BBB", officialName: "Clube B" },
  3: { id: 3, name: "CCC", officialName: "Clube C" }
};

function match(matchId, date, homeClubId, awayClubId, homeScore, awayScore, competition = "brasileirao-serie-a") {
  return {
    matchId,
    round: matchId,
    homeClubId,
    awayClubId,
    homeScore,
    awayScore,
    status: homeScore === null || awayScore === null ? "FUTURE" : "FINISHED",
    startsAt: `${date}T19:00:00.000Z`,
    competition
  };
}

const historicalMatches = [
  match(1, "2026-05-01", 1, 2, 2, 0),
  match(2, "2026-05-08", 2, 1, 1, 1),
  match(3, "2026-05-15", 1, 3, 0, 1),
  match(4, "2026-05-22", 3, 1, 0, 2),
  match(5, "2026-05-29", 1, 2, 3, 0),
  match(6, "2026-05-30", 2, 3, 1, 0, "copa-do-brasil"),
  match(7, "2026-06-03", 1, 3, null, null)
];

test("offensiveStrength e defensiveStrength usam somente resultados anteriores", () => {
  const args = { matches: historicalMatches, teamId: 1, cutoffIso: "2026-06-01T00:00:00.000Z", homeAway: "HOME" };
  const offensive = calculateOffensiveStrength(args);
  const defensive = calculateDefensiveStrength(args);
  assert.ok(offensive.index > 0);
  assert.ok(defensive.index > 0);
  assert.equal(offensive.sampleSize, 5);
  assert.equal(defensive.sampleSize, 5);
  assert.equal(offensive.components.venueAdjustment !== null, true);
  assert.equal(offensive.index, calculateOffensiveStrength(args).index);
});

test("forma recente, mando e janela temporal são determinísticos e sem leakage", () => {
  const performance = buildTeamPerformanceContext({
    teamId: 1,
    matches: historicalMatches,
    clubs,
    cutoffIso: "2026-06-01T00:00:00.000Z",
    homeAway: "HOME"
  });
  assert.equal(performance.recentTeamForm.sampleSize, 5);
  assert.equal(performance.recentTeamForm.goalsFor, 8);
  assert.equal(performance.recentTeamForm.goalsAgainst, 2);
  assert.equal(performance.recentTeamForm.lastMatches.some((item) => item.matchId === 7), false);
  assert.ok(performance.homePerformanceIndex.sampleSize >= 2);
  assert.ok(performance.awayPerformanceIndex.sampleSize >= 1);
  assert.deepEqual(
    performance,
    buildTeamPerformanceContext({ teamId: 1, matches: historicalMatches, clubs, cutoffIso: "2026-06-01T00:00:00.000Z", homeAway: "HOME" })
  );
});

test("confronto cria SG, risco de sofrer gol e oportunidade ofensiva como estimativas SLVS", () => {
  const context = buildMatchContext({
    match: historicalMatches[6],
    matches: historicalMatches,
    clubs,
    nowIso: "2026-06-01T00:00:00.000Z"
  });
  assert.ok(context.homeCleanSheetIndex !== null);
  assert.ok(context.homeConcedingRiskIndex !== null);
  assert.ok(context.homeOffensiveOpportunityIndex !== null);
  assert.equal(context.semantics.cleanSheetIndex, "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY");
  assert.equal(context.semantics.offensiveOpportunityIndex, "SLVS_INDEX_NOT_GOAL_PROBABILITY");
});

test("descanso, congestionamento e risco de rodízio não afirmam escalação", () => {
  const fixture = fixtureForTeam({ teamId: 1, match: historicalMatches[6], matches: historicalMatches });
  assert.equal(fixture.restDaysBeforeCurrentMatch, 5);
  assert.equal(fixture.restDaysAfterCurrentMatch, null);
  assert.equal(fixture.rotationRiskIndex, fixture.fixtureCongestionIndex);
  assert.equal(fixture.rotationRisk.semantics, "SLVS_ESTIMATE_NOT_CONFIRMED_LINEUP");
});

test("dados ausentes permanecem null e não viram zero", () => {
  const context = buildMatchContext({
    match: match(99, "2026-06-10", 9, 10, null, null),
    matches: [],
    clubs: {},
    nowIso: "2026-06-01T00:00:00.000Z"
  });
  assert.equal(context.homeOffensiveStrength, null);
  assert.equal(context.homeDefensiveStrength, null);
  assert.equal(context.homeCleanSheetIndex, null);
  assert.ok(context.unavailableSignals.length > 0);
});

test("contexto do atleta separa goleiro, defesa e ataque", () => {
  const matchContext = buildMatchContext({ match: historicalMatches[6], matches: historicalMatches, clubs });
  const goalkeeper = buildAthleteContext({ athlete: { athleteId: 10, nickname: "Goleiro A", clubId: 1, positionId: 1 }, matchContext });
  const defender = buildAthleteContext({ athlete: { athleteId: 11, nickname: "Zagueiro A", clubId: 1, positionId: 3 }, matchContext });
  const attacker = buildAthleteContext({ athlete: { athleteId: 12, nickname: "Atacante A", clubId: 1, positionId: 5 }, matchContext });
  assert.equal(goalkeeper.type, "goalkeeperContext");
  assert.equal(defender.type, "defensiveContext");
  assert.equal(attacker.type, "attackingContext");
  assert.equal(goalkeeper.opponentOffensiveStrength !== undefined, true);
});

test("contratos reconhecem 4-5-1 e não inventam regras de reservas", () => {
  const formation = buildFormationContract();
  const fourFiveOne = formation.formations.find((item) => item.code === "4-5-1");
  assert.deepEqual(fourFiveOne, {
    code: "4-5-1",
    goalkeeper: 1,
    defenders: { lateral: 2, centerBack: 2 },
    midfielders: 5,
    forwards: 1,
    coach: 1
  });
  const reserves = buildReserveRulesContract();
  assert.equal(reserves.status, "UNAVAILABLE_OFFICIAL_RULES_NOT_EXPOSED");
  assert.equal(reserves.official.reserveQuantity, null);
  assert.equal(reserves.doNotInfer, true);
});

test("normalizador propaga atletas, scouts, clubes, posições e forma de partidas reais", () => {
  const normalized = normalizeRoundPayload({
    matchesPayload: {
      rodada: 19,
      clubes: [{ id: 1, nome: "AAA", nome_oficial: "Clube A", apelido: "Apelido A" }],
      partidas: [{
        partida_id: 1,
        clube_casa_id: 1,
        clube_visitante_id: 2,
        partida_data: "2026-06-10 19:00:00",
        aproveitamento_mandante: ["v", "e"],
        clube_casa_posicao: 3,
        clube_visitante_posicao: 8
      }]
    },
    marketStatusPayload: { rodada_atual: 19, temporada: 2026 },
    marketPayload: {
      clubes: [{ id: 1, nome: "AAA", nome_oficial: "Clube A", apelido: "Apelido A" }],
      posicoes: { "1": { id: 1, nome: "Goleiro", abreviacao: "gol" } },
      status: { "7": { id: 7, nome: "Provável" } },
      atletas: [{ atleta_id: 10, apelido: "Goleiro A", clube_id: 1, posicao_id: 1, status_id: 7, media_num: 8.2, scout: { DD: 2 } }]
    },
    capturedAt: "2026-06-01T00:00:00.000Z",
    season: 2026,
    nowIso: "2026-06-01T00:00:00.000Z"
  });
  assert.equal(normalized.athletes[0].average, 8.2);
  assert.equal(normalized.athletes[0].scouts.DD, 2);
  assert.equal(normalized.clubs[1].officialName, "Clube A");
  assert.equal(normalized.positions[0].abbreviation, "gol");
  assert.deepEqual(normalized.matches[0].homeRecentResults, ["v", "e"]);
});

test("status ENCERRADA/POS_JOGO com placar real não permanece como LIVE", () => {
  const normalized = normalizeRoundPayload({
    matchesPayload: {
      rodada: 19,
      partidas: [{ partida_id: 2, clube_casa_id: 1, clube_visitante_id: 2, partida_data: "2026-06-01 19:00:00", placar_oficial_mandante: 1, placar_oficial_visitante: 0, status_transmissao_tr: "ENCERRADA", periodo_tr: "POS_JOGO" }]
    },
    marketStatusPayload: { rodada_atual: 19, temporada: 2026 },
    capturedAt: "2026-06-02T00:00:00.000Z",
    season: 2026,
    nowIso: "2026-06-02T00:00:00.000Z"
  });
  assert.equal(normalized.matches[0].status, "FINISHED");
});

function fakeFetch() {
  return async (url) => {
    if (String(url).endsWith("/mercado/status")) return new Response(JSON.stringify({ rodada_atual: 19, temporada: 2026 }), { status: 200 });
    if (String(url).endsWith("/partidas")) return new Response(JSON.stringify({ rodada: 19, clubes: [{ id: 1, nome: "AAA" }, { id: 2, nome: "BBB" }], partidas: [{ partida_id: 1, clube_casa_id: 1, clube_visitante_id: 2, partida_data: "2026-06-10 19:00:00" }] }), { status: 200 });
    if (String(url).endsWith("/atletas/mercado")) return new Response(JSON.stringify({ clubes: [{ id: 1, nome: "AAA" }, { id: 2, nome: "BBB" }], atletas: [{ atleta_id: 10, apelido: "Ivan", clube_id: 1, posicao_id: 1, media_num: 8.1 }] }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
}

test("diagnóstico de confronto retorna contexto e comparação de goleiros sem alterar motor oficial", async () => {
  const diagnostic = await buildTeamContextDiagnostic({ fetchImpl: fakeFetch(), timeoutMs: 1000, season: 2026, nowIso: "2026-06-01T00:00:00.000Z", homeClubId: 1, awayClubId: 2 });
  assert.equal(diagnostic.schemaVersion, "team-context-diagnostics/v1");
  assert.equal(diagnostic.status, "AVAILABLE");
  assert.equal(diagnostic.match.homeTeam.id, 1);
  assert.equal(diagnostic.confrontation.semantics.cleanSheetIndex, "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY");
  assert.equal(diagnostic.goalkeeperComparison.comparisons[0].playerName, "Ivan");
});

test("endpoints de formação, reservas e diagnóstico preservam contrato read-only", async () => {
  const app = createApp({ fetchImpl: fakeFetch() });
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  try {
    for (const path of ["/brasileirao/formation-contract", "/cartola/reserve-rules-contract", "/diagnostics/team-context?homeClubId=1&awayClubId=2"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.schemaVersion);
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});
