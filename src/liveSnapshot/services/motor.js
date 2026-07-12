const { centralIntelligence, predictPlayers, selectCaptain, selectFormation } = require("../../backtest/flutterParityPolicy");
const {
  PARITY_ANALYSIS_SCORE_POLICY_VERSION,
  PARITY_CAPTAIN_POLICY_VERSION,
  PARITY_DATA_QUALITY_POLICY_VERSION,
  PARITY_ENGINE_VERSION,
  PARITY_PREDICTION_POLICY_VERSION,
  PARITY_SELECTION_POLICY_VERSION
} = require("../../backtest/flutterParityPolicy");
const { AVAILABILITY } = require("../domain/constants");

function livePlayerToPreRound(player, matches) {
  const match = matches.find((item) => item.homeAwayByClub?.[String(player.clubId)]);
  return {
    athleteId: player.athleteId,
    name: player.name || player.nickname,
    clubId: player.clubId,
    positionId: player.positionId,
    priceBeforeRound: player.price,
    averageBeforeRound: player.average,
    gamesBeforeRound: player.games,
    accumulatedPointsBeforeRound: null,
    accumulatedScoutsBeforeRound: null,
    statusBeforeRound: player.statusId,
    opponent: match
      ? match.homeClubId === player.clubId
        ? match.awayClubId
        : match.homeClubId
      : null,
    homeAway: match?.homeAwayByClub?.[String(player.clubId)] || null,
    eligibleForBacktest: Boolean(player.athleteId && player.name && player.positionId && [1, 2, 3, 4, 5].includes(Number(player.positionId)))
  };
}

function runSnapshotMotor({ players, matches, isValidPreRoundSnapshot }) {
  const engineVersions = {
    engineVersion: PARITY_ENGINE_VERSION,
    predictionPolicyVersion: PARITY_PREDICTION_POLICY_VERSION,
    analysisScorePolicyVersion: PARITY_ANALYSIS_SCORE_POLICY_VERSION,
    dataQualityPolicyVersion: PARITY_DATA_QUALITY_POLICY_VERSION,
    selectionPolicyVersion: PARITY_SELECTION_POLICY_VERSION,
    captainPolicyVersion: PARITY_CAPTAIN_POLICY_VERSION
  };

  if (!isValidPreRoundSnapshot) {
    return {
      available: false,
      teamAvailable: false,
      captainAvailable: false,
      centralAvailable: false,
      engineVersions,
      unavailableReason: "Motor nao executado para snapshot temporalmente invalido ou desconhecido.",
      comparator: { status: "NOT_EVALUATED", reason: "Elenco pessoal nao e capturado nesta build." }
    };
  }

  const preRound = {
    players: players.map((player) => livePlayerToPreRound(player, matches))
  };
  const predictions = predictPlayers(preRound);
  const selectedTeam = selectFormation(predictions);
  const { captain, viceCaptain } = selectCaptain(selectedTeam);
  const central = centralIntelligence(selectedTeam);

  return {
    available: predictions.length > 0,
    teamAvailable: selectedTeam.length === 11,
    captainAvailable: Boolean(captain && viceCaptain),
    centralAvailable: central.length > 0,
    engineVersions,
    predictions,
    idealTeam: {
      formation: "4-3-3",
      players: selectedTeam,
      captainAthleteId: captain?.athleteId || null,
      viceCaptainAthleteId: viceCaptain?.athleteId || null
    },
    centralRecommendations: central.map((item) => ({
      type: item.type,
      status: item.status,
      athleteId: item.player?.athleteId || null
    })),
    userLineup: { status: AVAILABILITY.NOT_APPLICABLE },
    comparator: { status: "NOT_EVALUATED", reason: "Elenco pessoal nao e capturado nesta build." }
  };
}

module.exports = {
  runSnapshotMotor
};
