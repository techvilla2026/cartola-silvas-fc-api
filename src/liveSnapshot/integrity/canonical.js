const crypto = require("node:crypto");
const { CANONICALIZATION_VERSION, HASH_ALGORITHM } = require("../domain/constants");

function sortCanonical(value) {
  if (Array.isArray(value)) {
    return value.map(sortCanonical);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortCanonical(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(sortCanonical(value));
}

function snapshotForHash(snapshot) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  if (copy.integrity) {
    copy.integrity.contentHash = null;
  }
  return copy;
}

function contentHash(value) {
  return crypto.createHash(HASH_ALGORITHM).update(canonicalStringify(value)).digest("hex");
}

function attachIntegrity(snapshot) {
  const withIntegrity = {
    ...snapshot,
    integrity: {
      algorithm: HASH_ALGORITHM,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      contentHash: null
    }
  };
  withIntegrity.integrity.contentHash = contentHash(snapshotForHash(withIntegrity));
  return withIntegrity;
}

function verifySnapshotIntegrity(snapshot) {
  const expected = snapshot?.integrity?.contentHash;
  if (!expected) {
    return { ok: false, code: "MISSING_HASH" };
  }

  const actual = contentHash(snapshotForHash(snapshot));
  return {
    ok: actual === expected,
    expected,
    actual,
    code: actual === expected ? "OK" : "HASH_MISMATCH"
  };
}

module.exports = {
  attachIntegrity,
  canonicalStringify,
  contentHash,
  verifySnapshotIntegrity
};
