#!/usr/bin/env node

const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const {
  PreMatchAvailabilityRepository,
  capturePreMatchAvailability,
  writePreMatchAvailabilityDocs
} = require("../src/research/preMatchAvailabilitySource");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(item);
    if (match) args[match[1]] = match[2];
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--force-invalid-capture") args.forceInvalidCapture = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const season = Number(args.season || 2026);
  const round = args.round ? Number(args.round) : undefined;
  const result = await capturePreMatchAvailability({
    season,
    round,
    deadline: args.deadline || null,
    dryRun: Boolean(args.dryRun),
    forceInvalidCapture: Boolean(args.forceInvalidCapture),
    repository: new PreMatchAvailabilityRepository(),
    historicalRepository: new HistoricalDataRepository()
  });
  const docs = writePreMatchAvailabilityDocs();
  console.log(JSON.stringify({
    status: "OK",
    dryRun: result.report.dryRun,
    saved: result.report.saved,
    captureId: result.report.captureId,
    season: result.report.season,
    round: result.report.round,
    capturedAt: result.report.capturedAt,
    deadline: result.report.roundDeadline,
    temporalSafety: result.report.temporalSafety,
    fingerprint: result.report.snapshotFingerprint,
    totalPlayers: result.report.totalPlayers,
    coverage: result.report.coverage.percentages,
    report: docs.reportPath,
    contract: docs.contractPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
