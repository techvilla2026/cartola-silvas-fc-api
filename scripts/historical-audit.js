const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { buildAuditSummary } = require("../src/historical/audit");

function parseArgs(argv) {
  const args = { season: 2026, to: 38 };

  for (const arg of argv) {
    if (arg.startsWith("--season=")) args.season = Number(arg.split("=")[1]);
    if (arg.startsWith("--to=")) args.to = Number(arg.split("=")[1]);
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = new HistoricalDataRepository();
  const summary = buildAuditSummary(repository, args.season, { to: args.to });

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs
};
