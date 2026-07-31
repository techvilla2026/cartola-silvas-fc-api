const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { fetchCartolaJson } = require("../liveSnapshot/services/cartolaClient");
const {
  PreMatchAvailabilityRepository,
  buildCaptureStatus
} = require("./preMatchAvailabilitySource");

const PROJECT_VERSION = "5.2.13";
const PERSISTENCE_STRATEGY = "GITHUB_COMMIT_RESTRICTED";
const FIRST_PROSPECTIVE_ROUND = 20;
const NORMAL_REASON_CODES = new Set([
  "CAPTURE_CREATED",
  "ALREADY_CAPTURED",
  "OUTSIDE_CAPTURE_WINDOW",
  "ROUND_NOT_READY"
]);
const FAILURE_REASON_CODES = new Set([
  "SOURCE_UNAVAILABLE",
  "TEMPORAL_VALIDATION_FAILED",
  "MISSED_CAPTURE"
]);

function exactlyTrue(value) {
  return String(value || "").trim() === "true";
}

function deadlineFromMarketStatus(body) {
  const timestamp = Number(body?.fechamento?.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp * 1000).toISOString();
}

function missedProspectiveRounds({ season = 2026, currentRound, repository = new PreMatchAvailabilityRepository() } = {}) {
  if (!Number.isInteger(Number(currentRound)) || Number(currentRound) <= FIRST_PROSPECTIVE_ROUND) return [];
  const capturedRounds = new Set(repository.listSnapshots(season).map((snapshot) => Number(snapshot.round)));
  const missed = [];
  for (let round = FIRST_PROSPECTIVE_ROUND; round < Number(currentRound); round += 1) {
    if (!capturedRounds.has(round)) missed.push(round);
  }
  return missed;
}

async function resolveCurrentCaptureStatus({
  season = 2026,
  round = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  repository = new PreMatchAvailabilityRepository(),
  currentTime = new Date().toISOString()
} = {}) {
  if (round) {
    const snapshot = repository.latestSnapshot(season, Number(round));
    const status = buildCaptureStatus({
      season,
      round: Number(round),
      deadline: snapshot?.roundDeadline || null,
      currentTime,
      repository
    });
    return {
      ...status,
      statusSource: "EXPLICIT_ROUND_LOCAL_SNAPSHOT",
      missedProspectiveRounds: missedProspectiveRounds({ season, currentRound: Number(round), repository })
    };
  }

  try {
    const marketStatus = await fetchCartolaJson({ fetchImpl, endpoint: "/mercado/status", timeoutMs });
    const currentRound = Number(marketStatus.body?.rodada_atual);
    const deadline = deadlineFromMarketStatus(marketStatus.body);
    const status = buildCaptureStatus({ season, round: currentRound, deadline, currentTime, repository });
    return {
      ...status,
      statusSource: "CARTOLA_MARKET_STATUS_API",
      marketStatus: marketStatus.body?.status_mercado ?? null,
      missedProspectiveRounds: missedProspectiveRounds({ season, currentRound, repository })
    };
  } catch (error) {
    const fallback = buildCaptureStatus({ season, currentTime, repository });
    return {
      ...fallback,
      statusSource: "STALE_LOCAL_FALLBACK",
      sourceError: error.message,
      missedProspectiveRounds: missedProspectiveRounds({ season, currentRound: fallback.currentRound, repository })
    };
  }
}

function buildSchedulerReadiness({ captureStatus, workflowPath, env = process.env } = {}) {
  const workflowPrepared = Boolean(workflowPath && fs.existsSync(workflowPath));
  const workflowText = workflowPrepared ? fs.readFileSync(workflowPath, "utf8") : "";
  const scheduleConfigured = /cron:\s*["']?\*\/30 \* \* \* \*["']?/.test(workflowText);
  const writeEnabled = exactlyTrue(env.PRE_MATCH_CAPTURE_WRITE_ENABLED);
  const persistenceEnabled = exactlyTrue(env.PRE_MATCH_CAPTURE_COMMIT_ENABLED);
  const persistenceReady = workflowPrepared && /research:pre-match:persistence/.test(workflowText);
  const blockingIssues = [];
  if (!workflowPrepared) blockingIssues.push("WORKFLOW_NOT_PREPARED");
  if (!scheduleConfigured) blockingIssues.push("SCHEDULE_NOT_CONFIGURED");
  if (writeEnabled && !persistenceEnabled) blockingIssues.push("WRITE_WITHOUT_PERSISTENCE_BLOCKED");
  if (captureStatus?.statusSource === "STALE_LOCAL_FALLBACK") blockingIssues.push("CURRENT_MARKET_STATUS_UNAVAILABLE");

  let recommendedAction = "KEEP_DRY_RUN_AND_VALIDATE_MANUAL_DISPATCH";
  if (captureStatus?.captureRisk === "CAPTURE_AT_RISK") recommendedAction = "ENABLE_REVIEWED_CAPTURE_BEFORE_DEADLINE";
  if (captureStatus?.captureRisk === "MISSED_CAPTURE") recommendedAction = "RECORD_MISSED_CAPTURE_WITHOUT_RECONSTRUCTION";
  if (writeEnabled && persistenceEnabled && blockingIssues.length === 0) recommendedAction = "READY_FOR_REVIEWED_WRITE";

  return {
    schemaVersion: "pre-match-scheduler-readiness/v1",
    projectVersion: PROJECT_VERSION,
    workflowPrepared,
    scheduleConfigured,
    workflowStatus: "PREPARED_DRY_RUN",
    writeEnabled,
    persistenceStrategy: PERSISTENCE_STRATEGY,
    persistenceEnabled,
    persistenceReady,
    persistenceStatus: persistenceEnabled ? "READY" : "PREPARED_BUT_DISABLED",
    schedulerStatus: writeEnabled && persistenceEnabled ? "READY_FOR_REVIEWED_WRITE" : "READY_FOR_MANUAL_DISPATCH",
    currentRound: captureStatus?.currentRound ?? null,
    deadline: captureStatus?.deadline ?? null,
    currentCaptureStatus: captureStatus?.captureRisk || "UNKNOWN",
    currentPrimaryStatus: captureStatus?.primaryCaptureStatus || "MISSING",
    currentFinalStatus: captureStatus?.finalCaptureStatus || "MISSING",
    captureRisk: captureStatus?.captureRisk || "UNKNOWN",
    missedProspectiveRounds: captureStatus?.missedProspectiveRounds || [],
    blockingIssues,
    recommendedAction
  };
}

function operationalExitCode(reasonCode, captureRisk = "NONE") {
  if (captureRisk === "MISSED_CAPTURE" || reasonCode === "MISSED_CAPTURE") return 2;
  if (reasonCode === "MARKET_CLOSED") return captureRisk === "NONE" ? 0 : 2;
  if (reasonCode === "SOURCE_UNAVAILABLE") return 3;
  if (reasonCode === "TEMPORAL_VALIDATION_FAILED") return 4;
  if (NORMAL_REASON_CODES.has(reasonCode)) return 0;
  if (FAILURE_REASON_CODES.has(reasonCode)) return 2;
  return 1;
}

function normalizeAutomationResult(result, { captureStatus = null, filesChanged = [] } = {}) {
  const captureWindow = ["PRIMARY", "FINAL"].includes(result.captureWindow) ? result.captureWindow : null;
  const captureRisk = captureStatus?.captureRisk || (result.reasonCode === "MARKET_CLOSED" ? "MISSED_CAPTURE" : "NONE");
  const exitCode = operationalExitCode(result.reasonCode, captureRisk);
  return {
    schemaVersion: "pre-match-auto-capture-machine-result/v1",
    ok: exitCode === 0,
    reasonCode: result.reasonCode || "UNEXPECTED_ERROR",
    actionTaken: result.actionTaken || "NONE",
    round: result.round ?? captureStatus?.currentRound ?? null,
    deadline: result.deadline ?? captureStatus?.deadline ?? null,
    currentTime: result.currentTime ?? captureStatus?.currentTime ?? null,
    minutesToDeadline: result.minutesToDeadline ?? captureStatus?.minutesToDeadline ?? null,
    captureWindow,
    captureType: captureWindow,
    captureId: result.captureId || result.existingCaptureId || null,
    fingerprint: result.fingerprint || null,
    existingPrimary: captureStatus?.primaryCaptureStatus === "CAPTURED",
    existingFinal: captureStatus?.finalCaptureStatus === "CAPTURED",
    coverage: captureStatus?.coverage || null,
    captureRisk,
    nextRecommendedAction: captureStatus?.nextRecommendedAction || null,
    filesChanged: [...new Set(filesChanged)].sort(),
    exitCode
  };
}

function gitChangedFiles(cwd = process.cwd()) {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd, encoding: "utf8" });
    return output.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

function allowedPersistencePath(filePath, season = 2026) {
  const normalized = String(filePath).replace(/\\/g, "/");
  return normalized.startsWith(`data/research/${season}/pre-match-availability/`)
    || normalized === `data/research/${season}/prospective-availability-controls.json`;
}

function validatePersistenceChanges({ filesChanged, season = 2026, commitEnabled = false } = {}) {
  const changed = [...new Set(filesChanged || [])].sort();
  const allowed = changed.filter((file) => allowedPersistencePath(file, season));
  const unexpected = changed.filter((file) => !allowedPersistencePath(file, season));
  let persistenceStatus = "PERSISTENCE_DISABLED";
  if (commitEnabled && unexpected.length) persistenceStatus = "UNEXPECTED_FILE_CHANGE";
  else if (commitEnabled && allowed.length) persistenceStatus = "READY_TO_COMMIT";
  else if (commitEnabled) persistenceStatus = "NO_CHANGES";
  return {
    schemaVersion: "pre-match-persistence-validation/v1",
    persistenceStrategy: PERSISTENCE_STRATEGY,
    persistenceEnabled: Boolean(commitEnabled),
    persistenceStatus,
    allowedFiles: allowed,
    unexpectedFiles: unexpected,
    commitAllowed: Boolean(commitEnabled) && allowed.length > 0 && unexpected.length === 0
  };
}

module.exports = {
  FIRST_PROSPECTIVE_ROUND,
  PERSISTENCE_STRATEGY,
  PROJECT_VERSION,
  allowedPersistencePath,
  buildSchedulerReadiness,
  deadlineFromMarketStatus,
  exactlyTrue,
  gitChangedFiles,
  missedProspectiveRounds,
  normalizeAutomationResult,
  operationalExitCode,
  resolveCurrentCaptureStatus,
  validatePersistenceChanges
};
