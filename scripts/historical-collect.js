const { CartolaOpenDataSource } = require("../src/historical/sources/cartolaOpenDataSource");
const { HistoricalRoundCollector } = require("../src/historical/collectors/roundCollector");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");

function parseArgs(argv) {
  const args = {
    season: 2026,
    from: 1,
    to: null,
    source: "cartola-open-data",
    validate: true,
    force: false,
    dryRun: false
  };

  for (const arg of argv) {
    if (arg.startsWith("--season=")) args.season = Number(arg.split("=")[1]);
    if (arg.startsWith("--from=")) args.from = Number(arg.split("=")[1]);
    if (arg.startsWith("--to=")) args.to = Number(arg.split("=")[1]);
    if (arg.startsWith("--source=")) args.source = arg.split("=")[1];
    if (arg === "--no-validate") args.validate = false;
    if (arg === "--validate") args.validate = true;
    if (arg === "--force") args.force = true;
    if (arg === "--dry-run") args.dryRun = true;
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.source !== "cartola-open-data") {
    throw new Error("Somente --source=cartola-open-data esta implementado na Build 4.2.0.");
  }

  const source = new CartolaOpenDataSource();
  const repository = new HistoricalDataRepository();
  const collector = new HistoricalRoundCollector({ source, repository });
  const availableRounds = await source.listAvailableRounds(args.season);
  const lastAvailableRound = Math.max(...availableRounds.map((item) => item.round));
  const to = args.to || lastAvailableRound;
  const metadata = await source.getSourceMetadata();
  const results = [];

  for (let round = args.from; round <= to; round += 1) {
    try {
      const result = await collector.collectRound({
        season: args.season,
        round,
        validate: args.validate,
        force: args.force,
        dryRun: args.dryRun,
        sourceMetadata: metadata
      });
      results.push(result);
      console.log(`[historical:collect] rodada ${round}: ${result.status}`);
    } catch (error) {
      const failed = { season: args.season, round, status: "FAILED", error: error.message };
      results.push(failed);
      console.error(`[historical:collect] rodada ${round}: ${error.message}`);
    }
  }

  const summary = {
    season: args.season,
    source: args.source,
    sourceRevision: metadata.primaryRevision,
    from: args.from,
    to,
    collectedRounds: results.filter((item) => item.status === "COLLECTED").map((item) => item.round),
    missingRounds: results.filter((item) => item.status === "MISSING").map((item) => item.round),
    failedRounds: results.filter((item) => item.status === "FAILED").map((item) => ({ round: item.round, error: item.error })),
    athletesCollected: results.reduce((total, item) => total + (item.athletesCount || 0), 0),
    matchesCollected: results.reduce((total, item) => total + (item.matchesCount || 0), 0),
    divergences: results.reduce((total, item) => total + (item.divergences || 0), 0),
    results
  };

  console.log(JSON.stringify(summary, null, 2));

  if (summary.collectedRounds.length === 0 || summary.failedRounds.length === results.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs
};
