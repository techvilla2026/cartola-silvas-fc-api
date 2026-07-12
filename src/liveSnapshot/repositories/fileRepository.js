const fs = require("node:fs");
const path = require("node:path");
const { LIVE_SNAPSHOT_MANIFEST_SCHEMA_VERSION } = require("../domain/constants");

const DEFAULT_LIVE_SNAPSHOT_DIR = path.resolve(__dirname, "../../../data/live-snapshots");
const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;

function roundDir(baseDir, season, round) {
  return path.join(baseDir, String(season), `round-${String(round).padStart(2, "0")}`);
}

function atomicWriteJson(filePath, data, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && !options.overwrite) {
    throw new Error(`Arquivo ja existe: ${filePath}`);
  }

  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

class LiveSnapshotRepository {
  constructor(options = {}) {
    this.baseDir = options.baseDir || DEFAULT_LIVE_SNAPSHOT_DIR;
    this.storageMode = "LOCAL_FILESYSTEM";
    this.persistenceExpected = options.persistenceExpected ?? false;
    this.sharedWithWebService = options.sharedWithWebService ?? true;
    this.recoveryStrategy = options.recoveryStrategy || "Git-tracked snapshots or external persistent storage required for production.";
  }

  getRoundDir(season, round) {
    return roundDir(this.baseDir, season, round);
  }

  snapshotPath(season, round, snapshotId) {
    return path.join(this.getRoundDir(season, round), "snapshots", `${snapshotId}.json`);
  }

  manifestPath(season, round) {
    return path.join(this.getRoundDir(season, round), "manifest.json");
  }

  exists(filePath) {
    return fs.existsSync(filePath);
  }

  readJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  saveSnapshot(snapshot) {
    const filePath = this.writeSnapshotImmutable(snapshot);
    this.updateManifest(snapshot);
    return { filePath };
  }

  writeSnapshotImmutable(snapshot) {
    const filePath = this.snapshotPath(snapshot.season, snapshot.round, snapshot.snapshotId);
    atomicWriteJson(filePath, snapshot);
    return filePath;
  }

  updateManifest(snapshot) {
    const manifestPath = this.manifestPath(snapshot.season, snapshot.round);
    const current = this.readJson(manifestPath) || {
      schemaVersion: LIVE_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
      season: snapshot.season,
      round: snapshot.round,
      totalSnapshots: 0,
      validPreRoundSnapshots: 0,
      firstSnapshotId: null,
      lastSnapshotId: null,
      lastValidPreRoundSnapshotId: null,
      snapshots: []
    };

    if (current.snapshots.some((item) => item.snapshotId === snapshot.snapshotId)) {
      throw new Error(`Snapshot ja registrado no manifest: ${snapshot.snapshotId}`);
    }

    current.snapshots.push({
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      round: snapshot.round,
      capturePhase: snapshot.capturePhase,
      isValidPreRoundSnapshot: snapshot.isValidPreRoundSnapshot,
      contentHash: snapshot.integrity?.contentHash || null
    });
    current.snapshots.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
    current.totalSnapshots = current.snapshots.length;
    current.validPreRoundSnapshots = current.snapshots.filter((item) => item.isValidPreRoundSnapshot).length;
    current.firstSnapshotId = current.snapshots[0]?.snapshotId || null;
    current.lastSnapshotId = current.snapshots[current.snapshots.length - 1]?.snapshotId || null;
    current.lastValidPreRoundSnapshotId = [...current.snapshots].reverse().find((item) => item.isValidPreRoundSnapshot)?.snapshotId || null;
    current.firstValidSnapshotId = current.snapshots.find((item) => item.isValidPreRoundSnapshot)?.snapshotId || null;
    const finalPreClose = [...current.snapshots].reverse().find((item) => item.isValidPreRoundSnapshot);
    current.finalPreCloseSnapshotId = finalPreClose?.snapshotId || null;
    current.finalPreCloseCapturedAt = finalPreClose?.capturedAt || null;
    current.finalPreCloseDistanceToClosingSeconds = Number.isFinite(Number(snapshot.finalPreCloseDistanceToClosingSeconds))
      ? snapshot.finalPreCloseDistanceToClosingSeconds
      : null;
    current.finalCaptureQuality = finalPreClose
      ? snapshot.snapshotRole === "FINAL_PRE_CLOSE"
        ? "EXACT_WINDOW"
        : "EARLIER_VALID_FALLBACK"
      : "UNAVAILABLE";
    current.updatedAt = new Date().toISOString();

    this.writeManifestAtomic(snapshot.season, snapshot.round, current);
    return current;
  }

  readManifest(season, round) {
    return this.readJson(this.manifestPath(season, round));
  }

  writeManifestAtomic(season, round, manifest) {
    atomicWriteJson(this.manifestPath(season, round), manifest, { overwrite: true });
    return manifest;
  }

  readSnapshot(season, round, snapshotId) {
    return this.readJson(this.snapshotPath(season, round, snapshotId));
  }

  listSnapshots(season, round) {
    const snapshotsDir = path.join(this.getRoundDir(season, round), "snapshots");
    if (!fs.existsSync(snapshotsDir)) return [];
    return fs.readdirSync(snapshotsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort();
  }

  listRounds(season) {
    const seasonDir = path.join(this.baseDir, String(season));
    if (!fs.existsSync(seasonDir)) return [];
    return fs.readdirSync(seasonDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^round-\d+$/.test(entry.name))
      .map((entry) => Number(entry.name.replace("round-", "")))
      .sort((a, b) => a - b);
  }

  listManifests(season) {
    return this.listRounds(season)
      .map((round) => this.readManifest(season, round))
      .filter(Boolean);
  }

  automationStatusPath(season) {
    return path.join(this.baseDir, String(season), "automation-status.json");
  }

  changeHistoryPath(season, round) {
    return path.join(this.getRoundDir(season, round), "change-history.json");
  }

  saveAutomationStatus(season, status) {
    return this.writeAutomationStatusAtomic(season, status);
  }

  readAutomationStatus(season) {
    return this.readJson(this.automationStatusPath(season));
  }

  writeAutomationStatusAtomic(season, status) {
    atomicWriteJson(this.automationStatusPath(season), status, { overwrite: true });
    return status;
  }

  saveChangeHistory(season, round, history) {
    return this.writeChangeHistoryAtomic(season, round, history);
  }

  readChangeHistory(season, round) {
    return this.readJson(this.changeHistoryPath(season, round));
  }

  writeChangeHistoryAtomic(season, round, history) {
    atomicWriteJson(this.changeHistoryPath(season, round), history, { overwrite: true });
    return history;
  }

  lockPath(season) {
    return path.join(this.baseDir, String(season), "automation.lock.json");
  }

  readAutomationLock(season) {
    return this.readJson(this.lockPath(season));
  }

  acquireAutomationLock({ season, round = null, executionId, ttlMs = DEFAULT_LOCK_TTL_MS, now = new Date() }) {
    const createdAt = now instanceof Date ? now : new Date(now);
    const lock = {
      schemaVersion: "live-snapshot-automation-lock/v1",
      executionId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      season,
      round,
      process: {
        pid: process.pid,
        platform: process.platform
      }
    };
    const filePath = this.lockPath(season);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    try {
      fs.writeFileSync(filePath, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return { acquired: true, lock, staleRecovered: false };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = this.readAutomationLock(season);
      const expiresAt = existing?.expiresAt ? new Date(existing.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= createdAt.getTime()) {
        fs.unlinkSync(filePath);
        fs.writeFileSync(filePath, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        return { acquired: true, lock, staleRecovered: true, previousLock: existing };
      }
      const lockError = new Error("Automacao ja esta em execucao.");
      lockError.code = "LOCK_ACTIVE";
      lockError.lock = existing;
      throw lockError;
    }
  }

  releaseAutomationLock(season, executionId) {
    const filePath = this.lockPath(season);
    const existing = this.readAutomationLock(season);
    if (!existing) return { released: false, reason: "NO_LOCK" };
    if (existing.executionId !== executionId) {
      return { released: false, reason: "LOCK_OWNED_BY_ANOTHER_EXECUTION" };
    }
    fs.unlinkSync(filePath);
    return { released: true };
  }

  healthCheck(season = 2026) {
    const checkDir = path.join(this.baseDir, String(season), ".storage-check");
    const checkFile = path.join(checkDir, `check-${process.pid}-${Date.now()}.json`);
    const immutableFile = path.join(checkDir, `immutable-${process.pid}-${Date.now()}.json`);
    let writable = false;
    let readable = false;
    let atomicWriteSupported = false;
    let immutableWriteSupported = false;
    const issues = [];

    try {
      atomicWriteJson(checkFile, { ok: true }, { overwrite: true });
      writable = true;
      atomicWriteSupported = true;
      readable = this.readJson(checkFile)?.ok === true;
      atomicWriteJson(immutableFile, { ok: true });
      try {
        atomicWriteJson(immutableFile, { ok: false });
      } catch {
        immutableWriteSupported = true;
      }
    } catch (error) {
      issues.push({ code: "STORAGE_CHECK_FAILED", message: error.message });
    } finally {
      for (const filePath of [checkFile, immutableFile]) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      if (fs.existsSync(checkDir) && fs.readdirSync(checkDir).length === 0) fs.rmdirSync(checkDir);
    }

    const persistenceExpected = Boolean(this.persistenceExpected);
    const status = writable && readable && atomicWriteSupported && immutableWriteSupported
      ? persistenceExpected ? "PASS" : "WARNING"
      : "FAIL";

    return {
      storageMode: this.storageMode,
      writable,
      readable,
      atomicWriteSupported,
      immutableWriteSupported,
      persistenceExpected,
      sharedWithWebService: Boolean(this.sharedWithWebService),
      recoveryStrategy: this.recoveryStrategy,
      status,
      issues,
      productionPersistenceSafe: persistenceExpected ? "UNKNOWN" : false
    };
  }
}

module.exports = {
  DEFAULT_LIVE_SNAPSHOT_DIR,
  DEFAULT_LOCK_TTL_MS,
  LiveSnapshotRepository,
  atomicWriteJson
};
