#!/usr/bin/env node

const { BacktestRepository } = require("../src/backtest/repository");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  buildAvailabilityRecalibration,
  writeAvailabilityRecalibrationReport
} = require("../src/research/availabilityRecalibration");

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
  const artifact = buildAvailabilityRecalibration({
    season,
    historicalRepository: new HistoricalDataRepository(),
    backtestRepository: new BacktestRepository({ buildId: "build-4.3.2" }),
    researchRepository: new ResearchRepository()
  });
  const report = writeAvailabilityRecalibrationReport(artifact);
  console.log(JSON.stringify({
    status: "OK",
    artifact: `data/research/${season}/availability-recalibration.json`,
    report,
    baselineId: artifact.baseline.baselineId,
    candidateId: artifact.candidate.modelId,
    recommendation: artifact.promotionRecommendation.recommendation,
    v1Brier: artifact.metrics.availabilityV1.brierScore,
    v2Brier: artifact.metrics.availabilityV2Calibrated.brierScore,
    v1Ece: artifact.metrics.availabilityV1.ece,
    v2Ece: artifact.metrics.availabilityV2Calibrated.ece
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
