#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const {
  allowedPersistencePath,
  validateActivationConfiguration,
  validatePersistenceChanges
} = require("../src/research/preMatchScheduler");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(item);
    if (match) args[match[1]] = match[2];
    else if (item.startsWith("--")) args[item.slice(2)] = true;
  }
  return args;
}

function checkPushReadiness({ cwd = process.cwd(), branch, execute = false } = {}) {
  if (!execute) return { checked: false, status: "NOT_CHECKED", directPushAllowed: null };
  try {
    const output = execFileSync("git", ["push", "--dry-run", "origin", `HEAD:${branch}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { checked: true, status: "DRY_RUN_PUSH_PASSED", directPushAllowed: true, detail: output.trim() || "Everything up-to-date" };
  } catch (error) {
    return { checked: true, status: "DRY_RUN_PUSH_FAILED", directPushAllowed: false, detail: String(error.stderr || error.message).trim() };
  }
}

function buildPreflight({ env = process.env, season = 2026, checkPush = false, branch = "main", cwd = process.cwd() } = {}) {
  const activation = validateActivationConfiguration({
    writeEnabled: env.PRE_MATCH_CAPTURE_WRITE_ENABLED,
    commitEnabled: env.PRE_MATCH_CAPTURE_COMMIT_ENABLED
  });
  const allowlist = [
    `data/research/${season}/pre-match-availability/round-22/example.json`,
    `data/research/${season}/prospective-availability-controls.json`
  ];
  const persistenceSimulation = validatePersistenceChanges({ filesChanged: allowlist, season, commitEnabled: true });
  const unexpectedSimulation = validatePersistenceChanges({ filesChanged: [...allowlist, "server.js"], season, commitEnabled: true });
  const pushReadiness = checkPushReadiness({ cwd, branch, execute: checkPush });
  const checks = {
    activationConfigurationValid: activation.valid,
    bothVariablesEqual: activation.writeEnabled === activation.persistenceEnabled,
    allowlistValid: allowlist.every((file) => allowedPersistencePath(file, season)),
    unexpectedFileBlocked: unexpectedSimulation.persistenceStatus === "UNEXPECTED_FILE_CHANGE" && !unexpectedSimulation.commitAllowed,
    botIdentityConfigured: Boolean(env.BOT_NAME && env.BOT_EMAIL),
    contentsWriteDeclared: env.GITHUB_ACTIONS === "true",
    pushDryRunPassed: pushReadiness.directPushAllowed
  };
  const blockingIssues = [];
  if (!checks.activationConfigurationValid) blockingIssues.push("INVALID_ACTIVATION_CONFIGURATION");
  if (!checks.allowlistValid || !checks.unexpectedFileBlocked) blockingIssues.push("ALLOWLIST_VALIDATION_FAILED");
  if (!checks.botIdentityConfigured) blockingIssues.push("BOT_IDENTITY_NOT_CONFIGURED");
  if (checkPush && !pushReadiness.directPushAllowed) blockingIssues.push("PERSISTENCE_BLOCKED_BY_BRANCH_PROTECTION_OR_TOKEN");
  return {
    schemaVersion: "pre-match-activation-preflight/v1",
    projectVersion: "5.2.15",
    ok: blockingIssues.length === 0,
    mode: "PREFLIGHT_NO_WRITE",
    season,
    activation,
    checks,
    persistenceSimulation,
    unexpectedSimulation,
    pushReadiness,
    filesChanged: [],
    commitCreated: false,
    captureCreated: false,
    blockingIssues
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = buildPreflight({
    season: Number(args.season || 2026),
    checkPush: Boolean(args["check-push"]),
    branch: args.branch || process.env.GITHUB_REF_NAME || "main"
  });
  console.log(JSON.stringify(result, null, args.json ? 0 : 2));
  if (!result.ok) process.exitCode = 7;
}

module.exports = { buildPreflight, checkPushReadiness };
