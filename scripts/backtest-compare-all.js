const fs = require("node:fs");
const path = require("node:path");
const { BacktestRepository } = require("../src/backtest/repository");
const { compareBuilds } = require("../src/backtest/flutterParityEnrichedRunner");

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
  const summaries = {
    "4.3.0": new BacktestRepository({ buildId: "build-4.3.0" }).readJson(season, "run-summary.json"),
    "4.3.1": new BacktestRepository({ buildId: "build-4.3.1" }).readJson(season, "run-summary.json"),
    "4.3.2": new BacktestRepository({ buildId: "build-4.3.2" }).readJson(season, "run-summary.json")
  };
  const comparison = compareBuilds(summaries);
  const report = `# Backtest 4.3.0 vs 4.3.1 vs 4.3.2

| Build | MAE | RMSE | Bias | Pontos | Baseline | Capitao melhor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${Object.entries(comparison.builds).map(([build, item]) => `| ${build} | ${num(item.mae)} | ${num(item.rmse)} | ${num(item.bias)} | ${num(item.motorActualTotal)} | ${num(item.baselineActualTotal)} | ${num(item.captainBestRate)} |`).join("\n")}

4.3.2 vs 4.3.1: ${num(comparison.conclusion.enrichedVs431Points)} ponto(s).
4.3.2 vs baseline: ${num(comparison.conclusion.enrichedVsBaselinePoints)} ponto(s).
`;

  fs.mkdirSync(path.resolve("docs"), { recursive: true });
  fs.writeFileSync(path.resolve("docs/backtest-4.3.0-vs-4.3.1-vs-4.3.2.md"), report, "utf8");
  console.log(JSON.stringify(comparison, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
