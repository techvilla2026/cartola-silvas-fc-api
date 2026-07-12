const path = require("node:path");
const { BACKTEST_ROUND_SCHEMA_VERSION, BACKTEST_SCHEMA_VERSION } = require("./constants");
const { errorMetrics, round: roundNumber } = require("./math");
const { baselinePredictions, selectFormation: selectBaselineFormation } = require("./policy");
const { attachActuals, captainMetrics, costBenefitMetrics, homeAwayMetrics, metricsByPosition, scoreBandMetrics, teamMetrics } = require("./metrics");
const {
  PARITY_ANALYSIS_SCORE_POLICY_VERSION,
  PARITY_CAPTAIN_POLICY_VERSION,
  PARITY_DATA_QUALITY_POLICY_VERSION,
  PARITY_PREDICTION_POLICY_VERSION,
  PARITY_SELECTION_POLICY_VERSION,
  centralIntelligence,
  predictPlayers,
  selectCaptain,
  selectFormation
} = require("./flutterParityPolicy");

const ENRICHED_ENGINE_VERSION = "flutter-parity-enriched-engine/4.3.2";
const ENRICHED_BUILD_ID = "build-4.3.2";

function roundFile(round) {
  return `round-${String(round).padStart(2, "0")}.json`;
}

function average(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? roundNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;
}

function rate(items, predicate) {
  return items.length ? roundNumber(items.filter(predicate).length / items.length) : null;
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

  const categories = {};
  for (const [type, categoryItems] of Object.entries(groups)) {
    const evaluated = categoryItems.filter((item) => Number.isFinite(item.actualPoints));
    categories[type] = {
      status: categoryItems.some((item) => item.status === "PARTIALLY_EVALUATED") ? "PARTIALLY_EVALUATED" : "EVALUATED",
      count: evaluated.length,
      averagePrediction: average(evaluated.map((item) => item.predictedPoints)),
      averageAnalysisGrade: average(evaluated.map((item) => item.analysisGrade)),
      averageActual: average(evaluated.map((item) => item.actualPoints)),
      negativeRate: rate(evaluated, (item) => item.actualPoints < 0),
      rate5Plus: rate(evaluated, (item) => item.actualPoints >= 5),
      rate8Plus: rate(evaluated, (item) => item.actualPoints >= 8),
      rate10Plus: rate(evaluated, (item) => item.actualPoints >= 10)
    };
  }

  return {
    categories,
    comparator: {
      status: "NOT_EVALUATED",
      reason: "Nao ha elenco real historico do usuario antes da rodada."
    }
  };
}

function dataQualityDistribution(predictions) {
  const result = {
    "Dados insuficientes para avaliar": 0,
    "Dados insuficientes": 0,
    "Dados suficientes": 0,
    "Dados completos": 0
  };

  for (const player of predictions) {
    if (player.dataQualityRoundedScore >= 85) result["Dados completos"] += 1;
    else if (player.dataQualityRoundedScore >= 50) result["Dados suficientes"] += 1;
    else if (player.dataQualityLevel === "unavailable") result["Dados insuficientes para avaliar"] += 1;
    else result["Dados insuficientes"] += 1;
  }

  return result;
}

function evaluateEnrichedRound({ season, round, enriched, post, leakage }) {
  const predictions = predictPlayers(enriched);
  const selectedTeam = selectFormation(predictions);
  const baselineTeamRaw = selectBaselineFormation(baselinePredictions(enriched));
  const { captain, viceCaptain } = selectCaptain(selectedTeam);
  const central = centralIntelligence(selectedTeam);

  const evaluatedPredictions = attachActuals(predictions, post);
  const teamWithActuals = attachActuals(selectedTeam, post);
  const baselineWithActuals = attachActuals(baselineTeamRaw, post);
  const team = teamMetrics(teamWithActuals);
  const baselineTeam = teamMetrics(baselineWithActuals);

  return {
    schemaVersion: BACKTEST_ROUND_SCHEMA_VERSION,
    season,
    round,
    leakageStatus: leakage.status,
    decisionsFrozenBeforePostRoundComparison: true,
    engineVersion: ENRICHED_ENGINE_VERSION,
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
    centralIntelligence: attachCentralActuals(central, teamWithActuals),
    captain: captainMetrics(teamWithActuals, captain, viceCaptain),
    metrics: {
      prediction: errorMetrics(evaluatedPredictions.map((item) => ({ predicted: item.predictedPoints, actual: item.actualPoints }))),
      positions: metricsByPosition(evaluatedPredictions),
      scoreBands: scoreBandMetrics(evaluatedPredictions),
      homeAway: homeAwayMetrics(evaluatedPredictions),
      costBenefit: costBenefitMetrics(evaluatedPredictions),
      dataQuality: dataQualityDistribution(evaluatedPredictions),
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

function compareBuilds(summaries) {
  const builds = {};
  for (const [build, summary] of Object.entries(summaries)) {
    if (!summary) continue;
    builds[build] = {
      mae: summary.metrics?.prediction?.mae,
      rmse: summary.metrics?.prediction?.rmse,
      bias: summary.metrics?.prediction?.bias,
      medianAbsoluteError: summary.metrics?.prediction?.medianAbsoluteError,
      motorActualTotal: summary.metrics?.team?.motorActualTotal,
      baselineActualTotal: summary.metrics?.team?.baselineActualTotal,
      captainBestRate: summary.metrics?.captain?.bestRate,
      captainTop3Rate: summary.metrics?.captain?.top3Rate
    };
  }

  return {
    schemaVersion: "backtest-compare-all/v1",
    generatedAt: new Date().toISOString(),
    builds,
    conclusion: {
      enrichedVs431Points: builds["4.3.2"] && builds["4.3.1"] ? roundNumber(builds["4.3.2"].motorActualTotal - builds["4.3.1"].motorActualTotal) : null,
      enrichedVsBaselinePoints: builds["4.3.2"] ? roundNumber(builds["4.3.2"].motorActualTotal - builds["4.3.2"].baselineActualTotal) : null
    }
  };
}

function mergeMetrics(roundResults, previousSummaries = {}) {
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
    dataQuality: dataQualityDistribution(predictions),
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

  metrics.compareAll = compareBuilds({ ...previousSummaries, "4.3.2": { metrics } });
  return metrics;
}

function runFlutterParityEnrichedBacktest({ season, fromRound, toRound, historicalRepository, enrichedRepository, backtestRepository, previousBacktestRepositories = {} }) {
  const roundResults = [];
  const skipped = [];
  const previousSummaries = {};

  for (const [build, repository] of Object.entries(previousBacktestRepositories)) {
    previousSummaries[build] = repository.readJson(season, "run-summary.json");
  }

  for (let round = fromRound; round <= toRound; round += 1) {
    const enriched = enrichedRepository.readRoundFile(season, round, "pre-round-enriched.json");
    const leakage = enrichedRepository.readRoundFile(season, round, "leakage.json");
    const post = historicalRepository.readRoundFile(season, round, "post-round.json");

    if (!enriched) {
      skipped.push({ round, reason: "ENRICHED_PRE_ROUND_MISSING" });
      continue;
    }
    if (!post) {
      skipped.push({ round, reason: "POST_ROUND_MISSING" });
      continue;
    }
    if (!leakage) {
      skipped.push({ round, reason: "ENRICHED_LEAKAGE_MISSING" });
      continue;
    }
    if (leakage.status === "FAIL") {
      skipped.push({ round, reason: "ENRICHED_LEAKAGE_FAIL" });
      continue;
    }

    const result = evaluateEnrichedRound({ season, round, enriched, post, leakage });
    roundResults.push(result);
    backtestRepository.writeJson(season, path.join("rounds", roundFile(round)), result);
  }

  const metrics = mergeMetrics(roundResults, previousSummaries);
  const summary = {
    schemaVersion: BACKTEST_SCHEMA_VERSION,
    season,
    fromRound,
    toRound,
    generatedAt: new Date().toISOString(),
    datasetSchemaVersion: "historical-pre-round-enriched-data/v1",
    engineVersion: ENRICHED_ENGINE_VERSION,
    predictionPolicyVersion: PARITY_PREDICTION_POLICY_VERSION,
    analysisScorePolicyVersion: PARITY_ANALYSIS_SCORE_POLICY_VERSION,
    dataQualityPolicyVersion: PARITY_DATA_QUALITY_POLICY_VERSION,
    selectionPolicyVersion: PARITY_SELECTION_POLICY_VERSION,
    captainPolicyVersion: PARITY_CAPTAIN_POLICY_VERSION,
    baselinePolicyVersion: "baseline-average-4-3-3-v1",
    buildId: ENRICHED_BUILD_ID,
    roundsRequested: toRound - fromRound + 1,
    roundsEvaluated: roundResults.length,
    roundsSkipped: skipped.length,
    skipReasons: skipped,
    eligibleAthletes: roundResults.reduce((sum, item) => sum + item.eligibleAthletes, 0),
    evaluatedPredictions: roundResults.reduce((sum, item) => sum + item.evaluatedPredictions, 0),
    leakageStatus: skipped.some((item) => item.reason === "ENRICHED_LEAKAGE_FAIL") ? "FAIL" : "PASS",
    warnings: [
      "Status pre-rodada permaneceu indisponivel.",
      "Scouts historicos permaneceram desativados como oficiais.",
      "Dados recentes sao reconstruidos apenas de rodadas anteriores."
    ],
    limitations: [
      "Sem status historico seguro.",
      "Sem lineupProbabilityBeforeRound.",
      "Sem Comparador historico por falta de elenco real do usuario."
    ],
    metrics
  };

  backtestRepository.writeJson(season, "run-summary.json", summary);
  backtestRepository.writeJson(season, "metrics/prediction.json", metrics.prediction);
  backtestRepository.writeJson(season, "metrics/positions.json", metrics.positions);
  backtestRepository.writeJson(season, "metrics/team.json", metrics.team);
  backtestRepository.writeJson(season, "metrics/captain.json", metrics.captain);
  backtestRepository.writeJson(season, "metrics/score-bands.json", metrics.scoreBands);
  backtestRepository.writeJson(season, "metrics/home-away.json", metrics.homeAway);
  backtestRepository.writeJson(season, "metrics/cost-benefit.json", metrics.costBenefit);
  backtestRepository.writeJson(season, "metrics/data-quality.json", metrics.dataQuality);
  backtestRepository.writeJson(season, "metrics/central-intelligence.json", metrics.centralIntelligence);
  backtestRepository.writeJson(season, "comparison/baseline-average.json", metrics.baselineComparison);
  backtestRepository.writeJson(season, "comparison/all.json", metrics.compareAll);

  return summary;
}

module.exports = {
  ENRICHED_BUILD_ID,
  ENRICHED_ENGINE_VERSION,
  compareBuilds,
  evaluateEnrichedRound,
  runFlutterParityEnrichedBacktest
};
