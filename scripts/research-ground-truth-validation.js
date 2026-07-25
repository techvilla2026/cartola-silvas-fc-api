#!/usr/bin/env node

const { BacktestRepository } = require("../src/backtest/repository");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  buildGroundTruthValidation,
  writeGroundTruthReports
} = require("../src/research/groundTruthValidation");

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
  const result = buildGroundTruthValidation({
    season,
    historicalRepository: new HistoricalDataRepository(),
    backtestRepository: new BacktestRepository({ buildId: "build-4.3.2" }),
    liveSnapshotRepository: new LiveSnapshotRepository(),
    researchRepository: new ResearchRepository()
  });
  const reports = writeGroundTruthReports(result);
  console.log(JSON.stringify({
    status: "OK",
    validation: `data/research/${season}/ground-truth-validation.json`,
    topkAudit: `data/research/${season}/ground-truth-topk-audit.json`,
    report: reports.reportPath,
    round19Report: reports.round19Path,
    didNotPlayCases: result.validation.targetSummary.didNotPlayCases,
    top5DidNotPlayRate: result.topkAudit.aggregate.top5.didNotPlayRateAllSelected,
    nextResearchPriority: result.validation.conclusions.nextResearchPriority
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
