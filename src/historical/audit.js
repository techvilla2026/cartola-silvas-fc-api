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
  const preRounds = coverage
    .map((item) => repository.readRoundFile(season, item.round, "pre-round.json"))
    .filter(Boolean);
  const ready = preRounds.filter((item) => item.readiness?.status === "READY").length;
  const partiallyReady = preRounds.filter((item) => item.readiness?.status === "PARTIALLY_READY").length;
  const notReady = preRounds.filter((item) => item.readiness?.status === "NOT_READY").length;
  const hasPreRoundV2 = preRounds.some((item) => item.schemaVersion === "historical-pre-round-data/v2");

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
    preRoundReadiness: {
      ready,
      partiallyReady,
      notReady,
      eligiblePlayers: preRounds.reduce((total, item) => total + (item.readiness?.eligiblePlayers || 0), 0),
      ineligiblePlayers: preRounds.reduce((total, item) => total + (item.readiness?.ineligiblePlayers || 0), 0)
    },
    backtestStatus: missingRounds.length === 0 && hasPreRoundV2 && ready > 0 ? "PARTIALLY_READY" : "NOT_READY",
    limitation: hasPreRoundV2
      ? "Rodada 1 permanece sem historico anterior; status pre-rodada segue indisponivel."
      : "Campos pre-rodada historicos nao foram reconstruidos sem risco de vazamento futuro."
  };
}

module.exports = {
  buildAuditSummary
};
