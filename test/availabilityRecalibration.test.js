const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  MODEL_ID,
  TRAIN_ROUNDS,
  VALIDATION_ROUNDS,
  buildAvailabilityRecalibration,
  buildDataset,
  metrics,
  trainLogistic
} = require("../src/research/availabilityRecalibration");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(app, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      fetch(`http://127.0.0.1:${server.address().port}${pathname}`, { headers })
        .then(async (response) => {
          const body = await response.json();
          server.close(() => resolve({ status: response.status, body, headers: response.headers }));
        })
        .catch((error) => server.close(() => reject(error)));
    });
  });
}

function player(id, played = true, positionId = 5) {
  return {
    athleteId: id,
    name: `P${id}`,
    clubId: 260,
    positionId,
    predictedPoints: 8 - (id % 5),
    gamesBeforeRound: 3,
    eligibleForBacktest: true
  };
}

function seedHistorical(repository) {
  for (let round = 1; round <= 18; round += 1) {
    repository.saveRoundFile(2026, round, "post-round.json", {
      players: [
        { athleteId: 1, name: "P1", positionId: 5, played: true, points: 5, games: round, scouts: {} },
        { athleteId: 2, name: "P2", positionId: 5, played: round % 3 !== 0, points: round % 3 !== 0 ? 3 : null, games: Math.ceil(round * 0.7), scouts: {} },
        { athleteId: 3, name: "P3", positionId: 4, played: round % 2 === 0, points: round % 2 === 0 ? 4 : null, games: Math.floor(round / 2), scouts: {} },
        { athleteId: 4, name: "P4", positionId: 1, played: true, points: 2, games: round, scouts: {} }
      ]
    }, { force: true });
    if (round >= 2) {
      repository.saveRoundFile(2026, round, "pre-round.json", {
        players: [player(1, true, 5), player(2, true, 5), player(3, true, 4), player(4, true, 1)]
      }, { force: true });
    }
  }
}

function seedResearch(repository) {
  repository.writeJson(2026, "baselines/research-baseline-1.0.json", {
    baselineId: "RESEARCH_BASELINE_1_0",
    status: "VALID",
    researchFreezeStatus: "ACTIVE",
    baselineFingerprint: "baseline-fingerprint",
    targetDefinitionVersion: "PARTICIPATION_TARGET_V1",
    metricsDefinitionVersion: "RESEARCH_METRICS_V1"
  });
}

function backtestStub() {
  return {
    listRoundResults: () => {
      const rows = [];
      for (let round = 2; round <= 18; round += 1) {
        rows.push({
          round,
          predictions: [player(1, true, 5), player(2, true, 5), player(3, true, 4), player(4, true, 1)],
          selectedTeam: null
        });
      }
      return rows;
    }
  };
}

test("calibracao e deterministica, preserva V1 e nao detecta leakage", () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("avail-v2-hist-") });
  const research = new ResearchRepository({ baseDir: tempDir("avail-v2-research-") });
  seedHistorical(historical);
  seedResearch(research);
  const a = buildAvailabilityRecalibration({ historicalRepository: historical, researchRepository: research, backtestRepository: backtestStub(), generatedAt: "2026-07-24T00:00:00.000Z" });
  const b = buildAvailabilityRecalibration({ historicalRepository: historical, researchRepository: research, backtestRepository: backtestStub(), generatedAt: "2026-07-24T00:00:00.000Z" });
  assert.equal(a.candidate.modelId, MODEL_ID);
  assert.equal(a.modelAudit.v1Preserved, true);
  assert.equal(a.modelAudit.leakageStatus, "PASS");
  assert.deepEqual(a.candidate.weights, b.candidate.weights);
  assert.equal(a.candidate.candidateFingerprint, b.candidate.candidateFingerprint);
});

test("split temporal usa treino antes da validacao e dataset nao contem alvo nas features", () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("avail-v2-split-") });
  seedHistorical(historical);
  const rows = buildDataset({ historicalRepository: historical, backtestRepository: backtestStub(), season: 2026 });
  assert.ok(Math.max(...TRAIN_ROUNDS) < Math.min(...VALIDATION_ROUNDS));
  assert.ok(rows.every((row) => !Object.hasOwn(row.features, "target")));
  assert.ok(rows.every((row) => !Object.hasOwn(row.features, "played")));
});

test("metricas sao reproduziveis e comparison contract fica valido com baseline", () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("avail-v2-metrics-") });
  const research = new ResearchRepository({ baseDir: tempDir("avail-v2-metrics-research-") });
  seedHistorical(historical);
  seedResearch(research);
  const artifact = buildAvailabilityRecalibration({ historicalRepository: historical, researchRepository: research, backtestRepository: backtestStub(), generatedAt: "2026-07-24T00:00:00.000Z" });
  assert.equal(artifact.comparisonContract.comparable, true);
  assert.equal(artifact.temporalSplit.trainRounds.join(","), TRAIN_ROUNDS.join(","));
  assert.equal(artifact.temporalSplit.validationRounds.join(","), VALIDATION_ROUNDS.join(","));
  assert.equal(metrics([], "v1Probability").count, 0);
  assert.ok(Number.isFinite(artifact.metrics.availabilityV1.brierScore));
  assert.ok(Number.isFinite(artifact.metrics.availabilityV2Calibrated.brierScore));
});

test("treino logistico altera pesos de forma deterministica", () => {
  const rows = [
    { target: 1, v1Probability: 0.8, features: { recentParticipationRate: 1, allParticipationRate: 1, sampleSize: 6, consecutiveDidNotPlay: 0, consecutivePlayed: 4, gamesBeforeRound: 6 } },
    { target: 0, v1Probability: 0.8, features: { recentParticipationRate: 0.2, allParticipationRate: 0.3, sampleSize: 6, consecutiveDidNotPlay: 3, consecutivePlayed: 0, gamesBeforeRound: 2 } },
    { target: 1, v1Probability: 0.4, features: { recentParticipationRate: 0.8, allParticipationRate: 0.7, sampleSize: 6, consecutiveDidNotPlay: 0, consecutivePlayed: 2, gamesBeforeRound: 4 } }
  ];
  assert.deepEqual(trainLogistic(rows), trainLogistic(rows));
  assert.notEqual(trainLogistic(rows)[2], 0);
});

test("endpoint availability-recalibration e read-only, preserva CORS e retorna 404 claro", async () => {
  const research = new ResearchRepository({ baseDir: tempDir("avail-v2-endpoint-") });
  const app404 = createApp({ fetchImpl: fetch, researchRepository: research });
  const missing = await request(app404, "/research/availability-recalibration", { Origin: "https://meutimeideal.netlify.app" });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("access-control-allow-origin"), "https://meutimeideal.netlify.app");
  research.writeJson(2026, "availability-recalibration.json", { schemaVersion: "availability-recalibration/v1", candidate: { modelId: MODEL_ID } });
  const app = createApp({ fetchImpl: fetch, researchRepository: research });
  const ok = await request(app, "/research/availability-recalibration", { Origin: "https://meutimeideal.netlify.app" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.candidate.modelId, MODEL_ID);
});
