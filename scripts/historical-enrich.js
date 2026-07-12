const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { EnrichedHistoricalRepository } = require("../src/historical/enrichment/enrichedRepository");
const { enrichRound } = require("../src/historical/enrichment/enricher");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} deve ser inteiro positivo.`);
  return parsed;
}

function main() {
  const season = parsePositiveInt(argValue("season", "2026"), "season");
  const from = parsePositiveInt(argValue("from", "2"), "from");
  const to = parsePositiveInt(argValue("to", "18"), "to");
  const force = hasFlag("force");
  const dryRun = hasFlag("dry-run");
  const historicalRepository = new HistoricalDataRepository();
  const enrichedRepository = new EnrichedHistoricalRepository();
  const results = [];

  for (let round = from; round <= to; round += 1) {
    const { enriched, provenance, validation } = enrichRound({ season, round, historicalRepository });
    results.push({
      round,
      totalPlayers: enriched.readiness.totalPlayers,
      eligiblePlayers: enriched.readiness.eligiblePlayers,
      enrichedPlayers: enriched.readiness.enrichedPlayers,
      insufficientRecent: enriched.readiness.insufficientRecent
    });

    if (!dryRun) {
      enrichedRepository.saveRoundFile(season, round, "pre-round-enriched.json", enriched, { force });
      enrichedRepository.saveRoundFile(season, round, "provenance.json", provenance, { force });
      enrichedRepository.saveRoundFile(season, round, "validation.json", validation, { force });
    }
  }

  console.log(JSON.stringify({ season, from, to, dryRun, results }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
