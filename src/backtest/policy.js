const { FORMATION_433 } = require("./constants");
const { round } = require("./math");

function predictionForPlayer(player) {
  const average = Number(player.averageBeforeRound ?? 0);
  const sampleBonus = Math.min(Number(player.gamesBeforeRound ?? 0), 10) * 0.03;
  const homeAwayBonus = player.homeAway === "HOME" ? 0.25 : player.homeAway === "AWAY" ? -0.1 : 0;
  const accumulatedAverage =
    player.gamesBeforeRound > 0 && Number.isFinite(Number(player.accumulatedPointsBeforeRound))
      ? Number(player.accumulatedPointsBeforeRound) / Number(player.gamesBeforeRound)
      : average;
  const blended = (average * 0.75) + (accumulatedAverage * 0.25);

  return round(blended + sampleBonus + homeAwayBonus, 3);
}

function analysisGrade(predictedPoints) {
  if (!Number.isFinite(Number(predictedPoints))) {
    return null;
  }

  return Math.max(0, Math.min(100, round((Number(predictedPoints) + 5) * 7, 2)));
}

function scoreBand(grade) {
  if (grade === null) return "NOT_EVALUATED";
  if (grade < 40) return "Fraca";
  if (grade < 60) return "Regular";
  if (grade < 75) return "Boa";
  if (grade < 90) return "Forte";
  return "Excelente";
}

function predictPlayers(preRound) {
  return (preRound.players || [])
    .filter((player) => player.eligibleForBacktest && FORMATION_433[player.positionId])
    .map((player) => {
      const predictedPoints = predictionForPlayer(player);
      const grade = analysisGrade(predictedPoints);

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
        predictedPoints,
        analysisGrade: grade,
        analysisBand: scoreBand(grade),
        eligibleForBacktest: true
      };
    });
}

function selectFormation(predictions, scoreField = "predictedPoints") {
  const selected = [];

  for (const [positionId, count] of Object.entries(FORMATION_433)) {
    const players = predictions
      .filter((player) => String(player.positionId) === String(positionId))
      .sort((a, b) => {
        const diff = Number(b[scoreField] ?? -Infinity) - Number(a[scoreField] ?? -Infinity);
        return diff || Number(a.athleteId) - Number(b.athleteId);
      })
      .slice(0, count);
    selected.push(...players);
  }

  return selected;
}

function selectCaptain(team) {
  const ordered = [...team].sort((a, b) => {
    const diff = Number(b.predictedPoints ?? -Infinity) - Number(a.predictedPoints ?? -Infinity);
    return diff || Number(a.athleteId) - Number(b.athleteId);
  });

  return {
    captain: ordered[0] || null,
    viceCaptain: ordered[1] || null
  };
}

function baselinePredictions(preRound) {
  return (preRound.players || [])
    .filter((player) => player.eligibleForBacktest && FORMATION_433[player.positionId])
    .map((player) => ({
      athleteId: player.athleteId,
      name: player.name,
      clubId: player.clubId,
      positionId: player.positionId,
      homeAway: player.homeAway,
      priceBeforeRound: player.priceBeforeRound,
      predictedPoints: round(player.averageBeforeRound ?? 0, 3)
    }));
}

module.exports = {
  predictionForPlayer,
  analysisGrade,
  scoreBand,
  predictPlayers,
  selectFormation,
  selectCaptain,
  baselinePredictions
};
