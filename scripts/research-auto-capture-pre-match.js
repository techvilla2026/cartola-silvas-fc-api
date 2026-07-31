#!/usr/bin/env node

const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const {
  PreMatchAvailabilityRepository,
  autoCapturePreMatchAvailability
} = require("../src/research/preMatchAvailabilitySource");
const {
  gitChangedFiles,
  normalizeAutomationResult,
  operationalExitCode,
  resolveCurrentCaptureStatus
} = require("../src/research/preMatchScheduler");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(item);
    if (match) args[match[1]] = match[2];
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--json") args.json = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const season = Number(args.season || 2026);
  const repository = new PreMatchAvailabilityRepository();
  const before = gitChangedFiles();
  const result = await autoCapturePreMatchAvailability({
    season,
    dryRun: Boolean(args.dryRun),
    repository,
    historicalRepository: new HistoricalDataRepository()
  });
  const captureStatus = await resolveCurrentCaptureStatus({ season, repository });
  if (!args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = operationalExitCode(result.reasonCode, captureStatus.captureRisk);
    return;
  }
  const after = gitChangedFiles();
  const machineResult = normalizeAutomationResult(result, {
    captureStatus,
    filesChanged: after.filter((file) => !before.includes(file))
  });
  console.log(JSON.stringify(machineResult));
  process.exitCode = machineResult.exitCode;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
