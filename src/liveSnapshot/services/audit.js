const fs = require("node:fs");
const path = require("node:path");
const { LIVE_SNAPSHOT_AUDIT_SCHEMA_VERSION, LIVE_SNAPSHOT_SCHEMA_VERSION } = require("../domain/constants");
const { verifySnapshotIntegrity } = require("../integrity/canonical");

function auditRound(repository, season, round) {
  const issues = [];
  const manifest = repository.readManifest(season, round);

  if (!manifest) {
    return { round, status: "FAIL", issues: [{ code: "MANIFEST_MISSING" }], manifest: null, snapshots: [] };
  }

  const snapshots = [];
  const seen = new Set();
  for (const entry of manifest.snapshots || []) {
    if (seen.has(entry.snapshotId)) {
      issues.push({ code: "DUPLICATE_SNAPSHOT_ID", snapshotId: entry.snapshotId });
    }
    seen.add(entry.snapshotId);

    try {
      const snapshot = repository.readSnapshot(season, round, entry.snapshotId);
      if (!snapshot) {
        issues.push({ code: "SNAPSHOT_FILE_MISSING", snapshotId: entry.snapshotId });
        continue;
      }

      if (snapshot.schemaVersion !== LIVE_SNAPSHOT_SCHEMA_VERSION) {
        issues.push({ code: "INVALID_SCHEMA", snapshotId: entry.snapshotId });
      }

      const integrity = verifySnapshotIntegrity(snapshot);
      if (!integrity.ok) {
        issues.push({ code: integrity.code, snapshotId: entry.snapshotId, expected: integrity.expected, actual: integrity.actual });
      }

      if (entry.contentHash !== snapshot.integrity?.contentHash) {
        issues.push({ code: "MANIFEST_HASH_MISMATCH", snapshotId: entry.snapshotId });
      }

      snapshots.push({
        snapshotId: entry.snapshotId,
        capturedAt: snapshot.capturedAt,
        capturePhase: snapshot.capturePhase,
        isValidPreRoundSnapshot: snapshot.isValidPreRoundSnapshot,
        integrity
      });
    } catch (error) {
      issues.push({ code: "SNAPSHOT_JSON_INVALID", snapshotId: entry.snapshotId, message: error.message });
    }
  }

  const validCount = snapshots.filter((item) => item.isValidPreRoundSnapshot).length;
  if (validCount !== manifest.validPreRoundSnapshots) {
    issues.push({ code: "VALID_COUNT_MISMATCH" });
  }

  return {
    round,
    status: issues.length ? "FAIL" : "PASS",
    issues,
    manifest: {
      totalSnapshots: manifest.totalSnapshots,
      validPreRoundSnapshots: manifest.validPreRoundSnapshots,
      firstSnapshotId: manifest.firstSnapshotId,
      lastSnapshotId: manifest.lastSnapshotId,
      lastValidPreRoundSnapshotId: manifest.lastValidPreRoundSnapshotId
    },
    snapshots
  };
}

function auditLiveSnapshots(repository, season) {
  const rounds = repository.listRounds(season);
  const roundReports = rounds.map((round) => auditRound(repository, season, round));

  return {
    schemaVersion: LIVE_SNAPSHOT_AUDIT_SCHEMA_VERSION,
    season,
    generatedAt: new Date().toISOString(),
    status: roundReports.some((item) => item.status === "FAIL") ? "FAIL" : "PASS",
    totalSnapshots: roundReports.reduce((sum, item) => sum + (item.manifest?.totalSnapshots || 0), 0),
    validPreRoundSnapshots: roundReports.reduce((sum, item) => sum + (item.manifest?.validPreRoundSnapshots || 0), 0),
    rounds: roundReports
  };
}

function coverage(repository, season) {
  const manifests = repository.listManifests(season);
  return {
    season,
    rounds: manifests.map((manifest) => ({
      round: manifest.round,
      totalSnapshots: manifest.totalSnapshots,
      validPreRoundSnapshots: manifest.validPreRoundSnapshots,
      firstSnapshotId: manifest.firstSnapshotId,
      lastSnapshotId: manifest.lastSnapshotId,
      lastValidPreRoundSnapshotId: manifest.lastValidPreRoundSnapshotId,
      firstCapturedAt: manifest.snapshots?.[0]?.capturedAt || null,
      lastCapturedAt: manifest.snapshots?.[manifest.snapshots.length - 1]?.capturedAt || null
    })),
    totals: {
      roundsWithSnapshots: manifests.length,
      snapshots: manifests.reduce((sum, item) => sum + item.totalSnapshots, 0),
      validPreRoundSnapshots: manifests.reduce((sum, item) => sum + item.validPreRoundSnapshots, 0)
    }
  };
}

function findSnapshot(repository, season, snapshotId) {
  for (const manifest of repository.listManifests(season)) {
    const found = (manifest.snapshots || []).find((item) => item.snapshotId === snapshotId);
    if (found) {
      return repository.readSnapshot(season, manifest.round, snapshotId);
    }
  }
  return null;
}

module.exports = {
  auditLiveSnapshots,
  auditRound,
  coverage,
  findSnapshot
};
