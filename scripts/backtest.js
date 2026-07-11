const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { BacktestRepository } = require("../src/backtest/repository");
const { runBacktest } = require("../src/backtest/runner");

function parseArgs(argv) {
  const args = { season: 2026, from: 2, to: 18 };

  for (const arg of argv) {
    if (arg.startsWith("--season=")) args.season = Number(arg.split("=")[1]);
    if (arg.startsWith("--from=")) args.from = Number(arg.split("=")[1]);
    if (arg.startsWith("--to=")) args.to = Number(arg.split("=")[1]);
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const historicalRepository = new HistoricalDataRepository();
  const backtestRepository = new BacktestRepository();
  const summary = runBacktest({
    season: args.season,
    fromRound: args.from,
    toRound: args.to,
    historicalRepository,
    backtestRepository
  });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.roundsEvaluated === 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs
};
