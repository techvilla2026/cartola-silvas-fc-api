const fs = require("node:fs");
const path = require("node:path");
const { BacktestRepository } = require("../src/backtest/repository");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function pct(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : "n/d";
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "n/d";
}

function tableFromObject(obj) {
  return Object.entries(obj || {})
    .map(([key, value]) => `| ${key} | ${num(value.count)} | ${num(value.mae)} | ${num(value.rmse)} | ${num(value.bias)} |`)
    .join("\n");
}

function main() {
  const season = Number(argValue("season", "2026"));
  const repo = new BacktestRepository({ buildId: "build-4.3.1" });
  const summary = repo.readJson(season, "run-summary.json");
  const manifest = repo.readJson(season, "parity-manifest.json");

  if (!summary || !manifest) {
    throw new Error("Execute o backtest de paridade antes de gerar o relatorio.");
  }

  const prediction = summary.metrics.prediction;
  const team = summary.metrics.team;
  const captain = summary.metrics.captain;
  const comparison = summary.metrics.build430Comparison;
  const baseline = summary.metrics.baselineComparison;
  const scoreBands = summary.metrics.scoreBands || {};
  const central = summary.metrics.centralIntelligence || {};

  const report = `# Backtest 4.3.1 - Paridade Flutter

## O que foi testado

Esta build reproduz no backend as regras auditadas do Flutter para previsao, Nota da analise, qualidade dos dados, selecao 4-3-3, capitao/vice e categorias objetivas da Central Inteligente.

## Dados usados

- Temporada: ${summary.season}
- Rodadas avaliadas: ${summary.fromRound} a ${summary.toRound}
- Schema historico: ${summary.datasetSchemaVersion}
- Leakage: ${summary.leakageStatus}
- Previsoes avaliadas: ${summary.evaluatedPredictions}

## Politicas

- Engine: ${summary.engineVersion}
- Previsao: ${summary.predictionPolicyVersion}
- Nota: ${summary.analysisScorePolicyVersion}
- Qualidade dos dados: ${summary.dataQualityPolicyVersion}
- Selecao: ${summary.selectionPolicyVersion}
- Capitao: ${summary.captainPolicyVersion}

## Fidelidade

Regras reproduzidas: ${manifest.exactRules.join("; ")}.

Diferencas historicas assumidas: ${manifest.approximations.join("; ")}.

Nao reproduzido: ${manifest.notReproduced.join("; ")}.

## Resultados principais

- MAE: ${num(prediction.mae)}
- RMSE: ${num(prediction.rmse)}
- Bias: ${num(prediction.bias)}
- Erro mediano: ${num(prediction.medianAbsoluteError)}
- Dentro de +-1: ${pct(prediction.within1)}
- Dentro de +-2: ${pct(prediction.within2)}
- Dentro de +-3: ${pct(prediction.within3)}
- Dentro de +-5: ${pct(prediction.within5)}
- Pontos acumulados do motor 4.3.1: ${num(team.motorActualTotal)}
- Pontos acumulados do baseline: ${num(team.baselineActualTotal)}

## Comparacao com 4.3.0

- Build 4.3.0: ${num(comparison?.leftActualTotal)}
- Build 4.3.1: ${num(comparison?.rightActualTotal)}
- Diferenca acumulada: ${num(comparison?.cumulativeDifference)}
- Resultado: ${comparison?.result || "n/d"}

## Baseline

- Vitorias: ${baseline.wins}
- Empates: ${baseline.draws}
- Derrotas: ${baseline.losses}
- Diferenca media: ${num(baseline.averageDifference)}
- Diferenca acumulada: ${num(baseline.cumulativeDifference)}

## Capitao

- Melhor do time: ${pct(captain.bestRate)}
- Top 3: ${pct(captain.top3Rate)}
- Negativo: ${pct(captain.negativeRate)}
- Media real: ${num(captain.averageActual)}
- Distancia media para o melhor: ${num(captain.averageGapToBest)}

## Posicoes

| Posicao | Qtd | MAE | RMSE | Bias |
| --- | ---: | ---: | ---: | ---: |
${tableFromObject(summary.metrics.positions)}

## Faixas da Nota

${Object.entries(scoreBands).map(([band, item]) => `- ${band}: ${item.count} atletas, media real ${num(item.averageActual)}, mediana ${num(item.medianActual)}, 5+ ${pct(item.rate5Plus)}, 8+ ${pct(item.rate8Plus)}, 10+ ${pct(item.rate10Plus)}.`).join("\n")}

## Central Inteligente

${Object.entries(central.categories || {}).map(([type, item]) => `- ${type}: ${item.status}, ${item.count} avaliacoes, media real ${num(item.averageActual)}.`).join("\n")}

Comparador: ${central.comparator?.status || "NOT_EVALUATED"} - ${central.comparator?.reason || "sem contexto historico do usuario"}.

## Conclusao

O motor foi portado com fidelidade nas regras que dependem de campos historicos seguros. A ausencia de status, dados recentes de mercado e scouts oficiais por rodada ainda impede paridade absoluta. Nao houve calibracao, otimizacao, machine learning, deploy, push ou alteracao no Flutter.
`;

  fs.mkdirSync(path.resolve("docs"), { recursive: true });
  fs.writeFileSync(path.resolve("docs/backtest-4.3.1-report.md"), report, "utf8");

  const audit = `# Auditoria de Paridade do Motor Flutter

## Arquivos auditados

${manifest.auditedFiles.map((item) => `- ${item.className}: ${item.flutterFile} (${item.sha256})`).join("\n")}

## Regras reproduzidas

${manifest.exactRules.map((item) => `- ${item}`).join("\n")}

## Aproximacoes historicas

${manifest.approximations.map((item) => `- ${item}`).join("\n")}

## Regras nao reproduzidas

${manifest.notReproduced.map((item) => `- ${item}`).join("\n")}
`;
  fs.writeFileSync(path.resolve("docs/flutter-engine-parity-audit.md"), audit, "utf8");
  console.log("docs/backtest-4.3.1-report.md");
  console.log("docs/flutter-engine-parity-audit.md");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
