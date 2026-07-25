#!/usr/bin/env node

const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { BacktestRepository } = require("../src/backtest/repository");
const { ResearchRepository } = require("../src/research/repository");
const {
  buildMultiRoundCalibration,
  fetchOfficialMatchesSafely,
  writeMultiRoundReport
} = require("../src/research/multiRoundCalibration");

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
  const officialMatchesPayload = await fetchOfficialMatchesSafely(globalThis.fetch);
  const artifact = buildMultiRoundCalibration({
    season,
    round,
    officialMatchesPayload,
    historicalRepository: new HistoricalDataRepository(),
    liveSnapshotRepository: new LiveSnapshotRepository(),
    backtestRepository: new BacktestRepository({ buildId: "build-4.3.2" }),
    researchRepository: new ResearchRepository()
  });
  const reportPath = writeMultiRoundReport(artifact);
  console.log(JSON.stringify({
    status: "OK",
    artifact: `data/research/${season}/multi-round-calibration.json`,
    report: reportPath,
    corRemClosed: artifact.round19Closure.closed,
    promotable: artifact.promotionGate.anyPromotable
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
