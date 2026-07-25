#!/usr/bin/env node

const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  buildBaseline,
  checkBaseline,
  writeBaselineDocumentation,
  writeBaselineReports
} = require("../src/research/researchBaseline");

function parseArgs(argv) {
  const args = { _: [] };
  for (const item of argv) {
    if (item === "--force") args.force = true;
    else {
      const match = /^--([^=]+)=(.+)$/.exec(item);
      if (match) args[match[1]] = match[2];
      else args._.push(item);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] || "generate";
  const season = Number(args.season || 2026);
  const researchRepository = new ResearchRepository();

  if (mode === "check") {
    const result = checkBaseline({ season, researchRepository });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "PASS") process.exitCode = 1;
    return;
  }

  const built = buildBaseline({
    season,
    researchRepository,
    historicalRepository: new HistoricalDataRepository()
  });
  const files = writeBaselineReports({
    ...built,
    researchRepository,
    season,
    force: Boolean(args.force)
  });
  const docs = writeBaselineDocumentation(built.baseline);
  const check = checkBaseline({ season, researchRepository });

  console.log(JSON.stringify({
    status: built.baseline.status,
    baselineId: built.baseline.baselineId,
    baselineFingerprint: built.baseline.baselineFingerprint,
    files,
    docs,
    checkStatus: check.status,
    sourceWorkingTreeState: built.baseline.sourceWorkingTreeState,
    artifactsInManifest: built.manifest.totals.artifacts,
    requiredArtifactsPresent: built.manifest.totals.requiredPresent,
    blockingIssues: built.baseline.blockingIssues
  }, null, 2));

  if (built.baseline.status !== "VALID" || check.status !== "PASS") process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
