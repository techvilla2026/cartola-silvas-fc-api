function classifyScoutDifference(diff) {
  if (diff.primary === null || diff.primary === undefined) {
    return "missingInPrimary";
  }

  if (diff.validation === null || diff.validation === undefined) {
    return "missingInValidation";
  }

  return "valueDifference";
}

function analyzeScoutDivergences(validationReports) {
  const byScout = {};
  const byRound = {};
  let total = 0;
  let missingField = 0;
  let valueDifference = 0;
  let nomenclatureDifference = 0;

  for (const report of validationReports) {
    byRound[report.round] = byRound[report.round] || { total: 0 };

    for (const diff of report.scoutDifferences || []) {
      const scout = diff.scout;
      const classification = classifyScoutDifference(diff);
      total += 1;
      byRound[report.round].total += 1;
      byScout[scout] = byScout[scout] || {
        total: 0,
        missingInPrimary: 0,
        missingInValidation: 0,
        valueDifference: 0,
        maxMagnitude: 0
      };
      byScout[scout].total += 1;
      byScout[scout][classification] += 1;
      byScout[scout].maxMagnitude = Math.max(
        byScout[scout].maxMagnitude,
        Math.abs(Number(diff.primary || 0) - Number(diff.validation || 0))
      );

      if (classification === "valueDifference") {
        valueDifference += 1;
      } else {
        missingField += 1;
      }
    }
  }

  const trustedScouts = [];
  const excludedScouts = Object.keys(byScout).sort();

  return {
    schemaVersion: "historical-scout-divergence-analysis/v1",
    total,
    realDifferences: valueDifference,
    missingFieldDifferences: missingField,
    nomenclatureDifferences: nomenclatureDifference,
    byScout,
    byRound,
    trustedScouts,
    excludedScouts,
    recommendation: "Nao usar scouts como feature decisiva no backtest ate resolver granularidade caRtola vs Cartola oficial."
  };
}

module.exports = {
  classifyScoutDifference,
  analyzeScoutDivergences
};
