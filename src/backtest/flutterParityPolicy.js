const { FORMATION_433 } = require("./constants");
const { round } = require("./math");

const PARITY_ENGINE_VERSION = "flutter-parity-engine/4.3.1";
const PARITY_PREDICTION_POLICY_VERSION = "flutter-score-prediction-parity/4.3.1";
const PARITY_ANALYSIS_SCORE_POLICY_VERSION = "flutter-analysis-score-parity/4.3.1";
const PARITY_DATA_QUALITY_POLICY_VERSION = "flutter-data-quality-parity/4.3.1";
const PARITY_SELECTION_POLICY_VERSION = "flutter-ideal-team-parity/4.3.1";
const PARITY_CAPTAIN_POLICY_VERSION = "flutter-captain-parity/4.3.1";
const PARITY_BUILD_ID = "build-4.3.1";

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function hasScoutData(scouts = {}) {
  return Object.values(scouts || {}).some((value) => Number(value) > 0);
}

function levelForDataQuality(score) {
  const safeScore = clamp(score, 0, 100);
  if (safeScore >= 85) return "veryHigh";
  if (safeScore >= 70) return "high";
  if (safeScore >= 50) return "moderate";
  return "low";
}

function calculateDataQuality({
  status = "",
  games = 0,
  average = 0,
  roundPoints = 0,
  variation = 0,
  matchupAvailable = false,
  scouts = {}
} = {}) {
  const normalizedStatus = normalize(status);
  const statusAvailable = normalizedStatus.length > 0;
  const hasSample = games > 0 || average > 0;
  const hasRecentData = roundPoints !== 0 || variation !== 0;
  const scoutsPresent = hasScoutData(scouts);

  if (!statusAvailable && !hasSample && !hasRecentData && !matchupAvailable) {
    return {
      score: 0,
      roundedScore: 0,
      level: "unavailable",
      dataQualityLabel: "Dados insuficientes para avaliar",
      dataCompleteness: 0,
      isAvailable: false
    };
  }

  let score = 0;
  let availableComponents = 0;

  if (statusAvailable) {
    availableComponents += 1;
    if (normalizedStatus === "provavel") score += 20;
    else if (normalizedStatus === "disponivel") score += 15;
    else if (normalizedStatus === "duvida") score += 8;
    else score += 3;
  }

  if (games > 0) {
    availableComponents += 1;
    if (games >= 10) score += 25;
    else if (games >= 6) score += 19;
    else if (games >= 3) score += 12;
    else score += 5;
  }

  if (average > 0 && games > 0) {
    availableComponents += 1;
    if (games >= 6 && average >= 6) score += 15;
    else if (games >= 3 && average >= 4.5) score += 11;
    else if (average >= 3) score += 7;
    else score += 3;
  }

  if (hasRecentData) {
    availableComponents += 1;
    score += roundPoints !== 0 && variation !== 0 ? 10 : 5;
  }

  if (scoutsPresent) {
    availableComponents += 1;
    score += 15;
  } else if (Object.keys(scouts || {}).length > 0) {
    availableComponents += 1;
  }

  if (matchupAvailable) {
    availableComponents += 1;
    score += 5;
  }

  if (
    normalizedStatus === "provavel" &&
    games > 10 &&
    average >= 6 &&
    roundPoints !== 0 &&
    variation !== 0 &&
    scoutsPresent &&
    matchupAvailable
  ) {
    score += 10;
  }

  if (availableComponents <= 2) score *= 0.7;
  else if (availableComponents <= 3) score *= 0.85;

  const safeScore = clamp(score, 0, 100);
  const roundedScore = Math.round(safeScore);
  return {
    score: safeScore,
    roundedScore,
    level: levelForDataQuality(safeScore),
    dataQualityLabel: !Number.isFinite(safeScore)
      ? "Dados insuficientes para avaliar"
      : roundedScore >= 85
        ? "Dados completos"
        : roundedScore >= 50
          ? "Dados suficientes"
          : "Dados insuficientes",
    dataCompleteness: clamp((availableComponents / 6) * 100, 0, 100),
    isAvailable: true
  };
}

function predictScore({
  athleteId = 0,
  name = "",
  average = 0,
  confidence = 0,
  isHome,
  matchupAvailable = false
} = {}) {
  const safeAverage = clamp(average, 0, 20);
  const safeConfidence = clamp(confidence, 0, 100);
  const highAverageBonus = safeAverage >= 7 ? safeAverage * 0.12 : 0;
  const matchupBonus = matchupAvailable && isHome === true ? 0.4 : 0;
  const predicted = clamp((safeAverage * 0.7) + highAverageBonus + matchupBonus, 0, 25);

  return {
    athleteId,
    name,
    predictedPoints: round(predicted, 1),
    confidence: safeConfidence
  };
}

function analysisBand(score) {
  const safeScore = clamp(score, 0, 100);
  if (safeScore >= 90) return "Excelente";
  if (safeScore >= 75) return "Forte";
  if (safeScore >= 60) return "Boa";
  if (safeScore >= 40) return "Regular";
  return "Fraca";
}

function calculateAnalysisScore(player, predictedPoints, dataQuality) {
  if (
    !(Number(player.athleteId) > 0) ||
    !String(player.name || "").trim() ||
    !((Number(player.averageBeforeRound) > 0) || (Number(player.gamesBeforeRound) > 0) || (Number(player.priceBeforeRound) > 0))
  ) {
    return { score: 0, label: "Indisponivel", isAvailable: false, components: {} };
  }

  const average = Number(player.averageBeforeRound || 0);
  const games = Number(player.gamesBeforeRound || 0);
  const price = Number(player.priceBeforeRound || 0);
  const status = "";
  const matchupAvailable = Boolean(player.homeAway);
  const isHome = player.homeAway === "HOME";

  const components = {
    prediction: clamp(predictedPoints / 12, 0, 1) * 40,
    average: clamp(average / 8, 0, 1) * 15,
    status: normalize(status) === "provavel" ? 15 : normalize(status) === "disponivel" ? 11 : normalize(status) === "duvida" ? 5 : 3,
    sample: clamp(games / 12, 0, 1) * 10,
    home: matchupAvailable ? (isHome ? 5 : 2) : 0,
    value: price > 0 && predictedPoints > 0 ? clamp((predictedPoints / price) / 0.8, 0, 1) * 10 : 0,
    recent: 0
  };
  const rawScore = Object.values(components).reduce((sum, value) => sum + value, 0);
  const limitedScore = applyDataQualityLimiter(rawScore, dataQuality);

  return {
    score: round(clamp(limitedScore, 0, 100), 1),
    label: analysisBand(limitedScore),
    isAvailable: true,
    components
  };
}

function applyDataQualityLimiter(rawScore, dataQuality) {
  if (!dataQuality?.isAvailable) return clamp(rawScore, 0, 59) * 0.7;
  if (dataQuality.roundedScore >= 85) return rawScore;
  if (dataQuality.roundedScore >= 50) return clamp(rawScore * 0.95, 0, 89);
  return clamp(rawScore * 0.8, 0, 74);
}

function mapHistoricalPlayer(player) {
  const matchupAvailable = Boolean(player.homeAway);
  const quality = calculateDataQuality({
    status: "",
    games: Number(player.gamesBeforeRound || 0),
    average: Number(player.averageBeforeRound || 0),
    roundPoints: 0,
    variation: 0,
    matchupAvailable,
    scouts: {}
  });
  const prediction = predictScore({
    athleteId: player.athleteId,
    name: player.name,
    average: Number(player.averageBeforeRound || 0),
    confidence: quality.isAvailable ? quality.score : 0,
    isHome: player.homeAway === "HOME",
    matchupAvailable
  });
  const analysis = calculateAnalysisScore(player, prediction.predictedPoints, quality);

  return {
    athleteId: player.athleteId,
    name: player.name,
    clubId: player.clubId,
    positionId: player.positionId,
    opponent: player.opponent,
    homeAway: player.homeAway,
    priceBeforeRound: player.priceBeforeRound,
    averageBeforeRound: player.averageBeforeRound,
    gamesBeforeRound: player.gamesBeforeRound,
    statusBeforeRound: null,
    historicalStatusMode: "unavailable-neutral",
    historicalRecentDataMode: "unavailable-zero",
    historicalScoutMode: "divergent-not-used",
    predictedPoints: prediction.predictedPoints,
    dataQualityScore: round(quality.score, 3),
    dataQualityRoundedScore: quality.roundedScore,
    dataQualityLevel: quality.level,
    dataCompleteness: round(quality.dataCompleteness, 3),
    analysisGrade: analysis.isAvailable ? analysis.score : null,
    analysisBand: analysis.isAvailable ? analysis.label : "NOT_EVALUATED",
    analysisComponents: analysis.components,
    eligibleForBacktest: true
  };
}

function predictPlayers(preRound) {
  return (preRound.players || [])
    .filter((player) => player.eligibleForBacktest && FORMATION_433[player.positionId])
    .map(mapHistoricalPlayer);
}

function statusPriority() {
  return 1;
}

function homePriority(player) {
  return player.homeAway === "HOME" ? 0 : 1;
}

function selectFormation(predictions) {
  const selected = [];

  for (const [positionId, count] of Object.entries(FORMATION_433)) {
    const players = predictions
      .filter((player) => String(player.positionId) === String(positionId))
      .sort((a, b) => {
        const statusOrder = statusPriority(a) - statusPriority(b);
        if (statusOrder) return statusOrder;
        const averageOrder = Number(b.averageBeforeRound || 0) - Number(a.averageBeforeRound || 0);
        if (averageOrder) return averageOrder;
        const homeOrder = homePriority(a) - homePriority(b);
        if (homeOrder) return homeOrder;
        const priceOrder = Number(a.priceBeforeRound || 0) - Number(b.priceBeforeRound || 0);
        if (priceOrder) return priceOrder;
        return Number(a.athleteId) - Number(b.athleteId);
      })
      .slice(0, count);
    selected.push(...players);
  }

  return selected;
}

function selectCaptain(team) {
  const ordered = [...team].sort((a, b) => {
    const predictionOrder = Number(b.predictedPoints || 0) - Number(a.predictedPoints || 0);
    if (predictionOrder) return predictionOrder;
    const analysisOrder = Number(b.analysisGrade || 0) - Number(a.analysisGrade || 0);
    if (analysisOrder) return analysisOrder;
    const qualityOrder = Number(b.dataQualityScore || 0) - Number(a.dataQualityScore || 0);
    if (qualityOrder) return qualityOrder;
    return Number(b.averageBeforeRound || 0) - Number(a.averageBeforeRound || 0);
  });

  return {
    captain: ordered[0] || null,
    viceCaptain: ordered[1] || null
  };
}

function centralIntelligence(team) {
  const players = team.filter((player) => String(player.positionId) !== "6");
  const highestBy = (items, score) => items.reduce((current, next) => {
    const diff = score(next) - score(current);
    if (diff > 0) return next;
    if (diff === 0 && Number(next.dataQualityScore || 0) > Number(current.dataQualityScore || 0)) return next;
    return current;
  });
  const lowestBy = (items, score) => items.reduce((current, next) => {
    const diff = score(next) - score(current);
    if (diff < 0) return next;
    if (diff === 0 && Number(next.dataQualityScore || 0) < Number(current.dataQualityScore || 0)) return next;
    return current;
  });

  const defenders = players.filter((player) => ["1", "2", "3"].includes(String(player.positionId)));
  const bestCaptain = players[0] ? highestBy(players, (player) => Number(player.predictedPoints || 0)) : null;
  const bestViceCaptain = players.length > 1 ? highestBy(players.filter((player) => player.athleteId !== bestCaptain.athleteId), (player) => Number(player.predictedPoints || 0)) : null;

  return [
    { type: "bestCaptain", status: "EVALUATED", player: bestCaptain },
    { type: "bestViceCaptain", status: "EVALUATED", player: bestViceCaptain },
    { type: "bestDefense", status: "EVALUATED", player: defenders.length ? highestBy(defenders, (player) => Number(player.averageBeforeRound || 0)) : null },
    { type: "bestDifferential", status: "PARTIALLY_EVALUATED", player: players.length > 1 ? highestBy(players.filter((player) => player.athleteId !== bestCaptain.athleteId), (player) => Number(player.averageBeforeRound || 0)) : null },
    { type: "risingPlayer", status: "PARTIALLY_EVALUATED", player: players[0] ? highestBy(players, (player) => Number(player.averageBeforeRound || 0)) : null },
    { type: "playerToAvoid", status: "EVALUATED", player: players[0] ? lowestBy(players, (player) => Number(player.averageBeforeRound || 0)) : null },
    { type: "bestValue", status: "EVALUATED", player: players[0] ? highestBy(players, (player) => Number(player.priceBeforeRound || 0) > 0 ? Number(player.averageBeforeRound || 0) / Number(player.priceBeforeRound || 1) : 0) : null },
    { type: "roundAlert", status: "PARTIALLY_EVALUATED", player: players[0] ? lowestBy(players, (player) => Number(player.averageBeforeRound || 0)) : null }
  ];
}

module.exports = {
  PARITY_ENGINE_VERSION,
  PARITY_PREDICTION_POLICY_VERSION,
  PARITY_ANALYSIS_SCORE_POLICY_VERSION,
  PARITY_DATA_QUALITY_POLICY_VERSION,
  PARITY_SELECTION_POLICY_VERSION,
  PARITY_CAPTAIN_POLICY_VERSION,
  PARITY_BUILD_ID,
  analysisBand,
  calculateAnalysisScore,
  calculateDataQuality,
  centralIntelligence,
  predictPlayers,
  predictScore,
  selectCaptain,
  selectFormation
};
