#!/usr/bin/env node

const { BacktestRepository } = require("../src/backtest/repository");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  buildAvailabilitySignals,
  writeAvailabilitySignalsContractDoc,
  writeAvailabilitySignalsReport
} = require("../src/research/availabilitySignals");

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
  const artifact = buildAvailabilitySignals({
    season,
    historicalRepository: new HistoricalDataRepository(),
    backtestRepository: new BacktestRepository({ buildId: "build-4.3.2" }),
    researchRepository: new ResearchRepository()
  });
  const report = writeAvailabilitySignalsReport(artifact);
  const contract = writeAvailabilitySignalsContractDoc();
  console.log(JSON.stringify({
    status: "OK",
    artifact: `data/research/${season}/availability-signals.json`,
    report,
    contract,
    baselineId: artifact.baseline.baselineId,
    contractVersion: artifact.availabilitySignalsContract.version,
    safeSignals: artifact.dashboardSummary.safeSignals.length,
    blockedSignals: artifact.dashboardSummary.unsafeOrUnknownSignals.length,
    falseNegativesV2: artifact.falsePositiveFalseNegative.falseNegatives.count,
    falsePositivesV2: artifact.falsePositiveFalseNegative.falsePositives.count,
    augmentedModelCreated: artifact.experimentalAugmentedModel.created,
    recommendation: artifact.dashboardSummary.recommendation
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
