const path = require("node:path");
const {
  BACKTEST_SCHEMA_VERSION,
  BACKTEST_ROUND_SCHEMA_VERSION,
  BASELINE_POLICY_VERSION,
  BUILD_ID,
  ENGINE_VERSION,
  FORMATION_433,
  PREDICTION_POLICY_VERSION,
  SELECTION_POLICY_VERSION
} = require("./constants");
const { errorMetrics, round: roundNumber } = require("./math");
const { baselinePredictions, predictPlayers, selectCaptain, selectFormation } = require("./policy");
const {
  attachActuals,
  captainMetrics,
  costBenefitMetrics,
  homeAwayMetrics,
  metricsByPosition,
  scoreBandMetrics,
  teamMetrics
} = require("./metrics");

function validateFormation(team) {
  for (const [positionId, count] of Object.entries(FORMATION_433)) {
    if (team.filter((player) => String(player.positionId) === String(positionId)).length !== count) {
      return false;
    }
  }
  return team.length === 11;
}

function roundFile(round) {
  return `round-${String(round).padStart(2, "0")}.json`;
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

function evaluateRound({ season, round, pre, post, leakage }) {
  const predictions = predictPlayers(pre);
  const baseline = baselinePredictions(pre);
  const decision = {
    selectedTeam: selectFormation(predictions),
    baselineTeam: selectFormation(baseline)
  };
  const { captain, viceCaptain } = selectCaptain(decision.selectedTeam);
  decision.captain = captain;
  decision.viceCaptain = viceCaptain;
  decision.frozenAt = new Date().toISOString();
  decision.usedPostRoundBeforeFreeze = false;

  if (!validateFormation(decision.selectedTeam)) {
    throw new Error(`Formacao invalida na rodada ${round}`);
  }

  const evaluatedPredictions = attachActuals(predictions, post);
  const teamWithActuals = attachActuals(decision.selectedTeam, post);
  const baselineWithActuals = attachActuals(decision.baselineTeam, post);
  const team = teamMetrics(teamWithActuals);
  const baselineTeam = teamMetrics(baselineWithActuals);
  const captainResult = captainMetrics(teamWithActuals, captain, viceCaptain);

  return {
    schemaVersion: BACKTEST_ROUND_SCHEMA_VERSION,
    season,
    round,
    leakageStatus: leakage.status,
    decisionsFrozenBeforePostRoundComparison: true,
    engineVersion: ENGINE_VERSION,
    predictionPolicyVersion: PREDICTION_POLICY_VERSION,
    selectionPolicyVersion: SELECTION_POLICY_VERSION,
    eligibleAthletes: predictions.length,
    evaluatedPredictions: evaluatedPredictions.length,
    predictions: evaluatedPredictions,
    selectedTeam: teamWithActuals,
    baselineTeam: baselineWithActuals,
    captain: captainResult,
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

function mergeRoundMetrics(roundResults) {
  const predictions = roundResults.flatMap((roundResult) => roundResult.predictions);
  const comparisons = roundResults.map((roundResult) => roundResult.metrics.comparison);
  const captainRounds = roundResults.map((roundResult) => roundResult.captain);
  const motorTotal = roundResults.reduce((sum, item) => sum + item.metrics.team.actualTotal, 0);
  const baselineTotal = roundResults.reduce((sum, item) => sum + item.metrics.baselineTeam.actualTotal, 0);

  return {
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
      averageGapToBest: roundNumber(captainRounds.reduce((sum, item) => sum + Number(item.captainGapToBest || 0), 0) / (captainRounds.length || 1))
    },
    baselineComparison: {
      wins: comparisons.filter((item) => item.result === "WIN").length,
      draws: comparisons.filter((item) => item.result === "DRAW").length,
      losses: comparisons.filter((item) => item.result === "LOSS").length,
      averageDifference: roundNumber(comparisons.reduce((sum, item) => sum + item.difference, 0) / (comparisons.length || 1)),
      cumulativeDifference: roundNumber(comparisons.reduce((sum, item) => sum + item.difference, 0))
    },
    recommendations: {
      status: "NOT_EVALUATED",
      reason: "Nao ha politica backend reproduzivel para recomendacoes positivas nesta build."
    },
    avoidPlayers: {
      status: "NOT_EVALUATED",
      reason: "Nao ha politica backend reproduzivel para jogadores a evitar nesta build."
    },
    comparator: {
      status: "NOT_EVALUATED",
      reason: "Nao ha contexto historico do time do usuario antes da rodada."
    }
  };
}

function runBacktest({ season, fromRound, toRound, historicalRepository, backtestRepository }) {
  const roundResults = [];
  const skipped = [];
  const warnings = [
    "Motor completo do Flutter nao existe no backend; Build 4.3.0 mede uma politica historica explicita.",
    "statusBeforeRound e lineupProbabilityBeforeRound nao sao usados.",
    "Scouts divergentes nao sao usados como equivalentes oficiais por rodada."
  ];

  for (let round = fromRound; round <= toRound; round += 1) {
    const loaded = loadRound(historicalRepository, season, round);

    if (loaded.skipReason) {
      skipped.push({ round, reason: loaded.skipReason });
      continue;
    }

    const result = evaluateRound({ season, round, pre: loaded.pre, post: loaded.post, leakage: loaded.leakage });
    roundResults.push(result);
    backtestRepository.writeJson(season, path.join("rounds", roundFile(round)), result);
  }

  const metrics = mergeRoundMetrics(roundResults);
  const summary = {
    schemaVersion: BACKTEST_SCHEMA_VERSION,
    season,
    fromRound,
    toRound,
    generatedAt: new Date().toISOString(),
    datasetSchemaVersion: "historical-pre-round-data/v2",
    engineVersion: ENGINE_VERSION,
    predictionPolicyVersion: PREDICTION_POLICY_VERSION,
    selectionPolicyVersion: SELECTION_POLICY_VERSION,
    baselinePolicyVersion: BASELINE_POLICY_VERSION,
    buildId: BUILD_ID,
    roundsRequested: toRound - fromRound + 1,
    roundsEvaluated: roundResults.length,
    roundsSkipped: skipped.length,
    skipReasons: skipped,
    eligibleAthletes: roundResults.reduce((sum, item) => sum + item.eligibleAthletes, 0),
    evaluatedPredictions: roundResults.reduce((sum, item) => sum + item.evaluatedPredictions, 0),
    leakageStatus: skipped.some((item) => item.reason === "LEAKAGE_FAIL") ? "FAIL" : "PASS",
    warnings,
    limitations: [
      "Nao avalia recomendacoes, evitar jogadores ou comparador por falta de politica backend reproduzivel.",
      "Tecnico excluido da formacao inicial.",
      "Politica avaliada nao altera pesos nem aprende com resultados."
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
  backtestRepository.writeJson(season, "metrics/recommendations.json", metrics.recommendations);
  backtestRepository.writeJson(season, "metrics/comparator.json", metrics.comparator);
  backtestRepository.writeJson(season, "comparison/baseline-average.json", metrics.baselineComparison);

  return summary;
}

module.exports = {
  validateFormation,
  evaluateRound,
  mergeRoundMetrics,
  runBacktest
};

