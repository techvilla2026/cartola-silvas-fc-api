#!/usr/bin/env node

const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const {
  PreMatchAvailabilityRepository,
  autoCapturePreMatchAvailability
} = require("../src/research/preMatchAvailabilitySource");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(item);
    if (match) args[match[1]] = match[2];
    else if (item === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await autoCapturePreMatchAvailability({
    season: Number(args.season || 2026),
    dryRun: Boolean(args.dryRun),
    repository: new PreMatchAvailabilityRepository(),
    historicalRepository: new HistoricalDataRepository()
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.reasonCode === "SOURCE_UNAVAILABLE" || result.reasonCode === "TEMPORAL_VALIDATION_FAILED") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
