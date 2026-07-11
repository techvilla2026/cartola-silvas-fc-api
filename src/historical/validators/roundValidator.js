const { VALIDATION_STATUS } = require("../domain/schema");

function compareNumbers(primary, secondary, tolerance = 0) {
  if (primary === null || primary === undefined || secondary === null || secondary === undefined) {
    return false;
  }

  return Math.abs(Number(primary) - Number(secondary)) <= tolerance;
}

function indexByAthleteId(players) {
  const index = new Map();
  for (const player of players) {
    index.set(String(player.athleteId), player);
  }
  return index;
}

function normalizeOfficialPlayers(officialData) {
  const athletes = officialData?.atletas || {};
  return Object.entries(athletes).map(([athleteId, athlete]) => ({
    athleteId: Number(athleteId),
    clubId: athlete.clube_id ?? null,
    positionId: athlete.posicao_id ?? null,
    points: athlete.pontuacao ?? null,
    scouts: athlete.scout || {}
  }));
}

function validateRound(primaryRoundData, officialData) {
  const officialPlayers = normalizeOfficialPlayers(officialData);
  const primaryPlayedPlayers = primaryRoundData.players.filter((player) => player.played === true);
  const primaryIndex = indexByAthleteId(primaryPlayedPlayers);
  const officialIndex = indexByAthleteId(officialPlayers);
  const missingPlayers = [];
  const extraPlayers = [];
  const pointsDifferences = [];
  const priceDifferences = [];
  const scoutDifferences = [];
  const matchDifferences = [];

  for (const officialPlayer of officialPlayers) {
    const primaryPlayer = primaryIndex.get(String(officialPlayer.athleteId));

    if (!primaryPlayer) {
      missingPlayers.push(officialPlayer.athleteId);
      continue;
    }

    if (!compareNumbers(primaryPlayer.points, officialPlayer.points, 0.001)) {
      pointsDifferences.push({
        athleteId: officialPlayer.athleteId,
        primary: primaryPlayer.points,
        validation: officialPlayer.points
      });
    }

    for (const [scout, value] of Object.entries(officialPlayer.scouts || {})) {
      if (!compareNumbers(primaryPlayer.scouts?.[scout], value, 0.001)) {
        scoutDifferences.push({
          athleteId: officialPlayer.athleteId,
          scout,
          primary: primaryPlayer.scouts?.[scout] ?? null,
          validation: value
        });
      }
    }
  }

  for (const primaryPlayer of primaryPlayedPlayers) {
    if (!officialIndex.has(String(primaryPlayer.athleteId))) {
      extraPlayers.push(primaryPlayer.athleteId);
    }
  }

  const validationStatus =
    missingPlayers.length ||
    extraPlayers.length ||
    pointsDifferences.length ||
    priceDifferences.length ||
    scoutDifferences.length ||
    matchDifferences.length
      ? VALIDATION_STATUS.VALID_WITH_WARNINGS
      : VALIDATION_STATUS.VALID;

  return {
    schemaVersion: "historical-validation-report/v1",
    season: primaryRoundData.season,
    round: primaryRoundData.round,
    primarySource: primaryRoundData.source,
    validationSource: "cartola-official-public-api",
    playersCompared: officialPlayers.length,
    matchesCompared: primaryRoundData.matches.length,
    missingPlayers,
    extraPlayers,
    pointsDifferences,
    priceDifferences,
    scoutDifferences,
    matchDifferences,
    validationStatus
  };
}

module.exports = {
  compareNumbers,
  normalizeOfficialPlayers,
  validateRound
};
