const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { BacktestRepository } = require("../src/backtest/repository");
const { runBacktest } = require("../src/backtest/runner");

function parseArgs(argv) {
  const args = { season: 2026, round: 18 };

  for (const arg of argv) {
    if (arg.startsWith("--season=")) args.season = Number(arg.split("=")[1]);
    if (arg.startsWith("--round=")) args.round = Number(arg.split("=")[1]);
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = runBacktest({
    season: args.season,
    fromRound: args.round,
    toRound: args.round,
    historicalRepository: new HistoricalDataRepository(),
    backtestRepository: new BacktestRepository()
  });

  console.log(JSON.stringify(summary, null, 2));
  if (summary.roundsEvaluated === 0) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs };
