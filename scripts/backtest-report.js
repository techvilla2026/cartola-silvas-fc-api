const fs = require("node:fs");
const path = require("node:path");
const { BacktestRepository } = require("../src/backtest/repository");

function parseArgs(argv) {
  const args = { season: 2026 };

  for (const arg of argv) {
    if (arg.startsWith("--season=")) args.season = Number(arg.split("=")[1]);
  }

  return args;
}

function formatNumber(value) {
  return value === null || value === undefined ? "n/a" : String(value);
}

function buildReport(season, repository = new BacktestRepository()) {
  const summary = repository.readJson(season, "run-summary.json");

  if (!summary) {
    throw new Error("Resultado de backtest nao encontrado.");
  }

  return `# Backtest Build 4.3.0

Temporada: ${season}

## O que foi testado

Foi avaliada uma politica historica explicita do backend, nao o motor Flutter completo. A politica usa apenas dados pre-rodada v2: media antes da rodada, pontos acumulados, jogos anteriores, mando e preco pre-rodada para metricas de custo-beneficio.

## Auditoria do motor atual

No backend nao havia formulas de previsao, Nota da analise, Time Ideal, capitao, vice, custo-beneficio, recomendacoes, jogadores para evitar ou Comparador. Essas regras parecem existir fora deste backend, no aplicativo Flutter ou em camadas ainda nao portadas.

Por isso, a Build 4.3.0 criou uma Historical Evaluation Engine explicita e versionada:

- Engine: ${summary.engineVersion}
- Politica de previsao: ${summary.predictionPolicyVersion}
- Politica de selecao: ${summary.selectionPolicyVersion}
- Baseline: ${summary.baselinePolicyVersion}

## Dados excluidos

Nao foram usados statusBeforeRound, lineupProbabilityBeforeRound, placares/resultados da rodada como entrada, scouts oficiais divergentes da rodada, recomendacoes Flutter, jogadores para evitar ou comparador.

## Partes avaliadas

- Previsao por atleta.
- Nota da analise da politica historica.
- Time Ideal 4-3-3 sem tecnico.
- Capitao e vice.
- Casa x fora.
- Faixas de preco.
- Baseline por media pre-rodada.

## Partes nao avaliadas

- Recomendacoes positivas: NOT_EVALUATED.
- Jogadores para evitar: NOT_EVALUATED.
- Comparador: NOT_EVALUATED.
- Tecnico: NOT_EVALUATED na selecao inicial.

## Resultados principais

- Rodadas avaliadas: ${summary.roundsEvaluated}
- Rodadas puladas: ${summary.roundsSkipped}
- Atletas elegiveis: ${summary.eligibleAthletes}
- Previsoes avaliadas: ${summary.evaluatedPredictions}
- MAE: ${formatNumber(summary.metrics.prediction.mae)}
- RMSE: ${formatNumber(summary.metrics.prediction.rmse)}
- Bias: ${formatNumber(summary.metrics.prediction.bias)}
- Erro mediano: ${formatNumber(summary.metrics.prediction.medianAbsoluteError)}
- Dentro de +/-1: ${formatNumber(summary.metrics.prediction.within1)}
- Dentro de +/-2: ${formatNumber(summary.metrics.prediction.within2)}
- Dentro de +/-3: ${formatNumber(summary.metrics.prediction.within3)}
- Dentro de +/-5: ${formatNumber(summary.metrics.prediction.within5)}

## Motor x Baseline

- Pontos acumulados do motor: ${formatNumber(summary.metrics.team.motorActualTotal)}
- Pontos acumulados do baseline: ${formatNumber(summary.metrics.team.baselineActualTotal)}
- Vitorias: ${summary.metrics.baselineComparison.wins}
- Empates: ${summary.metrics.baselineComparison.draws}
- Derrotas: ${summary.metrics.baselineComparison.losses}
- Diferenca media: ${formatNumber(summary.metrics.baselineComparison.averageDifference)}
- Diferenca acumulada: ${formatNumber(summary.metrics.baselineComparison.cumulativeDifference)}

## Capitao

- Melhor do time: ${formatNumber(summary.metrics.captain.bestRate)}
- Top 3 do time: ${formatNumber(summary.metrics.captain.top3Rate)}
- Negativo: ${formatNumber(summary.metrics.captain.negativeRate)}
- Gap medio ao melhor: ${formatNumber(summary.metrics.captain.averageGapToBest)}

## Limitacoes

${summary.limitations.map((item) => `- ${item}`).join("\n")}

## Proximos passos

- Portar fielmente o motor Flutter real para o backend, se desejado.
- Investigar scouts divergentes antes de usa-los como feature forte.
- Avaliar recomendacoes, evitar jogadores e comparador quando houver politica backend reproduzivel.
- Rodar uma Build posterior para calibracao, sem alterar esta medicao.
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args.season);
  const outputPath = path.join(process.cwd(), "docs", "backtest-4.3.0-report.md");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");
  console.log(outputPath);
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
  parseArgs,
  buildReport
};
