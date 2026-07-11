const fs = require("node:fs");
const path = require("node:path");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { analyzeScoutDivergences } = require("../src/historical/reconstruction/scoutDivergence");

function parseArgs(argv) {
  const args = { season: 2026, from: 1, to: 18, write: false };

  for (const arg of argv) {
    if (arg.startsWith("--season=")) args.season = Number(arg.split("=")[1]);
    if (arg.startsWith("--from=")) args.from = Number(arg.split("=")[1]);
    if (arg.startsWith("--to=")) args.to = Number(arg.split("=")[1]);
    if (arg === "--write") args.write = true;
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = new HistoricalDataRepository();
  const reports = [];

  for (let round = args.from; round <= args.to; round += 1) {
    const report = repository.readRoundFile(args.season, round, "validation.json");
    if (report) reports.push(report);
  }

  const analysis = analyzeScoutDivergences(reports);
  console.log(JSON.stringify(analysis, null, 2));

  if (args.write) {
    fs.mkdirSync(path.join(process.cwd(), "data/historical", String(args.season)), { recursive: true });
    fs.writeFileSync(
      path.join(process.cwd(), "data/historical", String(args.season), "scout-divergences.json"),
      `${JSON.stringify(analysis, null, 2)}\n`,
      "utf8"
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs
};
