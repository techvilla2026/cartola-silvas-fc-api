const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  allowedPersistencePath,
  buildSchedulerReadiness,
  missedProspectiveRounds,
  normalizeAutomationResult,
  operationalExitCode,
  resolveCurrentCaptureStatus,
  validatePersistenceChanges
} = require("../src/research/preMatchScheduler");

const workflowPath = path.resolve(__dirname, "../.github/workflows/research-pre-match-auto-capture.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

test("workflow prospectivo possui dispatch, schedule seguro, concorrencia e timeout", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: "\*\/30 \* \* \* \*"/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: 15/);
});

test("workflow usa Node 22, npm ci e nao possui etapa de deploy", () => {
  assert.match(workflow, /node-version: "22"/);
  assert.match(workflow, /run: npm ci/);
  assert.doesNotMatch(workflow, /name:\s*Deploy/i);
});

test("workflow deixa escrita e persistencia falsas por padrao", () => {
  assert.match(workflow, /PRE_MATCH_CAPTURE_WRITE_ENABLED:.*\|\| 'false'/);
  assert.match(workflow, /PRE_MATCH_CAPTURE_COMMIT_ENABLED:.*\|\| 'false'/);
  assert.match(workflow, /--dry-run --json/);
});

test("workflow nunca usa staging amplo", () => {
  assert.doesNotMatch(workflow, /git add \.(?:\s|$)/);
  assert.doesNotMatch(workflow, /git add -A/);
  assert.match(workflow, /git add -- "data\/research\/\$SEASON\/pre-match-availability"/);
});

test("allowlist aceita apenas snapshot prospectivo e registry", () => {
  assert.equal(allowedPersistencePath("data/research/2026/pre-match-availability/round-22/capture.json"), true);
  assert.equal(allowedPersistencePath("data/research/2026/prospective-availability-controls.json"), true);
  assert.equal(allowedPersistencePath("server.js"), false);
  assert.equal(allowedPersistencePath("data/research/2026/slvs-evidence-dashboard.json"), false);
});

test("persistencia bloqueia arquivo inesperado e fica desabilitada por padrao", () => {
  const disabled = validatePersistenceChanges({ filesChanged: [], season: 2026, commitEnabled: false });
  assert.equal(disabled.persistenceStatus, "PERSISTENCE_DISABLED");
  assert.equal(disabled.commitAllowed, false);
  const blocked = validatePersistenceChanges({
    filesChanged: ["data/research/2026/pre-match-availability/round-22/x.json", "server.js"],
    season: 2026,
    commitEnabled: true
  });
  assert.equal(blocked.persistenceStatus, "UNEXPECTED_FILE_CHANGE");
  assert.deepEqual(blocked.unexpectedFiles, ["server.js"]);
  assert.equal(blocked.commitAllowed, false);
});

test("persistencia restrita fica pronta somente com mudancas permitidas", () => {
  const result = validatePersistenceChanges({
    filesChanged: [
      "data/research/2026/pre-match-availability/round-22/x.json",
      "data/research/2026/prospective-availability-controls.json"
    ],
    season: 2026,
    commitEnabled: true
  });
  assert.equal(result.persistenceStatus, "READY_TO_COMMIT");
  assert.equal(result.commitAllowed, true);
});

test("exit codes distinguem estados normais, risco e falhas", () => {
  for (const reason of ["CAPTURE_CREATED", "ALREADY_CAPTURED", "OUTSIDE_CAPTURE_WINDOW", "ROUND_NOT_READY"]) {
    assert.equal(operationalExitCode(reason, "NONE"), 0);
  }
  assert.equal(operationalExitCode("MARKET_CLOSED", "NONE"), 0);
  assert.notEqual(operationalExitCode("MARKET_CLOSED", "MISSED_CAPTURE"), 0);
  assert.notEqual(operationalExitCode("SOURCE_UNAVAILABLE", "NONE"), 0);
  assert.notEqual(operationalExitCode("TEMPORAL_VALIDATION_FAILED", "NONE"), 0);
  assert.notEqual(operationalExitCode("MISSED_CAPTURE", "MISSED_CAPTURE"), 0);
});

test("saida machine-readable possui contrato estavel", () => {
  const normalized = normalizeAutomationResult({
    reasonCode: "OUTSIDE_CAPTURE_WINDOW",
    actionTaken: "NONE",
    round: 22,
    deadline: "2026-08-08T18:59:00.000Z",
    currentTime: "2026-07-31T17:00:00.000Z",
    minutesToDeadline: 11639,
    captureWindow: "OUTSIDE"
  }, {
    captureStatus: {
      currentRound: 22,
      primaryCaptureStatus: "MISSING",
      finalCaptureStatus: "MISSING",
      captureRisk: "NONE",
      nextRecommendedAction: "NO_ACTION",
      coverage: null
    },
    filesChanged: []
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.captureWindow, null);
  assert.equal(normalized.captureType, null);
  assert.deepEqual(normalized.filesChanged, []);
  assert.equal(normalized.exitCode, 0);
});

test("auditoria registra R21 perdida sem reconstruir snapshot", () => {
  const repository = { listSnapshots: () => [{ round: 20 }] };
  assert.deepEqual(missedProspectiveRounds({ season: 2026, currentRound: 22, repository }), [21]);
});

test("capture status resolve rodada e deadline atuais pela API", async () => {
  const repository = {
    listSnapshots: (season, round) => round === undefined || round === null || round === 20 ? [{ round: 20 }] : [],
    latestSnapshot: () => null,
    existingCaptureOfType: () => null
  };
  const fetchImpl = async () => new Response(JSON.stringify({
    rodada_atual: 22,
    status_mercado: 1,
    fechamento: { timestamp: 1786215540 }
  }), { status: 200, headers: { "content-type": "application/json" } });
  const status = await resolveCurrentCaptureStatus({
    fetchImpl,
    repository,
    currentTime: "2026-07-31T17:00:00.000Z"
  });
  assert.equal(status.currentRound, 22);
  assert.equal(status.deadline, "2026-08-08T18:59:00.000Z");
  assert.deepEqual(status.missedProspectiveRounds, [21]);
  assert.equal(status.statusSource, "CARTOLA_MARKET_STATUS_API");
});

test("scheduler readiness fica preparado em dry-run e trata riscos", () => {
  const readiness = buildSchedulerReadiness({
    captureStatus: {
      currentRound: 22,
      deadline: "2026-08-08T18:59:00.000Z",
      captureRisk: "CAPTURE_AT_RISK",
      primaryCaptureStatus: "MISSING",
      finalCaptureStatus: "MISSING",
      missedProspectiveRounds: [21],
      statusSource: "CARTOLA_MARKET_STATUS_API"
    },
    workflowPath,
    env: {}
  });
  assert.equal(readiness.workflowPrepared, true);
  assert.equal(readiness.scheduleConfigured, true);
  assert.equal(readiness.writeEnabled, false);
  assert.equal(readiness.persistenceEnabled, false);
  assert.equal(readiness.persistenceReady, true);
  assert.equal(readiness.recommendedAction, "ENABLE_REVIEWED_CAPTURE_BEFORE_DEADLINE");
});

test("gitattributes protege bytes sem alterar snapshots existentes", () => {
  const attributes = fs.readFileSync(path.resolve(__dirname, "../.gitattributes"), "utf8");
  assert.match(attributes, /data\/live-snapshots\/\*\*\/\*\.json -text/);
  assert.match(attributes, /pre-match-availability\/\*\*\/\*\.json -text/);
});
