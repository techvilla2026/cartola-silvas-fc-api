#!/usr/bin/env node

const { BacktestRepository } = require("../src/backtest/repository");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  buildAvailabilityCalibration,
  writeAvailabilityReports
} = require("../src/research/availabilityCalibration");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(item);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const season = Number(args.season || 2026);
  const round = Number(args.round || 19);
  const artifact = buildAvailabilityCalibration({
    season,
    round,
    historicalRepository: new HistoricalDataRepository(),
    liveSnapshotRepository: new LiveSnapshotRepository(),
    backtestRepository: new BacktestRepository({ buildId: "build-4.3.2" }),
    researchRepository: new ResearchRepository()
  });
  const reports = writeAvailabilityReports(artifact);
  console.log(JSON.stringify({
    status: "OK",
    artifact: `data/research/${season}/availability-calibration.json`,
    report: reports.reportPath,
    round19Report: reports.roundReportPath,
    promotionState: artifact.promotionGate.state,
    promoted: artifact.promotionGate.promoted
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
