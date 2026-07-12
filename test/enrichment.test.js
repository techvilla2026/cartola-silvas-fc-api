const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const { enrichRound, recentForm } = require("../src/historical/enrichment/enricher");
const { checkEnrichedLeakage } = require("../src/historical/enrichment/leakageChecker");
const { buildEnrichedAudit } = require("../src/historical/enrichment/audit");
const { evaluateEnrichedRound } = require("../src/backtest/flutterParityEnrichedRunner");
const { createApp } = require("../server");

function player(id, points, round, overrides = {}) {
  return {
    athleteId: id,
    name: `Atleta ${id}`,
    clubId: 1,
    positionId: overrides.positionId || 5,
    priceVariation: overrides.priceVariation || 0,
    points,
    played: true,
    scouts: overrides.scouts || {},
    round
  };
}

function prePlayer(id, positionId = 5, overrides = {}) {
  return {
    athleteId: id,
    name: `Atleta ${id}`,
    clubId: 1,
    positionId,
    priceBeforeRound: overrides.priceBeforeRound ?? 10,
    averageBeforeRound: overrides.averageBeforeRound ?? 6,
    gamesBeforeRound: overrides.gamesBeforeRound ?? 3,
    accumulatedPointsBeforeRound: 18,
    opponent: 2,
    homeAway: "HOME",
    eligibleForBacktest: true,
    fieldProvenance: {}
  };
}

function fakeHistoricalRepository() {
  const posts = {
    1: { players: [player(1, 4, 1, { priceVariation: 0.2 }), player(2, 8, 1)] },
    2: { players: [player(1, -1, 2, { priceVariation: -0.4 }), player(2, 6, 2)] },
    3: { players: [player(1, 9, 3, { priceVariation: 1.1 }), player(2, 7, 3)] },
    4: { players: [player(1, 99, 4, { priceVariation: 9.9 })] }
  };
  const pre = {
    schemaVersion: "historical-pre-round-data/v2",
    season: 2026,
    round: 4,
    readiness: { status: "READY" },
    matches: [],
    players: [prePlayer(1), prePlayer(2)]
  };

  return {
    readRoundFile(season, round, fileName) {
      if (fileName === "pre-round.json" && round === 4) return pre;
      if (fileName === "post-round.json") return posts[round] || null;
      return null;
    }
  };
}

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    }).on("error", reject);
  });
}

test("dados recentes usam apenas rodadas anteriores e nao incluem a propria rodada", () => {
  const form = recentForm([
    { round: 1, points: 4, priceVariation: 0.1 },
    { round: 2, points: -1, priceVariation: -0.2 },
    { round: 3, points: 9, priceVariation: 0.5 },
    { round: 4, points: 99, priceVariation: 9.9 }
  ], 4);

  assert.deepEqual(form.sourceRounds, [3, 2, 1]);
  assert.deepEqual(form.pointsLast3BeforeRound, [9, -1, 4]);
  assert.equal(form.averageLast3BeforeRound, 4);
  assert.equal(form.pointsLast1BeforeRound, 9);
});

test("enriquecimento preserva status indisponivel e scouts desativados", () => {
  const { enriched, provenance, validation } = enrichRound({
    season: 2026,
    round: 4,
    historicalRepository: fakeHistoricalRepository()
  });

  assert.equal(enriched.schemaVersion, "historical-pre-round-enriched-data/v1");
  assert.equal(enriched.players[0].statusBeforeRound.classification, "unavailable");
  assert.equal(enriched.players[0].historicalScoutsBeforeRound.mode, "disabled");
  assert.equal(enriched.players[0].recentFormBeforeRound.pointsLast1BeforeRound, 9);
  assert.equal(provenance.fieldSummary.recentFormBeforeRound, "reconstructed");
  assert.equal(validation.validationStatus, "VALID_WITH_LIMITATIONS");
});

test("leakage PASS, WARNING e FAIL do enriquecido", () => {
  const { enriched } = enrichRound({ season: 2026, round: 4, historicalRepository: fakeHistoricalRepository() });
  const pass = checkEnrichedLeakage(enriched);
  const warning = checkEnrichedLeakage({
    ...enriched,
    players: [{ ...enriched.players[0], historicalScoutsBeforeRound: { mode: "primary-source-only" } }]
  });
  const fail = checkEnrichedLeakage({
    ...enriched,
    players: [{ ...enriched.players[0], recentFormBeforeRound: { sourceRounds: [4] } }]
  });

  assert.equal(pass.status, "PASS");
  assert.equal(warning.status, "WARNING");
  assert.equal(fail.status, "FAIL");
});

test("qualidade e Nota usam dados recentes reconstruidos sem mudar formula", () => {
  const ids = Array.from({ length: 11 }, (_, index) => index + 1);
  const positions = [1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5];
  const enriched = {
    schemaVersion: "historical-pre-round-enriched-data/v1",
    season: 2026,
    round: 4,
    players: ids.map((id, index) => ({
      ...prePlayer(id, positions[index], { averageBeforeRound: 8 - index * 0.1 }),
      recentFormBeforeRound: {
        reconstructed: true,
        pointsLast1BeforeRound: 8,
        variationLast1BeforeRound: 1,
        sourceRounds: [3],
        appearancesLast3BeforeRound: 1
      }
    }))
  };
  const post = { players: ids.map((id) => ({ athleteId: id, played: true, points: 5 })) };
  const result = evaluateEnrichedRound({ season: 2026, round: 4, enriched, post, leakage: { status: "PASS" } });

  assert.equal(result.selectedTeam.length, 11);
  assert.ok(result.predictions[0].analysisComponents.recent > 0);
  assert.ok(result.predictions[0].dataQualityScore > 0);
  assert.notEqual(result.captain.captainAthleteId, result.captain.viceAthleteId);
});

test("auditoria enriquecida consolida rodadas", () => {
  const repository = {
    listRounds() {
      return [2, 3];
    },
    readRoundFile(season, round) {
      return {
        round,
        enrichmentStatus: "READY",
        historicalScoutMode: "disabled",
        readiness: { totalPlayers: 10, eligiblePlayers: 8, enrichedPlayers: 7, insufficientRecent: 3 }
      };
    }
  };
  const audit = buildEnrichedAudit(repository, 2026);

  assert.equal(audit.totals.rounds, 2);
  assert.equal(audit.totals.enrichedPlayers, 14);
});

test("endpoints enriquecidos retornam 200, 400 e 404", async () => {
  const enrichedHistoricalRepository = {
    listRounds() {
      return [2];
    },
    readRoundFile(season, round, fileName) {
      if (fileName === "pre-round-enriched.json" && round === 2) {
        return { season, round, schemaVersion: "historical-pre-round-enriched-data/v1", readiness: {} };
      }
      if (fileName === "leakage.json" && round === 2) {
        return { season, round, status: "PASS" };
      }
      return null;
    }
  };
  const app = createApp({ enrichedHistoricalRepository });
  const server = app.listen(0);

  try {
    const ok = await get(server, "/historical/2026/enriched/round/2");
    const bad = await get(server, "/historical/abc/enriched/round/2");
    const missing = await get(server, "/historical/2026/enriched/round/3");

    assert.equal(ok.status, 200);
    assert.equal(bad.status, 400);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
