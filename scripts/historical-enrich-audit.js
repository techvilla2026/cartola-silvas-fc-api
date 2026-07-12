const { EnrichedHistoricalRepository } = require("../src/historical/enrichment/enrichedRepository");
const { buildEnrichedAudit } = require("../src/historical/enrichment/audit");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function main() {
  const season = Number(argValue("season", "2026"));
  const audit = buildEnrichedAudit(new EnrichedHistoricalRepository(), season);
  console.log(JSON.stringify(audit, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
