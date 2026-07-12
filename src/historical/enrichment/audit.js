function buildEnrichedAudit(repository, season) {
  const rounds = repository.listRounds(season);
  const reports = rounds.map((round) => repository.readRoundFile(season, round, "pre-round-enriched.json")).filter(Boolean);

  return {
    schemaVersion: "historical-enrichment-audit/v1",
    season,
    generatedAt: new Date().toISOString(),
    rounds: reports.map((item) => ({
      round: item.round,
      status: item.enrichmentStatus,
      totalPlayers: item.readiness?.totalPlayers || 0,
      eligiblePlayers: item.readiness?.eligiblePlayers || 0,
      enrichedPlayers: item.readiness?.enrichedPlayers || 0,
      insufficientRecent: item.readiness?.insufficientRecent || 0,
      historicalScoutMode: item.historicalScoutMode
    })),
    totals: {
      rounds: reports.length,
      players: reports.reduce((sum, item) => sum + (item.readiness?.totalPlayers || 0), 0),
      eligiblePlayers: reports.reduce((sum, item) => sum + (item.readiness?.eligiblePlayers || 0), 0),
      enrichedPlayers: reports.reduce((sum, item) => sum + (item.readiness?.enrichedPlayers || 0), 0),
      insufficientRecent: reports.reduce((sum, item) => sum + (item.readiness?.insufficientRecent || 0), 0)
    }
  };
}

module.exports = {
  buildEnrichedAudit
};
