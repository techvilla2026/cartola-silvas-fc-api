const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { validateChanges } = require("../src/liveSnapshot/services/changeValidator");

const workflowPath = path.resolve(__dirname, "../.github/workflows/live-snapshot-capture.yml");

function workflowText() {
  return fs.readFileSync(workflowPath, "utf8");
}

function run(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, data) {
  write(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function gitFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-validator-"));
  run(dir, ["init"]);
  run(dir, ["config", "user.name", "test"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  writeJson(path.join(dir, "data/live-snapshots/2026/automation-status.json"), {
    result: "SKIPPED",
    reason: "TOO_SOON",
    lastRunAt: "2026-07-12T10:00:00.000Z",
    executionId: "old",
    failureCount: 0
  });
  writeJson(path.join(dir, "data/live-snapshots/2026/round-19/snapshots/live-existing.json"), { snapshotId: "live-existing" });
  run(dir, ["add", "."]);
  run(dir, ["commit", "-m", "fixture"]);
  return dir;
}

test("workflow YAML possui gatilhos, schedule horario e concurrency segura", () => {
  const text = workflowText();

  assert.ok(text.includes("workflow_dispatch:"));
  assert.ok(text.includes("schedule:"));
  assert.ok(text.includes('cron: "7 * * * *"'));
  assert.ok(text.includes("concurrency:"));
  assert.ok(text.includes("cancel-in-progress: false"));
  assert.equal(/\npush:/.test(text), false);
});

test("workflow usa permissoes minimas e comandos obrigatorios", () => {
  const text = workflowText();

  assert.ok(text.includes("contents: write"));
  assert.equal(text.includes("actions: write"), false);
  assert.equal(text.includes("pull-requests: write"), false);
  assert.ok(text.includes("actions/checkout@v5"));
  assert.ok(text.includes("actions/setup-node@v6"));
  assert.ok(text.includes('node-version: "22"'));
  assert.equal(text.includes("actions/checkout@v4"), false);
  assert.equal(text.includes("actions/setup-node@v4"), false);
  assert.ok(text.includes("npm ci"));
  assert.ok(text.includes("npm run test:live-snapshot-ci"));
  assert.ok(text.includes("live:snapshot:storage-check"));
  assert.ok(text.includes("live:snapshot:auto"));
  assert.ok(text.includes("--strict"));
  assert.ok(text.includes("live:snapshot:audit"));
  assert.ok(text.includes("live:snapshot:validate-changes"));
});

test("workflow dry_run nao commita nem faz push e push nao usa force", () => {
  const text = workflowText();

  assert.ok(text.includes("dry_run"));
  assert.ok(text.includes("Dry run requested; no commit or push"));
  assert.ok(text.includes("if: env.DRY_RUN != 'true'"));
  assert.ok(text.includes("git push"));
  assert.equal(text.includes("--force"), false);
  assert.equal(text.includes("--force-with-lease"), false);
});

test("workflow configura bot, mensagem, rebase e resumo", () => {
  const text = workflowText();

  assert.ok(text.includes("slvs-snapshot-bot"));
  assert.ok(text.includes("slvs-snapshot-bot@users.noreply.github.com"));
  assert.ok(text.includes("chore(snapshot): automatic pre-round capture"));
  assert.ok(text.includes("git pull --rebase"));
  assert.ok(text.includes("GITHUB_STEP_SUMMARY"));
  assert.ok(text.includes("ignoredVolatileChanges"));
  assert.ok(text.includes("materialChanges"));
});

test("allowlist aceita apenas arquivos permitidos", () => {
  const dir = gitFixture();
  writeJson(path.join(dir, "data/live-snapshots/2026/round-19/manifest.json"), { totalSnapshots: 1 });
  writeJson(path.join(dir, "data/live-snapshots/2026/round-19/change-history.json"), { changes: [] });
  writeJson(path.join(dir, "data/live-snapshots/2026/round-19/snapshots/live-new.json"), { snapshotId: "live-new" });
  const result = validateChanges({ cwd: dir });

  assert.equal(result.ok, true);
  assert.equal(result.commitRecommended, true);
});

test("allowlist rejeita caminhos proibidos", () => {
  for (const filePath of ["src/a.js", "scripts/a.js", "package.json", ".env", "node_modules/a.js", "data/historical/a.json", "data/backtests/a.json"]) {
    const dir = gitFixture();
    write(path.join(dir, filePath), "bad\n");
    const result = validateChanges({ cwd: dir });
    assert.equal(result.ok, false, filePath);
  }
});

test("validator rejeita deletes, renames e modificacao de snapshot existente", () => {
  const deleteDir = gitFixture();
  fs.unlinkSync(path.join(deleteDir, "data/live-snapshots/2026/automation-status.json"));
  assert.equal(validateChanges({ cwd: deleteDir }).disallowed[0].reason, "DELETE_NOT_ALLOWED");

  const renameDir = gitFixture();
  run(renameDir, ["mv", "data/live-snapshots/2026/automation-status.json", "data/live-snapshots/2026/automation-status-renamed.json"]);
  assert.equal(validateChanges({ cwd: renameDir }).disallowed[0].reason, "RENAME_NOT_ALLOWED");

  const snapshotDir = gitFixture();
  writeJson(path.join(snapshotDir, "data/live-snapshots/2026/round-19/snapshots/live-existing.json"), { snapshotId: "changed" });
  assert.equal(validateChanges({ cwd: snapshotDir }).disallowed[0].reason, "IMMUTABLE_SNAPSHOT_MODIFIED");
});

test("automation-status volatil nao recomenda commit e material recomenda", () => {
  const volatileDir = gitFixture();
  writeJson(path.join(volatileDir, "data/live-snapshots/2026/automation-status.json"), {
    result: "SKIPPED",
    reason: "TOO_SOON",
    lastRunAt: "2026-07-12T11:00:00.000Z",
    executionId: "new",
    failureCount: 0
  });
  const volatileResult = validateChanges({ cwd: volatileDir, restoreVolatile: true });
  assert.equal(volatileResult.schemaVersion, "live-snapshot-change-validation/v1");
  assert.equal(volatileResult.allowedChanges, 0);
  assert.equal(volatileResult.disallowedChanges, 0);
  assert.equal(volatileResult.ignoredVolatileChangesCount, 1);
  assert.equal(volatileResult.onlyVolatileAutomationStatus, true);
  assert.equal(volatileResult.commitRecommended, false);
  assert.deepEqual(run(volatileDir, ["status", "--porcelain=v1"]).trim(), "");

  const materialDir = gitFixture();
  writeJson(path.join(materialDir, "data/live-snapshots/2026/automation-status.json"), {
    result: "FAILED",
    reason: "ERROR",
    lastRunAt: "2026-07-12T11:00:00.000Z",
    executionId: "new",
    failureCount: 1
  });
  const materialResult = validateChanges({ cwd: materialDir });
  assert.equal(materialResult.ok, true);
  assert.equal(materialResult.allowedChanges, 1);
  assert.equal(materialResult.materialChanges, 1);
  assert.equal(materialResult.commitRecommended, true);
});

test("arquivos temporarios no checkout seriam disallowed e por isso workflow usa RUNNER_TEMP", () => {
  const dir = gitFixture();
  writeJson(path.join(dir, "automation-result.json"), { result: "SKIPPED" });
  writeJson(path.join(dir, "validate-changes.json"), { ok: true });
  const result = validateChanges({ cwd: dir });

  assert.equal(result.ok, false);
  assert.equal(result.disallowedChanges, 2);
  assert.ok(result.disallowed.every((item) => item.reason === "PATH_NOT_IN_ALLOWLIST"));
});

test("production-health informa producao READY", async () => {
  const { createApp } = require("../server");
  const app = createApp();
  const server = app.listen(0);

  try {
    const body = await new Promise((resolve, reject) => {
      require("node:http").get(`http://127.0.0.1:${server.address().port}/live-snapshots/2026/production-health`, (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => resolve(JSON.parse(raw)));
      }).on("error", reject);
    });
    assert.equal(body.scheduler.mode, "GITHUB_ACTIONS");
    assert.equal(body.scheduler.schedulerFrequency, "HOURLY");
    assert.equal(body.workflowActivationStatus, "ACTIVE");
    assert.equal(body.gitPersistenceMode, "AUTOMATED_COMMIT_ACTIVE");
    assert.equal(body.renderAutoDeployConfirmed, true);
    assert.equal(body.renderAutoDeployMode, "ON_COMMIT");
    assert.equal(body.officialPersistenceMode, "GIT_AUTOMATED_COMMITS");
    assert.equal(body.productionAutomationStatus, "READY");
    assert.ok(body.readinessChecks.every((item) => item.status !== "FAIL"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production config invalida impede READY", () => {
  const { validateProductionConfig } = require("../src/liveSnapshot/services/productionConfig");
  const invalid = validateProductionConfig({
    schemaVersion: "live-snapshot-production-config/v1",
    githubActionsEnabled: false,
    workflowRealExecutionConfirmed: true,
    renderAutoDeployConfirmed: false,
    renderAutoDeployMode: "OFF",
    mainBranch: "main",
    schedulerFrequency: "HOURLY",
    workflowActivationStatus: "ACTIVE",
    gitPersistenceMode: "AUTOMATED_COMMIT_ACTIVE",
    officialPersistenceMode: "GIT_AUTOMATED_COMMITS",
    runtimeStorageMode: "LOCAL_EPHEMERAL",
    confirmedAt: "2026-07-12T00:00:00.000Z",
    evidenceNotes: ["x"]
  });

  assert.equal(invalid.ok, false);
  assert.ok(invalid.checks.some((item) => item.name === "githubActionsEnabled" && item.status === "FAIL"));
});
