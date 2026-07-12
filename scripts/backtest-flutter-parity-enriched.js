const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { EnrichedHistoricalRepository } = require("../src/historical/enrichment/enrichedRepository");
const { BacktestRepository } = require("../src/backtest/repository");
const { runFlutterParityEnrichedBacktest } = require("../src/backtest/flutterParityEnrichedRunner");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function main() {
  const season = Number(argValue("season", "2026"));
  const fromRound = Number(argValue("from", "2"));
  const toRound = Number(argValue("to", "18"));
  const summary = runFlutterParityEnrichedBacktest({
    season,
    fromRound,
    toRound,
    historicalRepository: new HistoricalDataRepository(),
    enrichedRepository: new EnrichedHistoricalRepository(),
    backtestRepository: new BacktestRepository({ buildId: "build-4.3.2" }),
    previousBacktestRepositories: {
      "4.3.0": new BacktestRepository({ buildId: "build-4.3.0" }),
      "4.3.1": new BacktestRepository({ buildId: "build-4.3.1" })
    }
  });

  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
