const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { ResearchRepository } = require("../src/research/repository");
const {
  aggregateCleanSheetBacktest,
  bestXIByScore,
  buildCaptainRecommendation,
  buildPositionShadow,
  buildPromotionGate,
  calculateDataQualityScore,
  classifyAvailability,
  classifyExplainableError,
  formationAccuracy,
  isCaptainEligible,
  summarizeShadowAcrossRounds,
  topPotentialCaptureRate
} = require("../src/research/multiRoundCalibration");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(app, pathname) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      fetch(`http://127.0.0.1:${port}${pathname}`)
        .then(async (response) => {
          const body = await response.json();
          server.close(() => resolve({ status: response.status, body }));
        })
        .catch((error) => server.close(() => reject(error)));
    });
  });
}

function player(id, positionId, predictedPoints, actualPoints, extra = {}) {
  return {
    athleteId: id,
    name: `P${id}`,
    clubId: 260 + id,
    positionId,
    predictedPoints,
    actualPoints,
    averageBeforeRound: predictedPoints,
    gamesBeforeRound: 5,
    statusBeforeRound: "provavel",
    homeAway: "HOME",
    opponent: 300,
    recentFormBeforeRound: { averageLast3BeforeRound: predictedPoints },
    historicalScoutMode: "available",
    eligibleForBacktest: true,
    enteredField: actualPoints === null ? null : true,
    ...extra
  };
}

test("capitao aceita apenas ATA e MEI e nao usa actualPoints para ordenar", () => {
  const base = [
    player(1, 1, 10, 30),
    player(2, 5, 7, 2),
    player(3, 4, 7.4, 25),
    player(4, 3, 9, 20)
  ];
  assert.equal(isCaptainEligible(base[0]), false);
  assert.equal(isCaptainEligible(base[1]), true);
  assert.equal(isCaptainEligible(base[2]), true);
  const before = buildCaptainRecommendation(base).captain.athleteId;
  const changedActuals = base.map((item) => item.athleteId === 2 ? { ...item, actualPoints: -20 } : { ...item, actualPoints: 40 });
  assert.equal(buildCaptainRecommendation(changedActuals).captain.athleteId, before);
});

test("dataQualityScore penaliza null sem converter null em zero", () => {
  const result = calculateDataQualityScore({
    predictedPoints: null,
    averageBeforeRound: 4,
    recentFormBeforeRound: null,
    statusBeforeRound: null,
    homeAway: "AWAY",
    opponent: 300,
    clubId: 262,
    historicalScoutMode: "divergent-not-used",
    gamesBeforeRound: 1
  });
  assert.ok(result.score < 60);
  assert.equal(result.factors.prediction, "MISSING_OR_UNSAFE");
  assert.ok(result.nullPolicy.includes("nao substitui"));
});

test("N/A pos-jogo distingue nao jogou de pontuacao indisponivel", () => {
  assert.equal(classifyAvailability({ enteredField: false, actualPoints: null }), "POST_MATCH_DID_NOT_PLAY");
  assert.equal(classifyAvailability({ enteredField: null, actualPoints: null }), "POST_MATCH_SCORE_UNAVAILABLE");
  assert.equal(classifyAvailability({ enteredField: true, actualPoints: 0 }), "POST_MATCH_SCORE_AVAILABLE");
});

test("Shadow Mode por posicao compara oficial e V2 preservando top1/top3/top5", () => {
  const result = buildPositionShadow([
    player(1, 1, 4, 1, { averageBeforeRound: 4 }),
    player(2, 1, 3, 8, { averageBeforeRound: 7 }),
    player(3, 1, 2, 2, { averageBeforeRound: 2 }),
    player(4, 1, 1, 1, { averageBeforeRound: 1 }),
    player(5, 1, 0.5, 0.5, { averageBeforeRound: 0.5 })
  ], 1);
  assert.equal(result.modelId, "GOL_V2");
  assert.equal(result.officialTop5[0].athleteId, 1);
  assert.equal(result.shadowTop5[0].athleteId, 2);
  assert.equal(result.status, "EXPERIMENTAL");
});

test("SG multirrodada compara V1 e V2 com rodadas validas", () => {
  const row = (teamId, actual, v1, v2, rankV1, rankV2) => ({
    teamId,
    cleanSheetActual: actual,
    cleanSheetIndexV1: { rawScore: v1 },
    cleanSheetIndexV2: { rawScore: v2 },
    evaluatedRankV1: rankV1,
    evaluatedRankV2: rankV2
  });
  const backtest = {
    rounds: [{
      rankingV1: [row(1, false, 90, 10, null, null), row(2, true, 20, 95, 2, 1)],
      rankingV2: [row(2, true, 20, 95, 2, 1), row(1, false, 90, 10, null, null)],
      metricsV1: { evaluated: 2, top1: { accuracy: 0 }, top3: { accuracy: 0.5 }, top5: { accuracy: 0.5 } },
      metricsV2: { evaluated: 2, top1: { accuracy: 1 }, top3: { accuracy: 0.5 }, top5: { accuracy: 0.5 } }
    }]
  };
  const result = aggregateCleanSheetBacktest(backtest);
  assert.equal(result.validRounds, 1);
  assert.equal(result.v1.top1, 0);
  assert.equal(result.v2.top1, 1);
  assert.equal(result.v1.falseDefensiveFavorites, 1);
});

test("Best Predicted XI, Best Actual XI e TopPotentialCaptureRate usam elegiveis pre-rodada", () => {
  const players = [
    player(1, 1, 5, 4), player(2, 2, 5, 4), player(3, 2, 5, 4), player(4, 3, 5, 4), player(5, 3, 5, 4),
    player(6, 4, 6, 2), player(7, 4, 5, 10), player(8, 4, 4, 8), player(9, 5, 8, 3), player(10, 5, 7, 9),
    player(11, 5, 6, 7), player(12, 6, 5, 4), player(13, 4, 1, 20)
  ];
  const predicted = bestXIByScore(players, "predictedPoints");
  const actual = bestXIByScore(players, "actualPoints");
  assert.equal(predicted.formation, "4-3-3");
  assert.ok(actual.actualPointsWithoutCaptain > predicted.actualPointsWithoutCaptain);
  assert.ok(topPotentialCaptureRate(players, 5).captureRate <= 1);
});

test("classificacao de erro e promotion gate preservam estados permitidos", () => {
  assert.equal(classifyExplainableError({ enteredField: false, actualPoints: null, predictedPoints: 5 }), "PLAYER_DID_NOT_PLAY");
  assert.equal(classifyExplainableError({ enteredField: null, actualPoints: null, predictedPoints: 5 }), "DATA_LIMITATION");
  assert.equal(classifyExplainableError({ enteredField: true, actualPoints: 14, predictedPoints: 5 }), "UNPREDICTABLE_EVENT");
  const gate = buildPromotionGate({
    cleanSheetBacktest: { v1: { top5: 0.3 }, v2: { top5: 0.4 } },
    shadowAcrossRounds: { GOL: { modelId: "GOL_V2", improved: true } }
  });
  assert.equal(gate.anyPromotable, false);
  assert.ok(gate.candidates.every((item) => ["EXPERIMENTAL", "REJECTED", "PROMOTABLE"].includes(item.state)));
});

test("shadow multirrodada e formacao calculam agregados sem vazamento posterior na escolha", () => {
  const rounds = [{
    round: 2,
    predictions: [
      player(1, 1, 5, 3), player(2, 2, 5, 3), player(3, 2, 4, 2), player(4, 3, 4, 8), player(5, 3, 3, 7),
      player(6, 4, 6, 2), player(7, 4, 5, 2), player(8, 4, 4, 9), player(9, 5, 7, 4), player(10, 5, 6, 6),
      player(11, 5, 5, 5), player(12, 6, 5, 3)
    ]
  }];
  const shadow = summarizeShadowAcrossRounds(rounds);
  const formations = formationAccuracy(rounds);
  assert.equal(shadow.GOL.roundsEvaluated, 1);
  assert.equal(formations.roundsEvaluated, 1);
  assert.ok(["4-3-3", "4-4-2", "4-5-1", "3-4-3", "3-5-2", "5-3-2"].includes(formations.rounds[0].recommendedFormation));
});

test("endpoint /research/multi-round-calibration le artefato persistido", async () => {
  const researchRepository = new ResearchRepository({ baseDir: tempDir("research-multi-round-") });
  researchRepository.writeJson(2026, "multi-round-calibration.json", {
    schemaVersion: "multi-round-calibration-research/v1",
    promotionGate: { anyPromotable: false }
  });
  const app = createApp({ fetchImpl: fetch, researchRepository });
  const response = await request(app, "/research/multi-round-calibration");
  assert.equal(response.status, 200);
  assert.equal(response.body.schemaVersion, "multi-round-calibration-research/v1");
});
