const { attachIntegrity } = require("../integrity/canonical");
const { auditLiveSnapshots } = require("./audit");
const { captureLivePreRoundSnapshot } = require("./capture");
const { createExecutionId, statusCounters } = require("./execution");
const { compareSnapshots, logicalFingerprint } = require("./fingerprint");
const { evaluateCapturePolicy, SNAPSHOT_ROLES } = require("./schedulePolicy");

function manifestSnapshotAt(manifest, field) {
  const snapshotId = manifest?.[field];
  return snapshotId || null;
}

function buildChangeHistoryEntry(previousSnapshot, currentSnapshot, comparison) {
  return {
    previousSnapshotId: previousSnapshot?.snapshotId || null,
    currentSnapshotId: currentSnapshot.snapshotId,
    capturedAt: currentSnapshot.capturedAt,
    changedPlayers: comparison.changes?.changedPlayers || 0,
    statusChanges: comparison.changes?.statusChanges || 0,
    priceChanges: comparison.changes?.priceChanges || 0,
    predictionChanges: comparison.changes?.predictionChanges || 0,
    idealTeamChanged: Boolean(comparison.changes?.idealTeamChanged),
    captainChanged: Boolean(comparison.changes?.captainChanged),
    viceChanged: Boolean(comparison.changes?.viceChanged),
    matchChanges: comparison.changes?.matchChanges || 0,
    closingChanged: Boolean(comparison.changes?.closingChanged),
    summary: comparison.summary || "Primeiro snapshot da rodada."
  };
}

function safeError(error) {
  return {
    errorCode: error.code || "LIVE_SNAPSHOT_AUTO_FAILED",
    errorMessage: error.message || "Falha ao executar automacao de snapshot."
  };
}

function ensureChangeHistory(repository, season, round) {
  const existingHistory = repository.readChangeHistory(season, round);
  if (existingHistory) return existingHistory;
  const history = {
    schemaVersion: "live-snapshot-change-history/v1",
    season,
    round,
    changes: []
  };
  repository.saveChangeHistory(season, round, history);
  return history;
}

async function runLiveSnapshotAutomation(options) {
  const {
    repository,
    dryRun = false,
    force = false,
    strict = false,
    reason = null,
    now,
    lockTtlMs
  } = options;
  const executionStartedAt = new Date();
  const executionId = options.executionId || createExecutionId(executionStartedAt);
  let lockSeason = Number(options.season || new Date().getUTCFullYear());
  let lockAcquired = false;
  let lockInfo = null;
  let staleLockRecovered = false;

  try {
    lockInfo = repository.acquireAutomationLock({
      season: lockSeason,
      round: options.round || null,
      executionId,
      ttlMs: lockTtlMs,
      now: executionStartedAt
    });
    lockAcquired = lockInfo.acquired;
    staleLockRecovered = Boolean(lockInfo.staleRecovered);

    const nowDate = now ? new Date(now) : new Date();
    const nowFn = () => nowDate;
    const candidateResult = await captureLivePreRoundSnapshot({
      ...options,
      dryRun: true,
      now: nowFn
    });
    let candidate = candidateResult.snapshot;
    lockSeason = candidate.season;
    const manifest = repository.readManifest(candidate.season, candidate.round);
    const previousStatus = repository.readAutomationStatus(candidate.season);
    const previousSnapshotId = manifestSnapshotAt(manifest, "lastValidPreRoundSnapshotId");
    const previousSnapshot = previousSnapshotId
      ? repository.readSnapshot(candidate.season, candidate.round, previousSnapshotId)
      : null;
    const comparison = compareSnapshots(previousSnapshot, candidate);
    let policy = evaluateCapturePolicy({
      marketStatus: candidate.marketStatus,
      capturedAt: candidate.capturedAt,
      marketClosingAt: candidate.marketClosingAt,
      capturePhase: candidate.capturePhase,
      lastSnapshotAt: manifest?.snapshots?.[manifest.snapshots.length - 1]?.capturedAt || null,
      lastValidSnapshotAt: manifest?.snapshots?.findLast?.((item) => item.isValidPreRoundSnapshot)?.capturedAt || null,
      lastLogicalHash: previousSnapshot ? logicalFingerprint(previousSnapshot) : null,
      hasSignificantChange: comparison.hasSignificantChange,
      totalSnapshots: manifest?.totalSnapshots || 0,
      validSnapshots: manifest?.validPreRoundSnapshots || 0
    });

    if (force && candidate.isValidPreRoundSnapshot && !policy.shouldCapture) {
      policy = {
        ...policy,
        shouldCapture: true,
        reason: reason || "MANUAL_FORCE",
        snapshotRole: SNAPSHOT_ROLES.CHECKPOINT
      };
    }

    const baseStatus = {
      schemaVersion: "live-snapshot-automation-status/v1",
      executionId,
      lastRunAt: new Date().toISOString(),
      result: "SKIPPED",
      reason: policy.reason,
      requestedReason: reason,
      round: candidate.round,
      snapshotId: null,
      captured: false,
      skipped: true,
      auditStatus: null,
      nextRecommendedCheckAt: policy.recommendedNextCheckAt,
      marketClosingAt: candidate.marketClosingAt,
      secondsToClosing: policy.secondsToClosing ?? null,
      scheduleWindow: policy.scheduleWindow,
      capturePriority: policy.capturePriority,
      changeSummary: comparison.changes,
      previousSnapshotId,
      currentFingerprint: logicalFingerprint(candidate),
      previousFingerprint: previousSnapshot ? logicalFingerprint(previousSnapshot) : null,
      staleLockRecovered,
      lockReleased: false,
      errorCode: null,
      errorMessage: null
    };

    if (!policy.shouldCapture || dryRun) {
      const status = {
        ...baseStatus,
        result: dryRun && policy.shouldCapture ? "DRY_RUN_CAPTURE_RECOMMENDED" : "SKIPPED",
        skipped: !policy.shouldCapture,
        dryRun
      };
      if (!dryRun) {
        ensureChangeHistory(repository, candidate.season, candidate.round);
        const release = lockAcquired
          ? repository.releaseAutomationLock(lockSeason, executionId)
          : { released: false };
        lockAcquired = false;
        const finalStatus = {
          ...status,
          lockReleased: Boolean(release.released),
          ...statusCounters(previousStatus, status.result, status.lastRunAt)
        };
        repository.saveAutomationStatus(candidate.season, finalStatus);
        return { status: finalStatus, policy, comparison, candidateReport: candidateResult.report };
      }
      return { status, policy, comparison, candidateReport: candidateResult.report };
    }

    candidate = attachIntegrity({
      ...candidate,
      snapshotRole: policy.snapshotRole
    });
    repository.saveSnapshot(candidate);

    const existingHistory = ensureChangeHistory(repository, candidate.season, candidate.round);
    if (previousSnapshot) {
      existingHistory.changes.push({
        ...buildChangeHistoryEntry(previousSnapshot, candidate, comparison),
        executionId
      });
      repository.saveChangeHistory(candidate.season, candidate.round, existingHistory);
    } else {
      repository.saveChangeHistory(candidate.season, candidate.round, existingHistory);
    }

    const audit = auditLiveSnapshots(repository, candidate.season);
    const status = {
      ...baseStatus,
      result: audit.status === "PASS" ? "CAPTURED" : "FAILED",
      snapshotId: candidate.snapshotId,
      captured: true,
      skipped: false,
      dryRun: false,
      reason: policy.reason,
      auditStatus: audit.status
    };
    const release = lockAcquired
      ? repository.releaseAutomationLock(lockSeason, executionId)
      : { released: false };
    lockAcquired = false;
    const finalStatus = {
      ...status,
      lockReleased: Boolean(release.released),
      ...statusCounters(previousStatus, status.result, status.lastRunAt)
    };
    repository.saveAutomationStatus(candidate.season, finalStatus);

    if (strict && audit.status !== "PASS") {
      throw new Error("Auditoria falhou apos captura.");
    }

    return { status: finalStatus, policy, comparison, audit, snapshot: candidate, executionId };
  } catch (error) {
    const fallbackSeason = Number(options.season || new Date().getUTCFullYear());
    const previousStatus = repository.readAutomationStatus(fallbackSeason);
    const failedAt = new Date().toISOString();
    const release = lockAcquired
      ? repository.releaseAutomationLock(lockSeason, executionId)
      : { released: false };
    lockAcquired = false;
    const status = {
      schemaVersion: "live-snapshot-automation-status/v1",
      executionId,
      lastRunAt: failedAt,
      result: "FAILED",
      reason: "ERROR",
      round: options.round || null,
      snapshotId: null,
      captured: false,
      skipped: false,
      auditStatus: null,
      nextRecommendedCheckAt: null,
      marketClosingAt: null,
      secondsToClosing: null,
      staleLockRecovered,
      lockReleased: Boolean(release.released),
      ...statusCounters(previousStatus, "FAILED", failedAt),
      ...safeError(error)
    };
    repository.saveAutomationStatus(fallbackSeason, status);
    if (strict) throw error;
    return { status };
  } finally {
    if (lockAcquired) {
      const release = repository.releaseAutomationLock(lockSeason, executionId);
      const currentStatus = repository.readAutomationStatus(lockSeason);
      if (currentStatus?.executionId === executionId) {
        repository.saveAutomationStatus(lockSeason, {
          ...currentStatus,
          lockReleased: Boolean(release.released)
        });
      }
    }
  }
}

module.exports = {
  buildChangeHistoryEntry,
  ensureChangeHistory,
  runLiveSnapshotAutomation
};
