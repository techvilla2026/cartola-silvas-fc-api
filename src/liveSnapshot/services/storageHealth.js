function productionStorageAssumptions() {
  return {
    CURRENT_STORAGE_MODE: "LOCAL_FILESYSTEM",
    CURRENT_SCHEDULER_MODE: "GITHUB_ACTIONS_PREPARED_NOT_ACTIVATED",
    CURRENT_DEPLOY_MODE: "RENDER_WEB_SERVICE_ASSUMED_FROM_CONTEXT",
    SNAPSHOT_DATA_TRACKED_BY_GIT: true,
    PRODUCTION_PERSISTENCE_SAFE: false,
    SELECTED_PRODUCTION_ARCHITECTURE: "GITHUB_ACTIONS_AUTOMATED_COMMIT_PREPARED",
    SELECTION_REASON: "Snapshots become durable through controlled Git commits, but production availability still depends on reviewing/activating the workflow and confirming Render auto deploy.",
    UNRESOLVED_INFRASTRUCTURE_ASSUMPTIONS: [
      "Render plan is unknown.",
      "Persistent Disk is not configured in this repository.",
      "No render.yaml is present.",
      "GitHub Actions workflow is prepared but not executed in this build.",
      "No production credential or external object storage is configured."
    ]
  };
}

function storageHealth(repository, season) {
  const health = repository.healthCheck(season);
  return {
    ...health,
    assumptions: productionStorageAssumptions()
  };
}

module.exports = {
  productionStorageAssumptions,
  storageHealth
};
