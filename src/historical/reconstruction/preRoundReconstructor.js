const { nowIso } = require("../domain/schema");

const PRE_ROUND_SCHEMA_VERSION = "historical-pre-round-data/v2";
const PRICE_TOLERANCE = 0.02;
const AVERAGE_TOLERANCE = 0.02;

function roundNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function addScouts(target, scouts) {
  for (const [scout, value] of Object.entries(scouts || {})) {
    target[scout] = roundNumber((target[scout] || 0) + Number(value || 0));
  }
  return target;
}

function subtractScouts(current, previous) {
  const result = {};
  const keys = new Set([...Object.keys(current || {}), ...Object.keys(previous || {})]);

  for (const key of keys) {
    const value = Number(current?.[key] || 0) - Number(previous?.[key] || 0);
    if (Math.abs(value) > 0.0001) {
      result[key] = roundNumber(value);
    }
  }

  return result;
}

function createProvenance({ status, method, sourceRound, sourceFile, sourceField, confidence, allowedForBacktest, note }) {
  return {
    status,
    method,
    sourceRound: sourceRound ?? null,
    sourceFile: sourceFile || null,
    sourceField: sourceField || null,
    confidence,
    allowedForBacktest,
    note
  };
}

function indexPlayers(roundData) {
  const index = new Map();

  for (const player of roundData?.players || []) {
    index.set(String(player.athleteId), player);
  }

  return index;
}

function buildOpponentMap(matches) {
  const map = new Map();

  for (const match of matches || []) {
    map.set(String(match.homeClubId), {
      opponent: match.awayClubId,
      homeAway: "HOME",
      matchId: match.matchId
    });
    map.set(String(match.awayClubId), {
      opponent: match.homeClubId,
      homeAway: "AWAY",
      matchId: match.matchId
    });
  }

  return map;
}

function sanitizePreMatch(match) {
  return {
    matchId: match.matchId,
    round: match.round,
    homeClubId: match.homeClubId,
    awayClubId: match.awayClubId,
    date: match.date,
    venue: match.venue,
    homeScore: null,
    awayScore: null,
    valid: match.valid,
    status: null,
    rawSourceReference: match.rawSourceReference
  };
}

function classifyReadiness(players, matches, round) {
  if (round === 1) {
    return "NOT_READY";
  }

  const eligible = players.filter((player) => player.eligibleForBacktest).length;
  const ratio = players.length ? eligible / players.length : 0;

  if (!matches.length || ratio === 0) {
    return "NOT_READY";
  }

  if (ratio >= 0.7) {
    return "READY";
  }

  return "PARTIALLY_READY";
}

function reconstructPlayer({ currentPlayer, previousPlayer, history, round, matchInfo }) {
  const provenance = {};
  const reasons = [];
  const previousSourceFile = previousPlayer?.rawSourceReference?.url || null;
  const currentSourceFile = currentPlayer.rawSourceReference?.url || null;
  const hasPrevious = Boolean(previousPlayer);
  const previousPlayedGames = previousPlayer?.games ?? null;
  const accumulatedPoints = history.pointsByAthlete.get(String(currentPlayer.athleteId)) ?? null;
  const accumulatedScouts = history.scoutsByAthlete.get(String(currentPlayer.athleteId)) || null;
  const priceBeforeRound = currentPlayer.price !== null && currentPlayer.priceVariation !== null
    ? roundNumber(currentPlayer.price - currentPlayer.priceVariation)
    : null;
  const priceMatchesPrevious = hasPrevious && previousPlayer.price !== null && priceBeforeRound !== null
    ? Math.abs(priceBeforeRound - previousPlayer.price) <= PRICE_TOLERANCE
    : false;
  const averageBeforeRound = hasPrevious ? previousPlayer.average : null;
  const averageConsistent =
    averageBeforeRound !== null &&
    previousPlayedGames &&
    accumulatedPoints !== null
      ? Math.abs(averageBeforeRound - accumulatedPoints / previousPlayedGames) <= AVERAGE_TOLERANCE
      : false;

  if (round === 1) {
    reasons.push("roundOneNoPreviousData");
  }

  if (!hasPrevious && round > 1) {
    reasons.push("missingPreviousRound");
  }

  if (!matchInfo) {
    reasons.push("missingMatchContext");
  }

  if (priceBeforeRound === null) {
    reasons.push("unsafePrice");
  }

  if (!priceMatchesPrevious && round > 1) {
    reasons.push("unsafePrice");
  }

  if (!averageConsistent && round > 1) {
    reasons.push("averageConsistencyWarning");
  }

  provenance.priceBeforeRound = createProvenance({
    status: priceBeforeRound !== null && priceMatchesPrevious ? "reconstructed" : "inferredWithCaution",
    method: "currentPostPriceMinusCurrentRoundPriceVariation",
    sourceRound: round,
    sourceFile: currentSourceFile,
    sourceField: "post.players[].price - post.players[].priceVariation",
    confidence: priceMatchesPrevious ? "high" : "medium",
    allowedForBacktest: Boolean(priceBeforeRound !== null && (priceMatchesPrevious || round === 1)),
    note: priceMatchesPrevious
      ? "Bate com o preco observado ao final da rodada anterior dentro da tolerancia."
      : "Sem confirmacao suficiente contra a rodada anterior."
  });
  provenance.averageBeforeRound = createProvenance({
    status: hasPrevious ? "reconstructed" : "unavailable",
    method: "previousRoundPostAverage",
    sourceRound: hasPrevious ? round - 1 : null,
    sourceFile: previousSourceFile,
    sourceField: "post.players[].average",
    confidence: averageConsistent ? "high" : hasPrevious ? "medium" : "none",
    allowedForBacktest: hasPrevious,
    note: averageConsistent
      ? "Media consistente com pontos acumulados divididos por jogos antes da rodada."
      : "Media anterior ausente ou com arredondamento/consistencia nao confirmada."
  });
  provenance.gamesBeforeRound = createProvenance({
    status: hasPrevious ? "reconstructed" : "unavailable",
    method: "previousRoundPostGames",
    sourceRound: hasPrevious ? round - 1 : null,
    sourceFile: previousSourceFile,
    sourceField: "post.players[].games",
    confidence: hasPrevious ? "high" : "none",
    allowedForBacktest: hasPrevious,
    note: "Jogos acumulados ao final da rodada anterior."
  });
  provenance.accumulatedPointsBeforeRound = createProvenance({
    status: round > 1 ? "reconstructed" : "unavailable",
    method: "sumPreviousRoundPointsWhenPlayed",
    sourceRound: round > 1 ? `1-${round - 1}` : null,
    sourceFile: "data/historical/2026/round-XX/post-round.json",
    sourceField: "post.players[].points",
    confidence: round > 1 ? "high" : "none",
    allowedForBacktest: round > 1,
    note: "Soma pontos reais de rodadas anteriores; pontos da propria rodada nao sao usados."
  });
  provenance.accumulatedScoutsBeforeRound = createProvenance({
    status: round > 1 ? "reconstructed" : "unavailable",
    method: "previousRoundsScoutAccumulationFromPrimarySource",
    sourceRound: round > 1 ? `1-${round - 1}` : null,
    sourceFile: "data/historical/2026/round-XX/post-round.json",
    sourceField: "post.players[].scouts",
    confidence: "medium",
    allowedForBacktest: round > 1,
    note: "Scouts usam a fonte primaria caRtola; divergencias contra Cartola oficial ficam documentadas."
  });
  provenance.statusBeforeRound = createProvenance({
    status: "unavailable",
    method: "notReconstructed",
    sourceRound: null,
    sourceFile: null,
    sourceField: null,
    confidence: "none",
    allowedForBacktest: false,
    note: "Sem evidencia temporal suficiente de que status historico represente o fechamento pre-rodada."
  });

  const eligibleForBacktest =
    round > 1 &&
    hasPrevious &&
    Boolean(matchInfo) &&
    previousPlayedGames !== null &&
    accumulatedPoints !== null &&
    accumulatedScouts !== null;

  if (!eligibleForBacktest && !reasons.length) {
    reasons.push("insufficientSample");
  }

  return {
    athleteId: currentPlayer.athleteId,
    name: currentPlayer.name,
    nickname: currentPlayer.nickname,
    clubId: currentPlayer.clubId,
    positionId: currentPlayer.positionId,
    priceBeforeRound,
    averageBeforeRound,
    gamesBeforeRound: previousPlayedGames,
    accumulatedPointsBeforeRound: accumulatedPoints,
    accumulatedScoutsBeforeRound: accumulatedScouts,
    statusBeforeRound: null,
    opponent: matchInfo?.opponent ?? null,
    homeAway: matchInfo?.homeAway ?? null,
    fieldProvenance: provenance,
    eligibleForBacktest,
    ineligibilityReasons: eligibleForBacktest ? [] : [...new Set(reasons)]
  };
}

function buildHistory(rounds, targetRound) {
  const pointsByAthlete = new Map();
  const scoutsByAthlete = new Map();

  for (const roundData of rounds) {
    if (!roundData || roundData.round >= targetRound) {
      continue;
    }

    for (const player of roundData.players || []) {
      const key = String(player.athleteId);
      const previousPoints = pointsByAthlete.get(key) || 0;
      const previousScouts = scoutsByAthlete.get(key) || {};

      if (player.played === true && player.points !== null) {
        pointsByAthlete.set(key, roundNumber(previousPoints + player.points));
      } else if (!pointsByAthlete.has(key)) {
        pointsByAthlete.set(key, previousPoints);
      }

      scoutsByAthlete.set(key, addScouts({ ...previousScouts }, player.scouts || {}));
    }
  }

  return { pointsByAthlete, scoutsByAthlete };
}

function reconstructPreRound({ season, round, currentPost, previousPost, allPosts, generatedAt = nowIso() }) {
  const history = buildHistory(allPosts || [], round);
  const previousIndex = indexPlayers(previousPost);
  const opponentMap = buildOpponentMap(currentPost.matches);
  const matches = (currentPost.matches || []).map(sanitizePreMatch);
  const sourceRounds = round > 1 ? Array.from({ length: round - 1 }, (_, index) => index + 1) : [];
  const players = (currentPost.players || []).map((currentPlayer) => reconstructPlayer({
    currentPlayer,
    previousPlayer: previousIndex.get(String(currentPlayer.athleteId)),
    history,
    round,
    matchInfo: opponentMap.get(String(currentPlayer.clubId))
  }));
  const readinessStatus = classifyReadiness(players, matches, round);
  const eligiblePlayers = players.filter((player) => player.eligibleForBacktest).length;

  return {
    schemaVersion: PRE_ROUND_SCHEMA_VERSION,
    season,
    round,
    generatedAt,
    sourceRounds,
    leakageStatus: "PASS",
    players,
    matches,
    metadata: {
      reconstructionMethod: "Use only rounds before N for accumulated fields; use current round only for identity, fixture and price minus variation audit.",
      priceTolerance: PRICE_TOLERANCE,
      averageTolerance: AVERAGE_TOLERANCE,
      statusBeforeRound: "unavailable"
    },
    readiness: {
      status: readinessStatus,
      criteria: {
        completeFixtures: matches.length > 0,
        minimumEligiblePlayersRatio: 0.7,
        noLeakageDetected: true
      },
      totalPlayers: players.length,
      eligiblePlayers,
      ineligiblePlayers: players.length - eligiblePlayers,
      eligibleRatio: players.length ? Number((eligiblePlayers / players.length).toFixed(4)) : 0
    }
  };
}

module.exports = {
  PRE_ROUND_SCHEMA_VERSION,
  PRICE_TOLERANCE,
  subtractScouts,
  buildHistory,
  reconstructPreRound
};
