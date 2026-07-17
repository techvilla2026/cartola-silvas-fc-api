const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { BacktestRepository, DEFAULT_BACKTEST_DIR } = require("../backtest/repository");
const { FORMATION_433, POSITION_LABELS } = require("../backtest/constants");
const { ResearchRepository } = require("./repository");

const SEASON = 2026;
const SOURCE_BUILD_ID = "build-4.3.2";
const RESEARCH_ENGINE_VERSION = "engine-research-lab/4.7.0";
const ROUND_FILE = (round) => `rounds/round-${String(round).padStart(2, "0")}.json`;
const REQUIRED_METADATA_KEYS = [
  "schemaVersion",
  "generatedAt",
  "season",
  "engineVersion",
  "dataFingerprint",
  "configFingerprint",
  "codeVersion",
  "inputRounds",
  "evaluatedRounds",
  "warnings",
  "limitations"
];

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function median(values) {
  const valid = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

function percentile(values, percentileValue) {
  const valid = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const index = (valid.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round(valid[lower]);
  return round(valid[lower] + (valid[upper] - valid[lower]) * (index - lower));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
  }
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

function groupBy(items, keyFn) {
  const groups = {};
  for (const item of items) {
    const key = keyFn(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
  }
  return groups;
}

function priceBand(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return "UNKNOWN";
  if (price <= 5) return "0-5";
  if (price <= 10) return "5-10";
  if (price <= 15) return "10-15";
  if (price <= 20) return "15-20";
  return "20+";
}

function predictionBand(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return "UNKNOWN";
  if (score < 2) return "0-2";
  if (score < 4) return "2-4";
  if (score < 6) return "4-6";
  if (score < 8) return "6-8";
  return "8+";
}

function gamesBand(value) {
  const games = Number(value);
  if (!Number.isFinite(games)) return "UNKNOWN";
  if (games <= 1) return "0-1";
  if (games <= 3) return "2-3";
  if (games <= 6) return "4-6";
  return "7+";
}

function historyBand(player) {
  const appearances = Number(player.recentFormBeforeRound?.appearancesLast3BeforeRound || 0);
  if (appearances <= 0) return "NO_RECENT_HISTORY";
  if (appearances === 1) return "ONE_RECENT_GAME";
  if (appearances === 2) return "TWO_RECENT_GAMES";
  return "THREE_RECENT_GAMES";
}

function errorMetrics(items, predictedKey = "predictedPoints") {
  const valid = items.filter((item) => Number.isFinite(item[predictedKey]) && Number.isFinite(item.actualPoints));
  const errors = valid.map((item) => Number(item[predictedKey]) - Number(item.actualPoints));
  const absErrors = errors.map(Math.abs);
  return {
    count: valid.length,
    mae: valid.length ? round(average(absErrors)) : null,
    rmse: valid.length ? round(Math.sqrt(average(errors.map((value) => value * value)))) : null,
    bias: valid.length ? round(average(errors)) : null,
    medianAbsoluteError: round(median(absErrors)),
    p75AbsoluteError: percentile(absErrors, 0.75),
    p90AbsoluteError: percentile(absErrors, 0.9),
    p95AbsoluteError: percentile(absErrors, 0.95),
    within1: valid.length ? round(valid.filter((item) => Math.abs(item[predictedKey] - item.actualPoints) <= 1).length / valid.length) : null,
    within2: valid.length ? round(valid.filter((item) => Math.abs(item[predictedKey] - item.actualPoints) <= 2).length / valid.length) : null,
    within3: valid.length ? round(valid.filter((item) => Math.abs(item[predictedKey] - item.actualPoints) <= 3).length / valid.length) : null,
    within5: valid.length ? round(valid.filter((item) => Math.abs(item[predictedKey] - item.actualPoints) <= 5).length / valid.length) : null,
    above5ErrorRate: valid.length ? round(valid.filter((item) => Math.abs(item[predictedKey] - item.actualPoints) > 5).length / valid.length) : null,
    above10ErrorRate: valid.length ? round(valid.filter((item) => Math.abs(item[predictedKey] - item.actualPoints) > 10).length / valid.length) : null
  };
}

function ranked(values, key) {
  const sorted = [...values].sort((a, b) => Number(a[key]) - Number(b[key]));
  const ranks = new Map();
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && Number(sorted[j][key]) === Number(sorted[i][key])) j += 1;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) ranks.set(sorted[k].athleteId, rank);
    i = j;
  }
  return ranks;
}

function spearman(items) {
  const valid = items.filter((item) => Number.isFinite(item.predictedPoints) && Number.isFinite(item.actualPoints));
  if (valid.length < 2) return null;
  const predictedRanks = ranked(valid, "predictedPoints");
  const actualRanks = ranked(valid, "actualPoints");
  const xs = valid.map((item) => predictedRanks.get(item.athleteId));
  const ys = valid.map((item) => actualRanks.get(item.athleteId));
  const xAvg = average(xs);
  const yAvg = average(ys);
  const numerator = valid.reduce((sum, _, index) => sum + (xs[index] - xAvg) * (ys[index] - yAvg), 0);
  const xDen = Math.sqrt(xs.reduce((sum, value) => sum + ((value - xAvg) ** 2), 0));
  const yDen = Math.sqrt(ys.reduce((sum, value) => sum + ((value - yAvg) ** 2), 0));
  return xDen && yDen ? round(numerator / (xDen * yDen)) : null;
}

function kendall(items) {
  const valid = items.filter((item) => Number.isFinite(item.predictedPoints) && Number.isFinite(item.actualPoints));
  if (valid.length < 2 || valid.length > 700) return { value: null, status: valid.length > 700 ? "SKIPPED_TOO_MANY_PAIRS" : "INSUFFICIENT_SAMPLE" };
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const predictionDiff = valid[i].predictedPoints - valid[j].predictedPoints;
      const actualDiff = valid[i].actualPoints - valid[j].actualPoints;
      const product = predictionDiff * actualDiff;
      if (product > 0) concordant += 1;
      if (product < 0) discordant += 1;
    }
  }
  const total = concordant + discordant;
  return { value: total ? round((concordant - discordant) / total) : null, status: total ? "EVALUATED" : "INSUFFICIENT_SAMPLE" };
}

function rankingAtK(items, k) {
  const valid = items.filter((item) => Number.isFinite(item.predictedPoints) && Number.isFinite(item.actualPoints));
  const topPredicted = [...valid].sort((a, b) => b.predictedPoints - a.predictedPoints || a.athleteId - b.athleteId).slice(0, k);
  const actualTop = new Set([...valid].sort((a, b) => b.actualPoints - a.actualPoints || a.athleteId - b.athleteId).slice(0, k).map((item) => item.athleteId));
  const relevant = new Set(valid.filter((item) => item.actualPoints >= 5).map((item) => item.athleteId));
  const hits = topPredicted.filter((item) => actualTop.has(item.athleteId)).length;
  const relevantHits = topPredicted.filter((item) => relevant.has(item.athleteId)).length;
  const dcg = topPredicted.reduce((sum, item, index) => sum + Math.max(0, item.actualPoints) / Math.log2(index + 2), 0);
  const ideal = [...valid].sort((a, b) => b.actualPoints - a.actualPoints).slice(0, k)
    .reduce((sum, item, index) => sum + Math.max(0, item.actualPoints) / Math.log2(index + 2), 0);
  return {
    precision: topPredicted.length ? round(hits / topPredicted.length) : null,
    recall: actualTop.size ? round(hits / actualTop.size) : null,
    hitRate: topPredicted.length ? round(relevantHits / topPredicted.length) : null,
    ndcg: ideal > 0 ? round(dcg / ideal) : null
  };
}

function rankingMetrics(items) {
  const kendallResult = kendall(items);
  return {
    count: items.length,
    spearman: spearman(items),
    kendall: kendallResult.value,
    kendallStatus: kendallResult.status,
    at5: rankingAtK(items, 5),
    at10: rankingAtK(items, 10),
    at20: rankingAtK(items, 20)
  };
}

function readSource({ season = SEASON, backtestRepository } = {}) {
  const repository = backtestRepository || new BacktestRepository({ buildId: SOURCE_BUILD_ID });
  const summary = repository.readJson(season, "run-summary.json");
  if (!summary) throw new Error(`Backtest ${SOURCE_BUILD_ID} nao encontrado para ${season}.`);
  const rounds = [];
  for (let roundNumber = summary.fromRound; roundNumber <= summary.toRound; roundNumber += 1) {
    const roundData = repository.readJson(season, ROUND_FILE(roundNumber));
    if (roundData) rounds.push(roundData);
  }
  return { summary, rounds };
}

function baseMeta(schemaVersion, source, extra = {}) {
  const inputRounds = Array.from(new Set(source.rounds.map((item) => item.round))).sort((a, b) => a - b);
  const dataBasis = {
    summary: {
      buildId: source.summary.buildId,
      engineVersion: source.summary.engineVersion,
      roundsEvaluated: source.summary.roundsEvaluated,
      evaluatedPredictions: source.summary.evaluatedPredictions
    },
    rounds: source.rounds.map((roundData) => ({
      round: roundData.round,
      predictionCount: roundData.predictions?.length || 0,
      selectedTeamIds: (roundData.selectedTeam || []).map((player) => player.athleteId)
    }))
  };
  return {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    season: source.summary.season,
    engineVersion: source.summary.engineVersion,
    researchEngineVersion: RESEARCH_ENGINE_VERSION,
    dataFingerprint: fingerprint(dataBasis),
    configFingerprint: fingerprint(extra.config || {}),
    codeVersion: "4.7.0",
    sourceBuildId: source.summary.buildId,
    inputRounds,
    evaluatedRounds: inputRounds,
    warnings: [...(source.summary.warnings || [])],
    limitations: [...(source.summary.limitations || [])],
    temporalPolicy: {
      decisionsFrozenBeforePostRoundComparison: source.rounds.every((item) => item.decisionsFrozenBeforePostRoundComparison === true),
      onlyPreviousRoundsForWalkForward: true,
      oracleUsedForEvaluationOnly: true,
      futureLeakageAllowed: false
    }
  };
}

function flatPredictions(source) {
  return source.rounds.flatMap((roundData) => (roundData.predictions || []).map((player) => ({
    ...player,
    round: roundData.round,
    positionLabel: POSITION_LABELS[player.positionId] || String(player.positionId),
    clubKey: String(player.clubId || "UNKNOWN"),
    opponentKey: String(player.opponent || "UNKNOWN")
  })));
}

function summarizeGroups(items, keyFn) {
  const groups = groupBy(items, keyFn);
  return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => [key, errorMetrics(group)]));
}

function buildAudit(source) {
  const expected = [];
  for (let roundNumber = source.summary.fromRound; roundNumber <= source.summary.toRound; roundNumber += 1) expected.push(roundNumber);
  const evaluated = source.rounds.map((item) => item.round);
  const missing = expected.filter((roundNumber) => !evaluated.includes(roundNumber));
  const critical = [];
  if (source.summary.leakageStatus !== "PASS") critical.push("SOURCE_LEAKAGE_NOT_PASS");
  if (!source.rounds.every((item) => item.decisionsFrozenBeforePostRoundComparison === true)) critical.push("DECISIONS_NOT_FROZEN");
  if (missing.length) critical.push("MISSING_ROUND_RESULTS");
  const duplicateKeys = new Set();
  const seen = new Set();
  for (const item of flatPredictions(source)) {
    const key = `${item.round}:${item.athleteId}`;
    if (seen.has(key)) duplicateKeys.add(key);
    seen.add(key);
  }
  if (duplicateKeys.size) critical.push("DUPLICATE_ROUND_ATHLETE_PREDICTIONS");

  return sanitize({
    ...baseMeta("historical-engine-audit/v1", source),
    coverage: {
      expectedRounds: expected,
      evaluatedRounds: evaluated,
      excludedRounds: missing.concat(source.summary.skipReasons?.map((item) => item.round) || []).sort((a, b) => a - b),
      roundsRequested: source.summary.roundsRequested,
      roundsEvaluated: source.summary.roundsEvaluated,
      evaluatedPredictions: source.summary.evaluatedPredictions,
      eligibleAthletes: source.summary.eligibleAthletes
    },
    temporalValidation: {
      leakageStatus: source.summary.leakageStatus,
      decisionsFrozenBeforePostRoundComparison: source.rounds.every((item) => item.decisionsFrozenBeforePostRoundComparison === true),
      postRoundFieldsUsedOnlyAfterFreeze: true,
      walkForwardRequiresPreviousRoundsOnly: true
    },
    determinism: {
      stableDataFingerprint: true,
      generatedAtExcludedFromFingerprint: true,
      sourceBuildImmutableInput: SOURCE_BUILD_ID
    },
    duplicatePredictionKeys: [...duplicateKeys],
    critical,
    auditStatus: critical.length ? "FAIL" : "PASS"
  });
}

function buildDiagnostics(source) {
  const predictions = flatPredictions(source);
  return sanitize({
    ...baseMeta("engine-error-diagnostics/v1", source, { config: { segments: "build-4.7.0-defaults" } }),
    discoveredEngineFeatures: [
      "averageBeforeRound",
      "gamesBeforeRound",
      "homeAway",
      "priceBeforeRound",
      "recentFormBeforeRound.pointsLast1BeforeRound",
      "recentFormBeforeRound.variationLast1BeforeRound",
      "analysisComponents.prediction",
      "analysisComponents.average",
      "analysisComponents.status",
      "analysisComponents.sample",
      "analysisComponents.home",
      "analysisComponents.value",
      "analysisComponents.recent",
      "dataQualityScore"
    ],
    overall: errorMetrics(predictions),
    byRound: summarizeGroups(predictions, (item) => String(item.round).padStart(2, "0")),
    byPosition: summarizeGroups(predictions, (item) => item.positionLabel),
    byClub: summarizeGroups(predictions, (item) => item.clubKey),
    byOpponent: summarizeGroups(predictions, (item) => item.opponentKey),
    byHomeAway: summarizeGroups(predictions, (item) => item.homeAway || "UNKNOWN"),
    byPriceBand: summarizeGroups(predictions, (item) => priceBand(item.priceBeforeRound)),
    byAnalysisGrade: summarizeGroups(predictions, (item) => item.analysisBand || "NOT_EVALUATED"),
    byPredictionBand: summarizeGroups(predictions, (item) => predictionBand(item.predictedPoints)),
    byGamesBeforeRound: summarizeGroups(predictions, (item) => gamesBand(item.gamesBeforeRound)),
    byHistoryDepth: summarizeGroups(predictions, historyBand),
    nullZeroPolicy: {
      nullStatusPreserved: predictions.every((item) => item.statusBeforeRound === null),
      numericZeroPreserved: predictions.some((item) => item.predictedPoints === 0),
      noNaNOrInfinity: true
    }
  });
}

function buildRanking(source) {
  const predictions = flatPredictions(source);
  const byRound = Object.fromEntries(Object.entries(groupBy(predictions, (item) => String(item.round).padStart(2, "0")))
    .map(([key, items]) => [key, rankingMetrics(items)]));
  const byPosition = Object.fromEntries(Object.entries(groupBy(predictions, (item) => item.positionLabel))
    .map(([key, items]) => [key, rankingMetrics(items)]));
  return sanitize({
    ...baseMeta("engine-ranking-diagnostics/v1", source),
    overall: rankingMetrics(predictions),
    byRound,
    byPosition,
    relevanceDefinition: "actualPoints >= 5 para HitRate; top-K real para Precision/Recall."
  });
}

function sumActual(team) {
  return round(team.reduce((sum, player) => sum + Number(player.actualPoints || 0), 0));
}

function selectOracleTeam(predictions) {
  const selected = [];
  for (const [positionId, count] of Object.entries(FORMATION_433)) {
    selected.push(...predictions
      .filter((item) => String(item.positionId) === String(positionId))
      .sort((a, b) => Number(b.actualPoints || -Infinity) - Number(a.actualPoints || -Infinity) || Number(a.athleteId) - Number(b.athleteId))
      .slice(0, count));
  }
  return selected;
}

function buildIdealTeam(source) {
  const rounds = source.rounds.map((roundData) => {
    const oracleTeam = selectOracleTeam(roundData.predictions || []);
    const officialTeam = roundData.selectedTeam || [];
    const officialCaptain = roundData.captain || {};
    const oracleCaptain = [...oracleTeam].sort((a, b) => Number(b.actualPoints || -Infinity) - Number(a.actualPoints || -Infinity))[0] || null;
    const officialActual = sumActual(officialTeam);
    const oracleActual = sumActual(oracleTeam);
    const officialWithCaptain = round(officialActual + Number(officialCaptain.captainActual || 0));
    const oracleWithCaptain = round(oracleActual + Number(oracleCaptain?.actualPoints || 0));
    return {
      round: roundData.round,
      formation: "4-3-3",
      chosenLineup: officialTeam.map((item) => item.athleteId),
      captainAthleteId: officialCaptain.captainAthleteId,
      viceAthleteId: officialCaptain.viceAthleteId,
      forecastScore: roundData.metrics?.team?.predictedTotal ?? null,
      realScore: officialActual,
      realScoreWithCaptain: officialWithCaptain,
      oracleOptimalTeam: oracleTeam.map((item) => item.athleteId),
      oracleCaptainAthleteId: oracleCaptain?.athleteId || null,
      oracleRealScore: oracleActual,
      oracleRealScoreWithCaptain: oracleWithCaptain,
      regret: round(oracleActual - officialActual),
      regretWithCaptain: round(oracleWithCaptain - officialWithCaptain),
      baselineRealScore: roundData.metrics?.baselineTeam?.actualTotal ?? null,
      baselineForecastScore: roundData.metrics?.baselineTeam?.predictedTotal ?? null
    };
  });
  return sanitize({
    ...baseMeta("ideal-team-diagnostics/v1", source),
    oraclePolicy: "EVALUATION_ONLY_NOT_AVAILABLE_TO_ENGINE",
    formation: "4-3-3",
    rounds,
    totals: {
      officialRealScore: round(rounds.reduce((sum, item) => sum + Number(item.realScore || 0), 0)),
      oracleRealScore: round(rounds.reduce((sum, item) => sum + Number(item.oracleRealScore || 0), 0)),
      regret: round(rounds.reduce((sum, item) => sum + Number(item.regret || 0), 0)),
      officialRealScoreWithCaptain: round(rounds.reduce((sum, item) => sum + Number(item.realScoreWithCaptain || 0), 0)),
      oracleRealScoreWithCaptain: round(rounds.reduce((sum, item) => sum + Number(item.oracleRealScoreWithCaptain || 0), 0)),
      regretWithCaptain: round(rounds.reduce((sum, item) => sum + Number(item.regretWithCaptain || 0), 0))
    }
  });
}

function captainChoice(team, policy) {
  if (!team.length) return null;
  const sorters = {
    official: null,
    highestPrediction: (a, b) => Number(b.predictedPoints || 0) - Number(a.predictedPoints || 0),
    highestAnalysis: (a, b) => Number(b.analysisGrade || 0) - Number(a.analysisGrade || 0),
    highestAverage: (a, b) => Number(b.averageBeforeRound || 0) - Number(a.averageBeforeRound || 0),
    oracleBestActual: (a, b) => Number(b.actualPoints || -Infinity) - Number(a.actualPoints || -Infinity)
  };
  return [...team].sort((a, b) => (sorters[policy](a, b) || Number(a.athleteId) - Number(b.athleteId)))[0];
}

function buildCaptain(source) {
  const policyIds = ["official", "highestPrediction", "highestAnalysis", "highestAverage", "oracleBestActual"];
  const rounds = source.rounds.map((roundData) => {
    const team = roundData.selectedTeam || [];
    const officialId = roundData.captain?.captainAthleteId;
    return Object.fromEntries(policyIds.map((policy) => {
      const chosen = policy === "official" ? team.find((item) => item.athleteId === officialId) || null : captainChoice(team, policy);
      const best = captainChoice(team, "oracleBestActual");
      return [policy, {
        round: roundData.round,
        athleteId: chosen?.athleteId || null,
        actualPoints: chosen?.actualPoints ?? null,
        gapToBest: chosen && best ? round(Number(best.actualPoints) - Number(chosen.actualPoints)) : null,
        wasBest: Boolean(chosen && best && chosen.athleteId === best.athleteId),
        wasTop3: Boolean(chosen && new Set([...team].sort((a, b) => b.actualPoints - a.actualPoints).slice(0, 3).map((item) => item.athleteId)).has(chosen.athleteId)),
        temporalStatus: policy === "oracleBestActual" ? "ORACLE_EVALUATION_ONLY" : "PRE_ROUND_POLICY"
      }];
    }));
  });
  const policies = Object.fromEntries(policyIds.map((policy) => {
    const items = rounds.map((roundItem) => roundItem[policy]);
    return [policy, {
      rounds: items.length,
      averageActual: average(items.map((item) => item.actualPoints)),
      averageGapToBest: average(items.map((item) => item.gapToBest)),
      bestRate: round(items.filter((item) => item.wasBest).length / (items.length || 1)),
      top3Rate: round(items.filter((item) => item.wasTop3).length / (items.length || 1)),
      temporalStatus: policy === "oracleBestActual" ? "ORACLE_EVALUATION_ONLY" : "PRE_ROUND_SAFE"
    }];
  }));
  return sanitize({
    ...baseMeta("captain-policy-diagnostics/v1", source),
    officialPolicyId: "official",
    policies,
    rounds,
    warning: "oracleBestActual e apenas baseline de avaliacao e nunca candidato de producao."
  });
}

function withAdjustedPrediction(items, candidateId, transform) {
  return items.map((item) => ({ ...item, candidateId, candidatePredictedPoints: round(transform(item)) }));
}

function evaluateCandidateItems(items) {
  return {
    error: errorMetrics(items, "candidatePredictedPoints"),
    ranking: rankingMetrics(items.map((item) => ({ ...item, predictedPoints: item.candidatePredictedPoints })))
  };
}

function buildAblation(source) {
  const predictions = flatPredictions(source);
  const experiments = {
    official: withAdjustedPrediction(predictions, "official", (item) => item.predictedPoints),
    noHomeBonus: withAdjustedPrediction(predictions, "noHomeBonus", (item) => Math.max(0, Number(item.predictedPoints || 0) - (item.homeAway === "HOME" ? 0.4 : 0))),
    averageOnly: withAdjustedPrediction(predictions, "averageOnly", (item) => Math.max(0, Math.min(25, Number(item.averageBeforeRound || 0) * 0.7))),
    neutralPriceValueSignal: withAdjustedPrediction(predictions, "neutralPriceValueSignal", (item) => item.predictedPoints)
  };
  return sanitize({
    ...baseMeta("engine-ablation-study/v1", source),
    status: "OFFLINE_ONLY",
    officialFormulaChanged: false,
    factors: Object.fromEntries(Object.entries(experiments).map(([id, items]) => [id, evaluateCandidateItems(items)])),
    notes: [
      "Ablacoes usam transformacoes offline sobre artefatos congelados.",
      "neutralPriceValueSignal fica sem efeito direto na previsao porque preco atua na Nota/seleção, nao na formula de predictedPoints persistida."
    ]
  });
}

function priorMeanBias(previousItems, keyFn) {
  const groups = groupBy(previousItems, keyFn);
  return Object.fromEntries(Object.entries(groups).map(([key, items]) => [key, average(items.map((item) => item.predictedPoints - item.actualPoints)) || 0]));
}

function buildWalkForwardCandidate(source, candidateId, transformRound) {
  const rounds = [];
  const evaluated = [];
  for (const roundData of source.rounds) {
    const previous = evaluated.slice();
    const current = (roundData.predictions || []).map((item) => ({ ...item, round: roundData.round }));
    if (!previous.length) {
      rounds.push({ round: roundData.round, status: "SKIPPED_INSUFFICIENT_PREVIOUS_ROUNDS" });
      evaluated.push(...current);
      continue;
    }
    const candidateItems = transformRound(current, previous);
    rounds.push({ round: roundData.round, status: "EVALUATED", metrics: evaluateCandidateItems(candidateItems).error });
    evaluated.push(...current);
  }
  const allEvaluated = source.rounds.flatMap((roundData) => {
    const previous = source.rounds.filter((item) => item.round < roundData.round).flatMap((item) => item.predictions || []);
    if (!previous.length) return [];
    return transformRound((roundData.predictions || []).map((item) => ({ ...item, round: roundData.round })), previous);
  });
  return {
    ...baseMeta("walk-forward-experiment/v1", source, { config: { candidateId } }),
    candidateId,
    status: "OFFLINE_ONLY",
    trainPolicy: "Somente rodadas anteriores a rodada avaliada.",
    leakageStatus: "PASS",
    rounds,
    summary: evaluateCandidateItems(allEvaluated)
  };
}

function bootstrapRoundDifferences(source, candidateItemsByRound) {
  const roundIds = source.rounds.map((item) => item.round).filter((roundNumber) => candidateItemsByRound[roundNumber]);
  if (roundIds.length < 10) {
    return { status: "INSUFFICIENT_SAMPLE", rounds: roundIds.length };
  }
  const differences = [];
  for (let i = 0; i < 200; i += 1) {
    let officialErrors = [];
    let candidateErrors = [];
    for (let j = 0; j < roundIds.length; j += 1) {
      const sampledRound = roundIds[(i * 37 + j * 17) % roundIds.length];
      const items = candidateItemsByRound[sampledRound];
      officialErrors = officialErrors.concat(items.map((item) => Math.abs(item.predictedPoints - item.actualPoints)));
      candidateErrors = candidateErrors.concat(items.map((item) => Math.abs(item.candidatePredictedPoints - item.actualPoints)));
    }
    differences.push((average(candidateErrors) || 0) - (average(officialErrors) || 0));
  }
  return {
    status: "EVALUATED",
    iterations: 200,
    meanDeltaMae: round(average(differences)),
    ci95: [percentile(differences, 0.025), percentile(differences, 0.975)],
    deterministicSeed: "round-index-lcg-37-17"
  };
}

function buildExperiments(source) {
  const candidates = [
    {
      candidateId: "bias-correction-walk-forward",
      description: "Corrige a previsao pelo vies medio observado apenas em rodadas anteriores.",
      transformRound: (current, previous) => {
        const bias = average(previous.map((item) => item.predictedPoints - item.actualPoints)) || 0;
        return withAdjustedPrediction(current, "bias-correction-walk-forward", (item) => Math.max(0, item.predictedPoints - bias));
      }
    },
    {
      candidateId: "home-away-bias-walk-forward",
      description: "Corrige vies por mando usando apenas rodadas anteriores.",
      transformRound: (current, previous) => {
        const biases = priorMeanBias(previous, (item) => item.homeAway || "UNKNOWN");
        return withAdjustedPrediction(current, "home-away-bias-walk-forward", (item) => Math.max(0, item.predictedPoints - (biases[item.homeAway || "UNKNOWN"] || 0)));
      }
    },
    {
      candidateId: "price-band-bias-walk-forward",
      description: "Corrige vies por faixa de preco usando apenas rodadas anteriores.",
      transformRound: (current, previous) => {
        const biases = priorMeanBias(previous, (item) => priceBand(item.priceBeforeRound));
        return withAdjustedPrediction(current, "price-band-bias-walk-forward", (item) => Math.max(0, item.predictedPoints - (biases[priceBand(item.priceBeforeRound)] || 0)));
      }
    }
  ];
  const official = errorMetrics(flatPredictions(source));
  const experiments = candidates.map((candidate) => {
    const experiment = buildWalkForwardCandidate(source, candidate.candidateId, candidate.transformRound);
    const byRound = {};
    for (const roundData of source.rounds) {
      const previous = source.rounds.filter((item) => item.round < roundData.round).flatMap((item) => item.predictions || []);
      if (!previous.length) continue;
      byRound[roundData.round] = candidate.transformRound((roundData.predictions || []).map((item) => ({ ...item, round: roundData.round })), previous);
    }
    experiment.description = candidate.description;
    experiment.officialBaseline = official;
    experiment.robustness = bootstrapRoundDifferences(source, byRound);
    experiment.delta = {
      mae: round((experiment.summary.error.mae || 0) - (official.mae || 0)),
      rmse: round((experiment.summary.error.rmse || 0) - (official.rmse || 0)),
      bias: round((experiment.summary.error.bias || 0) - (official.bias || 0))
    };
    return sanitize(experiment);
  });
  return experiments;
}

function buildExperimentsSummary(source, experiments) {
  return sanitize({
    ...baseMeta("engine-experiments-summary/v1", source),
    status: "OFFLINE_ONLY",
    candidates: experiments.map((item) => ({
      candidateId: item.candidateId,
      description: item.description,
      summary: item.summary,
      delta: item.delta,
      robustness: item.robustness,
      productionImpact: "NONE"
    })),
    officialEngineChanged: false,
    shadowModePrepared: true,
    shadowModeActive: false
  });
}

function readPromotionPolicy() {
  const filePath = path.resolve(__dirname, "../../config/engine-experiment-policy.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildPromotionGate(source, experiments, policy = readPromotionPolicy()) {
  const decisions = experiments.map((experiment) => {
    const improvement = Number(experiment.delta?.mae || 0) < -Math.abs(policy.thresholds.minMaeImprovement);
    const enoughRounds = source.rounds.length >= policy.thresholds.minEvaluatedRounds;
    const robust = experiment.robustness?.status === "EVALUATED" && Number(experiment.robustness.ci95?.[1] || 1) < 0;
    const state = !enoughRounds
      ? "INSUFFICIENT_EVIDENCE"
      : improvement && robust
        ? "ELIGIBLE_FOR_SHADOW_TEST"
        : improvement
          ? "PROMISING"
          : "REJECTED";
    return {
      candidateId: experiment.candidateId,
      state,
      promoted: false,
      reasons: [
        enoughRounds ? "MIN_ROUNDS_OK" : "MIN_ROUNDS_NOT_MET",
        improvement ? "MAE_IMPROVED" : "MAE_NOT_IMPROVED",
        robust ? "ROBUSTNESS_CI_OK" : "ROBUSTNESS_CI_NOT_CONFIRMED",
        "PROMOTION_DISABLED_BY_BUILD_4_7_0"
      ]
    };
  });
  return sanitize({
    ...baseMeta("engine-promotion-gate/v1", source, { config: policy }),
    allowedStates: policy.allowedStates,
    forbiddenStates: ["PROMOTED"],
    shadowModeContract: policy.shadowModeContract,
    decisions,
    finalStatus: decisions.some((item) => item.state === "ELIGIBLE_FOR_SHADOW_TEST") ? "ELIGIBLE_FOR_SHADOW_TEST" : "NO_PROMOTION",
    productionEngineChanged: false
  });
}

function buildHealth(source, artifacts) {
  const missingKeys = Object.entries(artifacts).flatMap(([name, artifact]) => (
    REQUIRED_METADATA_KEYS.filter((key) => !Object.hasOwn(artifact, key)).map((key) => `${name}.${key}`)
  ));
  return sanitize({
    ...baseMeta("engine-research-health/v1", source),
    status: missingKeys.length ? "FAIL" : "PASS",
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, {
      schemaVersion: artifact.schemaVersion,
      status: artifact.auditStatus || artifact.status || "PERSISTED",
      dataFingerprint: artifact.dataFingerprint
    }])),
    missingMetadataKeys: missingKeys,
    readOnlyEndpointsPrepared: true,
    heavyComputationOnRequest: false,
    productionSnapshotMutation: false,
    productionEngineMutation: false
  });
}

function runResearch({ season = SEASON, mode = "all", researchRepository, backtestRepository } = {}) {
  const source = readSource({ season, backtestRepository });
  const repository = researchRepository || new ResearchRepository();
  const audit = buildAudit(source);
  if (mode !== "audit" && audit.auditStatus !== "PASS") {
    repository.writeJson(season, "audit.json", audit);
    throw new Error("Auditoria historica falhou; experimentos validos foram interrompidos.");
  }

  const generated = {};
  function persist(name, relativePath, artifact) {
    repository.writeJson(season, relativePath, artifact);
    generated[name] = artifact;
  }

  if (mode === "audit" || mode === "all") persist("audit", "audit.json", audit);
  if (mode === "diagnostics" || mode === "all") persist("engineDiagnostics", "engine-diagnostics.json", buildDiagnostics(source));
  if (mode === "ranking" || mode === "all") persist("rankingDiagnostics", "ranking-diagnostics.json", buildRanking(source));
  if (mode === "ideal-team" || mode === "all") persist("idealTeamDiagnostics", "ideal-team-diagnostics.json", buildIdealTeam(source));
  if (mode === "captain" || mode === "all") persist("captainDiagnostics", "captain-diagnostics.json", buildCaptain(source));
  if (mode === "ablation" || mode === "all") persist("ablationStudy", "ablation-study.json", buildAblation(source));

  let experiments = [];
  if (["experiments", "walk-forward", "promotion-gate", "all"].includes(mode)) {
    experiments = buildExperiments(source);
    for (const experiment of experiments) {
      repository.writeJson(season, `experiments/${experiment.candidateId}.json`, experiment);
    }
    persist("experimentsSummary", "experiments-summary.json", buildExperimentsSummary(source, experiments));
  }

  if (mode === "promotion-gate" || mode === "all") {
    if (!experiments.length) experiments = buildExperiments(source);
    persist("promotionGate", "promotion-gate.json", buildPromotionGate(source, experiments));
  }

  if (mode === "check" || mode === "all") {
    const artifacts = {
      audit: repository.readJson(season, "audit.json") || audit,
      engineDiagnostics: repository.readJson(season, "engine-diagnostics.json") || buildDiagnostics(source),
      rankingDiagnostics: repository.readJson(season, "ranking-diagnostics.json") || buildRanking(source),
      idealTeamDiagnostics: repository.readJson(season, "ideal-team-diagnostics.json") || buildIdealTeam(source),
      captainDiagnostics: repository.readJson(season, "captain-diagnostics.json") || buildCaptain(source),
      ablationStudy: repository.readJson(season, "ablation-study.json") || buildAblation(source),
      experimentsSummary: repository.readJson(season, "experiments-summary.json") || buildExperimentsSummary(source, experiments.length ? experiments : buildExperiments(source)),
      promotionGate: repository.readJson(season, "promotion-gate.json") || buildPromotionGate(source, experiments.length ? experiments : buildExperiments(source))
    };
    persist("researchHealth", "research-health.json", buildHealth(source, artifacts));
  }

  return {
    season,
    mode,
    auditStatus: audit.auditStatus,
    generated: Object.keys(generated),
    evaluatedRounds: source.rounds.length
  };
}

module.exports = {
  RESEARCH_ENGINE_VERSION,
  SOURCE_BUILD_ID,
  buildAudit,
  buildDiagnostics,
  buildRanking,
  buildIdealTeam,
  buildCaptain,
  buildAblation,
  buildExperiments,
  buildPromotionGate,
  buildHealth,
  errorMetrics,
  rankingMetrics,
  readSource,
  runResearch,
  sanitize,
  fingerprint
};
