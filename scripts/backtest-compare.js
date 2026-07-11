const fs = require("node:fs");
const path = require("node:path");
const { BacktestRepository } = require("../src/backtest/repository");
const { compareSummaries } = require("../src/backtest/flutterParityRunner");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "n/d";
}

function main() {
  const season = Number(argValue("season", "2026"));
  const left = argValue("left", "4.3.0");
  const right = argValue("right", "4.3.1");
  const leftSummary = new BacktestRepository({ buildId: `build-${left}` }).readJson(season, "run-summary.json");
  const rightSummary = new BacktestRepository({ buildId: `build-${right}` }).readJson(season, "run-summary.json");

  if (!leftSummary || !rightSummary) {
    throw new Error("Backtests para comparacao nao encontrados.");
  }

  const comparison = compareSummaries(leftSummary, rightSummary.metrics);
  const report = `# Backtest ${left} vs ${right}

| Metrica | ${left} | ${right} |
| --- | ---: | ---: |
| MAE | ${num(leftSummary.metrics.prediction.mae)} | ${num(rightSummary.metrics.prediction.mae)} |
| RMSE | ${num(leftSummary.metrics.prediction.rmse)} | ${num(rightSummary.metrics.prediction.rmse)} |
| Bias | ${num(leftSummary.metrics.prediction.bias)} | ${num(rightSummary.metrics.prediction.bias)} |
| Pontos acumulados | ${num(leftSummary.metrics.team.motorActualTotal)} | ${num(rightSummary.metrics.team.motorActualTotal)} |
| Baseline | ${num(leftSummary.metrics.team.baselineActualTotal)} | ${num(rightSummary.metrics.team.baselineActualTotal)} |

Resultado acumulado: ${comparison.result}, diferenca ${num(comparison.cumulativeDifference)}.

Nao declare vencedor por uma unica metrica. A 4.3.1 mede paridade com o Flutter; a 4.3.0 mede uma politica historica simples.
`;

  fs.mkdirSync(path.resolve("docs"), { recursive: true });
  fs.writeFileSync(path.resolve(`docs/backtest-${left}-vs-${right}.md`), report, "utf8");
  console.log(JSON.stringify(comparison, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
