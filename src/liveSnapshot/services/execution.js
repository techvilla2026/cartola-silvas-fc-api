const crypto = require("node:crypto");

function createExecutionId(now = new Date()) {
  const timestamp = (now instanceof Date ? now : new Date(now)).toISOString().replace(/[-:.TZ]/g, "");
  return `exec-${timestamp}-${crypto.randomBytes(4).toString("hex")}`;
}

function statusCounters(previousStatus, result, nowIso) {
  const failureCount = Number(previousStatus?.failureCount || 0);
  const consecutiveFailureCount = Number(previousStatus?.consecutiveFailureCount || 0);

  if (result === "FAILED") {
    return {
      failureCount: failureCount + 1,
      consecutiveFailureCount: consecutiveFailureCount + 1,
      lastSuccessfulRunAt: previousStatus?.lastSuccessfulRunAt || null,
      lastFailureAt: nowIso
    };
  }

  return {
    failureCount,
    consecutiveFailureCount: 0,
    lastSuccessfulRunAt: nowIso,
    lastFailureAt: previousStatus?.lastFailureAt || null
  };
}

module.exports = {
  createExecutionId,
  statusCounters
};
