const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { checkPreRoundLeakage } = require("../src/historical/reconstruction/leakageChecker");

function parseArgs(argv) {
  const args = { season: 2026, from: 1, to: 18 };

  for (const arg of argv) {
    if (arg.startsWith("--season=")) args.season = Number(arg.split("=")[1]);
    if (arg.startsWith("--from=")) args.from = Number(arg.split("=")[1]);
    if (arg.startsWith("--to=")) args.to = Number(arg.split("=")[1]);
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = new HistoricalDataRepository();
  const results = [];

  for (let round = args.from; round <= args.to; round += 1) {
    const preRound = repository.readRoundFile(args.season, round, "pre-round.json");

    if (!preRound) {
      results.push({
        season: args.season,
        round,
        status: "FAIL",
        issues: [{ code: "MISSING_PRE_ROUND" }],
        warnings: []
      });
      continue;
    }

    results.push(checkPreRoundLeakage(preRound));
  }

  const summary = {
    season: args.season,
    from: args.from,
    to: args.to,
    pass: results.filter((item) => item.status === "PASS").length,
    warning: results.filter((item) => item.status === "WARNING").length,
    fail: results.filter((item) => item.status === "FAIL").length,
    results
  };

  console.log(JSON.stringify(summary, null, 2));

  if (summary.fail > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs
};
