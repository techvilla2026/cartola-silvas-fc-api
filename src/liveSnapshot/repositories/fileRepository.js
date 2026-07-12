const fs = require("node:fs");
const path = require("node:path");
const { LIVE_SNAPSHOT_MANIFEST_SCHEMA_VERSION } = require("../domain/constants");

const DEFAULT_LIVE_SNAPSHOT_DIR = path.resolve(__dirname, "../../../data/live-snapshots");

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

  readJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  saveSnapshot(snapshot) {
    const filePath = this.snapshotPath(snapshot.season, snapshot.round, snapshot.snapshotId);
    atomicWriteJson(filePath, snapshot);
    this.updateManifest(snapshot);
    return { filePath };
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
    current.updatedAt = new Date().toISOString();

    atomicWriteJson(manifestPath, current, { overwrite: true });
    return current;
  }

  readManifest(season, round) {
    return this.readJson(this.manifestPath(season, round));
  }

  readSnapshot(season, round, snapshotId) {
    return this.readJson(this.snapshotPath(season, round, snapshotId));
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
}

module.exports = {
  DEFAULT_LIVE_SNAPSHOT_DIR,
  LiveSnapshotRepository,
  atomicWriteJson
};
