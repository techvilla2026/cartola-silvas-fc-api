function parseSnapshotId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9._-]+$/.test(text) && !text.includes("..") ? text : null;
}

function parseLiveRound(value) {
  const round = Number(value);
  return Number.isInteger(round) && round >= 1 && round <= 38 ? round : null;
}

module.exports = {
  parseLiveRound,
  parseSnapshotId
};
