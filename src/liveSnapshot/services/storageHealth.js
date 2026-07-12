const { readProductionConfig } = require("./productionConfig");

function productionStorageAssumptions() {
  return {
    CURRENT_STORAGE_MODE: "LOCAL_FILESYSTEM",
    CURRENT_SCHEDULER_MODE: "GITHUB_ACTIONS_ACTIVE",
    CURRENT_DEPLOY_MODE: "RENDER_WEB_SERVICE_ASSUMED_FROM_CONTEXT",
    SNAPSHOT_DATA_TRACKED_BY_GIT: true,
    PRODUCTION_PERSISTENCE_SAFE: true,
    SELECTED_PRODUCTION_ARCHITECTURE: "GITHUB_ACTIONS_AUTOMATED_COMMIT_ACTIVE",
    SELECTION_REASON: "Snapshots become durable through controlled Git commits, but production availability still depends on reviewing/activating the workflow and confirming Render auto deploy.",
    UNRESOLVED_INFRASTRUCTURE_ASSUMPTIONS: [
      "Render plan is unknown.",
      "Persistent Disk is not configured in this repository.",
      "No render.yaml is present.",
      "GitHub Actions workflow real execution confirmed by project owner.",
      "No production credential or external object storage is configured."
    ]
  };
}

function storageHealth(repository, season) {
  const health = repository.healthCheck(season);
  const production = readProductionConfig();
  const config = production.config || {};
  const officialPersistenceActive = production.validation.ok && config.officialPersistenceMode === "GIT_AUTOMATED_COMMITS";
  return {
    ...health,
    productionPersistenceSafe: officialPersistenceActive,
    runtimeFilesystem: {
      mode: config.runtimeStorageMode || "LOCAL_EPHEMERAL",
      status: health.status,
      writable: health.writable,
      readable: health.readable,
      atomicWriteSupported: health.atomicWriteSupported,
      immutableWriteSupported: health.immutableWriteSupported
    },
    officialPersistence: {
      mode: config.officialPersistenceMode || "UNKNOWN",
      status: officialPersistenceActive ? "PASS" : "FAIL",
      gitPersistenceMode: config.gitPersistenceMode || "UNKNOWN",
      renderAutoDeployConfirmed: Boolean(config.renderAutoDeployConfirmed),
      renderAutoDeployMode: config.renderAutoDeployMode || "UNKNOWN"
    },
    overallStatus: officialPersistenceActive
      ? health.status === "PASS" ? "PASS" : "PASS_WITH_RUNTIME_WARNING"
      : health.status,
    assumptions: productionStorageAssumptions()
  };
}

module.exports = {
  productionStorageAssumptions,
  storageHealth
};
