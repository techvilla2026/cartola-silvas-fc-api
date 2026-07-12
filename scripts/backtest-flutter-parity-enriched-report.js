const fs = require("node:fs");
const path = require("node:path");
const { BacktestRepository } = require("../src/backtest/repository");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "n/d";
}

function pct(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : "n/d";
}

function main() {
  const season = Number(argValue("season", "2026"));
  const repo = new BacktestRepository({ buildId: "build-4.3.2" });
  const summary = repo.readJson(season, "run-summary.json");
  if (!summary) throw new Error("Execute o backtest enriquecido antes do relatorio.");

  const p = summary.metrics.prediction;
  const t = summary.metrics.team;
  const c = summary.metrics.captain;
  const compare = summary.metrics.compareAll;
  const bands = summary.metrics.scoreBands || {};
  const quality = summary.metrics.dataQuality || {};

  const report = `# Backtest 4.3.2 - Paridade Flutter Enriquecida

## O que mudou

A formula do motor Flutter permanece igual. A unica diferenca da 4.3.2 e a disponibilidade de forma recente reconstruida somente com rodadas anteriores.

Status pre-rodada segue indisponivel. Scouts historicos seguem desativados como oficiais.

## Resultados

- Rodadas avaliadas: ${summary.roundsEvaluated}
- Previsoes avaliadas: ${summary.evaluatedPredictions}
- MAE: ${num(p.mae)}
- RMSE: ${num(p.rmse)}
- Bias: ${num(p.bias)}
- Erro mediano: ${num(p.medianAbsoluteError)}
- Dentro de +-1: ${pct(p.within1)}
- Dentro de +-2: ${pct(p.within2)}
- Dentro de +-3: ${pct(p.within3)}
- Dentro de +-5: ${pct(p.within5)}
- Pontos acumulados 4.3.2: ${num(t.motorActualTotal)}
- Baseline: ${num(t.baselineActualTotal)}

## Qualidade dos dados

${Object.entries(quality).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Nota da analise

${Object.entries(bands).map(([band, item]) => `- ${band}: ${item.count} atletas, media real ${num(item.averageActual)}, mediana ${num(item.medianActual)}, negativo ${pct(item.negativeRate)}, 5+ ${pct(item.rate5Plus)}, 8+ ${pct(item.rate8Plus)}, 10+ ${pct(item.rate10Plus)}.`).join("\n")}

## Capitao

- Melhor do time: ${pct(c.bestRate)}
- Top 3: ${pct(c.top3Rate)}
- Negativo: ${pct(c.negativeRate)}
- Media real: ${num(c.averageActual)}
- Distancia media para o melhor: ${num(c.averageGapToBest)}

## Comparacao

- 4.3.0: ${num(compare.builds["4.3.0"]?.motorActualTotal)}
- 4.3.1: ${num(compare.builds["4.3.1"]?.motorActualTotal)}
- 4.3.2: ${num(compare.builds["4.3.2"]?.motorActualTotal)}
- Diferenca 4.3.2 vs 4.3.1: ${num(compare.conclusion.enrichedVs431Points)}
- Diferenca 4.3.2 vs baseline: ${num(compare.conclusion.enrichedVsBaselinePoints)}

## Conclusao

Os dados recentes enriquecem a Qualidade e a Nota sem alterar pesos. A calibracao ainda nao deve comecar enquanto status pre-rodada e lineupProbabilityBeforeRound permanecerem indisponiveis.
`;

  fs.mkdirSync(path.resolve("docs"), { recursive: true });
  fs.writeFileSync(path.resolve("docs/backtest-4.3.2-report.md"), report, "utf8");
  console.log("docs/backtest-4.3.2-report.md");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
