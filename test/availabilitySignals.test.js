const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  SAFE_PRE_MATCH,
  SIGNAL_CONTRACT_VERSION,
  UNKNOWN_TIMING,
  UNSAFE_POST_MATCH,
  assertUsablePreMatchSignal,
  buildAvailabilitySignals,
  buildSignalDataset,
  coverageMatrix,
  isUsablePreMatchSignal,
  thresholdAnalysis
} = require("../src/research/availabilitySignals");

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
    priceBeforeRound: 5 + id,
    averageBeforeRound: 3 + id,
    accumulatedPointsBeforeRound: 10 + id,
    gamesBeforeRound: 3,
    statusBeforeRound: null,
    opponent: 262,
    homeAway: id % 2 ? "HOME" : "AWAY",
    predictedPoints: 8 - (id % 5),
    eligibleForBacktest: true,
    fieldProvenance: {
      gamesBeforeRound: { allowedForBacktest: true },
      priceBeforeRound: { allowedForBacktest: true }
    }
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
    baselineFingerprint: "baseline-fingerprint"
  });
}

function backtestStub() {
  return {
    listRoundResults: () => Array.from({ length: 17 }, (_, index) => ({
      round: index + 2,
      predictions: [player(1, true, 5), player(2, true, 5), player(3, true, 4), player(4, true, 1)]
    }))
  };
}

test("contrato AVAILABILITY_SIGNALS_V1 permite apenas SAFE_PRE_MATCH", () => {
  assert.equal(isUsablePreMatchSignal({ name: "recentPlayedRate", timingClass: SAFE_PRE_MATCH }), true);
  assert.equal(isUsablePreMatchSignal({ name: "actualPoints", timingClass: UNSAFE_POST_MATCH }), false);
  assert.equal(isUsablePreMatchSignal({ name: "starterFlag", timingClass: UNKNOWN_TIMING }), false);
  assert.throws(() => assertUsablePreMatchSignal({ name: "starterFlag", timingClass: UNKNOWN_TIMING }), /not SAFE_PRE_MATCH/);
});

test("dataset de sinais preserva null, fontes e status de timestamp", () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("signals-hist-") });
  seedHistorical(historical);
  const rows = [
    {
      season: 2026,
      round: 2,
      athleteId: 1,
      name: "P1",
      positionId: 5,
      position: "ATA",
      target: 1,
      features: {
        recentParticipationRate: 1,
        allParticipationRate: 1,
        consecutivePlayed: 1,
        consecutiveDidNotPlay: 0,
        sampleSize: 1,
        gamesBeforeRound: 1
      }
    }
  ];
  const dataset = buildSignalDataset({ historicalRepository: historical, scoredRows: rows });
  assert.equal(dataset[0].signals.statusBeforeRound, null);
  assert.equal(dataset[0].signalTimestampStatus.actualPoints, "BLOCKED_POST_MATCH");
  assert.equal(dataset[0].signalTimestampStatus.starterFlag, "BLOCKED_UNKNOWN_TIMING");
  assert.equal(dataset[0].signalTimestampStatus.recentPlayedRate, "AVAILABLE");
});

test("build 5.2.10 gera artefato sem criar modelo aumentado nem alterar baseline", () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("signals-build-hist-") });
  const research = new ResearchRepository({ baseDir: tempDir("signals-build-research-") });
  seedHistorical(historical);
  seedResearch(research);
  const artifact = buildAvailabilitySignals({
    historicalRepository: historical,
    researchRepository: research,
    backtestRepository: backtestStub(),
    generatedAt: "2026-07-24T00:00:00.000Z"
  });
  assert.equal(artifact.availabilitySignalsContract.version, SIGNAL_CONTRACT_VERSION);
  assert.equal(artifact.experimentalAugmentedModel.created, false);
  assert.equal(artifact.safeguards.officialEngineChanged, false);
  assert.equal(artifact.safeguards.availabilityV2CalibratedChanged, false);
  assert.equal(artifact.baseline.status, "VALID");
  assert.ok(artifact.dataset.rows.length > 0);
  assert.ok(artifact.coverageMatrix.global.some((item) => item.name === "recentPlayedRate"));
});

test("matriz de cobertura e thresholds sao reproduziveis", () => {
  const rows = [
    { round: 14, position: "ATA", targetClassification: "DID_PLAY", signals: { recentPlayedRate: 1 } },
    { round: 14, position: "ATA", targetClassification: "DID_NOT_PLAY", signals: { recentPlayedRate: null } }
  ];
  const matrix = coverageMatrix(rows);
  assert.equal(matrix.global.find((item) => item.name === "recentPlayedRate").coverage, 0.5);
  const scored = [
    { target: 1, v2Probability: 0.45 },
    { target: 1, v2Probability: 0.55 },
    { target: 0, v2Probability: 0.52 },
    { target: 0, v2Probability: 0.2 }
  ];
  const thresholds = thresholdAnalysis(scored, 1);
  assert.equal(thresholds.thresholdGrid.length, 6);
  assert.ok(thresholds.paretoFrontier.length >= 1);
});

test("endpoints availability-signals sao read-only, preservam CORS e 404 claro", async () => {
  const research = new ResearchRepository({ baseDir: tempDir("signals-endpoint-") });
  const app404 = createApp({ fetchImpl: fetch, researchRepository: research });
  const missing = await request(app404, "/research/availability-signals", { Origin: "https://meutimeideal.netlify.app" });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("access-control-allow-origin"), "https://meutimeideal.netlify.app");

  research.writeJson(2026, "availability-signals.json", {
    schemaVersion: "availability-signals/v1",
    generatedAt: "2026-07-24T00:00:00.000Z",
    season: 2026,
    availabilitySignalsContract: { version: SIGNAL_CONTRACT_VERSION },
    coverageMatrix: { global: [] },
    qualityAnalysis: {},
    falsePositiveFalseNegative: { falseNegatives: { count: 0 }, falsePositives: { count: 0 } },
    thresholds: { thresholdGrid: [] },
    experimentalAugmentedModel: { created: false }
  });
  const app = createApp({ fetchImpl: fetch, researchRepository: research });
  const full = await request(app, "/research/availability-signals", { Origin: "https://meutimeideal.netlify.app" });
  const coverage = await request(app, "/research/availability-signals/coverage", { Origin: "https://meutimeideal.netlify.app" });
  const errors = await request(app, "/research/availability-signals/false-negatives", { Origin: "https://meutimeideal.netlify.app" });
  const thresholds = await request(app, "/research/availability-signals/thresholds", { Origin: "https://meutimeideal.netlify.app" });
  assert.equal(full.status, 200);
  assert.equal(coverage.body.schemaVersion, "availability-signals-coverage/v1");
  assert.equal(errors.body.schemaVersion, "availability-signals-errors/v1");
  assert.equal(thresholds.body.schemaVersion, "availability-signals-thresholds/v1");
});
