#!/usr/bin/env node

const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const {
  PreMatchAvailabilityRepository,
  evaluatePreMatchAvailability
} = require("../src/research/preMatchAvailabilitySource");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(item);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const season = Number(args.season || 2026);
  const round = Number(args.round);
  if (!Number.isInteger(round) || round <= 0) throw new Error("--round e obrigatorio para avaliar snapshot pre-jogo.");
  const artifact = evaluatePreMatchAvailability({
    season,
    round,
    captureId: args.captureId || null,
    repository: new PreMatchAvailabilityRepository(),
    historicalRepository: new HistoricalDataRepository()
  });
  console.log(JSON.stringify({
    status: "OK",
    evaluationStatus: artifact.status,
    season,
    round,
    captureId: artifact.captureId,
    targetRows: artifact.targetRows,
    reason: artifact.reason || null,
    v1: artifact.metrics?.availabilityV1 || null,
    v2Threshold050: artifact.metrics?.availabilityV2Threshold050 || null,
    v2Threshold045: artifact.metrics?.availabilityV2Threshold045 || null
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
