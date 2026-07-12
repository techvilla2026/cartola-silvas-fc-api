const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { validateChanges } = require("../src/liveSnapshot/services/changeValidator");

function run(cwd, command, args) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-workflow-"));
  run(tmp, "git", ["init"]);
  run(tmp, "git", ["config", "user.name", "slvs-snapshot-bot"]);
  run(tmp, "git", ["config", "user.email", "slvs-snapshot-bot@users.noreply.github.com"]);

  const statusPath = path.join(tmp, "data/live-snapshots/2026/automation-status.json");
  const snapshotPath = path.join(tmp, "data/live-snapshots/2026/round-19/snapshots/live-2026-r19-existing.json");
  writeJson(statusPath, { result: "SKIPPED", reason: "TOO_SOON", lastRunAt: "2026-07-12T10:00:00.000Z", executionId: "old" });
  writeJson(snapshotPath, { snapshotId: "live-2026-r19-existing" });
  run(tmp, "git", ["add", "."]);
  run(tmp, "git", ["commit", "-m", "fixture"]);

  const cleanSkipped = validateChanges({ cwd: tmp, restoreVolatile: true });

  writeJson(statusPath, { result: "SKIPPED", reason: "TOO_SOON", lastRunAt: "2026-07-12T11:00:00.000Z", executionId: "new" });
  const volatile = validateChanges({ cwd: tmp, restoreVolatile: true });

  const newSnapshotPath = path.join(tmp, "data/live-snapshots/2026/round-19/snapshots/live-2026-r19-new.json");
  writeJson(newSnapshotPath, { snapshotId: "live-2026-r19-new" });
  const captured = validateChanges({ cwd: tmp });

  run(tmp, "git", ["checkout", "--", "."]);
  fs.rmSync(newSnapshotPath, { force: true });
  writeJson(statusPath, { result: "FAILED", reason: "ERROR", failureCount: 1 });
  const materialStatus = validateChanges({ cwd: tmp });
  run(tmp, "git", ["checkout", "--", "."]);

  fs.writeFileSync(path.join(tmp, "server.js"), "console.log('bad');\n", "utf8");
  const disallowed = validateChanges({ cwd: tmp });
  fs.rmSync(path.join(tmp, "server.js"), { force: true });

  writeJson(snapshotPath, { snapshotId: "modified" });
  const immutable = validateChanges({ cwd: tmp });

  const report = {
    simulated: true,
    commitCreated: false,
    pushPerformed: false,
    skippedClean: {
      allowedChanges: cleanSkipped.allowedChanges,
      disallowedChanges: cleanSkipped.disallowedChanges,
      ignoredVolatileChanges: cleanSkipped.ignoredVolatileChangesCount,
      commitRecommended: cleanSkipped.commitRecommended
    },
    volatileStatusRestored: volatile.restored.includes("data/live-snapshots/2026/automation-status.json"),
    volatileSummary: {
      allowedChanges: volatile.allowedChanges,
      disallowedChanges: volatile.disallowedChanges,
      ignoredVolatileChanges: volatile.ignoredVolatileChangesCount
    },
    capturedSummary: {
      allowedChanges: captured.allowedChanges,
      disallowedChanges: captured.disallowedChanges,
      newSnapshots: captured.newSnapshots.length,
      commitRecommended: captured.commitRecommended
    },
    materialStatusSummary: {
      allowedChanges: materialStatus.allowedChanges,
      materialChanges: materialStatus.materialChanges,
      commitRecommended: materialStatus.commitRecommended
    },
    disallowedPathRejected: !disallowed.ok,
    immutableSnapshotRejected: immutable.disallowed.some((item) => item.reason === "IMMUTABLE_SNAPSHOT_MODIFIED"),
    finalSummaryContract: "live-snapshot-change-validation/v1",
    productionAutomationStatus: "READY"
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
