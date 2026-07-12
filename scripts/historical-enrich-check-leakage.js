const { EnrichedHistoricalRepository } = require("../src/historical/enrichment/enrichedRepository");
const { checkEnrichedLeakage } = require("../src/historical/enrichment/leakageChecker");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function main() {
  const season = Number(argValue("season", "2026"));
  const from = Number(argValue("from", "2"));
  const to = Number(argValue("to", "18"));
  const repository = new EnrichedHistoricalRepository();
  const results = [];

  for (let round = from; round <= to; round += 1) {
    const enriched = repository.readRoundFile(season, round, "pre-round-enriched.json");
    if (!enriched) {
      results.push({
        schemaVersion: "historical-enriched-leakage-report/v1",
        season,
        round,
        status: "FAIL",
        issues: [{ code: "ENRICHED_ROUND_MISSING" }],
        warnings: []
      });
      continue;
    }

    const report = checkEnrichedLeakage(enriched);
    repository.saveRoundFile(season, round, "leakage.json", report, { force: true });
    results.push(report);
  }

  console.log(JSON.stringify({
    season,
    from,
    to,
    pass: results.filter((item) => item.status === "PASS").length,
    warning: results.filter((item) => item.status === "WARNING").length,
    fail: results.filter((item) => item.status === "FAIL").length,
    results
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
