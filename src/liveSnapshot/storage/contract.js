const REQUIRED_STORAGE_METHODS = [
  "readManifest",
  "writeManifestAtomic",
  "listRounds",
  "listSnapshots",
  "readSnapshot",
  "writeSnapshotImmutable",
  "readAutomationStatus",
  "writeAutomationStatusAtomic",
  "readChangeHistory",
  "writeChangeHistoryAtomic",
  "exists",
  "healthCheck"
];

function validateLiveSnapshotStorage(storage) {
  const missing = REQUIRED_STORAGE_METHODS.filter((method) => typeof storage?.[method] !== "function");
  return {
    ok: missing.length === 0,
    missing,
    required: REQUIRED_STORAGE_METHODS
  };
}

module.exports = {
  REQUIRED_STORAGE_METHODS,
  validateLiveSnapshotStorage
};
