const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { reconstructPreRound, PRE_ROUND_SCHEMA_VERSION } = require("../src/historical/reconstruction/preRoundReconstructor");
const { checkPreRoundLeakage } = require("../src/historical/reconstruction/leakageChecker");
const { analyzeScoutDivergences } = require("../src/historical/reconstruction/scoutDivergence");
const { parseArgs: parseReconstructArgs } = require("../scripts/historical-reconstruct-pre");
const { parseArgs: parseLeakageArgs } = require("../scripts/historical-check-leakage");
const { once } = require("node:events");
const http = require("node:http");

async function request(app, url) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${url}`);
    return {
      status: response.status,
      body: await response.json()
    };
  } finally {
    server.close();
    await once(server, "close");
  }
}

function player(overrides = {}) {
  return {
    athleteId: 10,
    name: "Atleta",
    nickname: "Atleta",
    clubId: 1,
    positionId: 5,
    price: 11,
    priceVariation: 1,
    average: 5,
    points: 5,
    games: 1,
    played: true,
    scouts: { G: 1, DS: 2 },
    rawSourceReference: { url: "post.json" },
    ...overrides
  };
}

function post(round, players = [player()], matches = []) {
  return {
    season: 2026,
    round,
    players,
    matches: matches.length ? matches : [{
      matchId: round,
      round,
      homeClubId: 1,
      awayClubId: 2,
      date: "2026-01-01",
      venue: "Estadio",
      homeScore: 2,
      awayScore: 1,
      valid: true,
      status: "encerrada"
    }]
  };
}

test("Rodada N usa somente dados ate N-1 para acumulados", () => {
  const r1 = post(1, [player({ price: 10, priceVariation: 0, points: 5, games: 1, scouts: { G: 1 } })]);
  const r2 = post(2, [player({ price: 12, priceVariation: 2, points: 7, games: 2, scouts: { G: 2 } })]);
  const pre = reconstructPreRound({ season: 2026, round: 2, currentPost: r2, previousPost: r1, allPosts: [r1, r2] });

  assert.equal(pre.players[0].accumulatedPointsBeforeRound, 5);
  assert.deepEqual(pre.players[0].accumulatedScoutsBeforeRound, { G: 1 });
});

test("pontuacao e scouts da propria rodada nao aparecem no pre-round", () => {
  const r1 = post(1, [player({ points: 5, scouts: { G: 1 } })]);
  const r2 = post(2, [player({ points: 7, scouts: { G: 2 } })]);
  const pre = reconstructPreRound({ season: 2026, round: 2, currentPost: r2, previousPost: r1, allPosts: [r1, r2] });

  assert.equal(pre.players[0].points, undefined);
  assert.equal(pre.players[0].scouts, undefined);
  assert.equal(pre.players[0].accumulatedPointsBeforeRound, 5);
});

test("placares nao aparecem no pre-round", () => {
  const r1 = post(1);
  const pre = reconstructPreRound({ season: 2026, round: 1, currentPost: r1, previousPost: null, allPosts: [r1] });

  assert.equal(pre.matches[0].homeScore, null);
  assert.equal(pre.matches[0].awayScore, null);
});

test("games, pontos, scouts e media pre-rodada ficam corretos", () => {
  const r1 = post(1, [player({ price: 10, points: 6, games: 1, average: 6, scouts: { DS: 3 } })]);
  const r2 = post(2, [player({ price: 11, priceVariation: 1, points: 4, games: 2, average: 5, scouts: { DS: 5 } })]);
  const pre = reconstructPreRound({ season: 2026, round: 2, currentPost: r2, previousPost: r1, allPosts: [r1, r2] });

  assert.equal(pre.players[0].gamesBeforeRound, 1);
  assert.equal(pre.players[0].accumulatedPointsBeforeRound, 6);
  assert.deepEqual(pre.players[0].accumulatedScoutsBeforeRound, { DS: 3 });
  assert.equal(pre.players[0].averageBeforeRound, 6);
});

test("atleta estreante ou ausente na rodada anterior fica inelegivel", () => {
  const r1 = post(1, []);
  const r2 = post(2, [player({ athleteId: 20 })]);
  const pre = reconstructPreRound({ season: 2026, round: 2, currentPost: r2, previousPost: r1, allPosts: [r1, r2] });

  assert.equal(pre.players[0].eligibleForBacktest, false);
  assert.ok(pre.players[0].ineligibilityReasons.includes("missingPreviousRound"));
});

test("transferencia de clube preserva confronto atual e historico anterior", () => {
  const r1 = post(1, [player({ clubId: 1 })]);
  const r2 = post(2, [player({ clubId: 2, price: 11, priceVariation: 1 })], [{
    matchId: 2,
    round: 2,
    homeClubId: 1,
    awayClubId: 2,
    homeScore: 0,
    awayScore: 0
  }]);
  const pre = reconstructPreRound({ season: 2026, round: 2, currentPost: r2, previousPost: r1, allPosts: [r1, r2] });

  assert.equal(pre.players[0].homeAway, "AWAY");
  assert.equal(pre.players[0].opponent, 1);
});

test("Rodada 1 fica NOT_READY e sem dados fabricados", () => {
  const r1 = post(1);
  const pre = reconstructPreRound({ season: 2026, round: 1, currentPost: r1, previousPost: null, allPosts: [r1] });

  assert.equal(pre.readiness.status, "NOT_READY");
  assert.equal(pre.players[0].gamesBeforeRound, null);
  assert.ok(pre.players[0].ineligibilityReasons.includes("roundOneNoPreviousData"));
});

test("priceBeforeRound seguro e indisponivel/unsafe quando nao validado", () => {
  const r1 = post(1, [player({ price: 10 })]);
  const safe = reconstructPreRound({
    season: 2026,
    round: 2,
    currentPost: post(2, [player({ price: 12, priceVariation: 2 })]),
    previousPost: r1,
    allPosts: [r1]
  });
  const unsafe = reconstructPreRound({
    season: 2026,
    round: 2,
    currentPost: post(2, [player({ price: 12, priceVariation: null })]),
    previousPost: r1,
    allPosts: [r1]
  });

  assert.equal(safe.players[0].priceBeforeRound, 10);
  assert.equal(safe.players[0].fieldProvenance.priceBeforeRound.allowedForBacktest, true);
  assert.equal(unsafe.players[0].priceBeforeRound, null);
});

test("status pre-rodada permanece indisponivel", () => {
  const r1 = post(1);
  const pre = reconstructPreRound({ season: 2026, round: 2, currentPost: post(2), previousPost: r1, allPosts: [r1] });

  assert.equal(pre.players[0].statusBeforeRound, null);
  assert.equal(pre.players[0].fieldProvenance.statusBeforeRound.allowedForBacktest, false);
});

test("schema v2 e provenance existem", () => {
  const r1 = post(1);
  const pre = reconstructPreRound({ season: 2026, round: 2, currentPost: post(2), previousPost: r1, allPosts: [r1] });

  assert.equal(pre.schemaVersion, PRE_ROUND_SCHEMA_VERSION);
  assert.equal(typeof pre.players[0].fieldProvenance.averageBeforeRound.method, "string");
});

test("classifica READY, PARTIALLY_READY e NOT_READY", () => {
  const r1 = post(1, [player(), player({ athleteId: 11 })]);
  const ready = reconstructPreRound({ season: 2026, round: 2, currentPost: post(2, [player(), player({ athleteId: 11 })]), previousPost: r1, allPosts: [r1] });
  const partial = reconstructPreRound({ season: 2026, round: 2, currentPost: post(2, [player(), player({ athleteId: 99 })]), previousPost: post(1, [player()]), allPosts: [post(1, [player()])] });
  const notReady = reconstructPreRound({ season: 2026, round: 1, currentPost: post(1), previousPost: null, allPosts: [] });

  assert.equal(ready.readiness.status, "READY");
  assert.equal(partial.readiness.status, "PARTIALLY_READY");
  assert.equal(notReady.readiness.status, "NOT_READY");
});

test("leakage PASS, WARNING e FAIL", () => {
  const r1 = post(1);
  const pass = reconstructPreRound({ season: 2026, round: 2, currentPost: post(2), previousPost: r1, allPosts: [r1] });
  const warning = { ...pass, schemaVersion: "old" };
  const fail = { ...pass, matches: [{ homeScore: 1, awayScore: null }], players: [{ athleteId: 10, points: 1 }] };

  assert.equal(checkPreRoundLeakage(pass).status, "PASS");
  assert.equal(checkPreRoundLeakage(warning).status, "WARNING");
  assert.equal(checkPreRoundLeakage(fail).status, "FAIL");
});

test("divergencias de scout sao classificadas", () => {
  const analysis = analyzeScoutDivergences([{
    round: 1,
    scoutDifferences: [
      { scout: "G", primary: 1, validation: 2 },
      { scout: "DS", primary: null, validation: 1 }
    ]
  }]);

  assert.equal(analysis.total, 2);
  assert.equal(analysis.byScout.G.valueDifference, 1);
  assert.ok(analysis.excludedScouts.includes("G"));
});

test("scripts parseiam dry-run e force", () => {
  assert.equal(parseReconstructArgs(["--season=2026", "--from=1", "--to=18", "--dry-run"]).dryRun, true);
  assert.equal(parseReconstructArgs(["--force"]).force, true);
  assert.equal(parseLeakageArgs(["--to=18"]).to, 18);
});

test("nao sobrescreve sem force e sobrescreve com force", () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  repository.saveRoundFile(2026, 1, "pre-round.json", { ok: true });

  assert.throws(() => repository.saveRoundFile(2026, 1, "pre-round.json", { ok: true }), /Use --force/);
  assert.doesNotThrow(() => repository.saveRoundFile(2026, 1, "pre-round.json", { ok: true }, { force: true }));
});

test("endpoint pre retorna schema v2 e agregados funcionam", async () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  const pre = reconstructPreRound({ season: 2026, round: 1, currentPost: post(1), previousPost: null, allPosts: [] });
  const leakage = checkPreRoundLeakage(pre);
  repository.saveRoundFile(2026, 1, "pre-round.json", pre, { force: true });
  repository.saveRoundFile(2026, 1, "leakage.json", leakage, { force: true });
  repository.saveRoundFile(2026, 1, "validation.json", { scoutDifferences: [] }, { force: true });
  const app = createApp({ fetchImpl: fetch, historicalRepository: repository });

  const preResponse = await request(app, "/historical/2026/round/1/pre");
  const readinessResponse = await request(app, "/historical/2026/backtest-readiness");
  const leakageResponse = await request(app, "/historical/2026/leakage-report");
  const scoutResponse = await request(app, "/historical/2026/scout-divergences");

  assert.equal(preResponse.status, 200);
  assert.equal(preResponse.body.schemaVersion, PRE_ROUND_SCHEMA_VERSION);
  assert.equal(readinessResponse.body.totals.notReady, 1);
  assert.equal(leakageResponse.body.pass, 1);
  assert.equal(scoutResponse.status, 200);
});
