const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { BACKTEST_ROUND_SCHEMA_VERSION, BACKTEST_SCHEMA_VERSION } = require("./constants");
const { errorMetrics, round: roundNumber } = require("./math");
const { baselinePredictions, selectFormation: selectBaselineFormation } = require("./policy");
const { attachActuals, captainMetrics, costBenefitMetrics, homeAwayMetrics, metricsByPosition, scoreBandMetrics, teamMetrics } = require("./metrics");
const {
  PARITY_ANALYSIS_SCORE_POLICY_VERSION,
  PARITY_BUILD_ID,
  PARITY_CAPTAIN_POLICY_VERSION,
  PARITY_DATA_QUALITY_POLICY_VERSION,
  PARITY_ENGINE_VERSION,
  PARITY_PREDICTION_POLICY_VERSION,
  PARITY_SELECTION_POLICY_VERSION,
  centralIntelligence,
  predictPlayers,
  selectCaptain,
  selectFormation
} = require("./flutterParityPolicy");

const FLUTTER_ROOT = path.resolve(__dirname, "../../../meu_time_ideal");

const AUDITED_FLUTTER_FILES = [
  {
    className: "RuleBasedScorePredictionRepository",
    relativePath: "lib/features/score_prediction/data/rule_based_score_prediction_repository.dart"
  },
  {
    className: "RuleBasedPlayerAnalysisScoreRepository",
    relativePath: "lib/features/player_analysis_score/data/rule_based_player_analysis_score_repository.dart"
  },
  {
    className: "RuleBasedSlvsConfidenceRepository",
    relativePath: "lib/features/slvs_confidence/data/rule_based_slvs_confidence_repository.dart"
  },
  {
    className: "RealPlayerSelectionPolicy",
    relativePath: "lib/features/ideal_team/data/real_player_selection_policy.dart"
  },
  {
    className: "CartolaIdealTeamRepository",
    relativePath: "lib/features/ideal_team/data/cartola_ideal_team_repository.dart"
  },
  {
    className: "RuleBasedCentralIntelligenceRepository",
    relativePath: "lib/features/central_intelligence/data/rule_based_central_intelligence_repository.dart"
  },
  {
    className: "RealTeamComparisonRepository",
    relativePath: "lib/features/compare_team/data/real_team_comparison_repository.dart"
  },
  {
    className: "SuggestedSwap",
    relativePath: "lib/features/compare_team/domain/suggested_swap.dart"
  }
];

function roundFile(round) {
  return `round-${String(round).padStart(2, "0")}.json`;
}

function readHash(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

function createParityManifest() {
  return {
    schemaVersion: "flutter-parity-manifest/v1",
    buildId: PARITY_BUILD_ID,
    generatedAt: new Date().toISOString(),
    flutterRoot: FLUTTER_ROOT,
    engineVersion: PARITY_ENGINE_VERSION,
    predictionPolicyVersion: PARITY_PREDICTION_POLICY_VERSION,
    analysisScorePolicyVersion: PARITY_ANALYSIS_SCORE_POLICY_VERSION,
    dataQualityPolicyVersion: PARITY_DATA_QUALITY_POLICY_VERSION,
    selectionPolicyVersion: PARITY_SELECTION_POLICY_VERSION,
    captainPolicyVersion: PARITY_CAPTAIN_POLICY_VERSION,
    auditedFiles: AUDITED_FLUTTER_FILES.map((item) => {
      const filePath = path.join(FLUTTER_ROOT, item.relativePath);
      return {
        className: item.className,
        flutterFile: item.relativePath,
        sha256: fs.existsSync(filePath) ? readHash(filePath) : null
      };
    }),
    historicalFieldPolicy: {
      historicalStatusMode: "unavailable-neutral",
      historicalRecentDataMode: "unavailable-zero",
      historicalScoutMode: "divergent-not-used",
      coachMode: "excluded-from-historical-team-evaluation"
    },
    exactRules: [
      "Formula de previsao por media, bonus de media alta, bonus de mando, clamp e arredondamento.",
      "Qualidade dos dados com pesos, redutores, bonus de dados completos e faixas internas.",
      "Nota da analise com pesos, componentes, limitador por qualidade e faixas.",
      "Selecao 4-3-3 por status, media, mando, preco e id.",
      "Capitao e vice por previsao, Nota, qualidade dos dados e media."
    ],
    approximations: [
      "Status historico indisponivel foi mantido vazio, como componente neutro/conservador.",
      "Dados recentes do mercado Flutter, como pontos_num e variacao_num atuais, foram zerados por nao existirem de forma pre-rodada segura.",
      "Scouts historicos acumulados nao foram usados na qualidade por divergencia documentada entre fontes."
    ],
    notReproduced: [
      "Comparador historico, por falta de elenco real do usuario antes de cada rodada.",
      "Tecnico na avaliacao do time, por falta de dados historicos seguros suficientes no mesmo contrato."
    ]
  };
}

function loadRound(repository, season, round) {
  const pre = repository.readRoundFile(season, round, "pre-round.json");
  const post = repository.readRoundFile(season, round, "post-round.json");
  const leakage = repository.readRoundFile(season, round, "leakage.json");

  if (!pre) return { skipReason: "PRE_ROUND_MISSING" };
  if (!post) return { skipReason: "POST_ROUND_MISSING" };
  if (!leakage) return { skipReason: "LEAKAGE_REPORT_MISSING" };
  if (pre.schemaVersion !== "historical-pre-round-data/v2") return { skipReason: "INCOMPATIBLE_PRE_ROUND_SCHEMA" };
  if (pre.readiness?.status !== "READY") return { skipReason: `ROUND_${pre.readiness?.status || "NOT_READY"}` };
  if (leakage.status === "FAIL") return { skipReason: "LEAKAGE_FAIL" };

  return { pre, post, leakage };
}

function evaluateParityRound({ season, round, pre, post, leakage }) {
  const predictions = predictPlayers(pre);
  const decision = {
    selectedTeam: selectFormation(predictions),
    baselineTeam: selectBaselineFormation(baselinePredictions(pre))
  };
  const { captain, viceCaptain } = selectCaptain(decision.selectedTeam);
  decision.captain = captain;
  decision.viceCaptain = viceCaptain;
  decision.centralIntelligence = centralIntelligence(decision.selectedTeam);
  decision.frozenAt = new Date().toISOString();
  decision.usedPostRoundBeforeFreeze = false;

  const evaluatedPredictions = attachActuals(predictions, post);
  const teamWithActuals = attachActuals(decision.selectedTeam, post);
  const baselineWithActuals = attachActuals(decision.baselineTeam, post);
  const centralWithActuals = attachCentralActuals(decision.centralIntelligence, teamWithActuals);
  const team = teamMetrics(teamWithActuals);
  const baselineTeam = teamMetrics(baselineWithActuals);

  return {
    schemaVersion: BACKTEST_ROUND_SCHEMA_VERSION,
    season,
    round,
    leakageStatus: leakage.status,
    decisionsFrozenBeforePostRoundComparison: true,
    engineVersion: PARITY_ENGINE_VERSION,
    predictionPolicyVersion: PARITY_PREDICTION_POLICY_VERSION,
    analysisScorePolicyVersion: PARITY_ANALYSIS_SCORE_POLICY_VERSION,
    dataQualityPolicyVersion: PARITY_DATA_QUALITY_POLICY_VERSION,
    selectionPolicyVersion: PARITY_SELECTION_POLICY_VERSION,
    captainPolicyVersion: PARITY_CAPTAIN_POLICY_VERSION,
    eligibleAthletes: predictions.length,
    evaluatedPredictions: evaluatedPredictions.length,
    predictions: evaluatedPredictions,
    selectedTeam: teamWithActuals,
    baselineTeam: baselineWithActuals,
    centralIntelligence: centralWithActuals,
    captain: captainMetrics(teamWithActuals, captain, viceCaptain),
    metrics: {
      prediction: errorMetrics(evaluatedPredictions.map((item) => ({ predicted: item.predictedPoints, actual: item.actualPoints }))),
      positions: metricsByPosition(evaluatedPredictions),
      scoreBands: scoreBandMetrics(evaluatedPredictions),
      homeAway: homeAwayMetrics(evaluatedPredictions),
      costBenefit: costBenefitMetrics(evaluatedPredictions),
      team,
      baselineTeam,
      comparison: {
        motorActual: team.actualTotal,
        baselineActual: baselineTeam.actualTotal,
        difference: roundNumber(team.actualTotal - baselineTeam.actualTotal),
        result: team.actualTotal > baselineTeam.actualTotal ? "WIN" : team.actualTotal < baselineTeam.actualTotal ? "LOSS" : "DRAW"
      }
    }
  };
}

function attachCentralActuals(recommendations, teamWithActuals) {
  const actuals = new Map(teamWithActuals.map((player) => [String(player.athleteId), player.actualPoints]));
  return recommendations.map((item) => ({
    type: item.type,
    status: item.status,
    athleteId: item.player?.athleteId || null,
    predictedPoints: item.player?.predictedPoints ?? null,
    analysisGrade: item.player?.analysisGrade ?? null,
    dataQualityScore: item.player?.dataQualityScore ?? null,
    actualPoints: item.player ? actuals.get(String(item.player.athleteId)) ?? null : null
  }));
}

function centralMetrics(roundResults) {
  const items = roundResults.flatMap((roundResult) => roundResult.centralIntelligence || []);
  const groups = {};
  for (const item of items) {
    groups[item.type] = groups[item.type] || [];
    groups[item.type].push(item);
  }

  const result = {
    categories: {},
    comparator: {
      status: "NOT_EVALUATED",
      reason: "Nao ha elenco real historico do usuario antes da rodada; o projeto Flutter usa UserLineupRepository em tempo atual."
    }
  };

  for (const [type, categoryItems] of Object.entries(groups)) {
    const evaluated = categoryItems.filter((item) => Number.isFinite(item.actualPoints));
    result.categories[type] = {
      status: categoryItems.some((item) => item.status === "PARTIALLY_EVALUATED") ? "PARTIALLY_EVALUATED" : "EVALUATED",
      count: evaluated.length,
      averagePrediction: average(evaluated.map((item) => item.predictedPoints)),
      averageAnalysisGrade: average(evaluated.map((item) => item.analysisGrade)),
      averageActual: average(evaluated.map((item) => item.actualPoints)),
      negativeRate: rate(evaluated, (item) => item.actualPoints < 0),
      rate5Plus: rate(evaluated, (item) => item.actualPoints >= 5),
      rate8Plus: rate(evaluated, (item) => item.actualPoints >= 8),
      rate10Plus: rate(evaluated, (item) => item.actualPoints >= 10),
      below3Rate: type === "playerToAvoid" ? rate(evaluated, (item) => item.actualPoints < 3) : undefined,
      falseNegative8Plus: type === "playerToAvoid" ? evaluated.filter((item) => item.actualPoints >= 8).length : undefined,
      falseNegative10Plus: type === "playerToAvoid" ? evaluated.filter((item) => item.actualPoints >= 10).length : undefined
    };
  }

  return result;
}

function average(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? roundNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;
}

function rate(items, predicate) {
  return items.length ? roundNumber(items.filter(predicate).length / items.length) : null;
}

function mergeParityMetrics(roundResults, build430Summary) {
  const predictions = roundResults.flatMap((roundResult) => roundResult.predictions);
  const comparisons = roundResults.map((roundResult) => roundResult.metrics.comparison);
  const captainRounds = roundResults.map((roundResult) => roundResult.captain);
  const motorTotal = roundResults.reduce((sum, item) => sum + item.metrics.team.actualTotal, 0);
  const baselineTotal = roundResults.reduce((sum, item) => sum + item.metrics.baselineTeam.actualTotal, 0);

  const metrics = {
    prediction: errorMetrics(predictions.map((item) => ({ predicted: item.predictedPoints, actual: item.actualPoints }))),
    positions: metricsByPosition(predictions),
    scoreBands: scoreBandMetrics(predictions),
    homeAway: homeAwayMetrics(predictions),
    costBenefit: costBenefitMetrics(predictions),
    team: {
      motorActualTotal: roundNumber(motorTotal),
      baselineActualTotal: roundNumber(baselineTotal),
      motorPredictedTotal: roundNumber(roundResults.reduce((sum, item) => sum + item.metrics.team.predictedTotal, 0)),
      baselinePredictedTotal: roundNumber(roundResults.reduce((sum, item) => sum + item.metrics.baselineTeam.predictedTotal, 0)),
      rounds: roundResults.length
    },
    captain: {
      rounds: captainRounds.length,
      bestRate: captainRounds.length ? roundNumber(captainRounds.filter((item) => item.captainWasBest).length / captainRounds.length) : null,
      top3Rate: captainRounds.length ? roundNumber(captainRounds.filter((item) => item.captainWasTop3).length / captainRounds.length) : null,
      negativeRate: captainRounds.length ? roundNumber(captainRounds.filter((item) => item.captainNegative).length / captainRounds.length) : null,
      averageActual: average(captainRounds.map((item) => item.captainActual)),
      averageGapToBest: roundNumber(captainRounds.reduce((sum, item) => sum + Number(item.captainGapToBest || 0), 0) / (captainRounds.length || 1))
    },
    baselineComparison: {
      wins: comparisons.filter((item) => item.result === "WIN").length,
      draws: comparisons.filter((item) => item.result === "DRAW").length,
      losses: comparisons.filter((item) => item.result === "LOSS").length,
      averageDifference: roundNumber(comparisons.reduce((sum, item) => sum + item.difference, 0) / (comparisons.length || 1)),
      cumulativeDifference: roundNumber(comparisons.reduce((sum, item) => sum + item.difference, 0))
    },
    centralIntelligence: centralMetrics(roundResults)
  };

  metrics.build430Comparison = build430Summary ? compareSummaries(build430Summary, metrics) : null;
  return metrics;
}

function compareSummaries(leftSummary, rightMetrics) {
  const leftTeam = leftSummary.metrics?.team || {};
  const leftPrediction = leftSummary.metrics?.prediction || {};
  const rightTeam = rightMetrics.team || {};
  const rightPrediction = rightMetrics.prediction || {};
  const diff = roundNumber(Number(rightTeam.motorActualTotal || 0) - Number(leftTeam.motorActualTotal || 0));

  return {
    leftBuild: "4.3.0",
    rightBuild: "4.3.1",
    maeDifference: roundNumber(Number(rightPrediction.mae || 0) - Number(leftPrediction.mae || 0)),
    rmseDifference: roundNumber(Number(rightPrediction.rmse || 0) - Number(leftPrediction.rmse || 0)),
    biasDifference: roundNumber(Number(rightPrediction.bias || 0) - Number(leftPrediction.bias || 0)),
    leftActualTotal: leftTeam.motorActualTotal,
    rightActualTotal: rightTeam.motorActualTotal,
    cumulativeDifference: diff,
    result: diff > 0 ? "RIGHT_HIGHER" : diff < 0 ? "LEFT_HIGHER" : "DRAW"
  };
}

function runFlutterParityBacktest({ season, fromRound, toRound, historicalRepository, backtestRepository, previousBacktestRepository }) {
  const roundResults = [];
  const skipped = [];
  const previousSummary = previousBacktestRepository?.readJson(season, "run-summary.json") || null;

  for (let round = fromRound; round <= toRound; round += 1) {
    const loaded = loadRound(historicalRepository, season, round);
    if (loaded.skipReason) {
      skipped.push({ round, reason: loaded.skipReason });
      continue;
    }

    const result = evaluateParityRound({ season, round, pre: loaded.pre, post: loaded.post, leakage: loaded.leakage });
    roundResults.push(result);
    backtestRepository.writeJson(season, path.join("rounds", roundFile(round)), result);
  }

  const metrics = mergeParityMetrics(roundResults, previousSummary);
  const manifest = createParityManifest();
  const summary = {
    schemaVersion: BACKTEST_SCHEMA_VERSION,
    season,
    fromRound,
    toRound,
    generatedAt: new Date().toISOString(),
    datasetSchemaVersion: "historical-pre-round-data/v2",
    engineVersion: PARITY_ENGINE_VERSION,
    predictionPolicyVersion: PARITY_PREDICTION_POLICY_VERSION,
    analysisScorePolicyVersion: PARITY_ANALYSIS_SCORE_POLICY_VERSION,
    dataQualityPolicyVersion: PARITY_DATA_QUALITY_POLICY_VERSION,
    selectionPolicyVersion: PARITY_SELECTION_POLICY_VERSION,
    captainPolicyVersion: PARITY_CAPTAIN_POLICY_VERSION,
    baselinePolicyVersion: "baseline-average-4-3-3-v1",
    buildId: PARITY_BUILD_ID,
    roundsRequested: toRound - fromRound + 1,
    roundsEvaluated: roundResults.length,
    roundsSkipped: skipped.length,
    skipReasons: skipped,
    eligibleAthletes: roundResults.reduce((sum, item) => sum + item.eligibleAthletes, 0),
    evaluatedPredictions: roundResults.reduce((sum, item) => sum + item.evaluatedPredictions, 0),
    leakageStatus: skipped.some((item) => item.reason === "LEAKAGE_FAIL") ? "FAIL" : "PASS",
    warnings: manifest.approximations,
    limitations: manifest.notReproduced,
    metrics
  };

  backtestRepository.writeJson(season, "run-summary.json", summary);
  backtestRepository.writeJson(season, "parity-manifest.json", manifest);
  backtestRepository.writeJson(season, "metrics/prediction.json", metrics.prediction);
  backtestRepository.writeJson(season, "metrics/positions.json", metrics.positions);
  backtestRepository.writeJson(season, "metrics/team.json", metrics.team);
  backtestRepository.writeJson(season, "metrics/captain.json", metrics.captain);
  backtestRepository.writeJson(season, "metrics/score-bands.json", metrics.scoreBands);
  backtestRepository.writeJson(season, "metrics/home-away.json", metrics.homeAway);
  backtestRepository.writeJson(season, "metrics/cost-benefit.json", metrics.costBenefit);
  backtestRepository.writeJson(season, "metrics/central-intelligence.json", metrics.centralIntelligence);
  backtestRepository.writeJson(season, "comparison/baseline-average.json", metrics.baselineComparison);
  backtestRepository.writeJson(season, "comparison/build-4.3.0.json", metrics.build430Comparison);

  return summary;
}

module.exports = {
  AUDITED_FLUTTER_FILES,
  createParityManifest,
  compareSummaries,
  evaluateParityRound,
  runFlutterParityBacktest
};
