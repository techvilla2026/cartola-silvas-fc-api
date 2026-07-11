function buildAuditSummary(repository, season, options = {}) {
  const coverage = repository.getCoverage(season);
  const maxCollectedRound = coverage.reduce((max, item) => Math.max(max, item.round), 0);
  const toRound = options.to || maxCollectedRound;
  const collectedRounds = new Set(coverage.map((item) => item.round));
  const missingRounds = [];

  for (let round = 1; round <= toRound; round += 1) {
    if (!collectedRounds.has(round)) {
      missingRounds.push(round);
    }
  }

  const athletes = coverage.reduce((total, item) => total + item.athletesCount, 0);
  const scoredAthletes = coverage.reduce((total, item) => total + item.scoredAthletesCount, 0);
  const matches = coverage.reduce((total, item) => total + item.matchesCount, 0);
  const coveragePercent = toRound > 0 ? Number(((coverage.length / toRound) * 100).toFixed(2)) : 0;

  return {
    season,
    expectedRounds: toRound,
    availableRounds: coverage.map((item) => item.round),
    missingRounds,
    rounds: coverage,
    totals: {
      athletes,
      scoredAthletes,
      matches,
      coveragePercent
    },
    sources: [...new Set(coverage.map((item) => item.source).filter(Boolean))],
    backtestStatus: missingRounds.length === 0 && coverage.length > 0 ? "PARTIALLY_READY" : "NOT_READY",
    limitation: "Campos pre-rodada historicos nao foram reconstruidos sem risco de vazamento futuro."
  };
}

module.exports = {
  buildAuditSummary
};
