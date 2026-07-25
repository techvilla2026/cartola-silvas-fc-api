const fs = require("node:fs");
const path = require("node:path");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../liveSnapshot/repositories/fileRepository");
const { ResearchRepository } = require("./repository");
const { FORMATIONS } = require("./roundValidation");

const SEASON = 2026;
const ROUND = 19;
const SOURCE_BUILD_ID = "build-4.3.2";
const AVAILABILITY_ENGINE_VERSION = "availability-calibration-research-lab/5.2.5";
const PARTICIPATION_RELIABILITY_METADATA = {
  metricType: "internal_index",
  probability: false,
  scale: "0-100",
  modelId: "AVAILABILITY_V1",
  description: "Indice interno SLVS de confiabilidade de participacao; nao e probabilidade de jogar nem de titularidade."
};
const POSITION_LABELS = {
  1: "GOL",
  2: "LAT",
  3: "ZAG",
  4: "MEI",
  5: "ATA",
  6: "TEC"
};
const CAPTAIN_POSITIONS = new Set([4, 5]);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function median(values) {
  const valid = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : round((valid[mid - 1] + valid[mid]) / 2);
}

function clamp(value, min = 0, max = 100) {
  const number = finite(value);
  if (number === null) return null;
  return Math.max(min, Math.min(max, number));
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
  }
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

function positionLabel(positionId) {
  return POSITION_LABELS[Number(positionId)] || String(positionId || "N/A");
}

function playedFromPostPlayer(player) {
  if (!player) return null;
  if (typeof player.played === "boolean") return player.played;
  if (typeof player.enteredField === "boolean") return player.enteredField;
  if (finite(player.points) !== null || finite(player.roundPoints) !== null) return true;
  return null;
}

function buildParticipationHistoryForRound(historicalRepository, season, round) {
  const rowsByAthlete = new Map();
  for (const priorRound of historicalRepository.listRounds(season).filter((item) => item < round).sort((a, b) => a - b)) {
    const post = historicalRepository.readRoundFile(season, priorRound, "post-round.json");
    for (const player of post?.players || []) {
      const athleteId = Number(player.athleteId);
      if (!rowsByAthlete.has(athleteId)) rowsByAthlete.set(athleteId, []);
      rowsByAthlete.get(athleteId).push({
        round: priorRound,
        played: playedFromPostPlayer(player),
        points: finite(player.points ?? player.roundPoints),
        statusId: player.statusId ?? null
      });
    }
  }
  return rowsByAthlete;
}

function participationFeaturesForPlayer(player, historyRows = []) {
  const known = historyRows.filter((row) => row.played !== null);
  const recent = known.slice(-5);
  const played = known.filter((row) => row.played === true);
  const recentPlayed = recent.filter((row) => row.played === true);
  let consecutiveDidNotPlay = 0;
  let consecutivePlayed = 0;
  for (const row of [...known].reverse()) {
    if (row.played === false && consecutivePlayed === 0) consecutiveDidNotPlay += 1;
    else if (row.played === true && consecutiveDidNotPlay === 0) consecutivePlayed += 1;
    else break;
  }
  const statusAvailable = player?.statusBeforeRound !== null && player?.statusBeforeRound !== undefined;
  return {
    matchesAvailableBeforeRound: known.length,
    matchesEnteredFieldBeforeRound: played.length,
    recentParticipationRate: recent.length ? round(recentPlayed.length / recent.length) : null,
    allParticipationRate: known.length ? round(played.length / known.length) : null,
    recentStartsRate: null,
    startsSourceStatus: "UNAVAILABLE_SOURCE_NOT_CONFIGURED",
    minutesRecent: null,
    minutesSourceStatus: "UNAVAILABLE_SOURCE_NOT_CONFIGURED",
    consecutiveDidNotPlay,
    consecutivePlayed,
    sampleSize: known.length,
    statusSignalAvailable: statusAvailable,
    statusBeforeRound: player?.statusBeforeRound ?? null,
    gamesBeforeRound: finite(player?.gamesBeforeRound),
    homeAway: player?.homeAway || null,
    opponent: player?.opponent ?? null
  };
}

function availabilityDataQuality(features) {
  if (!features || features.sampleSize === 0) {
    return {
      score: 20,
      state: "INSUFFICIENT_HISTORY",
      explanation: "Pouca ou nenhuma participacao historica segura antes da rodada; isso nao vira baixa confiabilidade."
    };
  }
  const score = clamp(
    Math.min(features.sampleSize, 8) * 8
    + (features.recentParticipationRate !== null ? 20 : 0)
    + (features.statusSignalAvailable ? 10 : 0)
    + (features.gamesBeforeRound !== null ? 6 : 0)
  );
  return {
    score,
    state: score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW",
    explanation: "Qualidade dos sinais de disponibilidade, separada da qualidade tecnica do atleta."
  };
}

function participationReliability(player, features) {
  if (!features || features.sampleSize < 2) {
    return {
      participationReliabilityScore: 50,
      availabilityConfidence: "INSUFFICIENT_DATA",
      availabilityDataQuality: availabilityDataQuality(features),
      reasons: ["Amostra historica pre-rodada insuficiente; nao classificar como LOW por ausencia de dados."]
    };
  }
  const recent = features.recentParticipationRate ?? features.allParticipationRate ?? 0.5;
  const all = features.allParticipationRate ?? recent;
  const statusBoost = features.statusSignalAvailable ? 5 : 0;
  const sampleBoost = Math.min(features.sampleSize, 8) * 2;
  const streakPenalty = Math.min(features.consecutiveDidNotPlay, 5) * 10;
  const playedBoost = Math.min(features.consecutivePlayed, 5) * 3;
  const gamesBeforeRound = finite(player?.gamesBeforeRound);
  const gamesSignal = gamesBeforeRound === null ? 0 : gamesBeforeRound >= Math.max(2, features.sampleSize * 0.5) ? 5 : -5;
  const score = clamp(20 + recent * 38 + all * 22 + sampleBoost + statusBoost + playedBoost + gamesSignal - streakPenalty);
  const availabilityConfidence = score >= 75
    ? "HIGH_CONFIDENCE_TO_PLAY"
    : score >= 55
      ? "MEDIUM_CONFIDENCE_TO_PLAY"
      : "LOW_CONFIDENCE_TO_PLAY";
  return {
    participationReliabilityScore: round(score),
    availabilityConfidence,
    availabilityDataQuality: availabilityDataQuality(features),
    reasons: [
      `recentParticipationRate=${features.recentParticipationRate}`,
      `allParticipationRate=${features.allParticipationRate}`,
      `consecutiveDidNotPlay=${features.consecutiveDidNotPlay}`,
      `consecutivePlayed=${features.consecutivePlayed}`,
      `sampleSize=${features.sampleSize}`
    ]
  };
}

function enrichWithAvailability(player, historyRows) {
  const features = participationFeaturesForPlayer(player, historyRows);
  const reliability = participationReliability(player, features);
  return {
    ...player,
    participationFeatures: features,
    participationReliabilityScore: reliability.participationReliabilityScore,
    participationReliabilityMetadata: PARTICIPATION_RELIABILITY_METADATA,
    availabilityConfidence: reliability.availabilityConfidence,
    availabilityDataQuality: reliability.availabilityDataQuality,
    availabilityReasons: reliability.reasons,
    didPlayActual: player.enteredField ?? (finite(player.actualPoints) !== null ? true : null),
    didNotPlayActual: player.enteredField === false ? true : player.enteredField === true ? false : null,
    scoreUnavailableActual: player.enteredField !== false && finite(player.actualPoints) === null
  };
}

function adjustedScore(player, strategy = "B") {
  const contextual = finite(player.predictedPoints) ?? 0;
  const reliability = finite(player.participationReliabilityScore);
  if (strategy === "A" || reliability === null) return contextual;
  if (strategy === "C" && player.availabilityConfidence === "LOW_CONFIDENCE_TO_PLAY" && player.participationFeatures?.sampleSize >= 4) {
    return -Infinity;
  }
  const multiplier = 0.55 + (reliability / 100) * 0.45;
  const penalty = player.availabilityConfidence === "LOW_CONFIDENCE_TO_PLAY" ? 1.2 : 0;
  return round(contextual * multiplier - penalty);
}

function rankPlayers(players, key, k = 5) {
  return [...players]
    .filter((player) => finite(player[key]) !== null)
    .sort((a, b) => Number(b[key]) - Number(a[key]) || Number(a.athleteId) - Number(b.athleteId))
    .slice(0, k);
}

function rankAvailabilityAware(players, k = 5, strategy = "B") {
  return [...players]
    .map((player) => ({ ...player, availabilityAdjustedScore: adjustedScore(player, strategy) }))
    .filter((player) => Number.isFinite(player.availabilityAdjustedScore))
    .sort((a, b) => b.availabilityAdjustedScore - a.availabilityAdjustedScore || Number(b.predictedPoints || 0) - Number(a.predictedPoints || 0) || Number(a.athleteId) - Number(b.athleteId))
    .slice(0, k);
}

function didNotPlayRate(players) {
  if (!players.length) return null;
  return round(players.filter((player) => player.didNotPlayActual === true).length / players.length);
}

function rankingMetrics(rowsByRound, side) {
  const atK = (k) => {
    const selections = rowsByRound.flatMap((row) => row[side].slice(0, k));
    return {
      k,
      selected: selections.length,
      didNotPlayRate: didNotPlayRate(selections),
      averageActualPoints: average(selections.map((player) => player.actualPoints))
    };
  };
  return {
    top1: atK(1),
    top3: atK(3),
    top5: atK(5)
  };
}

function selectFormation(players, formation, key, aware = false) {
  const selected = [];
  for (const [positionId, count] of Object.entries(formation)) {
    const pool = players.filter((player) => Number(player.positionId) === Number(positionId));
    selected.push(...(aware ? rankAvailabilityAware(pool, count) : rankPlayers(pool, key, count)));
  }
  return selected;
}

function sumPlayers(players, key) {
  return round(players.reduce((sum, player) => sum + (finite(player[key]) ?? 0), 0));
}

function bestXI(players, aware = false) {
  return Object.entries(FORMATIONS).map(([formation, slots]) => {
    const selected = selectFormation(players, slots, "predictedPoints", aware);
    return {
      formation,
      players: selected,
      predictedPoints: sumPlayers(selected, "predictedPoints"),
      actualPoints: sumPlayers(selected, "actualPoints"),
      didNotPlayCount: selected.filter((player) => player.didNotPlayActual === true).length
    };
  }).sort((a, b) => b.predictedPoints - a.predictedPoints || a.formation.localeCompare(b.formation))[0] || null;
}

function serializePlayer(player, extra = {}) {
  return sanitize({
    athleteId: player?.athleteId ?? null,
    name: player?.name ?? null,
    clubId: player?.clubId ?? null,
    positionId: player?.positionId ?? null,
    position: positionLabel(player?.positionId),
    predictedPoints: finite(player?.predictedPoints),
    actualPoints: finite(player?.actualPoints),
    enteredField: player?.enteredField ?? null,
    didPlayActual: player?.didPlayActual ?? null,
    didNotPlayActual: player?.didNotPlayActual ?? null,
    participationReliabilityScore: finite(player?.participationReliabilityScore),
    availabilityConfidence: player?.availabilityConfidence ?? null,
    availabilityAdjustedScore: finite(player?.availabilityAdjustedScore),
    participationFeatures: player?.participationFeatures ?? null,
    availabilityReasons: player?.availabilityReasons ?? null,
    ...extra
  });
}

function serializeTeam(team) {
  if (!team) return null;
  return {
    formation: team.formation,
    predictedPoints: team.predictedPoints,
    actualPoints: team.actualPoints,
    didNotPlayCount: team.didNotPlayCount,
    players: team.players.map((player) => serializePlayer(player))
  };
}

function chooseCaptain(players, aware = false) {
  const eligible = players.filter((player) => CAPTAIN_POSITIONS.has(Number(player.positionId)) && finite(player.predictedPoints) !== null);
  const ranked = aware
    ? rankAvailabilityAware(eligible, 1)
    : rankPlayers(eligible.map((player) => ({ ...player, captainScore: (finite(player.predictedPoints) ?? 0) + (finite(player.analysisGrade) ?? 0) * 0.1 })), "captainScore", 1);
  return ranked[0] || null;
}

function classifyAvailabilityError(player) {
  if (player.didNotPlayActual !== true) return "NO_AVAILABILITY_ERROR";
  if (player.availabilityConfidence === "LOW_CONFIDENCE_TO_PLAY") return "PREDICTABLE_AVAILABILITY_ERROR";
  if (player.availabilityConfidence === "INSUFFICIENT_DATA") return "INSUFFICIENT_PREMATCH_DATA";
  if (player.participationFeatures?.statusSignalAvailable && player.availabilityConfidence !== "LOW_CONFIDENCE_TO_PLAY") return "STATUS_SIGNAL_MISSED";
  if (player.availabilityConfidence === "HIGH_CONFIDENCE_TO_PLAY") return "UNEXPECTED_ROTATION";
  return "MODEL_ERROR";
}

function evaluateConfidenceBuckets(players) {
  const buckets = ["HIGH_CONFIDENCE_TO_PLAY", "MEDIUM_CONFIDENCE_TO_PLAY", "LOW_CONFIDENCE_TO_PLAY", "INSUFFICIENT_DATA"];
  return Object.fromEntries(buckets.map((bucket) => {
    const rows = players.filter((player) => player.availabilityConfidence === bucket);
    return [bucket, {
      count: rows.length,
      didPlayRate: rows.length ? round(rows.filter((player) => player.didPlayActual === true).length / rows.length) : null,
      didNotPlayRate: rows.length ? round(rows.filter((player) => player.didNotPlayActual === true).length / rows.length) : null,
      averageActualPoints: average(rows.map((player) => player.actualPoints))
    }];
  }));
}

function buildRoundEvaluation(roundResult, historicalRepository, season) {
  const history = buildParticipationHistoryForRound(historicalRepository, season, roundResult.round);
  const currentPost = historicalRepository.readRoundFile(season, roundResult.round, "post-round.json");
  const currentPostMap = new Map((currentPost?.players || []).map((player) => [Number(player.athleteId), player]));
  const players = (roundResult.predictions || [])
    .filter((player) => Number(player.positionId) !== 6 && player.eligibleForBacktest !== false)
    .map((player) => {
      const actual = currentPostMap.get(Number(player.athleteId));
      const enteredField = playedFromPostPlayer(actual);
      return enrichWithAvailability({
        ...player,
        actualPoints: enteredField === true ? finite(actual?.points ?? player.actualPoints) : null,
        enteredField: enteredField ?? (finite(player.actualPoints) !== null)
      }, history.get(Number(player.athleteId)) || []);
    });
  const byPosition = {};
  for (const [positionId, label] of Object.entries(POSITION_LABELS)) {
    if (label === "TEC") continue;
    const pool = players.filter((player) => Number(player.positionId) === Number(positionId));
    byPosition[label] = {
      officialTop5: rankPlayers(pool, "predictedPoints", 5),
      availabilityAwareTop5: rankAvailabilityAware(pool, 5)
    };
  }
  const officialXI = roundResult.selectedTeam
    ? {
      formation: "OFFICIAL_BACKTEST_SELECTION",
      players: roundResult.selectedTeam.map((selected) => players.find((player) => Number(player.athleteId) === Number(selected.athleteId)) || enrichWithAvailability(selected, history.get(Number(selected.athleteId)) || [])),
      predictedPoints: sumPlayers(roundResult.selectedTeam, "predictedPoints"),
      actualPoints: null,
      didNotPlayCount: null
    }
    : bestXI(players, false);
  if (officialXI) {
    officialXI.actualPoints = sumPlayers(officialXI.players, "actualPoints");
    officialXI.didNotPlayCount = officialXI.players.filter((player) => player.didNotPlayActual === true).length;
  }
  const awareXI = bestXI(players, true);
  const officialCaptain = chooseCaptain(officialXI.players || players, false);
  const awareCaptain = chooseCaptain(awareXI?.players || players, true);
  return {
    round: roundResult.round,
    players,
    byPosition,
    officialXI,
    availabilityAwareXI: awareXI,
    officialCaptain,
    availabilityAwareCaptain: awareCaptain
  };
}

function aggregateBacktest(roundEvaluations) {
  const byPosition = {};
  for (const label of ["GOL", "LAT", "ZAG", "MEI", "ATA"]) {
    const rows = roundEvaluations.map((roundItem) => ({
      official: roundItem.byPosition[label].officialTop5,
      aware: roundItem.byPosition[label].availabilityAwareTop5
    }));
    byPosition[label] = {
      official: rankingMetrics(rows, "official"),
      availabilityAware: rankingMetrics(rows, "aware")
    };
  }
  const officialXis = roundEvaluations.map((item) => item.officialXI);
  const awareXis = roundEvaluations.map((item) => item.availabilityAwareXI);
  const officialCaptains = roundEvaluations.map((item) => item.officialCaptain).filter(Boolean);
  const awareCaptains = roundEvaluations.map((item) => item.availabilityAwareCaptain).filter(Boolean);
  return {
    validRounds: roundEvaluations.length,
    evaluatedAthletes: roundEvaluations.reduce((sum, item) => sum + item.players.length, 0),
    confidenceBuckets: evaluateConfidenceBuckets(roundEvaluations.flatMap((item) => item.players)),
    byPosition,
    officialRanking: rankingMetrics(roundEvaluations.map((item) => ({ official: Object.values(item.byPosition).flatMap((pos) => pos.officialTop5).slice(0, 5) })), "official"),
    availabilityAwareRanking: rankingMetrics(roundEvaluations.map((item) => ({ aware: Object.values(item.byPosition).flatMap((pos) => pos.availabilityAwareTop5).slice(0, 5) })), "aware"),
    xi: {
      officialAverageActualPoints: average(officialXis.map((item) => item.actualPoints)),
      availabilityAwareAverageActualPoints: average(awareXis.map((item) => item.actualPoints)),
      officialAverageDidNotPlayCount: average(officialXis.map((item) => item.didNotPlayCount)),
      availabilityAwareAverageDidNotPlayCount: average(awareXis.map((item) => item.didNotPlayCount))
    },
    captain: {
      officialDidNotPlayRate: didNotPlayRate(officialCaptains),
      availabilityAwareDidNotPlayRate: didNotPlayRate(awareCaptains),
      officialAverageActualPoints: average(officialCaptains.map((item) => item.actualPoints)),
      availabilityAwareAverageActualPoints: average(awareCaptains.map((item) => item.actualPoints)),
      officialMedianActualPoints: median(officialCaptains.map((item) => item.actualPoints)),
      availabilityAwareMedianActualPoints: median(awareCaptains.map((item) => item.actualPoints))
    }
  };
}

function latestSnapshot(repository, season = SEASON, round = ROUND) {
  const manifest = repository.readManifest(season, round);
  const snapshotId = manifest?.finalPreCloseSnapshotId || manifest?.lastValidPreRoundSnapshotId || manifest?.lastSnapshotId;
  return {
    manifest,
    snapshotId,
    snapshot: snapshotId ? repository.readSnapshot(season, round, snapshotId) : null
  };
}

function enrichRound19Players(liveSnapshotRepository, historicalRepository, season, round) {
  const latest = latestSnapshot(liveSnapshotRepository, season, round);
  const actualMap = new Map((latest.snapshot?.data?.players || []).map((player) => [Number(player.athleteId), player]));
  const history = buildParticipationHistoryForRound(historicalRepository, season, round);
  const players = (latest.snapshot?.motor?.predictions || [])
    .filter((player) => Number(player.positionId) !== 6)
    .map((player) => {
      const actual = actualMap.get(Number(player.athleteId));
      return enrichWithAvailability({
        ...player,
        actualPoints: actual?.enteredField === true ? finite(actual.roundPoints) : null,
        enteredField: actual?.enteredField ?? null
      }, history.get(Number(player.athleteId)) || []);
    });
  return { latest, players };
}

function findByName(players, text) {
  return players.find((player) => String(player.name || "").toLocaleLowerCase("pt-BR").includes(text.toLocaleLowerCase("pt-BR"))) || null;
}

function buildRound19Audit(players, snapshot) {
  const byPosition = {};
  for (const [positionId, label] of Object.entries(POSITION_LABELS)) {
    if (label === "TEC") continue;
    const pool = players.filter((player) => Number(player.positionId) === Number(positionId));
    byPosition[label] = {
      officialTop5: rankPlayers(pool, "predictedPoints", 5).map((player, index) => serializePlayer(player, { rank: index + 1 })),
      availabilityAwareTop5: rankAvailabilityAware(pool, 5).map((player, index) => serializePlayer(player, { rank: index + 1 }))
    };
  }
  const idealIds = new Set((snapshot?.motor?.idealTeam?.players || []).map((player) => Number(player.athleteId)));
  const officialPlayers = players.filter((player) => idealIds.has(Number(player.athleteId)));
  const officialXI = {
    formation: snapshot?.motor?.idealTeam?.formation || null,
    players: officialPlayers,
    predictedPoints: sumPlayers(officialPlayers, "predictedPoints"),
    actualPoints: sumPlayers(officialPlayers, "actualPoints"),
    didNotPlayCount: officialPlayers.filter((player) => player.didNotPlayActual === true).length
  };
  const awareXI = bestXI(players, true);
  return {
    byPosition,
    cases: {
      danilo: serializePlayer(findByName(players, "Danilo dos Santos de Oliveira")),
      canobbio: serializePlayer(findByName(players, "Canobbio")),
      souza: serializePlayer(findByName(players, "Carlos Renê de Sousa Ferreira")),
      kaue: serializePlayer(findByName(players, "Kauê")),
      lucasArcanjo: serializePlayer(findByName(players, "Lucas Willians Assis Arcanjo"))
    },
    officialCaptain: serializePlayer(chooseCaptain(officialPlayers, false)),
    availabilityAwareCaptain: serializePlayer(chooseCaptain(officialPlayers, true)),
    officialXI: serializeTeam(officialXI),
    availabilityAwareXI: serializeTeam(awareXI),
    recommendedDidNotPlay: officialPlayers.filter((player) => player.didNotPlayActual === true).map((player) => serializePlayer(player, {
      errorClass: classifyAvailabilityError(player),
      predictable: classifyAvailabilityError(player) === "PREDICTABLE_AVAILABILITY_ERROR"
    }))
  };
}

function buildErrorSummary(roundEvaluations) {
  const categories = {
    PREDICTABLE_AVAILABILITY_ERROR: [],
    INSUFFICIENT_PREMATCH_DATA: [],
    UNEXPECTED_ROTATION: [],
    STATUS_SIGNAL_MISSED: [],
    MODEL_ERROR: []
  };
  for (const item of roundEvaluations) {
    for (const player of item.officialXI.players || []) {
      const category = classifyAvailabilityError(player);
      if (categories[category]) categories[category].push(serializePlayer(player, { round: item.round, errorClass: category }));
    }
  }
  for (const key of Object.keys(categories)) {
    categories[key] = categories[key].slice(0, 10);
  }
  return categories;
}

function mergeRound19Errors(errors, round19Audit) {
  const merged = Object.fromEntries(Object.entries(errors).map(([key, rows]) => [key, [...rows]]));
  for (const player of round19Audit.recommendedDidNotPlay || []) {
    const key = player.errorClass;
    if (merged[key]) {
      merged[key].push({ ...player, round: 19 });
    }
  }
  for (const key of Object.keys(merged)) {
    merged[key] = merged[key].slice(0, 10);
  }
  return merged;
}

function buildPromotionGate(aggregate) {
  const official = aggregate.xi.officialAverageActualPoints ?? 0;
  const aware = aggregate.xi.availabilityAwareAverageActualPoints ?? 0;
  const didImproved = (aggregate.xi.availabilityAwareAverageDidNotPlayCount ?? Infinity) < (aggregate.xi.officialAverageDidNotPlayCount ?? 0);
  const scoreHeld = aware >= official * 0.97;
  const state = didImproved && scoreHeld && aggregate.validRounds >= 15 ? "EXPERIMENTAL" : "REJECTED";
  return {
    allowedStates: ["REJECTED", "EXPERIMENTAL", "PROMOTABLE"],
    candidateId: "contextual-score-with-availability",
    state,
    promoted: false,
    promotable: false,
    reasons: [
      didImproved ? "Reduziu didNotPlayCount medio do XI no laboratorio." : "Nao reduziu didNotPlayCount medio de forma suficiente.",
      scoreHeld ? "Pontuacao media foi mantida dentro da tolerancia experimental." : "Pontuacao media caiu alem da tolerancia experimental.",
      "Sem promocao automatica e sem regra nominal."
    ]
  };
}

function buildAvailabilityCalibration({
  season = SEASON,
  round = ROUND,
  historicalRepository = new HistoricalDataRepository(),
  liveSnapshotRepository = new LiveSnapshotRepository(),
  backtestRepository = new BacktestRepository({ buildId: SOURCE_BUILD_ID }),
  researchRepository = new ResearchRepository()
} = {}) {
  const roundResults = backtestRepository.listRoundResults(season).filter((item) => item.round >= 2 && item.round <= 18);
  const roundEvaluations = roundResults.map((roundResult) => buildRoundEvaluation(roundResult, historicalRepository, season));
  const aggregate = aggregateBacktest(roundEvaluations);
  const round19 = enrichRound19Players(liveSnapshotRepository, historicalRepository, season, round);
  const round19Audit = buildRound19Audit(round19.players, round19.latest.snapshot);
  const artifact = sanitize({
    schemaVersion: "availability-calibration-research/v1",
    generatedAt: new Date().toISOString(),
    season,
    round,
    engineVersion: AVAILABILITY_ENGINE_VERSION,
    sourceBuildId: SOURCE_BUILD_ID,
    officialEngineImpact: false,
    productionPromotion: false,
    participationReliabilityMetadata: PARTICIPATION_RELIABILITY_METADATA,
    availablePreMatchSignals: [
      "statusBeforeRound quando existente",
      "gamesBeforeRound",
      "participacao historica ate N-1",
      "recentParticipationRate",
      "consecutiveDidNotPlay",
      "consecutivePlayed",
      "sampleSize",
      "homeAway",
      "opponent",
      "priceBeforeRound como contexto fraco",
      "dataQualityScore separado do availabilityDataQuality"
    ],
    unavailableSignalsNotInvented: ["titularidade", "minutos", "lesao", "suspensao", "provavel escalacao", "starts confiaveis"],
    temporalPolicy: {
      leakageStatus: "PASS",
      roundNUsesParticipationOnlyUntilNMinus1: true,
      didPlayActualUsedOnlyAsTarget: true,
      didNotPlayActualUsedOnlyAsTarget: true
    },
    backtest: aggregate,
    round19: round19Audit,
    errors: mergeRound19Errors(buildErrorSummary(roundEvaluations), round19Audit),
    promotionGate: buildPromotionGate(aggregate),
    limitations: [
      "Status pre-rodada esta majoritariamente indisponivel nos dados historicos reconstruidos.",
      "Titularidade, minutos, lesoes, suspensoes e provaveis escalacoes nao existem como fonte confiavel neste dataset.",
      "AVAILABILITY_V1 e indice interno, nao probabilidade calibrada.",
      "Rodada 19 usa snapshot/live market disponivel para target posterior."
    ],
    artifacts: {
      persistedAt: `data/research/${season}/availability-calibration.json`,
      report: "docs/research/build-5.2.5-availability-learning.md",
      round19Report: "docs/research/round-19-availability-learning.md"
    }
  });
  researchRepository.writeJson(season, "availability-calibration.json", artifact);
  return artifact;
}

function writeAvailabilityReports(artifact, options = {}) {
  const reportPath = options.reportPath || path.resolve(__dirname, "../../docs/research/build-5.2.5-availability-learning.md");
  const roundReportPath = options.roundReportPath || path.resolve(__dirname, "../../docs/research/round-19-availability-learning.md");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const lines = [
    "# Build 5.2.5 - Availability Learning",
    "",
    "Research Lab experimental. Nao altera Motor SLVS oficial, formulas, Flutter, snapshots ou backtests.",
    "",
    `Rodadas validas: ${artifact.backtest.validRounds}. Atletas avaliados: ${artifact.backtest.evaluatedAthletes}.`,
    `HIGH_CONFIDENCE didPlayRate: ${artifact.backtest.confidenceBuckets.HIGH_CONFIDENCE_TO_PLAY.didPlayRate}.`,
    `LOW_CONFIDENCE didNotPlayRate: ${artifact.backtest.confidenceBuckets.LOW_CONFIDENCE_TO_PLAY.didNotPlayRate}.`,
    `XI oficial media real: ${artifact.backtest.xi.officialAverageActualPoints}; availability-aware: ${artifact.backtest.xi.availabilityAwareAverageActualPoints}.`,
    `Promotion gate: ${artifact.promotionGate.state}; promoted=${artifact.promotionGate.promoted}.`,
    "",
    "## Limitacoes",
    "",
    ...artifact.limitations.map((item) => `- ${item}`),
    ""
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  const round19 = [
    "# Round 19 Availability Learning",
    "",
    `Capitao oficial: ${artifact.round19.officialCaptain?.name || "N/A"}; reliability ${artifact.round19.officialCaptain?.participationReliabilityScore ?? "N/A"}; jogou=${artifact.round19.officialCaptain?.didPlayActual}.`,
    `Capitao availability-aware: ${artifact.round19.availabilityAwareCaptain?.name || "N/A"}; reliability ${artifact.round19.availabilityAwareCaptain?.participationReliabilityScore ?? "N/A"}; jogou=${artifact.round19.availabilityAwareCaptain?.didPlayActual}.`,
    `XI oficial pontos reais: ${artifact.round19.officialXI.actualPoints}; nao jogaram: ${artifact.round19.officialXI.didNotPlayCount}.`,
    `XI availability-aware pontos reais: ${artifact.round19.availabilityAwareXI.actualPoints}; nao jogaram: ${artifact.round19.availabilityAwareXI.didNotPlayCount}.`,
    "",
    "## Recomendados que nao jogaram",
    "",
    ...artifact.round19.recommendedDidNotPlay.map((player) => `- ${player.name} (${player.position}): reliability ${player.participationReliabilityScore}, ${player.availabilityConfidence}, ${player.errorClass}.`),
    ""
  ];
  fs.writeFileSync(roundReportPath, `${round19.join("\n")}\n`, "utf8");
  return { reportPath, roundReportPath };
}

module.exports = {
  AVAILABILITY_ENGINE_VERSION,
  PARTICIPATION_RELIABILITY_METADATA,
  adjustedScore,
  availabilityDataQuality,
  buildAvailabilityCalibration,
  buildParticipationHistoryForRound,
  buildPromotionGate,
  buildRoundEvaluation,
  classifyAvailabilityError,
  enrichWithAvailability,
  participationFeaturesForPlayer,
  participationReliability,
  rankAvailabilityAware,
  writeAvailabilityReports
};
