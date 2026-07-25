const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  PARTICIPATION_RELIABILITY_METADATA,
  adjustedScore,
  availabilityDataQuality,
  buildParticipationHistoryForRound,
  buildPromotionGate,
  buildRoundEvaluation,
  classifyAvailabilityError,
  enrichWithAvailability,
  participationFeaturesForPlayer,
  participationReliability,
  rankAvailabilityAware
} = require("../src/research/availabilityCalibration");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function player(id, positionId, predictedPoints, actualPoints = 1, extra = {}) {
  return {
    athleteId: id,
    name: `P${id}`,
    clubId: 260,
    positionId,
    predictedPoints,
    actualPoints,
    gamesBeforeRound: 3,
    statusBeforeRound: null,
    homeAway: "HOME",
    opponent: 300,
    eligibleForBacktest: true,
    ...extra
  };
}

function request(app, pathname) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      fetch(`http://127.0.0.1:${server.address().port}${pathname}`)
        .then(async (response) => {
          const body = await response.json();
          server.close(() => resolve({ status: response.status, body }));
        })
        .catch((error) => server.close(() => reject(error)));
    });
  });
}

test("rodada N usa somente participacao ate N-1", () => {
  const repository = new HistoricalDataRepository({ baseDir: tempDir("availability-history-") });
  repository.saveRoundFile(2026, 1, "post-round.json", { players: [{ athleteId: 10, played: true, points: 5 }] }, { force: true });
  repository.saveRoundFile(2026, 2, "post-round.json", { players: [{ athleteId: 10, played: false, points: null }] }, { force: true });
  repository.saveRoundFile(2026, 3, "post-round.json", { players: [{ athleteId: 10, played: false, points: null }] }, { force: true });
  const history = buildParticipationHistoryForRound(repository, 2026, 3).get(10);
  assert.deepEqual(history.map((item) => item.round), [1, 2]);
});

test("didPlayActual nunca entra como feature pre-jogo", () => {
  const p = player(1, 5, 8, null);
  const enriched = enrichWithAvailability({ ...p, enteredField: false }, [{ round: 1, played: true }, { round: 2, played: true }]);
  assert.equal(enriched.didPlayActual, false);
  assert.equal(Object.hasOwn(enriched.participationFeatures, "didPlayActual"), false);
  assert.equal(Object.hasOwn(enriched.participationFeatures, "didNotPlayActual"), false);
});

test("null nao vira baixa confiabilidade e estreante fica INSUFFICIENT_DATA", () => {
  const result = participationReliability(player(1, 5, 7), participationFeaturesForPlayer(player(1, 5, 7), []));
  assert.equal(result.availabilityConfidence, "INSUFFICIENT_DATA");
  assert.equal(result.participationReliabilityScore, 50);
});

test("participationReliabilityScore e deterministico e metadata nao e probabilidade", () => {
  const p = player(1, 5, 7, 4);
  const history = [{ played: true }, { played: true }, { played: false }, { played: true }];
  const a = enrichWithAvailability(p, history);
  const b = enrichWithAvailability(p, history);
  assert.equal(a.participationReliabilityScore, b.participationReliabilityScore);
  assert.equal(PARTICIPATION_RELIABILITY_METADATA.metricType, "internal_index");
  assert.equal(PARTICIPATION_RELIABILITY_METADATA.probability, false);
});

test("status pre-rodada influencia quando disponivel", () => {
  const history = [{ played: true }, { played: false }, { played: true }];
  const withoutStatus = enrichWithAvailability(player(1, 5, 6), history);
  const withStatus = enrichWithAvailability(player(1, 5, 6, 1, { statusBeforeRound: "provavel" }), history);
  assert.ok(withStatus.participationReliabilityScore > withoutStatus.participationReliabilityScore);
});

test("recentParticipationRate e consecutiveDidNotPlay sao calculados", () => {
  const features = participationFeaturesForPlayer(player(1, 4, 6), [
    { played: true },
    { played: false },
    { played: false }
  ]);
  assert.equal(features.recentParticipationRate, 0.3333);
  assert.equal(features.consecutiveDidNotPlay, 2);
});

test("Shadow ranking penaliza baixa disponibilidade sem excluir automaticamente", () => {
  const highRisk = enrichWithAvailability(player(1, 5, 9, null, { enteredField: false }), [{ played: false }, { played: false }, { played: false }]);
  const reliable = enrichWithAvailability(player(2, 5, 7, 8), [{ played: true }, { played: true }, { played: true }]);
  const ranked = rankAvailabilityAware([highRisk, reliable], 2);
  assert.equal(ranked[0].athleteId, 2);
  assert.equal(Number.isFinite(adjustedScore(highRisk)), true);
});

test("Shadow captain e Shadow XI reduzem risco usando sinais pre-rodada", () => {
  const round = buildRoundEvaluation({
    round: 4,
    predictions: [
      player(1, 1, 4, 4), player(2, 2, 4, 4), player(3, 2, 4, 4), player(4, 3, 4, 4), player(5, 3, 4, 4),
      player(6, 4, 10, null), player(7, 4, 7, 7), player(8, 4, 6, 6), player(9, 5, 8, 8), player(10, 5, 7, 7),
      player(11, 5, 6, 6)
    ],
    selectedTeam: null
  }, {
    listRounds: () => [1, 2, 3],
    readRoundFile: () => ({ players: [
      { athleteId: 6, played: false }, { athleteId: 7, played: true }, { athleteId: 8, played: true }, { athleteId: 9, played: true },
      { athleteId: 10, played: true }, { athleteId: 11, played: true }, { athleteId: 1, played: true }, { athleteId: 2, played: true },
      { athleteId: 3, played: true }, { athleteId: 4, played: true }, { athleteId: 5, played: true }
    ] })
  }, 2026);
  assert.equal(round.availabilityAwareCaptain.athleteId, 9);
  assert.ok(round.availabilityAwareXI.didNotPlayCount <= round.officialXI.didNotPlayCount);
});

test("classificacao de erro e promotion gate preservam estados", () => {
  const low = enrichWithAvailability(player(1, 5, 8, null, { enteredField: false }), [{ played: false }, { played: false }]);
  assert.equal(classifyAvailabilityError(low), "PREDICTABLE_AVAILABILITY_ERROR");
  const gate = buildPromotionGate({
    validRounds: 17,
    xi: {
      officialAverageActualPoints: 50,
      availabilityAwareAverageActualPoints: 49,
      officialAverageDidNotPlayCount: 2,
      availabilityAwareAverageDidNotPlayCount: 1
    }
  });
  assert.equal(gate.promoted, false);
  assert.ok(["REJECTED", "EXPERIMENTAL", "PROMOTABLE"].includes(gate.state));
});

test("availabilityDataQuality separa ausencia de historico de baixa confiabilidade", () => {
  const quality = availabilityDataQuality({ sampleSize: 0 });
  assert.equal(quality.state, "INSUFFICIENT_HISTORY");
});

test("endpoint /research/availability-calibration le artefato persistido", async () => {
  const repository = new ResearchRepository({ baseDir: tempDir("availability-research-") });
  repository.writeJson(2026, "availability-calibration.json", {
    schemaVersion: "availability-calibration-research/v1",
    promotionGate: { promoted: false }
  });
  const app = createApp({ fetchImpl: fetch, researchRepository: repository });
  const response = await request(app, "/research/availability-calibration");
  assert.equal(response.status, 200);
  assert.equal(response.body.schemaVersion, "availability-calibration-research/v1");
});
