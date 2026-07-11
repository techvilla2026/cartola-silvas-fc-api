const CONTRACTS = {
  HistoricalDataSource: [
    "getSourceMetadata()",
    "listAvailableRounds(season)",
    "fetchRoundCsv(season, round)",
    "fetchMatches(season, round)",
    "fetchOfficialScoredAthletes(season, round)"
  ],
  HistoricalRoundCollector: [
    "collectRound({ season, round, source, validate, force, dryRun })"
  ],
  HistoricalRoundValidator: [
    "validateRound(primaryRoundData, validationRoundData)"
  ],
  HistoricalDataRepository: [
    "saveRound(season, round, files, options)",
    "readRoundFile(season, round, fileName)",
    "getCoverage(season)"
  ]
};

module.exports = {
  CONTRACTS
};
