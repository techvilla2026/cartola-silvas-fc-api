const { PRE_ROUND_SCHEMA_VERSION } = require("./preRoundReconstructor");

function hasOwnRoundPoints(player) {
  return Object.prototype.hasOwnProperty.call(player, "points") || Object.prototype.hasOwnProperty.call(player, "roundPoints");
}

function hasOwnRoundScouts(player) {
  return Object.prototype.hasOwnProperty.call(player, "scouts") || Object.prototype.hasOwnProperty.call(player, "roundScouts");
}

function checkPreRoundLeakage(preRound) {
  const issues = [];
  const warnings = [];

  if (preRound.schemaVersion !== PRE_ROUND_SCHEMA_VERSION) {
    warnings.push({
      code: "UNKNOWN_PRE_ROUND_SCHEMA",
      message: "Schema pre-rodada nao e v2."
    });
  }

  for (const match of preRound.matches || []) {
    if (match.homeScore !== null || match.awayScore !== null) {
      issues.push({
        code: "MATCH_SCORE_LEAK",
        round: preRound.round,
        matchId: match.matchId
      });
    }
  }

  for (const player of preRound.players || []) {
    if (hasOwnRoundPoints(player)) {
      issues.push({
        code: "CURRENT_ROUND_POINTS_LEAK",
        round: preRound.round,
        athleteId: player.athleteId
      });
    }

    if (hasOwnRoundScouts(player)) {
      issues.push({
        code: "CURRENT_ROUND_SCOUTS_LEAK",
        round: preRound.round,
        athleteId: player.athleteId
      });
    }

    if (Object.prototype.hasOwnProperty.call(player, "priceVariation")) {
      issues.push({
        code: "CURRENT_ROUND_PRICE_VARIATION_LEAK",
        round: preRound.round,
        athleteId: player.athleteId
      });
    }

    const averageProvenance = player.fieldProvenance?.averageBeforeRound;
    if (averageProvenance?.sourceRound === preRound.round) {
      issues.push({
        code: "POST_ROUND_AVERAGE_LEAK",
        round: preRound.round,
        athleteId: player.athleteId
      });
    }

    const gamesProvenance = player.fieldProvenance?.gamesBeforeRound;
    if (gamesProvenance?.sourceRound === preRound.round) {
      issues.push({
        code: "POST_ROUND_GAMES_LEAK",
        round: preRound.round,
        athleteId: player.athleteId
      });
    }
  }

  return {
    schemaVersion: "historical-leakage-report/v1",
    season: preRound.season,
    round: preRound.round,
    status: issues.length ? "FAIL" : warnings.length ? "WARNING" : "PASS",
    issues,
    warnings
  };
}

module.exports = {
  checkPreRoundLeakage
};
