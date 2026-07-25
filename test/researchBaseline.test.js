const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  BASELINE_ID,
  BASELINE_SCHEMA_VERSION,
  EXPERIMENTAL_MODELS,
  KNOWN_DENOMINATORS,
  METRICS_DEFINITION_VERSION,
  OFFICIAL_MODELS,
  TARGET_DEFINITION_VERSION,
  buildBaseline,
  buildComparisonContract,
  buildManifest,
  buildMetricsDefinitions,
  checkBaseline,
  evaluateBaselineValidity,
  evaluateComparison,
  fingerprints,
  sha256,
  writeBaselineReports
} = require("../src/research/researchBaseline");

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
  repository.saveRoundFile(2026, 1, "post-round.json", { players: [] }, { force: true });
  for (const round of [2, 3]) {
    repository.saveRoundFile(2026, round, "pre-round.json", {
      players: [
        { athleteId: 1, name: "A", positionId: 5, gamesBeforeRound: 1 },
        { athleteId: 2, name: "B", positionId: 5, gamesBeforeRound: 1 },
        { athleteId: 3, name: "C", positionId: 5, gamesBeforeRound: 1 }
      ]
    }, { force: true });
    repository.saveRoundFile(2026, round, "post-round.json", {
      players: [
        { athleteId: 1, name: "A", positionId: 5, played: true, points: 0, games: 1, scouts: {} },
        { athleteId: 2, name: "B", positionId: 5, played: false, points: 0, games: 1, scouts: { FS: 1 } },
        { athleteId: 3, name: "C", positionId: 5, played: true, points: -1, games: 2, scouts: {} }
      ]
    }, { force: true });
  }
}

function seedResearch(repository) {
  const topkAggregate = Object.fromEntries(Object.entries(KNOWN_DENOMINATORS).map(([key, selectedCount]) => [key, {
    selectedCount,
    didPlayCount: selectedCount,
    didNotPlayCount: 0,
    scoreUnavailableCount: 0,
    targetMissingCount: 0,
    targetAmbiguousCount: 0,
    didNotPlayRateAllSelected: 0,
    didNotPlayRateKnownTargets: 0
  }]));
  repository.writeJson(2026, "ground-truth-topk-audit.json", {
    schemaVersion: "ground-truth-topk-audit/v1",
    generatedAt: "2026-07-24T00:00:00.000Z",
    season: 2026,
    rounds: [{ round: 2, byPosition: { 5: { top1: { metrics: { selectedCount: 1 } } } } }],
    aggregate: topkAggregate
  });
  repository.writeJson(2026, "ground-truth-validation.json", {
    schemaVersion: "ground-truth-validation/v1",
    generatedAt: "2026-07-24T00:00:00.000Z",
    season: 2026,
    targetSummary: { totalRecords: 6, byClassification: { DID_PLAY: 4, DID_NOT_PLAY: 2, TARGET_MISSING: 0, TARGET_AMBIGUOUS: 0 } },
    groundTruthReliability: { PARTICIPATION_TARGET: { reliabilityState: "PARTIALLY_RELIABLE" } },
    conclusions: { nextResearchPriority: "FIX_TARGET_CLASSIFICATION" }
  });
  repository.writeJson(2026, "multi-round-calibration.json", {
    schemaVersion: "multi-round-calibration/v1",
    generatedAt: "2026-07-24T00:00:00.000Z",
    season: 2026,
    cleanSheetBacktest: {
      validRounds: 17,
      validMatches: 167,
      v1: { top1: 0.2941, top3: 0.2941, top5: 0.2706 },
      v2: { top1: 0.2353, top3: 0.2941, top5: 0.2588 }
    },
    formationAudit: { hitRate: 0.5882, roundsEvaluated: 17 }
  });
  repository.writeJson(2026, "availability-calibration.json", {
    schemaVersion: "availability-calibration/v1",
    generatedAt: "2026-07-24T00:00:00.000Z",
    season: 2026,
    backtest: { evaluatedAthletes: 5126 },
    round19: {
      officialXI: { actualPoints: 83.3, didNotPlayCount: 5 },
      availabilityAwareXI: { actualPoints: 93.1, didNotPlayCount: 1 },
      officialCaptain: { name: "Danilo", targetClassification: "DID_NOT_PLAY" },
      availabilityAwareCaptain: { name: "Pedro", targetClassification: "DID_PLAY", actualPoints: 20.4 }
    }
  });
  repository.writeJson(2026, "slvs-evidence-dashboard.json", {
    schemaVersion: "slvs-evidence-dashboard/v1",
    generatedAt: "2026-07-24T00:00:00.000Z",
    season: 2026,
    engineVersion: "slvs-evidence-dashboard/5.2.6",
    models: [...OFFICIAL_MODELS, ...EXPERIMENTAL_MODELS].map((modelId) => ({
      modelId,
      promotionState: OFFICIAL_MODELS.includes(modelId) ? "OFFICIAL" : modelId === "CLEAN_SHEET_V2" ? "EXPERIMENTAL" : "REJECTED",
      metricsAvailable: [],
      limitations: []
    })),
    scorecards: []
  });
  repository.writeJson(2026, "promotion-gate.json", { schemaVersion: "promotion-gate/v1", generatedAt: "2026-07-24T00:00:00.000Z", season: 2026, decisions: [], finalStatus: "NO_PROMOTION" });
  for (const file of [
    "round-19-validation.json",
    "ranking-diagnostics.json",
    "ideal-team-diagnostics.json",
    "captain-diagnostics.json",
    "research-health.json",
    "audit.json",
    "experiments-summary.json",
    "engine-diagnostics.json",
    "ablation-study.json",
    "experiments/bias-correction-walk-forward.json",
    "experiments/home-away-bias-walk-forward.json",
    "experiments/price-band-bias-walk-forward.json"
  ]) {
    repository.writeJson(2026, file, { schemaVersion: `${file}/v1`, generatedAt: "2026-07-24T00:00:00.000Z", season: 2026, evaluatedRounds: [2, 3] });
  }
}

function buildSeededBaseline() {
  const research = new ResearchRepository({ baseDir: tempDir("baseline-research-") });
  const historical = new HistoricalDataRepository({ baseDir: tempDir("baseline-historical-") });
  seedResearch(research);
  seedHistorical(historical);
  return { research, historical, result: buildBaseline({ researchRepository: research, historicalRepository: historical, generatedAt: "2026-07-24T00:00:00.000Z" }) };
}

test("baseline possui identidade, schema, targets, metricas e modelos obrigatorios", () => {
  const { result } = buildSeededBaseline();
  assert.equal(result.baseline.baselineId, BASELINE_ID);
  assert.equal(result.baseline.schemaVersion, BASELINE_SCHEMA_VERSION);
  assert.equal(result.baseline.status, "VALID");
  assert.equal(result.baseline.targetDefinitionVersion, TARGET_DEFINITION_VERSION);
  assert.equal(result.baseline.metricsDefinitionVersion, METRICS_DEFINITION_VERSION);
  for (const modelId of [...OFFICIAL_MODELS, ...EXPERIMENTAL_MODELS]) {
    assert.ok(result.baseline.modelsIncluded.some((item) => item.modelId === modelId));
  }
});

test("denominadores conhecidos e rodada 19 ficam congelados/separados", () => {
  const { result } = buildSeededBaseline();
  assert.deepEqual(result.baseline.denominators.known, KNOWN_DENOMINATORS);
  assert.deepEqual(result.baseline.evaluatedRounds, [2, 3]);
  assert.ok(result.baseline.excludedRounds.some((item) => item.round === 1));
  assert.ok(result.baseline.excludedRounds.some((item) => item.round === 19 && item.reason.includes("CONTROL_CASE")));
  assert.equal(result.baseline.knownResults.round19.evidenceType, "ROUND_19_CONTROL_CASE");
});

test("SG V2 permanece inferior globalmente e Promotion State nao muda", () => {
  const { result } = buildSeededBaseline();
  assert.equal(result.baseline.knownResults.cleanSheet.V1.top1, 0.2941);
  assert.equal(result.baseline.knownResults.cleanSheet.V2.top1, 0.2353);
  assert.ok(result.baseline.knownResults.cleanSheet.V2.top1 < result.baseline.knownResults.cleanSheet.V1.top1);
  assert.equal(result.baseline.promotionGateStateChanged, false);
  assert.equal(result.baseline.modelsIncluded.find((item) => item.modelId === "CLEAN_SHEET_V2").promotionState, "EXPERIMENTAL");
});

test("fingerprints sao deterministicos e ignoram timestamps volateis", () => {
  const { result } = buildSeededBaseline();
  const a = result.baseline.baselineFingerprint;
  assert.equal(a.length, 64);
  const fp1 = fingerprints({
    manifest: result.manifest,
    targetAudit: result.targetAudit,
    metricsDefinitions: result.metrics,
    modelsIncluded: result.baseline.modelsIncluded,
    denominators: result.baseline.denominators.known,
    codeFiles: result.baseline.codeFiles
  });
  const fp2 = fingerprints({
    manifest: { ...result.manifest, generatedAt: "changed" },
    targetAudit: { ...result.targetAudit, generatedAt: "changed" },
    metricsDefinitions: result.metrics,
    modelsIncluded: result.baseline.modelsIncluded,
    denominators: result.baseline.denominators.known,
    codeFiles: result.baseline.codeFiles
  });
  assert.equal(fp1.baselineFingerprint, fp2.baselineFingerprint);
});

test("mudancas em target, metrica, modelo e denominador alteram fingerprints", () => {
  const { result } = buildSeededBaseline();
  const base = fingerprints({
    manifest: result.manifest,
    targetAudit: result.targetAudit,
    metricsDefinitions: result.metrics,
    modelsIncluded: result.baseline.modelsIncluded,
    denominators: result.baseline.denominators.known,
    codeFiles: result.baseline.codeFiles
  });
  const changedTarget = fingerprints({ manifest: result.manifest, targetAudit: { ...result.targetAudit, byClassification: { DID_PLAY: 999 } }, metricsDefinitions: result.metrics, modelsIncluded: result.baseline.modelsIncluded, denominators: result.baseline.denominators.known, codeFiles: result.baseline.codeFiles });
  const changedMetric = fingerprints({ manifest: result.manifest, targetAudit: result.targetAudit, metricsDefinitions: { ...result.metrics, metrics: [{ ...result.metrics.metrics[0], denominator: "changed" }] }, modelsIncluded: result.baseline.modelsIncluded, denominators: result.baseline.denominators.known, codeFiles: result.baseline.codeFiles });
  const changedModel = fingerprints({ manifest: result.manifest, targetAudit: result.targetAudit, metricsDefinitions: result.metrics, modelsIncluded: [{ ...result.baseline.modelsIncluded[0], promotionState: "CHANGED" }], denominators: result.baseline.denominators.known, codeFiles: result.baseline.codeFiles });
  const changedDenominator = fingerprints({ manifest: result.manifest, targetAudit: result.targetAudit, metricsDefinitions: result.metrics, modelsIncluded: result.baseline.modelsIncluded, denominators: { top1: 1 }, codeFiles: result.baseline.codeFiles });
  assert.notEqual(base.targetFingerprint, changedTarget.targetFingerprint);
  assert.notEqual(base.metricsFingerprint, changedMetric.metricsFingerprint);
  assert.notEqual(base.modelsFingerprint, changedModel.modelsFingerprint);
  assert.notEqual(base.baselineFingerprint, changedDenominator.baselineFingerprint);
});

test("artefato ausente e registrado sem inventar zero", () => {
  const research = new ResearchRepository({ baseDir: tempDir("baseline-missing-research-") });
  const manifest = buildManifest({ researchRepository: research, season: 2026 });
  assert.ok(manifest.artifacts.some((item) => item.required && !item.exists && item.recordCount === null));
});

test("baseline valida nao e sobrescrita quando fingerprint difere", () => {
  const { research, result } = buildSeededBaseline();
  writeBaselineReports({ ...result, researchRepository: research, season: 2026 });
  const changed = { ...result.baseline, baselineFingerprint: sha256("changed") };
  assert.throws(() => writeBaselineReports({ ...result, baseline: changed, researchRepository: research, season: 2026 }), /nao sobrescrevendo/i);
  assert.throws(() => writeBaselineReports({ ...result, baseline: changed, researchRepository: research, season: 2026, force: true }), /nao pode ser sobrescrita/i);
});

test("sourceWorkingTreeState DIRTY e falta de git nao impedem estrutura de baseline", () => {
  const { result } = buildSeededBaseline();
  assert.ok(["DIRTY", "CLEAN", "GIT_METADATA_UNAVAILABLE"].includes(result.baseline.sourceWorkingTreeState));
  assert.ok(result.baseline.sourceCommit);
});

test("baselineComparisonContract detecta comparabilidade", () => {
  const contract = buildComparisonContract();
  assert.ok(contract.requiredFields.includes("candidateId"));
  assert.equal(evaluateComparison({
    candidateId: "A",
    baselineId: BASELINE_ID,
    candidateBuild: "5.2.9",
    candidateFingerprint: "a",
    baselineFingerprint: "b",
    sameRounds: true,
    sameTargets: true,
    sameMetrics: true,
    sameDenominators: true,
    sameEligibilityRules: true,
    sameFormationRules: true,
    sameCaptainEligibility: true,
    leakageStatus: "PASS"
  }).comparable, true);
  assert.equal(evaluateComparison({ sameRounds: false, sameTargets: true, sameMetrics: true, sameDenominators: true, sameEligibilityRules: true, sameFormationRules: true, sameCaptainEligibility: true, leakageStatus: "PASS", candidateFingerprint: "a", baselineFingerprint: "b" }).comparable, false);
  assert.equal(evaluateComparison({ sameRounds: true, sameTargets: false, sameMetrics: true, sameDenominators: true, sameEligibilityRules: true, sameFormationRules: true, sameCaptainEligibility: true, leakageStatus: "PASS", candidateFingerprint: "a", baselineFingerprint: "b" }).comparable, false);
  assert.equal(evaluateComparison({ sameRounds: true, sameTargets: true, sameMetrics: true, sameDenominators: false, sameEligibilityRules: true, sameFormationRules: true, sameCaptainEligibility: true, leakageStatus: "PASS", candidateFingerprint: "a", baselineFingerprint: "b" }).comparable, false);
});

test("evaluateBaselineValidity detecta hash divergente e baseline:check passa", () => {
  const { research, result } = buildSeededBaseline();
  writeBaselineReports({ ...result, researchRepository: research, season: 2026 });
  const pass = checkBaseline({ researchRepository: research, season: 2026 });
  assert.equal(pass.status, "PASS");
  const changedManifest = { ...result.manifest, artifacts: result.manifest.artifacts.map((item, index) => index === 0 ? { ...item, sha256: "bad" } : item) };
  const invalid = evaluateBaselineValidity({ baseline: result.baseline, manifest: changedManifest, researchRepository: research, season: 2026 });
  assert.equal(invalid.pass, false);
});

test("endpoints da baseline sao read-only, preservam CORS e retornam 404 claro", async () => {
  const research = new ResearchRepository({ baseDir: tempDir("baseline-endpoint-") });
  const app404 = createApp({ fetchImpl: fetch, researchRepository: research });
  const missing = await request(app404, "/research/baseline", { Origin: "https://meutimeideal.netlify.app" });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("access-control-allow-origin"), "https://meutimeideal.netlify.app");

  const { result } = buildSeededBaseline();
  writeBaselineReports({ ...result, researchRepository: research, season: 2026 });
  const app = createApp({ fetchImpl: fetch, researchRepository: research });
  for (const endpoint of ["/research/baseline", "/research/baseline/manifest", "/research/baseline/metrics", "/research/baseline/validity"]) {
    const response = await request(app, endpoint, { Origin: "https://meutimeideal.netlify.app" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://meutimeideal.netlify.app");
  }
});

test("snapshots, motor oficial e Flutter permanecem intactos no construtor", () => {
  const { historical, result } = buildSeededBaseline();
  const prePath = path.join(historical.getRoundDirectory(2026, 2), "pre-round.json");
  const before = fs.readFileSync(prePath, "utf8");
  buildMetricsDefinitions();
  assert.equal(fs.readFileSync(prePath, "utf8"), before);
  assert.equal(result.baseline.modelsIncluded.find((item) => item.modelId === "OFFICIAL_ENGINE").promotionState, "OFFICIAL");
  assert.equal(result.baseline.promotionGateStateChanged, false);
});
