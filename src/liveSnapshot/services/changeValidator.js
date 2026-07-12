const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ALLOWED_PATTERNS = [
  /^data\/live-snapshots\/\d{4}\/automation-status\.json$/,
  /^data\/live-snapshots\/\d{4}\/round-\d+\/manifest\.json$/,
  /^data\/live-snapshots\/\d{4}\/round-\d+\/change-history\.json$/,
  /^data\/live-snapshots\/\d{4}\/round-\d+\/snapshots\/[^/]+\.json$/
];

const FORBIDDEN_PREFIXES = [
  "src/",
  "scripts/",
  "test/",
  "docs/",
  "node_modules/",
  "data/historical/",
  "data/backtests/"
];

const FORBIDDEN_EXACT = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "README.md",
  "CHANGELOG.md",
  ".env"
]);

const AUTOMATION_STATUS_VOLATILE_FIELDS = new Set([
  "lastRunAt",
  "executionId",
  "processId",
  "duration",
  "nextRecommendedCheckAt",
  "secondsToClosing",
  "lockReleased",
  "lastSuccessfulRunAt"
]);

function normalizePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function runGit(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"]
  });
}

function isAllowedPath(filePath) {
  const normalized = normalizePath(filePath);
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isForbiddenPath(filePath) {
  const normalized = normalizePath(filePath);
  return FORBIDDEN_EXACT.has(normalized) || FORBIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isSnapshotPath(filePath) {
  return /^data\/live-snapshots\/\d{4}\/round-\d+\/snapshots\/[^/]+\.json$/.test(normalizePath(filePath));
}

function parsePorcelainLine(line) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3);
  if (status.includes("R") || status.includes("C")) {
    const [from, to] = rawPath.split(" -> ");
    return { status, path: normalizePath(to || rawPath), from: normalizePath(from), raw: line };
  }
  return { status, path: normalizePath(rawPath), raw: line };
}

function gitStatus(cwd) {
  const output = runGit(cwd, ["status", "--porcelain=v1"]);
  return output.split(/\r?\n/).filter(Boolean).map(parsePorcelainLine);
}

function existsInHead(cwd, filePath) {
  try {
    runGit(cwd, ["cat-file", "-e", `HEAD:${normalizePath(filePath)}`]);
    return true;
  } catch {
    return false;
  }
}

function readHeadJson(cwd, filePath) {
  try {
    return JSON.parse(runGit(cwd, ["show", `HEAD:${normalizePath(filePath)}`]));
  } catch {
    return null;
  }
}

function readWorktreeJson(cwd, filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, filePath), "utf8"));
  } catch {
    return null;
  }
}

function stripVolatileAutomationStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (AUTOMATION_STATUS_VOLATILE_FIELDS.has(key)) continue;
    result[key] = stripVolatileAutomationStatus(item);
  }
  return result;
}

function isAutomationStatusPath(filePath) {
  return /^data\/live-snapshots\/\d{4}\/automation-status\.json$/.test(normalizePath(filePath));
}

function automationStatusMateriality(cwd, filePath) {
  if (!isAutomationStatusPath(filePath) || !existsInHead(cwd, filePath)) {
    return { checked: false, material: true };
  }
  const head = readHeadJson(cwd, filePath);
  const worktree = readWorktreeJson(cwd, filePath);
  const material = JSON.stringify(stripVolatileAutomationStatus(head)) !== JSON.stringify(stripVolatileAutomationStatus(worktree));
  return { checked: true, material };
}

function restoreFromHead(cwd, filePath) {
  const content = runGit(cwd, ["show", `HEAD:${normalizePath(filePath)}`]);
  fs.writeFileSync(path.join(cwd, filePath), content, "utf8");
}

function validateChanges(options = {}) {
  const cwd = options.cwd || process.cwd();
  const entries = gitStatus(cwd);
  const allowed = [];
  const disallowed = [];
  const volatileOnly = [];

  for (const entry of entries) {
    const status = entry.status;
    const filePath = entry.path;
    const deleted = status.includes("D");
    const renamed = status.includes("R") || status.includes("C");
    const allowedPath = isAllowedPath(filePath);
    const forbiddenPath = isForbiddenPath(filePath);
    const trackedSnapshotModified = isSnapshotPath(filePath) && existsInHead(cwd, filePath) && !status.includes("A") && status !== "??";

    let reason = null;
    if (deleted) reason = "DELETE_NOT_ALLOWED";
    else if (renamed) reason = "RENAME_NOT_ALLOWED";
    else if (!allowedPath) reason = forbiddenPath ? "FORBIDDEN_PATH" : "PATH_NOT_IN_ALLOWLIST";
    else if (trackedSnapshotModified) reason = "IMMUTABLE_SNAPSHOT_MODIFIED";

    if (reason) {
      disallowed.push({ path: filePath, status, reason });
      continue;
    }

    const materiality = automationStatusMateriality(cwd, filePath);
    const item = {
      path: filePath,
      status,
      material: materiality.material,
      materialityChecked: materiality.checked
    };
    allowed.push(item);
    if (materiality.checked && !materiality.material) volatileOnly.push(item);
  }

  const materialAllowed = allowed.filter((item) => item.material);
  const onlyVolatileAutomationStatus = allowed.length > 0 && materialAllowed.length === 0 && disallowed.length === 0;
  const restored = [];
  if (options.restoreVolatile && onlyVolatileAutomationStatus) {
    for (const item of volatileOnly) {
      restoreFromHead(cwd, item.path);
      restored.push(item.path);
    }
  }

  return {
    ok: disallowed.length === 0,
    allowed,
    disallowed,
    restored,
    onlyVolatileAutomationStatus,
    hasMaterialAllowedChanges: materialAllowed.length > 0,
    commitRecommended: disallowed.length === 0 && materialAllowed.length > 0,
    counts: {
      allowed: allowed.length,
      disallowed: disallowed.length,
      materialAllowed: materialAllowed.length,
      restored: restored.length
    }
  };
}

module.exports = {
  ALLOWED_PATTERNS,
  FORBIDDEN_EXACT,
  FORBIDDEN_PREFIXES,
  AUTOMATION_STATUS_VOLATILE_FIELDS,
  automationStatusMateriality,
  isAllowedPath,
  isForbiddenPath,
  isSnapshotPath,
  stripVolatileAutomationStatus,
  validateChanges
};
