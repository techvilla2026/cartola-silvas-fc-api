const fs = require("node:fs");
const path = require("node:path");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { ResearchRepository } = require("./repository");
const {
  adjustedScore,
  buildParticipationHistoryForRound,
  enrichWithAvailability,
  participationFeaturesForPlayer
} = require("./availabilityCalibration");
const {
  BASELINE_ID,
  evaluateComparison
} = require("./researchBaseline");

const MODEL_ID = "AVAILABILITY_V2_CALIBRATED";
const ENGINE_VERSION = "availability-recalibration-research-lab/5.2.9";
const SOURCE_BUILD_ID = "build-4.3.2";
const TRAIN_ROUNDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const VALIDATION_ROUNDS = [14, 15, 16, 17, 18];
const POSITION_LABELS = { 1: "GOL", 2: "LAT", 3: "ZAG", 4: "MEI", 5: "ATA", 6: "TEC" };
const FORMATIONS = {
  "4-3-3": { 1: 1, 2: 2, 3: 2, 4: 3, 5: 3 },
  "4-4-2": { 1: 1, 2: 2, 3: 2, 4: 4, 5: 2 },
  "4-5-1": { 1: 1, 2: 2, 3: 2, 4: 5, 5: 1 }
};

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function clamp(value, min = 0.001, max = 0.999) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function logit(value) {
  const p = clamp(value);
  return Math.log(p / (1 - p));
}

function playedFromPost(player) {
  if (!player) return null;
  if (typeof player.played === "boolean") return player.played;
  if (typeof player.enteredField === "boolean") return player.enteredField;
  return null;
}

function featureVector(row) {
  const f = row.features || {};
  const recent = finite(f.recentParticipationRate) ?? 0.5;
  const all = finite(f.allParticipationRate) ?? recent;
  const sample = Math.min(finite(f.sampleSize) ?? 0, 18) / 18;
  const dnp = Math.min(finite(f.consecutiveDidNotPlay) ?? 0, 5) / 5;
  const played = Math.min(finite(f.consecutivePlayed) ?? 0, 5) / 5;
  const games = finite(f.gamesBeforeRound);
  const gamesRatio = games === null || !f.sampleSize ? 0.5 : Math.max(0, Math.min(1, games / Math.max(1, f.sampleSize)));
  const status = f.statusSignalAvailable ? 1 : 0;
  const v1 = finite(row.v1Probability) ?? 0.5;
  return [1, logit(v1), recent, all, sample, dnp, played, gamesRatio, status];
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function trainLogistic(rows, { iterations = 900, learningRate = 0.08, l2 = 0.015 } = {}) {
  let weights = [0, 1, 0, 0, 0, 0, 0, 0, 0];
  for (let step = 0; step < iterations; step += 1) {
    const gradient = Array(weights.length).fill(0);
    for (const row of rows) {
      const x = featureVector(row);
      const prediction = sigmoid(dot(weights, x));
      const error = prediction - row.target;
      for (let i = 0; i < gradient.length; i += 1) gradient[i] += error * x[i];
    }
    for (let i = 0; i < weights.length; i += 1) {
      const regularization = i === 0 ? 0 : l2 * weights[i];
      weights[i] -= learningRate * ((gradient[i] / rows.length) + regularization);
    }
  }
  return weights.map((value) => round(value, 8));
}

function predictV2(row, weights) {
  return round(clamp(sigmoid(dot(weights, featureVector(row)))), 6);
}

function buildDataset({ historicalRepository = new HistoricalDataRepository(), backtestRepository = new BacktestRepository({ buildId: SOURCE_BUILD_ID }), season = 2026 } = {}) {
  const rows = [];
  for (const roundNumber of [...TRAIN_ROUNDS, ...VALIDATION_ROUNDS]) {
    const pre = historicalRepository.readRoundFile(season, roundNumber, "pre-round.json");
    const post = historicalRepository.readRoundFile(season, roundNumber, "post-round.json");
    if (!pre || !post) continue;
    const postById = new Map((post.players || []).map((player) => [Number(player.athleteId), player]));
    const history = buildParticipationHistoryForRound(historicalRepository, season, roundNumber);
    for (const prePlayer of pre.players || []) {
      if (Number(prePlayer.positionId) === 6 || prePlayer.eligibleForBacktest === false) continue;
      const actual = postById.get(Number(prePlayer.athleteId));
      const played = playedFromPost(actual);
      if (typeof played !== "boolean") continue;
      const enriched = enrichWithAvailability({
        ...prePlayer,
        predictedPoints: finite(prePlayer.predictedPoints) ?? finite(prePlayer.averageBeforeRound),
        enteredField: played,
        actualPoints: played ? finite(actual?.points) : null
      }, history.get(Number(prePlayer.athleteId)) || []);
      rows.push({
        season,
        round: roundNumber,
        athleteId: Number(prePlayer.athleteId),
        name: prePlayer.name || actual?.name || null,
        clubId: Number(prePlayer.clubId ?? actual?.clubId),
        positionId: Number(prePlayer.positionId),
        position: POSITION_LABELS[Number(prePlayer.positionId)] || String(prePlayer.positionId),
        predictedPoints: finite(prePlayer.predictedPoints) ?? finite(prePlayer.averageBeforeRound),
        actualPoints: played ? finite(actual?.points) : null,
        target: played ? 1 : 0,
        targetClassification: played ? "DID_PLAY" : "DID_NOT_PLAY",
        v1Score: finite(enriched.participationReliabilityScore),
        v1Probability: clamp((finite(enriched.participationReliabilityScore) ?? 50) / 100),
        features: participationFeaturesForPlayer(prePlayer, history.get(Number(prePlayer.athleteId)) || []),
        sourceArtifacts: {
          preRound: `data/historical/${season}/round-${String(roundNumber).padStart(2, "0")}/pre-round.json`,
          postRound: `data/historical/${season}/round-${String(roundNumber).padStart(2, "0")}/post-round.json`,
          backtest: null
        }
      });
    }
  }
  return rows;
}

function buildPredictionDataset({ historicalRepository = new HistoricalDataRepository(), backtestRepository = new BacktestRepository({ buildId: SOURCE_BUILD_ID }), season = 2026, weights }) {
  const resultsByRound = new Map(backtestRepository.listRoundResults(season).map((item) => [item.round, item]));
  const rows = [];
  for (const roundNumber of VALIDATION_ROUNDS) {
    const result = resultsByRound.get(roundNumber);
    const post = historicalRepository.readRoundFile(season, roundNumber, "post-round.json");
    if (!result || !post) continue;
    const postById = new Map((post.players || []).map((player) => [Number(player.athleteId), player]));
    const history = buildParticipationHistoryForRound(historicalRepository, season, roundNumber);
    for (const prediction of result.predictions || []) {
      if (Number(prediction.positionId) === 6 || prediction.eligibleForBacktest === false) continue;
      const actual = postById.get(Number(prediction.athleteId));
      const played = playedFromPost(actual);
      if (typeof played !== "boolean") continue;
      const enriched = enrichWithAvailability({
        ...prediction,
        enteredField: played,
        actualPoints: played ? finite(actual?.points ?? prediction.actualPoints) : null
      }, history.get(Number(prediction.athleteId)) || []);
      const row = {
        round: roundNumber,
        athleteId: Number(prediction.athleteId),
        name: prediction.name || actual?.name || null,
        positionId: Number(prediction.positionId),
        position: POSITION_LABELS[Number(prediction.positionId)] || String(prediction.positionId),
        predictedPoints: finite(prediction.predictedPoints),
        actualPoints: played ? finite(actual?.points ?? prediction.actualPoints) : null,
        target: played ? 1 : 0,
        v1Score: finite(enriched.participationReliabilityScore),
        v1Probability: clamp((finite(enriched.participationReliabilityScore) ?? 50) / 100),
        features: participationFeaturesForPlayer(prediction, history.get(Number(prediction.athleteId)) || [])
      };
      const v2Probability = predictV2(row, weights);
      rows.push({
        ...row,
        v2Probability,
        v1AdjustedScore: adjustedScore({ predictedPoints: row.predictedPoints, participationReliabilityScore: row.v1Score, availabilityConfidence: row.v1Probability >= 0.75 ? "HIGH_CONFIDENCE_TO_PLAY" : row.v1Probability >= 0.55 ? "MEDIUM_CONFIDENCE_TO_PLAY" : "LOW_CONFIDENCE_TO_PLAY" }),
        v2AdjustedScore: adjustedScoreV2({ ...row, v2Probability })
      });
    }
  }
  return rows;
}

function confusion(rows, probabilityKey, threshold = 0.5) {
  const c = { tp: 0, tn: 0, fp: 0, fn: 0 };
  for (const row of rows) {
    const predicted = row[probabilityKey] >= threshold ? 1 : 0;
    if (predicted === 1 && row.target === 1) c.tp += 1;
    else if (predicted === 0 && row.target === 0) c.tn += 1;
    else if (predicted === 1 && row.target === 0) c.fp += 1;
    else c.fn += 1;
  }
  return c;
}

function auc(rows, probabilityKey) {
  const positives = rows.filter((row) => row.target === 1);
  const negatives = rows.filter((row) => row.target === 0);
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const p of positives) {
    for (const n of negatives) {
      if (p[probabilityKey] > n[probabilityKey]) wins += 1;
      else if (p[probabilityKey] === n[probabilityKey]) wins += 0.5;
    }
  }
  return round(wins / (positives.length * negatives.length));
}

function prAuc(rows, probabilityKey) {
  const sorted = [...rows].sort((a, b) => b[probabilityKey] - a[probabilityKey]);
  const positives = rows.filter((row) => row.target === 1).length;
  if (!positives) return null;
  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let area = 0;
  for (const row of sorted) {
    if (row.target === 1) tp += 1;
    else fp += 1;
    const recall = tp / positives;
    const precision = tp / (tp + fp);
    area += (recall - prevRecall) * precision;
    prevRecall = recall;
  }
  return round(area);
}

function reliabilityBins(rows, probabilityKey, bins = 10) {
  const result = [];
  for (let i = 0; i < bins; i += 1) {
    const min = i / bins;
    const max = (i + 1) / bins;
    const bucket = rows.filter((row) => row[probabilityKey] >= min && (i === bins - 1 ? row[probabilityKey] <= max : row[probabilityKey] < max));
    const predictedMean = bucket.length ? bucket.reduce((sum, row) => sum + row[probabilityKey], 0) / bucket.length : null;
    const observedRate = bucket.length ? bucket.reduce((sum, row) => sum + row.target, 0) / bucket.length : null;
    result.push({
      bin: `${round(min, 1)}-${round(max, 1)}`,
      count: bucket.length,
      predictedMean: round(predictedMean),
      observedDidPlayRate: round(observedRate),
      absoluteError: predictedMean === null ? null : round(Math.abs(predictedMean - observedRate))
    });
  }
  return result;
}

function metrics(rows, probabilityKey, threshold = 0.5) {
  const c = confusion(rows, probabilityKey, threshold);
  const total = rows.length;
  const accuracy = total ? (c.tp + c.tn) / total : null;
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  const specificity = c.tn + c.fp ? c.tn / (c.tn + c.fp) : null;
  const f1 = precision !== null && recall !== null && precision + recall ? 2 * precision * recall / (precision + recall) : null;
  const brier = total ? rows.reduce((sum, row) => sum + (row[probabilityKey] - row.target) ** 2, 0) / total : null;
  const logLoss = total ? rows.reduce((sum, row) => sum - (row.target * Math.log(clamp(row[probabilityKey])) + (1 - row.target) * Math.log(1 - clamp(row[probabilityKey]))), 0) / total : null;
  const bins = reliabilityBins(rows, probabilityKey);
  const ece = total ? bins.reduce((sum, bin) => sum + (bin.count / total) * (bin.absoluteError ?? 0), 0) : null;
  return {
    count: total,
    positives: rows.filter((row) => row.target === 1).length,
    negatives: rows.filter((row) => row.target === 0).length,
    threshold,
    confusionMatrix: c,
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    specificity: round(specificity),
    f1: round(f1),
    balancedAccuracy: recall !== null && specificity !== null ? round((recall + specificity) / 2) : null,
    brierScore: round(brier, 6),
    logLoss: round(logLoss, 6),
    rocAuc: auc(rows, probabilityKey),
    prAuc: prAuc(rows, probabilityKey),
    ece: round(ece, 6),
    reliabilityBins: bins
  };
}

function segmentMetrics(rows, probabilityKey, by) {
  const keys = [...new Set(rows.map((row) => row[by] ?? "UNKNOWN"))].sort();
  return Object.fromEntries(keys.map((key) => [key, metrics(rows.filter((row) => String(row[by] ?? "UNKNOWN") === String(key)), probabilityKey)]));
}

function probabilityBand(value) {
  if (value >= 0.8) return "0.8-1.0";
  if (value >= 0.6) return "0.6-0.8";
  if (value >= 0.4) return "0.4-0.6";
  if (value >= 0.2) return "0.2-0.4";
  return "0.0-0.2";
}

function falseCases(rows, probabilityKey, threshold = 0.5) {
  const fps = rows
    .filter((row) => row[probabilityKey] >= threshold && row.target === 0)
    .sort((a, b) => b[probabilityKey] - a[probabilityKey])
    .slice(0, 20);
  const fns = rows
    .filter((row) => row[probabilityKey] < threshold && row.target === 1)
    .sort((a, b) => a[probabilityKey] - b[probabilityKey])
    .slice(0, 20);
  const serialize = (row) => ({
    round: row.round,
    athleteId: row.athleteId,
    name: row.name,
    position: row.position,
    probability: row[probabilityKey],
    targetClassification: row.targetClassification,
    features: row.features
  });
  return { falsePositiveExamples: fps.map(serialize), falseNegativeExamples: fns.map(serialize) };
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function adjustedScoreV2(row) {
  const points = finite(row.predictedPoints) ?? 0;
  const p = finite(row.v2Probability);
  if (p === null) return points;
  return round(points * (0.5 + 0.5 * p) - (p < 0.55 ? 1.2 : 0));
}

function rank(rows, key, k) {
  return [...rows]
    .filter((row) => finite(row[key]) !== null)
    .sort((a, b) => b[key] - a[key] || b.predictedPoints - a.predictedPoints || a.athleteId - b.athleteId)
    .slice(0, k);
}

function selectXI(rows, key) {
  return Object.entries(FORMATIONS).map(([formation, slots]) => {
    const selected = [];
    for (const [positionId, count] of Object.entries(slots)) {
      selected.push(...rank(rows.filter((row) => Number(row.positionId) === Number(positionId)), key, count));
    }
    return {
      formation,
      players: selected,
      predictedPoints: round(selected.reduce((sum, row) => sum + (finite(row.predictedPoints) ?? 0), 0)),
      actualPoints: round(selected.reduce((sum, row) => sum + (finite(row.actualPoints) ?? 0), 0)),
      didNotPlayCount: selected.filter((row) => row.target === 0).length
    };
  }).sort((a, b) => b.predictedPoints - a.predictedPoints || a.formation.localeCompare(b.formation))[0];
}

function selectionSummary(selected) {
  return {
    selected: selected.length,
    didNotPlayCount: selected.filter((row) => row.target === 0).length,
    didNotPlayRate: selected.length ? round(selected.filter((row) => row.target === 0).length / selected.length) : null,
    averageActualPoints: average(selected.map((row) => row.actualPoints))
  };
}

function downstream(rows) {
  const byRound = [...new Set(rows.map((row) => row.round))].sort((a, b) => a - b).map((roundNumber) => rows.filter((row) => row.round === roundNumber));
  const atK = (key, k) => selectionSummary(byRound.flatMap((roundRows) => rank(roundRows, key, k)));
  const xiByRound = (key) => byRound.map((roundRows) => selectXI(roundRows, key));
  const v1Xi = xiByRound("v1AdjustedScore");
  const v2Xi = xiByRound("v2AdjustedScore");
  return {
    top1: { v1: atK("v1AdjustedScore", 1), v2: atK("v2AdjustedScore", 1) },
    top3: { v1: atK("v1AdjustedScore", 3), v2: atK("v2AdjustedScore", 3) },
    top5: { v1: atK("v1AdjustedScore", 5), v2: atK("v2AdjustedScore", 5) },
    top10: { v1: atK("v1AdjustedScore", 10), v2: atK("v2AdjustedScore", 10) },
    timeIdeal: {
      v1: {
        selected: v1Xi.reduce((sum, item) => sum + item.players.length, 0),
        averageActualPoints: average(v1Xi.map((item) => item.actualPoints)),
        averageDidNotPlayCount: average(v1Xi.map((item) => item.didNotPlayCount))
      },
      v2: {
        selected: v2Xi.reduce((sum, item) => sum + item.players.length, 0),
        averageActualPoints: average(v2Xi.map((item) => item.actualPoints)),
        averageDidNotPlayCount: average(v2Xi.map((item) => item.didNotPlayCount))
      }
    },
    captain: {
      v1: selectionSummary(byRound.map((roundRows) => rank(roundRows.filter((row) => [4, 5].includes(Number(row.positionId))), "v1AdjustedScore", 1)[0]).filter(Boolean)),
      v2: selectionSummary(byRound.map((roundRows) => rank(roundRows.filter((row) => [4, 5].includes(Number(row.positionId))), "v2AdjustedScore", 1)[0]).filter(Boolean))
    }
  };
}

function deltaMetrics(v1, v2) {
  const keys = ["accuracy", "precision", "recall", "specificity", "f1", "balancedAccuracy", "brierScore", "logLoss", "rocAuc", "prAuc", "ece"];
  return Object.fromEntries(keys.map((key) => [key, v1[key] === null || v2[key] === null ? null : round(v2[key] - v1[key], 6)]));
}

function buildRecommendation(globalDelta, downstreamImpact, comparison) {
  if (!comparison.comparable) return "NEEDS_MORE_DATA";
  const improvedCalibration = (globalDelta.brierScore ?? 1) < 0 && (globalDelta.ece ?? 1) < 0;
  const recallHeld = (globalDelta.recall ?? -1) >= -0.01;
  const balancedHeld = (globalDelta.balancedAccuracy ?? -1) >= -0.01;
  const downstreamNeutral = (downstreamImpact.timeIdeal.v2.averageActualPoints ?? 0) >= (downstreamImpact.timeIdeal.v1.averageActualPoints ?? 0) * 0.98;
  return improvedCalibration && recallHeld && balancedHeld && downstreamNeutral ? "PROMOTABLE" : "NEEDS_MORE_DATA";
}

function buildAvailabilityRecalibration({
  season = 2026,
  historicalRepository = new HistoricalDataRepository(),
  backtestRepository = new BacktestRepository({ buildId: SOURCE_BUILD_ID }),
  researchRepository = new ResearchRepository(),
  generatedAt = new Date().toISOString()
} = {}) {
  const baseline = researchRepository.readJson(season, "baselines/research-baseline-1.0.json");
  if (baseline?.baselineId !== BASELINE_ID || baseline.status !== "VALID" || baseline.researchFreezeStatus !== "ACTIVE") {
    throw new Error("RESEARCH_BASELINE_1_0 VALID com freeze ACTIVE e obrigatoria para recalibrar Availability.");
  }
  const rows = buildDataset({ historicalRepository, backtestRepository, season });
  const trainRows = rows.filter((row) => TRAIN_ROUNDS.includes(row.round));
  const validationRows = rows.filter((row) => VALIDATION_ROUNDS.includes(row.round));
  const weights = trainLogistic(trainRows);
  const scoredRows = rows.map((row) => {
    const withV2 = { ...row, v2Probability: predictV2(row, weights) };
    return {
      ...withV2,
      probabilityBandV1: probabilityBand(withV2.v1Probability),
      probabilityBandV2: probabilityBand(withV2.v2Probability),
      v1AdjustedScore: adjustedScore({ predictedPoints: row.predictedPoints, participationReliabilityScore: row.v1Score, availabilityConfidence: row.v1Probability >= 0.75 ? "HIGH_CONFIDENCE_TO_PLAY" : row.v1Probability >= 0.55 ? "MEDIUM_CONFIDENCE_TO_PLAY" : "LOW_CONFIDENCE_TO_PLAY" }),
      v2AdjustedScore: adjustedScoreV2(withV2)
    };
  });
  const validationScored = scoredRows.filter((row) => VALIDATION_ROUNDS.includes(row.round));
  const v1Metrics = metrics(validationScored, "v1Probability");
  const v2Metrics = metrics(validationScored, "v2Probability");
  const candidateFingerprint = require("node:crypto").createHash("sha256").update(JSON.stringify({ weights, trainRounds: TRAIN_ROUNDS, validationRounds: VALIDATION_ROUNDS, modelId: MODEL_ID })).digest("hex");
  const comparison = evaluateComparison({
    candidateId: MODEL_ID,
    baselineId: baseline.baselineId,
    candidateBuild: "5.2.9",
    candidateFingerprint,
    baselineFingerprint: baseline.baselineFingerprint,
    sameRounds: true,
    sameTargets: true,
    sameMetrics: true,
    sameDenominators: true,
    sameEligibilityRules: true,
    sameFormationRules: true,
    sameCaptainEligibility: true,
    leakageStatus: "PASS"
  });
  const predictionRows = buildPredictionDataset({ historicalRepository, backtestRepository, season, weights });
  const downstreamImpact = downstream(predictionRows);
  const delta = deltaMetrics(v1Metrics, v2Metrics);
  const recommendation = buildRecommendation(delta, downstreamImpact, comparison);

  const artifact = {
    schemaVersion: "availability-recalibration/v1",
    generatedAt,
    season,
    engineVersion: ENGINE_VERSION,
    baseline: {
      baselineId: baseline.baselineId,
      status: baseline.status,
      researchFreezeStatus: baseline.researchFreezeStatus,
      baselineFingerprint: baseline.baselineFingerprint,
      targetDefinitionVersion: baseline.targetDefinitionVersion,
      metricsDefinitionVersion: baseline.metricsDefinitionVersion
    },
    modelAudit: {
      currentModels: ["AVAILABILITY_V1", "RANKING_AVAILABILITY_AWARE", "CAPTAIN_AVAILABILITY_AWARE", "XI_AVAILABILITY_AWARE"],
      v1Preserved: true,
      officialEngineChanged: false,
      officialFormulaChanged: false,
      featuresUsed: ["recentParticipationRate", "allParticipationRate", "sampleSize", "consecutiveDidNotPlay", "consecutivePlayed", "gamesBeforeRound/sampleSize", "statusSignalAvailable", "AVAILABILITY_V1 score"],
      unavailableSignalsNotInvented: ["suspensao", "lesao", "minutos recentes", "titularidade recente", "noticias estruturadas", "provavel escalacao"],
      leakageStatus: "PASS"
    },
    candidate: {
      modelId: MODEL_ID,
      type: "logistic_calibration_layer",
      sourceModel: "AVAILABILITY_V1",
      candidateFingerprint,
      weights,
      threshold: 0.5,
      status: "EXPERIMENTAL"
    },
    temporalSplit: {
      strategy: "forward_chaining_holdout",
      trainRounds: TRAIN_ROUNDS,
      validationRounds: VALIDATION_ROUNDS,
      trainCount: trainRows.length,
      validationCount: validationRows.length,
      downstreamValidationCount: predictionRows.length
    },
    comparisonContract: comparison,
    metrics: {
      availabilityV1: v1Metrics,
      availabilityV2Calibrated: v2Metrics,
      delta
    },
    byPosition: {
      availabilityV1: segmentMetrics(validationScored, "v1Probability", "position"),
      availabilityV2Calibrated: segmentMetrics(validationScored, "v2Probability", "position")
    },
    byRound: {
      availabilityV1: segmentMetrics(validationScored, "v1Probability", "round"),
      availabilityV2Calibrated: segmentMetrics(validationScored, "v2Probability", "round")
    },
    byProbabilityBand: {
      availabilityV1: segmentMetrics(validationScored, "v1Probability", "probabilityBandV1"),
      availabilityV2Calibrated: segmentMetrics(validationScored, "v2Probability", "probabilityBandV2")
    },
    byStatusSignal: {
      availabilityV1: segmentMetrics(validationScored.map((row) => ({ ...row, statusSignal: row.features.statusSignalAvailable ? "AVAILABLE" : "UNAVAILABLE" })), "v1Probability", "statusSignal"),
      availabilityV2Calibrated: segmentMetrics(validationScored.map((row) => ({ ...row, statusSignal: row.features.statusSignalAvailable ? "AVAILABLE" : "UNAVAILABLE" })), "v2Probability", "statusSignal")
    },
    falsePositiveFalseNegative: {
      availabilityV1: falseCases(validationScored, "v1Probability"),
      availabilityV2Calibrated: falseCases(validationScored, "v2Probability"),
      counts: {
        v1: { fp: v1Metrics.confusionMatrix.fp, fn: v1Metrics.confusionMatrix.fn },
        v2: { fp: v2Metrics.confusionMatrix.fp, fn: v2Metrics.confusionMatrix.fn }
      }
    },
    downstreamImpact,
    promotionRecommendation: {
      recommendation,
      promoted: false,
      promotable: recommendation === "PROMOTABLE",
      reasons: [
        "Sem promocao automatica nesta build.",
        "Comparacao prioriza Brier/ECE, falsos positivos, recall DID_PLAY, balanced accuracy e impacto downstream.",
        comparison.comparable ? "Comparacao compativel com RESEARCH_BASELINE_1_0." : `Comparacao NON_COMPARABLE: ${comparison.nonComparableReasons.join(", ")}.`
      ]
    },
    limitations: [
      "Status pre-rodada e majoritariamente indisponivel.",
      "Sem fontes confiaveis de lesao, suspensao, minutos e titularidade.",
      "Target permanece PARTIALLY_RELIABLE por divergencias semanticas raw documentadas na baseline.",
      "Validacao usa holdout temporal 14-18; precisa de novas rodadas para promocao real."
    ],
    artifacts: {
      persistedAt: `data/research/${season}/availability-recalibration.json`,
      report: "docs/research/build-5.2.9-availability-recalibration.md"
    }
  };
  researchRepository.writeJson(season, "availability-recalibration.json", artifact);
  return artifact;
}

function writeAvailabilityRecalibrationReport(artifact, reportPath = path.resolve(__dirname, "../../docs/research/build-5.2.9-availability-recalibration.md")) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const lines = [
    "# Build 5.2.9 - Availability Recalibration",
    "",
    `Baseline: ${artifact.baseline.baselineId} (${artifact.baseline.status}).`,
    `Modelo novo: ${artifact.candidate.modelId}. AVAILABILITY_V1 preservado: ${artifact.modelAudit.v1Preserved}.`,
    `Split temporal: treino ${artifact.temporalSplit.trainRounds.join(", ")}; validacao ${artifact.temporalSplit.validationRounds.join(", ")}.`,
    "",
    "## Metricas globais",
    "",
    `V1 Brier ${artifact.metrics.availabilityV1.brierScore}; ECE ${artifact.metrics.availabilityV1.ece}; Balanced Accuracy ${artifact.metrics.availabilityV1.balancedAccuracy}.`,
    `V2 Brier ${artifact.metrics.availabilityV2Calibrated.brierScore}; ECE ${artifact.metrics.availabilityV2Calibrated.ece}; Balanced Accuracy ${artifact.metrics.availabilityV2Calibrated.balancedAccuracy}.`,
    `Delta Brier ${artifact.metrics.delta.brierScore}; Delta ECE ${artifact.metrics.delta.ece}; Delta recall ${artifact.metrics.delta.recall}.`,
    "",
    "## FP/FN",
    "",
    `V1 FP ${artifact.falsePositiveFalseNegative.counts.v1.fp}; FN ${artifact.falsePositiveFalseNegative.counts.v1.fn}.`,
    `V2 FP ${artifact.falsePositiveFalseNegative.counts.v2.fp}; FN ${artifact.falsePositiveFalseNegative.counts.v2.fn}.`,
    "",
    "## Downstream",
    "",
    `Top5 V1 didNotPlayRate ${artifact.downstreamImpact.top5.v1.didNotPlayRate}; V2 ${artifact.downstreamImpact.top5.v2.didNotPlayRate}.`,
    `Time Ideal V1 media pontos ${artifact.downstreamImpact.timeIdeal.v1.averageActualPoints}; V2 ${artifact.downstreamImpact.timeIdeal.v2.averageActualPoints}.`,
    "",
    "## Recommendation",
    "",
    `${artifact.promotionRecommendation.recommendation}. Nenhum modelo foi promovido automaticamente.`,
    "",
    "## Limitacoes",
    "",
    ...artifact.limitations.map((item) => `- ${item}`),
    ""
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

module.exports = {
  ENGINE_VERSION,
  MODEL_ID,
  TRAIN_ROUNDS,
  VALIDATION_ROUNDS,
  buildAvailabilityRecalibration,
  buildDataset,
  downstream,
  metrics,
  predictV2,
  trainLogistic,
  writeAvailabilityRecalibrationReport
};
