#!/usr/bin/env node

const { BacktestRepository } = require("../src/backtest/repository");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  buildEvidenceDashboard,
  writeEvidenceDashboardReport
} = require("../src/research/evidenceDashboard");
const { PreMatchAvailabilityRepository } = require("../src/research/preMatchAvailabilitySource");
const { buildSchedulerReadiness, resolveCurrentCaptureStatus } = require("../src/research/preMatchScheduler");
const path = require("node:path");

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
  const researchRepository = new ResearchRepository();
  const preMatchRepository = new PreMatchAvailabilityRepository({ researchRepository });
  const captureStatus = await resolveCurrentCaptureStatus({ season, repository: preMatchRepository });
  const schedulerReadiness = buildSchedulerReadiness({
    captureStatus,
    workflowPath: path.resolve(__dirname, "../.github/workflows/research-pre-match-auto-capture.yml")
  });
  const dashboard = buildEvidenceDashboard({
    season,
    researchRepository,
    historicalRepository: new HistoricalDataRepository(),
    backtestRepository: new BacktestRepository({ buildId: "build-4.3.2" }),
    schedulerContext: { captureStatus, schedulerReadiness }
  });
  const report = writeEvidenceDashboardReport(dashboard);
  console.log(JSON.stringify({
    status: "OK",
    artifact: `data/research/${season}/slvs-evidence-dashboard.json`,
    report,
    models: dashboard.models.length,
    evidenceRecords: dashboard.evidence.length,
    nextResearchPriority: dashboard.nextResearchPriority.priority,
    promotable: dashboard.promotionGate.some((item) => item.promotionState === "PROMOTABLE")
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
