function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return null;
  }

  return Number(Number(value).toFixed(digits));
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

  if (!sorted.length) {
    return null;
  }

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function errorMetrics(pairs) {
  const valid = pairs.filter((item) => Number.isFinite(item.predicted) && Number.isFinite(item.actual));
  const errors = valid.map((item) => item.predicted - item.actual);
  const absErrors = errors.map((value) => Math.abs(value));
  const squared = errors.map((value) => value * value);

  return {
    count: valid.length,
    mae: valid.length ? round(absErrors.reduce((sum, value) => sum + value, 0) / valid.length) : null,
    rmse: valid.length ? round(Math.sqrt(squared.reduce((sum, value) => sum + value, 0) / valid.length)) : null,
    bias: valid.length ? round(errors.reduce((sum, value) => sum + value, 0) / valid.length) : null,
    medianAbsoluteError: round(median(absErrors)),
    within1: valid.length ? round(valid.filter((item) => Math.abs(item.predicted - item.actual) <= 1).length / valid.length) : null,
    within2: valid.length ? round(valid.filter((item) => Math.abs(item.predicted - item.actual) <= 2).length / valid.length) : null,
    within3: valid.length ? round(valid.filter((item) => Math.abs(item.predicted - item.actual) <= 3).length / valid.length) : null,
    within5: valid.length ? round(valid.filter((item) => Math.abs(item.predicted - item.actual) <= 5).length / valid.length) : null
  };
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

module.exports = {
  round,
  median,
  average,
  errorMetrics
};
