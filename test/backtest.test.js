const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const test = require("node:test");

const { createApp } = require("../server");
const { BacktestRepository } = require("../src/backtest/repository");
const { FORMATION_433 } = require("../src/backtest/constants");
const { errorMetrics } = require("../src/backtest/math");
const { predictionForPlayer, predictPlayers, scoreBand, selectCaptain, selectFormation } = require("../src/backtest/policy");
const { evaluateRound, runBacktest, validateFormation } = require("../src/backtest/runner");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");

async function request(app, url) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${url}`);
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

function prePlayer(id, positionId, extra = {}) {
  return {
    athleteId: id,
    name: `P${id}`,
    clubId: positionId,
    positionId,
    priceBeforeRound: 10,
    averageBeforeRound: 5 + id / 100,
    gamesBeforeRound: 2,
    accumulatedPointsBeforeRound: 10,
    accumulatedScoutsBeforeRound: {},
    opponent: 99,
    homeAway: id % 2 ? "HOME" : "AWAY",
    eligibleForBacktest: true,
    ineligibilityReasons: [],
    ...extra
  };
}

function fixtureRound(round = 2) {
  let id = 1;
  const players = [];
  for (const [position, count] of Object.entries(FORMATION_433)) {
    for (let i = 0; i < count + 1; i += 1) {
      players.push(prePlayer(id, Number(position)));
      id += 1;
    }
  }
  players.push(prePlayer(99, 5, { eligibleForBacktest: false }));
  const pre = {
    schemaVersion: "historical-pre-round-data/v2",
    season: 2026,
    round,
    leakageStatus: "PASS",
    readiness: { status: "READY" },
    players,
    matches: []
  };
  const post = {
    season: 2026,
    round,
    players: players.map((player) => ({
      athleteId: player.athleteId,
      points: player.athleteId % 7 - 1,
      played: true
    }))
  };
  return { pre, post, leakage: { status: "PASS" } };
}

test("nenhuma rodada usa dados futuros e post nao e acessado antes do congelamento", () => {
  const { pre, post, leakage } = fixtureRound();
  const result = evaluateRound({ season: 2026, round: 2, pre, post, leakage });

  assert.equal(result.decisionsFrozenBeforePostRoundComparison, true);
  assert.equal(result.selectedTeam.length, 11);
  assert.equal(result.predictions.some((item) => Object.hasOwn(item, "scouts")), false);
});

test("somente atletas elegiveis entram no motor", () => {
  const { pre } = fixtureRound();
  const predictions = predictPlayers(pre);

  assert.equal(predictions.some((item) => item.athleteId === 99), false);
});

test("formacao 4-3-3 e quantidades por posicao sao respeitadas", () => {
  const { pre } = fixtureRound();
  const team = selectFormation(predictPlayers(pre));

  assert.equal(validateFormation(team), true);
  for (const [positionId, count] of Object.entries(FORMATION_433)) {
    assert.equal(team.filter((player) => String(player.positionId) === String(positionId)).length, count);
  }
});

test("capitao e vice pertencem ao time e sao diferentes", () => {
  const { pre } = fixtureRound();
  const team = selectFormation(predictPlayers(pre));
  const { captain, viceCaptain } = selectCaptain(team);
  const ids = new Set(team.map((player) => player.athleteId));

  assert.equal(ids.has(captain.athleteId), true);
  assert.equal(ids.has(viceCaptain.athleteId), true);
  assert.notEqual(captain.athleteId, viceCaptain.athleteId);
});

test("MAE, RMSE e Bias corretos", () => {
  const metrics = errorMetrics([
    { predicted: 1, actual: 2 },
    { predicted: 3, actual: 1 }
  ]);

  assert.equal(metrics.mae, 1.5);
  assert.equal(metrics.rmse, 1.5811);
  assert.equal(metrics.bias, 0.5);
});

test("faixas da Nota corretas", () => {
  assert.equal(scoreBand(20), "Fraca");
  assert.equal(scoreBand(50), "Regular");
  assert.equal(scoreBand(70), "Boa");
  assert.equal(scoreBand(80), "Forte");
  assert.equal(scoreBand(95), "Excelente");
});

test("Casa/Fora e custo-beneficio aparecem nas metricas", () => {
  const { pre, post, leakage } = fixtureRound();
  const result = evaluateRound({ season: 2026, round: 2, pre, post, leakage });

  assert.ok(result.metrics.homeAway.HOME || result.metrics.homeAway.AWAY);
  assert.ok(result.metrics.costBenefit["5-10"] || result.metrics.costBenefit["10-15"]);
});

test("baseline respeita 4-3-3 e comparacao e calculada", () => {
  const { pre, post, leakage } = fixtureRound();
  const result = evaluateRound({ season: 2026, round: 2, pre, post, leakage });

  assert.equal(validateFormation(result.baselineTeam), true);
  assert.ok(["WIN", "LOSS", "DRAW"].includes(result.metrics.comparison.result));
});

test("schemas versionados", () => {
  const { pre, post, leakage } = fixtureRound();
  const result = evaluateRound({ season: 2026, round: 2, pre, post, leakage });

  assert.equal(result.schemaVersion, "backtest-round-result/v1");
});

test("rodada 1 ou NOT_READY e pulada", () => {
  const historical = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  const backtest = new BacktestRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "backtest-")) });
  const { pre, post } = fixtureRound(1);
  pre.readiness.status = "NOT_READY";
  historical.saveRoundFile(2026, 1, "pre-round.json", pre, { force: true });
  historical.saveRoundFile(2026, 1, "post-round.json", post, { force: true });
  historical.saveRoundFile(2026, 1, "leakage.json", { status: "PASS" }, { force: true });
  const summary = runBacktest({ season: 2026, fromRound: 1, toRound: 1, historicalRepository: historical, backtestRepository: backtest });

  assert.equal(summary.roundsEvaluated, 0);
  assert.equal(summary.skipReasons[0].reason, "ROUND_NOT_READY");
});

test("leakage FAIL impede avaliacao", () => {
  const historical = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  const backtest = new BacktestRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "backtest-")) });
  const { pre, post } = fixtureRound(2);
  historical.saveRoundFile(2026, 2, "pre-round.json", pre, { force: true });
  historical.saveRoundFile(2026, 2, "post-round.json", post, { force: true });
  historical.saveRoundFile(2026, 2, "leakage.json", { status: "FAIL" }, { force: true });
  const summary = runBacktest({ season: 2026, fromRound: 2, toRound: 2, historicalRepository: historical, backtestRepository: backtest });

  assert.equal(summary.roundsEvaluated, 0);
  assert.equal(summary.skipReasons[0].reason, "LEAKAGE_FAIL");
});

test("execucao deterministica com mesmo dataset", () => {
  const historical = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  const backtest1 = new BacktestRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "backtest-")) });
  const backtest2 = new BacktestRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "backtest-")) });
  const { pre, post, leakage } = fixtureRound(2);
  historical.saveRoundFile(2026, 2, "pre-round.json", pre, { force: true });
  historical.saveRoundFile(2026, 2, "post-round.json", post, { force: true });
  historical.saveRoundFile(2026, 2, "leakage.json", leakage, { force: true });
  const a = runBacktest({ season: 2026, fromRound: 2, toRound: 2, historicalRepository: historical, backtestRepository: backtest1 });
  const b = runBacktest({ season: 2026, fromRound: 2, toRound: 2, historicalRepository: historical, backtestRepository: backtest2 });

  assert.deepEqual(a.metrics.prediction, b.metrics.prediction);
  assert.equal(predictionForPlayer(pre.players[0]), predictionForPlayer(pre.players[0]));
});

test("endpoints de backtest retornam 200, 400 e 404", async () => {
  const repo = new BacktestRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "backtest-")) });
  repo.writeJson(2026, "run-summary.json", { ok: true });
  repo.writeJson(2026, "rounds/round-02.json", { round: 2, metrics: { team: { actualTotal: 1 } } });
  repo.writeJson(2026, "metrics/prediction.json", { mae: 1 });
  repo.writeJson(2026, "metrics/team.json", { actualTotal: 1 });
  repo.writeJson(2026, "metrics/captain.json", { bestRate: 1 });
  repo.writeJson(2026, "metrics/score-bands.json", { Boa: {} });
  repo.writeJson(2026, "comparison/baseline-average.json", { wins: 1 });
  const app = createApp({ fetchImpl: fetch, backtestRepository: repo });

  assert.equal((await request(app, "/backtests/2026/latest")).status, 200);
  assert.equal((await request(app, "/backtests/2026/round/2")).status, 200);
  assert.equal((await request(app, "/backtests/abc/latest")).status, 400);
  assert.equal((await request(app, "/backtests/2026/round/99")).status, 400);
  assert.equal((await request(app, "/backtests/2026/metrics/prediction")).status, 200);
  assert.equal((await request(app, "/backtests/2025/latest")).status, 404);
});
