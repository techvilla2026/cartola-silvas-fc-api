const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PRODUCTION_CONFIG_PATH = path.resolve(__dirname, "../../../config/live-snapshot-production.json");

function validateProductionConfig(config) {
  const checks = [];
  function check(name, status, message) {
    checks.push({ name, status, message });
  }

  check("schemaVersion", config?.schemaVersion === "live-snapshot-production-config/v1" ? "PASS" : "FAIL", "Schema version must be live-snapshot-production-config/v1.");
  check("githubActionsEnabled", config?.githubActionsEnabled === true ? "PASS" : "FAIL", "GitHub Actions must be enabled.");
  check("workflowRealExecutionConfirmed", config?.workflowRealExecutionConfirmed === true ? "PASS" : "FAIL", "A real workflow execution must be confirmed.");
  check("schedulerFrequency", config?.schedulerFrequency === "HOURLY" ? "PASS" : "FAIL", "Scheduler frequency must be HOURLY.");
  check("workflowActivationStatus", config?.workflowActivationStatus === "ACTIVE" ? "PASS" : "FAIL", "Workflow must be active.");
  check("gitPersistenceMode", config?.gitPersistenceMode === "AUTOMATED_COMMIT_ACTIVE" ? "PASS" : "FAIL", "Git persistence must be active.");
  check("renderAutoDeployConfirmed", config?.renderAutoDeployConfirmed === true ? "PASS" : "FAIL", "Render auto deploy must be confirmed.");
  check("renderAutoDeployMode", config?.renderAutoDeployMode === "ON_COMMIT" ? "PASS" : "FAIL", "Render auto deploy mode must be ON_COMMIT.");
  check("mainBranch", config?.mainBranch === "main" ? "PASS" : "FAIL", "Main branch must be main.");
  check("officialPersistenceMode", config?.officialPersistenceMode === "GIT_AUTOMATED_COMMITS" ? "PASS" : "FAIL", "Official persistence must be Git automated commits.");
  check("runtimeStorageMode", config?.runtimeStorageMode === "LOCAL_EPHEMERAL" ? "PASS" : "WARNING", "Runtime filesystem is expected to be local ephemeral.");
  check("confirmedAt", typeof config?.confirmedAt === "string" && !Number.isNaN(new Date(config.confirmedAt).getTime()) ? "PASS" : "FAIL", "Confirmation date must be valid.");
  check("evidenceNotes", Array.isArray(config?.evidenceNotes) && config.evidenceNotes.length > 0 ? "PASS" : "FAIL", "Evidence notes must be present.");

  return {
    ok: checks.every((item) => item.status !== "FAIL"),
    checks
  };
}

function readProductionConfig(options = {}) {
  const filePath = options.filePath || DEFAULT_PRODUCTION_CONFIG_PATH;
  if (!fs.existsSync(filePath)) {
    return {
      config: null,
      validation: {
        ok: false,
        checks: [{ name: "configFile", status: "FAIL", message: "Production config file not found." }]
      }
    };
  }
  const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return { config, validation: validateProductionConfig(config) };
}

module.exports = {
  DEFAULT_PRODUCTION_CONFIG_PATH,
  readProductionConfig,
  validateProductionConfig
};
