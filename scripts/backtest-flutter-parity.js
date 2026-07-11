const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { BacktestRepository } = require("../src/backtest/repository");
const { runFlutterParityBacktest } = require("../src/backtest/flutterParityRunner");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} deve ser inteiro positivo.`);
  }
  return parsed;
}

async function main() {
  const season = parsePositiveInt(argValue("season", "2026"), "season");
  const fromRound = parsePositiveInt(argValue("from", "2"), "from");
  const toRound = parsePositiveInt(argValue("to", "18"), "to");

  if (fromRound > toRound) {
    throw new Error("from nao pode ser maior que to.");
  }

  const summary = runFlutterParityBacktest({
    season,
    fromRound,
    toRound,
    historicalRepository: new HistoricalDataRepository(),
    backtestRepository: new BacktestRepository({ buildId: "build-4.3.1" }),
    previousBacktestRepository: new BacktestRepository({ buildId: "build-4.3.0" })
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
