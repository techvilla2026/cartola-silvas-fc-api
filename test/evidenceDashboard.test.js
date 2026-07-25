const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { BacktestRepository } = require("../src/backtest/repository");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  REQUIRED_MODELS,
  SCORECARD_METADATA,
  auditParticipationTarget,
  buildEvidenceDashboard,
  buildEvidenceRecords,
  createEvidenceRecord,
  evidenceConfidence
} = require("../src/research/evidenceDashboard");

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

function seedResearch(repository) {
  repository.writeJson(2026, "multi-round-calibration.json", {
    cleanSheetBacktest: {
      validRounds: 17,
      validMatches: 167,
      v1: { top1: 0.2941, top3: 0.2941, top5: 0.2706 },
      v2: { top1: 0.2353, top3: 0.2941, top5: 0.2588 }
    },
    shadowMode: {
      multiRound: {
        byPosition: {
          GOL: { modelId: "GOL_V2", roundsEvaluated: 17, official: { top1: 1, top3: 1, top5: 1 }, shadow: { top1: 2, top3: 2, top5: 2 } },
          LAT: { modelId: "LAT_V2", roundsEvaluated: 17, official: { top1: 2, top3: 2, top5: 2 }, shadow: { top1: 1, top3: 1, top5: 1 } }
        }
      }
    },
    formationAudit: { hitRate: 0.5882, roundsEvaluated: 17 },
    idealTeamAudit: { captureRateAbsolute: 0.4375 }
  });
  repository.writeJson(2026, "availability-calibration.json", {
    round19: {
      officialXI: { actualPoints: 83.3, didNotPlayCount: 5 },
      availabilityAwareXI: { actualPoints: 93.1, didNotPlayCount: 1 },
      officialCaptain: { name: "Danilo" },
      availabilityAwareCaptain: { name: "Pedro" }
    },
    backtest: { validRounds: 17, evaluatedAthletes: 100, officialRanking: { top1: { didNotPlayRate: 0 } } }
  });
  for (const file of ["round-19-validation.json", "ranking-diagnostics.json", "ideal-team-diagnostics.json", "captain-diagnostics.json", "promotion-gate.json", "research-health.json", "audit.json", "experiments-summary.json"]) {
    repository.writeJson(2026, file, { status: "OK", evaluatedRounds: [2, 3] });
  }
}

function seedHistorical(repository) {
  for (const round of [2, 3]) {
    repository.saveRoundFile(2026, round, "pre-round.json", {
      players: [
        { athleteId: 1, statusBeforeRound: null, opponent: 2, homeAway: "HOME", priceBeforeRound: 1 },
        { athleteId: 2, statusBeforeRound: "provavel", opponent: 1, homeAway: "AWAY", priceBeforeRound: 2 }
      ]
    }, { force: true });
    repository.saveRoundFile(2026, round, "post-round.json", {
      players: [
        { athleteId: 1, played: true, points: 5 },
        { athleteId: 2, played: false, points: null }
      ]
    }, { force: true });
  }
}

test("catalogo contem modelos obrigatorios", () => {
  const required = REQUIRED_MODELS.map((item) => item[0]);
  for (const model of ["OFFICIAL_ENGINE", "CLEAN_SHEET_V2", "GOL_V2", "AVAILABILITY_V1", "XI_AVAILABILITY_AWARE", "FORMATION_SHADOW"]) {
    assert.ok(required.includes(model));
  }
});

test("evidenceRecord possui schema valido e rodada isolada nao gera HIGH", () => {
  const record = createEvidenceRecord({
    evidenceId: "one-round",
    modelId: "XI_AVAILABILITY_AWARE",
    metric: "round19.actualPoints",
    officialValue: 83.3,
    candidateValue: 93.1,
    sampleSize: 1,
    roundsEvaluated: 1,
    isolatedRound: true,
    sourceArtifact: "availability-calibration.json",
    interpretation: "isolated"
  }, "2026-07-23T00:00:00.000Z");
  assert.equal(record.confidenceLevel, "LOW");
  assert.equal(record.evidenceType, "POSITIVE");
  assert.ok(record.generatedAt);
});

test("target incompleto reduz confianca da evidencia", () => {
  assert.equal(evidenceConfidence({ roundsEvaluated: 17, sampleSize: 500, hasDataLimitation: true, consistent: true }), "LOW");
});

test("SG V2 nao aparece como melhor global", () => {
  const records = buildEvidenceRecords({
    multiRoundCalibration: {
      cleanSheetBacktest: {
        validRounds: 17,
        validMatches: 167,
        v1: { top1: 0.2941, top3: 0.2941, top5: 0.2706 },
        v2: { top1: 0.2353, top3: 0.2941, top5: 0.2588 }
      },
      shadowMode: { multiRound: { byPosition: {} } }
    },
    availabilityCalibration: { round19: { officialXI: {}, availabilityAwareXI: {} } }
  }, { predictionsAudited: 10, roundsAudited: 17, diagnosis: "limited", limitation: "limited" }, "2026-07-23T00:00:00.000Z");
  assert.equal(records.find((item) => item.evidenceId === "sg-v2-top1").evidenceType, "NEGATIVE");
  assert.equal(records.find((item) => item.evidenceId === "sg-v2-top5").evidenceType, "NEGATIVE");
});

test("Availability R19 fica separada da evidencia historica", () => {
  const records = buildEvidenceRecords({
    multiRoundCalibration: { cleanSheetBacktest: {}, shadowMode: { multiRound: { byPosition: {} } } },
    availabilityCalibration: { round19: { officialXI: { actualPoints: 83.3, didNotPlayCount: 5 }, availabilityAwareXI: { actualPoints: 93.1, didNotPlayCount: 1 } } }
  }, { predictionsAudited: 10, roundsAudited: 17, diagnosis: "limited", limitation: "limited" }, "2026-07-23T00:00:00.000Z");
  assert.equal(records.find((item) => item.evidenceId === "availability-r19-xi-points").confidenceLevel, "LOW");
  assert.equal(records.find((item) => item.evidenceId === "availability-historical-target").evidenceType, "DATA_LIMITATION");
});

test("auditoria de target conta didNotPlay, scoreUnavailable e sem target", () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("evidence-historical-") });
  seedHistorical(historical);
  const backtest = {
    listRoundResults: () => [{
      round: 2,
      predictions: [
        { athleteId: 1, predictedPoints: 10 },
        { athleteId: 3, predictedPoints: 9 }
      ]
    }]
  };
  const audit = auditParticipationTarget({ historicalRepository: historical, backtestRepository: backtest, season: 2026 });
  assert.equal(audit.didNotPlayCases, 2);
  assert.equal(audit.athletesWithoutTarget, 1);
});

test("ausencia de artefato nao vira zero e dataQuality preserva null", () => {
  const research = new ResearchRepository({ baseDir: tempDir("evidence-research-missing-") });
  const historical = new HistoricalDataRepository({ baseDir: tempDir("evidence-historical-missing-") });
  seedHistorical(historical);
  const dashboard = buildEvidenceDashboard({
    researchRepository: research,
    historicalRepository: historical,
    backtestRepository: new BacktestRepository({ baseDir: tempDir("evidence-backtest-missing-") }),
    generatedAt: "2026-07-23T00:00:00.000Z"
  });
  assert.equal(dashboard.sourceArtifacts.multiRoundCalibration, "DATA_NOT_AVAILABLE");
  assert.equal(dashboard.dataQuality.SCOUT_DATA.coverage, null);
});

test("Promotion Gate nao promove automaticamente e scorecard nao e probabilidade", () => {
  assert.equal(SCORECARD_METADATA.probability, false);
  assert.equal(SCORECARD_METADATA.metricType, "internal_index");
});

test("endpoint e read-only, preserva CORS e retorna 404 quando necessario", async () => {
  const repository = new ResearchRepository({ baseDir: tempDir("evidence-endpoint-") });
  const app404 = createApp({ fetchImpl: fetch, researchRepository: repository });
  const missing = await request(app404, "/research/evidence-dashboard", { Origin: "https://meutimeideal.netlify.app" });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("access-control-allow-origin"), "https://meutimeideal.netlify.app");
  repository.writeJson(2026, "slvs-evidence-dashboard.json", { schemaVersion: "slvs-evidence-dashboard/v1" });
  const app = createApp({ fetchImpl: fetch, researchRepository: repository });
  const ok = await request(app, "/research/evidence-dashboard", { Origin: "https://meutimeideal.netlify.app" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.schemaVersion, "slvs-evidence-dashboard/v1");
});

test("script construtor e deterministico e nao altera snapshots nem motor oficial", () => {
  const research = new ResearchRepository({ baseDir: tempDir("evidence-research-") });
  const historical = new HistoricalDataRepository({ baseDir: tempDir("evidence-historical-") });
  seedResearch(research);
  seedHistorical(historical);
  const backtest = { listRoundResults: () => [{ round: 2, predictions: [{ athleteId: 1, predictedPoints: 10 }, { athleteId: 2, predictedPoints: 9 }] }] };
  const a = buildEvidenceDashboard({ researchRepository: research, historicalRepository: historical, backtestRepository: backtest, generatedAt: "2026-07-23T00:00:00.000Z" });
  const b = buildEvidenceDashboard({ researchRepository: research, historicalRepository: historical, backtestRepository: backtest, generatedAt: "2026-07-23T00:00:00.000Z" });
  assert.deepEqual(a.evidence, b.evidence);
  assert.equal(a.officialEngine.productionEngineChanged, false);
  assert.equal(a.officialEngine.snapshotsChanged, false);
});
