const { storageHealth } = require("./storageHealth");
const { auditLiveSnapshots } = require("./audit");
const { readProductionConfig } = require("./productionConfig");

function secondsBetween(laterIso, earlierIso) {
  if (!laterIso || !earlierIso) return null;
  const later = new Date(laterIso).getTime();
  const earlier = new Date(earlierIso).getTime();
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return null;
  return Math.max(0, Math.round((later - earlier) / 1000));
}

function latestValidSnapshot(repository, season) {
  const manifests = repository.listManifests(season);
  const valid = manifests
    .flatMap((manifest) => (manifest.snapshots || [])
      .filter((snapshot) => snapshot.isValidPreRoundSnapshot)
      .map((snapshot) => ({ ...snapshot, round: manifest.round })))
    .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
  const latest = valid[valid.length - 1] || null;
  if (!latest) return null;
  return {
    snapshotId: latest.snapshotId,
    round: latest.round,
    capturedAt: latest.capturedAt,
    capturePhase: latest.capturePhase
  };
}

function operationalAlerts({ storage, automationStatus, lock, latestValid, now = new Date() }) {
  const alerts = [];
  const nowIso = now.toISOString();

  if (!latestValid) alerts.push({ code: "NO_VALID_SNAPSHOT", level: "CRITICAL" });
  if (!automationStatus?.lastRunAt) {
    alerts.push({ code: "NO_RECENT_EXECUTION", level: "WARNING" });
  } else if (secondsBetween(nowIso, automationStatus.lastRunAt) > 26 * 60 * 60) {
    alerts.push({ code: "NO_RECENT_EXECUTION", level: "WARNING" });
  }
  if (automationStatus?.secondsToClosing !== null && automationStatus?.secondsToClosing <= 6 * 60 * 60 && !latestValid) {
    alerts.push({ code: "CLOSING_SOON_WITHOUT_RECENT_VALID_SNAPSHOT", level: "CRITICAL" });
  }
  if (Number(automationStatus?.consecutiveFailureCount || 0) >= 3) {
    alerts.push({ code: "CONSECUTIVE_FAILURES", level: "CRITICAL" });
  }
  const gitPersistenceActive = storage.officialPersistence?.mode === "GIT_AUTOMATED_COMMITS" && storage.officialPersistence?.status === "PASS";
  if (!gitPersistenceActive && (storage.status !== "PASS" || storage.productionPersistenceSafe === false)) {
    alerts.push({ code: "STORAGE_UNSAFE", level: "WARNING" });
  }
  if (automationStatus?.staleLockRecovered) {
    alerts.push({ code: "LOCK_STALE_RECOVERED", level: "INFO" });
  }
  if (automationStatus?.auditStatus === "FAIL" || automationStatus?.result === "FAILED" && automationStatus?.errorCode === "AUDIT_FAILURE") {
    alerts.push({ code: "AUDIT_FAILURE", level: "CRITICAL" });
  }
  if (lock) {
    alerts.push({ code: "LOCK_ACTIVE", level: "INFO" });
  }

  return alerts;
}

function buildProductionHealth(repository, season, options = {}) {
  const now = options.now || new Date();
  const production = readProductionConfig(options.productionConfigOptions || {});
  const config = production.config || {};
  const storage = storageHealth(repository, season);
  const automationStatus = repository.readAutomationStatus(season);
  const latestValid = latestValidSnapshot(repository, season);
  const lock = repository.readAutomationLock(season);
  const audit = auditLiveSnapshots(repository, season);
  const configChecks = production.validation.checks;
  const readinessChecks = [
    ...configChecks,
    { name: "validSnapshotExists", status: latestValid ? "PASS" : "FAIL", message: latestValid ? "Latest valid snapshot is available." : "No valid snapshot found." },
    { name: "auditStatus", status: audit.status === "PASS" ? "PASS" : "FAIL", message: `Snapshot audit status is ${audit.status}.` },
    { name: "criticalAlerts", status: "PENDING", message: "Evaluated after alerts are computed." }
  ];
  const storageForAlerts = {
    ...storage,
    officialPersistence: {
      mode: config.officialPersistenceMode || "UNKNOWN",
      status: production.validation.ok ? "PASS" : "FAIL"
    }
  };
  let alerts = operationalAlerts({ storage: storageForAlerts, automationStatus, lock, latestValid, now });
  const criticalAlerts = alerts.filter((alert) => alert.level === "CRITICAL");
  readinessChecks[readinessChecks.length - 1] = {
    name: "criticalAlerts",
    status: criticalAlerts.length === 0 ? "PASS" : "FAIL",
    message: criticalAlerts.length === 0 ? "No critical alerts." : "Critical alerts are present."
  };
  const ready = readinessChecks.every((item) => item.status !== "FAIL");
  const currentRound = automationStatus?.round || latestValid?.round || null;
  const productionAutomationStatus = ready ? "READY" : "PARTIALLY_READY";

  return {
    backendVersion: options.backendVersion || "unknown",
    storage: {
      storageMode: storage.storageMode,
      status: storage.status,
      persistenceExpected: storage.persistenceExpected,
      sharedWithWebService: storage.sharedWithWebService,
      productionPersistenceSafe: ready,
      runtimeStorageMode: config.runtimeStorageMode || "LOCAL_EPHEMERAL",
      officialPersistenceMode: config.officialPersistenceMode || "UNKNOWN"
    },
    scheduler: {
      mode: "GITHUB_ACTIONS",
      schedulerFrequency: config.schedulerFrequency || "UNKNOWN",
      capturePolicyFrequency: "Managed by live snapshot policy windows"
    },
    schedulerFrequency: config.schedulerFrequency || "UNKNOWN",
    githubActionsEnabled: Boolean(config.githubActionsEnabled),
    workflowRealExecutionConfirmed: Boolean(config.workflowRealExecutionConfirmed),
    workflowActivationStatus: config.workflowActivationStatus || "UNKNOWN",
    gitPersistenceMode: config.gitPersistenceMode || "UNKNOWN",
    renderAutoDeployConfirmed: Boolean(config.renderAutoDeployConfirmed),
    renderAutoDeployMode: config.renderAutoDeployMode || "UNKNOWN",
    mainBranch: config.mainBranch || "UNKNOWN",
    runtimeStorageMode: config.runtimeStorageMode || "LOCAL_EPHEMERAL",
    officialPersistenceMode: config.officialPersistenceMode || "UNKNOWN",
    automation: {
      status: automationStatus?.result || "UNKNOWN",
      reason: automationStatus?.reason || null,
      productionAutomationStatus
    },
    lastExecution: automationStatus ? {
      executionId: automationStatus.executionId || null,
      lastRunAt: automationStatus.lastRunAt || null,
      result: automationStatus.result || null
    } : null,
    lastSuccessfulRun: automationStatus?.lastSuccessfulRunAt || null,
    currentRound,
    marketClosingAt: automationStatus?.marketClosingAt || null,
    latestValidSnapshot: latestValid,
    auditStatus: audit.status,
    secondsSinceLatestValidSnapshot: latestValid ? secondsBetween(now.toISOString(), latestValid.capturedAt) : null,
    finalPreCloseStatus: currentRound ? {
      round: currentRound,
      snapshotId: repository.readManifest(season, currentRound)?.finalPreCloseSnapshotId
        || repository.readManifest(season, currentRound)?.lastValidPreRoundSnapshotId
        || null
    } : null,
    lockStatus: lock ? {
      active: true,
      executionId: lock.executionId || null,
      createdAt: lock.createdAt || null,
      expiresAt: lock.expiresAt || null,
      season: lock.season || null,
      round: lock.round || null
    } : { active: false },
    alerts,
    readinessChecks,
    productionAutomationStatus
  };
}

module.exports = {
  buildProductionHealth,
  latestValidSnapshot,
  operationalAlerts
};
