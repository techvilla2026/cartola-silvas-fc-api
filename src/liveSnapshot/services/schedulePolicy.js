const { CAPTURE_PHASE } = require("../domain/constants");

const REASONS = {
  FIRST_VALID_SNAPSHOT: "FIRST_VALID_SNAPSHOT",
  SIGNIFICANT_CHANGE: "SIGNIFICANT_CHANGE",
  DAILY_CHECKPOINT: "DAILY_CHECKPOINT",
  CLOSING_WINDOW: "CLOSING_WINDOW",
  FINAL_SAFETY_CAPTURE: "FINAL_SAFETY_CAPTURE",
  NO_PREVIOUS_VALID_SNAPSHOT: "NO_PREVIOUS_VALID_SNAPSHOT",
  MARKET_CLOSED: "MARKET_CLOSED",
  NO_SIGNIFICANT_CHANGE: "NO_SIGNIFICANT_CHANGE",
  TOO_SOON: "TOO_SOON",
  UNKNOWN_MARKET_STATE: "UNKNOWN_MARKET_STATE"
};

const SNAPSHOT_ROLES = {
  FIRST_VALID: "FIRST_VALID",
  CHECKPOINT: "CHECKPOINT",
  SIGNIFICANT_CHANGE: "SIGNIFICANT_CHANGE",
  CLOSING_WINDOW: "CLOSING_WINDOW",
  FINAL_PRE_CLOSE: "FINAL_PRE_CLOSE",
  INVALID_AUDIT_CAPTURE: "INVALID_AUDIT_CAPTURE"
};

function secondsBetween(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

function scheduleWindow(secondsToClosing) {
  if (!Number.isFinite(secondsToClosing)) {
    return { name: "UNKNOWN", intervalSeconds: null, priority: "LOW" };
  }
  if (secondsToClosing <= 0) {
    return { name: "CLOSED", intervalSeconds: null, priority: "NONE" };
  }
  if (secondsToClosing <= 15 * 60) {
    return { name: "LAST_15_MINUTES", intervalSeconds: 15 * 60, priority: "CRITICAL" };
  }
  if (secondsToClosing <= 60 * 60) {
    return { name: "LAST_HOUR", intervalSeconds: 15 * 60, priority: "HIGH" };
  }
  if (secondsToClosing <= 6 * 60 * 60) {
    return { name: "SIX_TO_ONE_HOURS", intervalSeconds: 60 * 60, priority: "HIGH" };
  }
  if (secondsToClosing <= 24 * 60 * 60) {
    return { name: "TWENTY_FOUR_TO_SIX_HOURS", intervalSeconds: 3 * 60 * 60, priority: "MEDIUM" };
  }
  if (secondsToClosing <= 72 * 60 * 60) {
    return { name: "SEVENTY_TWO_TO_TWENTY_FOUR_HOURS", intervalSeconds: 12 * 60 * 60, priority: "MEDIUM" };
  }
  return { name: "MORE_THAN_72_HOURS", intervalSeconds: 24 * 60 * 60, priority: "LOW" };
}

function addSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function evaluateCapturePolicy(input) {
  const {
    capturedAt,
    marketClosingAt,
    capturePhase,
    lastSnapshotAt,
    lastValidSnapshotAt,
    hasSignificantChange,
    totalSnapshots = 0,
    validSnapshots = 0
  } = input;

  if (!marketClosingAt || capturePhase === CAPTURE_PHASE.UNKNOWN) {
    return {
      shouldCapture: false,
      reason: REASONS.UNKNOWN_MARKET_STATE,
      recommendedNextCheckAt: null,
      capturePriority: "LOW",
      scheduleWindow: scheduleWindow(null),
      snapshotRole: SNAPSHOT_ROLES.INVALID_AUDIT_CAPTURE
    };
  }

  const secondsToClosing = secondsBetween(capturedAt, marketClosingAt);
  const window = scheduleWindow(secondsToClosing);

  if (capturePhase !== CAPTURE_PHASE.PRE_MARKET_CLOSE) {
    return {
      shouldCapture: false,
      reason: REASONS.MARKET_CLOSED,
      recommendedNextCheckAt: null,
      capturePriority: "NONE",
      scheduleWindow: window,
      snapshotRole: SNAPSHOT_ROLES.INVALID_AUDIT_CAPTURE,
      secondsToClosing
    };
  }

  if (validSnapshots === 0) {
    return {
      shouldCapture: true,
      reason: totalSnapshots === 0 ? REASONS.FIRST_VALID_SNAPSHOT : REASONS.NO_PREVIOUS_VALID_SNAPSHOT,
      recommendedNextCheckAt: window.intervalSeconds ? addSeconds(capturedAt, window.intervalSeconds) : null,
      capturePriority: window.priority,
      scheduleWindow: window,
      snapshotRole: SNAPSHOT_ROLES.FIRST_VALID,
      secondsToClosing
    };
  }

  if (secondsToClosing <= 15 * 60) {
    return {
      shouldCapture: true,
      reason: REASONS.FINAL_SAFETY_CAPTURE,
      recommendedNextCheckAt: null,
      capturePriority: "CRITICAL",
      scheduleWindow: window,
      snapshotRole: SNAPSHOT_ROLES.FINAL_PRE_CLOSE,
      secondsToClosing
    };
  }

  if (hasSignificantChange) {
    return {
      shouldCapture: true,
      reason: REASONS.SIGNIFICANT_CHANGE,
      recommendedNextCheckAt: window.intervalSeconds ? addSeconds(capturedAt, window.intervalSeconds) : null,
      capturePriority: window.priority,
      scheduleWindow: window,
      snapshotRole: SNAPSHOT_ROLES.SIGNIFICANT_CHANGE,
      secondsToClosing
    };
  }

  const lastAt = lastValidSnapshotAt || lastSnapshotAt;
  const elapsed = lastAt ? secondsBetween(lastAt, capturedAt) : Infinity;
  if (window.intervalSeconds && elapsed >= window.intervalSeconds) {
    return {
      shouldCapture: true,
      reason: secondsToClosing <= 60 * 60 ? REASONS.CLOSING_WINDOW : REASONS.DAILY_CHECKPOINT,
      recommendedNextCheckAt: addSeconds(capturedAt, window.intervalSeconds),
      capturePriority: window.priority,
      scheduleWindow: window,
      snapshotRole: secondsToClosing <= 60 * 60 ? SNAPSHOT_ROLES.CLOSING_WINDOW : SNAPSHOT_ROLES.CHECKPOINT,
      secondsToClosing
    };
  }

  return {
    shouldCapture: false,
    reason: lastAt ? REASONS.TOO_SOON : REASONS.NO_SIGNIFICANT_CHANGE,
    recommendedNextCheckAt: lastAt && window.intervalSeconds ? addSeconds(lastAt, window.intervalSeconds) : null,
    capturePriority: window.priority,
    scheduleWindow: window,
    snapshotRole: null,
    secondsToClosing
  };
}

module.exports = {
  REASONS,
  SNAPSHOT_ROLES,
  evaluateCapturePolicy,
  scheduleWindow
};
