const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  TARGET_CLASSIFICATIONS,
  auditJoins,
  auditTopK,
  buildGroundTruthValidation,
  classifyTarget,
  summarizeSelected,
  targetRecord
} = require("../src/research/groundTruthValidation");

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

function seedHistorical(repository) {
  repository.saveRoundFile(2026, 2, "pre-round.json", {
    players: [
      { athleteId: 1, name: "A", clubId: 10, positionId: 5, gamesBeforeRound: 1, eligibleForBacktest: true },
      { athleteId: 2, name: "B", clubId: 10, positionId: 5, gamesBeforeRound: 1, eligibleForBacktest: true },
      { athleteId: 3, name: "C", clubId: 10, positionId: 5, gamesBeforeRound: 1, eligibleForBacktest: true }
    ]
  }, { force: true });
  repository.saveRoundFile(2026, 2, "post-round.json", {
    players: [
      { athleteId: 1, name: "A", clubId: 10, positionId: 5, played: false, points: null, games: 1, scouts: {} },
      { athleteId: 2, name: "B", clubId: 20, positionId: 5, played: true, points: 0, games: 2, scouts: {} },
      { athleteId: 3, name: "C", clubId: 10, positionId: 5, played: true, points: -1.2, games: 2, scouts: { FS: 1 } }
    ]
  }, { force: true });
}

test("classificacoes canonicas nao confundem null, zero e negativo", () => {
  assert.equal(classifyTarget({ prePlayer: {}, postPlayer: { played: true, points: 0 } }).targetClassification, TARGET_CLASSIFICATIONS.DID_PLAY);
  assert.equal(classifyTarget({ prePlayer: {}, postPlayer: { played: true, points: -1 } }).targetClassification, TARGET_CLASSIFICATIONS.DID_PLAY);
  assert.equal(classifyTarget({ prePlayer: {}, postPlayer: { played: false, points: null } }).targetClassification, TARGET_CLASSIFICATIONS.DID_NOT_PLAY);
  assert.equal(classifyTarget({ prePlayer: {}, postPlayer: null }).targetClassification, TARGET_CLASSIFICATIONS.PLAYER_NOT_IN_POST_SNAPSHOT);
  assert.equal(classifyTarget({ prePlayer: null, postPlayer: { points: null } }).targetClassification, TARGET_CLASSIFICATIONS.SCORE_UNAVAILABLE);
});

test("TopK e congelado e left join preserva target null no denominador", () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("gt-hist-") });
  seedHistorical(historical);
  const audit = auditTopK({
    season: 2026,
    historicalRepository: historical,
    generatedAt: "2026-07-23T00:00:00.000Z",
    roundResult: {
      round: 2,
      predictions: [
        { athleteId: 4, name: "Missing", clubId: 10, positionId: 5, predictedPoints: 12 },
        { athleteId: 1, name: "A", clubId: 10, positionId: 5, predictedPoints: 10 },
        { athleteId: 2, name: "B", clubId: 10, positionId: 5, predictedPoints: 9 }
      ],
      selectedTeam: [],
      captain: null
    }
  });
  const top3 = audit.byPosition[5].top3.metrics;
  assert.equal(top3.selectedCount, 3);
  assert.equal(top3.targetMissingCount, 1);
  assert.equal(top3.didNotPlayCount, 1);
});

test("didNotPlay, scoreUnavailable, targetMissing e ambiguous permanecem separados", () => {
  const rows = [
    { targetClassification: TARGET_CLASSIFICATIONS.DID_NOT_PLAY },
    { targetClassification: TARGET_CLASSIFICATIONS.SCORE_UNAVAILABLE },
    { targetClassification: TARGET_CLASSIFICATIONS.PLAYER_NOT_IN_POST_SNAPSHOT },
    { targetClassification: TARGET_CLASSIFICATIONS.TARGET_AMBIGUOUS }
  ];
  const summary = summarizeSelected(rows);
  assert.equal(summary.didNotPlayCount, 1);
  assert.equal(summary.scoreUnavailableCount, 1);
  assert.equal(summary.targetMissingCount, 1);
  assert.equal(summary.targetAmbiguousCount, 1);
});

test("associacao usa athleteId e preserva transferencia de clube", () => {
  const joins = auditJoins(
    [{ athleteId: 1, name: "Mesmo Nome", clubId: 10 }, { athleteId: 2, name: "X", clubId: 10 }],
    [{ athleteId: 1, name: "Outro Nome", clubId: 20 }]
  );
  assert.equal(joins.find((item) => item.athleteId === 1).joinStatus, "MATCHED_WITH_CLUB_CHANGE");
  assert.equal(joins.find((item) => item.athleteId === 2).joinStatus, "POST_RECORD_MISSING");
});

test("games delta e scouts sao evidencia complementar", () => {
  const record = targetRecord({
    season: 2026,
    round: 2,
    generatedAt: "2026-07-23T00:00:00.000Z",
    prePlayer: { athleteId: 1, gamesBeforeRound: 1, eligibleForBacktest: true },
    postPlayer: { athleteId: 1, played: true, points: -1, games: 2, scouts: { FS: 1 } }
  });
  assert.equal(record.gamesDelta, 1);
  assert.equal(record.scoutsState, "SCOUTS_WITH_EVENT");
  assert.equal(record.targetClassification, TARGET_CLASSIFICATIONS.DID_PLAY);
});

test("buildGroundTruthValidation e deterministico e nao promove modelo", () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("gt-build-hist-") });
  seedHistorical(historical);
  const research = new ResearchRepository({ baseDir: tempDir("gt-research-") });
  research.writeJson(2026, "availability-calibration.json", { round19: { cases: {} } });
  const backtest = { listRoundResults: () => [{ round: 2, predictions: [{ athleteId: 1, positionId: 5, predictedPoints: 10 }], selectedTeam: [], captain: null }] };
  const live = { readManifest: () => null, readSnapshot: () => null };
  const a = buildGroundTruthValidation({ historicalRepository: historical, researchRepository: research, backtestRepository: backtest, liveSnapshotRepository: live, generatedAt: "2026-07-23T00:00:00.000Z" });
  const b = buildGroundTruthValidation({ historicalRepository: historical, researchRepository: research, backtestRepository: backtest, liveSnapshotRepository: live, generatedAt: "2026-07-23T00:00:00.000Z" });
  assert.deepEqual(a.validation.legacyVsAudited, b.validation.legacyVsAudited);
  assert.equal(a.validation.conclusions.promotionStateChanged, false);
});

test("endpoints ground truth sao read-only, preservam CORS e retornam 404", async () => {
  const repository = new ResearchRepository({ baseDir: tempDir("gt-endpoint-") });
  const app404 = createApp({ fetchImpl: fetch, researchRepository: repository });
  const missing = await request(app404, "/research/ground-truth-validation", { Origin: "https://meutimeideal.netlify.app" });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("access-control-allow-origin"), "https://meutimeideal.netlify.app");
  repository.writeJson(2026, "ground-truth-validation.json", { schemaVersion: "ground-truth-validation/v1" });
  repository.writeJson(2026, "ground-truth-topk-audit.json", { schemaVersion: "ground-truth-topk-audit/v1" });
  const app = createApp({ fetchImpl: fetch, researchRepository: repository });
  assert.equal((await request(app, "/research/ground-truth-validation")).status, 200);
  assert.equal((await request(app, "/research/ground-truth-topk-audit")).status, 200);
});
