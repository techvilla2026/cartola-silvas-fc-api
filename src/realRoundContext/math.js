function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function errorMetrics(pairs) {
  const valid = pairs.filter((item) => Number.isFinite(item.predictedScore) && Number.isFinite(item.actualScore));
  const errors = valid.map((item) => item.predictedScore - item.actualScore);
  const abs = errors.map(Math.abs);
  return {
    count: valid.length,
    mae: average(abs),
    weightedLargeError: valid.length ? round(abs.reduce((sum, value) => sum + (value > 5 ? value * 1.5 : value), 0) / valid.length) : null,
    bias: average(errors),
    within1: valid.length ? round(valid.filter((item) => Math.abs(item.predictedScore - item.actualScore) <= 1).length / valid.length) : null,
    within2: valid.length ? round(valid.filter((item) => Math.abs(item.predictedScore - item.actualScore) <= 2).length / valid.length) : null,
    within3: valid.length ? round(valid.filter((item) => Math.abs(item.predictedScore - item.actualScore) <= 3).length / valid.length) : null,
    within5: valid.length ? round(valid.filter((item) => Math.abs(item.predictedScore - item.actualScore) <= 5).length / valid.length) : null
  };
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
  }
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

module.exports = {
  average,
  errorMetrics,
  round,
  sanitize
};
