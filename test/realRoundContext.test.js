const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const test = require("node:test");

const { createApp } = require("../server");
const { BacktestRepository } = require("../src/backtest/repository");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { buildRealRoundEvaluation, buildRoundContext, buildTeamContext } = require("../src/realRoundContext/service");
const { fixtureCongestion, normalizeMatch, normalizeRoundPayload } = require("../src/realRoundContext/normalizer");

async function request(app, url, options = {}) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      headers: options.headers || {}
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

function fakeOfficialPayload() {
  return {
    market: {
      rodada_atual: 19,
      status_mercado: 1,
      temporada: 2026,
      fechamento: { timestamp: 1784672940 }
    },
    matches: {
      rodada: 19,
      clubes: [
        { id: 263, nome: "BOT", abreviacao: "BOT", slug: "botafogo" },
        { id: 277, nome: "SAN", abreviacao: "SAN", slug: "santos" },
        { id: 287, nome: "VIT", abreviacao: "VIT", slug: "vitoria" }
      ],
      partidas: [
        {
          partida_id: 1,
          clube_casa_id: 263,
          clube_visitante_id: 277,
          placar_oficial_mandante: 2,
          placar_oficial_visitante: 1,
          partida_data: "2026-07-16 19:30:00",
          local: "Nilton Santos",
          valida: false
        },
        {
          partida_id: 2,
          clube_casa_id: 287,
          clube_visitante_id: 263,
          placar_oficial_mandante: null,
          placar_oficial_visitante: null,
          partida_data: "2026-07-24 21:00:00",
          local: "Barradao",
          valida: true
        }
      ]
    }
  };
}

function fakeFetch(payload = fakeOfficialPayload()) {
  return async (url) => {
    if (String(url).endsWith("/mercado/status")) {
      return new Response(JSON.stringify(payload.market), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("/partidas")) {
      return new Response(JSON.stringify(payload.matches), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({}), { status: 404, headers: { "content-type": "application/json" } });
  };
}

function tempHistorical() {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-ctx-")) });
  repository.saveRoundFile(2026, 18, "post-round.json", {
    season: 2026,
    round: 18,
    collectedAt: "2026-07-12T00:00:00.000Z",
    matches: [
      {
        matchId: 10,
        round: 18,
        homeClubId: 277,
        awayClubId: 287,
        homeScore: 0,
        awayScore: 1,
        date: "2026-07-12 16:00:00",
        venue: "Vila Belmiro"
      }
    ]
  }, { force: true });
  return repository;
}

function tempLiveSnapshot() {
  return new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-ctx-")) });
}

test("normaliza partidas encerradas com fonte, rodada e placar real", () => {
  const match = normalizeMatch(fakeOfficialPayload().matches.partidas[0], {
    season: 2026,
    round: 19,
    capturedAt: "2026-07-21T00:00:00.000Z",
    nowIso: "2026-07-21T00:00:00.000Z"
  });

  assert.equal(match.competition, "brasileirao-serie-a");
  assert.equal(match.season, 2026);
  assert.equal(match.round, 19);
  assert.equal(match.status, "FINISHED");
  assert.equal(match.homeScore, 2);
  assert.equal(match.awayScore, 1);
  assert.equal(match.sourceEndpoint, "/partidas");
});

test("normaliza jogos futuros sem transformar placar ausente em zero", () => {
  const match = normalizeMatch(fakeOfficialPayload().matches.partidas[1], {
    season: 2026,
    round: 19,
    capturedAt: "2026-07-21T00:00:00.000Z",
    nowIso: "2026-07-21T00:00:00.000Z"
  });

  assert.equal(match.status, "FUTURE");
  assert.equal(match.homeScore, null);
  assert.equal(match.awayScore, null);
});

test("detecta rodada atual e totais reais da rodada", () => {
  const normalized = normalizeRoundPayload({
    matchesPayload: fakeOfficialPayload().matches,
    marketStatusPayload: fakeOfficialPayload().market,
    capturedAt: "2026-07-21T00:00:00.000Z",
    season: 2026,
    nowIso: "2026-07-21T00:00:00.000Z"
  });

  assert.equal(normalized.currentRound, 19);
  assert.equal(normalized.counts.total, 2);
  assert.equal(normalized.counts.closed, 1);
  assert.equal(normalized.counts.future, 1);
  assert.equal(normalized.seasonValidation.status, "PASS");
});

test("classifica congestionamento de calendario com criterios explicaveis", () => {
  const result = fixtureCongestion({
    previousMatch: { startsAt: "2026-07-19T00:00:00.000Z", competition: "brasileirao-serie-a" },
    nextMatch: { startsAt: "2026-07-23T00:00:00.000Z", competition: "libertadores" },
    past7: [{}, {}],
    next7: [{}],
    nowIso: "2026-07-21T00:00:00.000Z"
  });

  assert.equal(result.level, "HIGH");
  assert.ok(result.reasons.includes("played_less_than_72h_before"));
  assert.ok(result.reasons.includes("important_match_within_next_4_days"));
});

test("buildRoundContext usa upstream oficial quando disponivel", async () => {
  const context = await buildRoundContext({
    fetchImpl: fakeFetch(),
    timeoutMs: 8000,
    liveSnapshotRepository: tempLiveSnapshot(),
    season: 2026,
    nowIso: "2026-07-21T00:00:00.000Z"
  });

  assert.equal(context.schemaVersion, "real-round-context/v1");
  assert.equal(context.sourceStatus, "LIVE_UPSTREAM");
  assert.equal(context.currentRound, 19);
  assert.equal(context.competitions.find((item) => item.id === "brasileirao-serie-a").realDataIntegrated, true);
  assert.equal(context.competitions.find((item) => item.id === "libertadores").status, "UNAVAILABLE_SOURCE_NOT_CONFIGURED");
});

test("team context preserva ausencias e provaveis escalacoes como indisponiveis", async () => {
  const context = await buildTeamContext({
    fetchImpl: fakeFetch(),
    timeoutMs: 8000,
    liveSnapshotRepository: tempLiveSnapshot(),
    historicalRepository: tempHistorical(),
    season: 2026,
    teamId: 263,
    nowIso: "2026-07-21T00:00:00.000Z"
  });

  assert.equal(context.schemaVersion, "real-team-context/v1");
  assert.equal(context.teamId, 263);
  assert.equal(context.unavailableDataContracts.absences.value, null);
  assert.equal(context.unavailableDataContracts.probableLineup.status, "UNAVAILABLE_SOURCE_NOT_CONFIGURED");
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(context.fixtureCongestion.level));
});

test("comparacao previsao x resultado usa backtest congelado antes do resultado", () => {
  const evaluation = buildRealRoundEvaluation({ season: 2026 });

  assert.equal(evaluation.schemaVersion, "real-round-evaluation/v1");
  assert.equal(evaluation.temporalPolicy.predictionsMustBeCapturedBeforeResults, true);
  assert.equal(evaluation.metrics.count, 5126);
  assert.ok(evaluation.comparedRounds.includes(18));
  assert.equal(evaluation.comparisons[0].predictionCapturedAt, "PRE_ROUND_HISTORICAL_FREEZE");
});

test("endpoints de contexto real respondem e preservam CORS", async () => {
  const app = createApp({
    fetchImpl: fakeFetch(),
    liveSnapshotRepository: tempLiveSnapshot(),
    historicalRepository: tempHistorical()
  });
  const headers = { Origin: "https://meutimeideal.netlify.app" };

  for (const url of [
    "/brasileirao/round-context",
    "/brasileirao/results",
    "/brasileirao/team-context/263",
    "/brasileirao/calendar-context/263",
    "/brasileirao/player-context-contract",
    "/research/real-round-evaluation",
    "/research/context-feature-diagnostics"
  ]) {
    const response = await request(app, url, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://meutimeideal.netlify.app");
    assert.ok(response.body.schemaVersion);
  }
});

test("endpoint team-context rejeita time invalido sem quebrar rotas antigas", async () => {
  const app = createApp({ fetchImpl: fakeFetch(), liveSnapshotRepository: tempLiveSnapshot(), historicalRepository: tempHistorical() });
  const invalid = await request(app, "/brasileirao/team-context/abc");
  const old = await request(app, "/health");

  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_TEAM_ID");
  assert.equal(old.status, 200);
  assert.equal(old.body.status, "ok");
});

test("contexto nao contem NaN nem Infinity", async () => {
  const context = await buildRoundContext({
    fetchImpl: fakeFetch(),
    timeoutMs: 8000,
    liveSnapshotRepository: tempLiveSnapshot(),
    season: 2026,
    nowIso: "2026-07-21T00:00:00.000Z"
  });
  const text = JSON.stringify(context);

  assert.equal(text.includes("NaN"), false);
  assert.equal(text.includes("Infinity"), false);
});
