const { ENRICHED_LEAKAGE_SCHEMA_VERSION, ENRICHED_SCHEMA_VERSION } = require("./enrichedRepository");

function checkEnrichedLeakage(enriched) {
  const issues = [];
  const warnings = [];

  if (enriched.schemaVersion !== ENRICHED_SCHEMA_VERSION) {
    warnings.push({ code: "UNKNOWN_ENRICHED_SCHEMA", message: "Schema enriquecido desconhecido." });
  }

  for (const match of enriched.matches || []) {
    if (match.homeScore !== null || match.awayScore !== null) {
      issues.push({ code: "MATCH_SCORE_LEAK", round: enriched.round, matchId: match.matchId });
    }
  }

  for (const player of enriched.players || []) {
    const recent = player.recentFormBeforeRound || {};
    for (const sourceRound of recent.sourceRounds || []) {
      if (Number(sourceRound) >= Number(enriched.round)) {
        issues.push({
          code: "RECENT_FORM_CURRENT_ROUND_LEAK",
          round: enriched.round,
          athleteId: player.athleteId,
          sourceRound
        });
      }
    }

    const status = player.statusBeforeRound || {};
    if (status.capturedAt && status.marketStatusAtCapture === "closed") {
      issues.push({
        code: "STATUS_AFTER_MARKET_CLOSE",
        round: enriched.round,
        athleteId: player.athleteId
      });
    }

    if (player.historicalScoutsBeforeRound?.mode !== "disabled") {
      warnings.push({
        code: "SCOUTS_ENABLED_REVIEW_REQUIRED",
        round: enriched.round,
        athleteId: player.athleteId
      });
    }
  }

  return {
    schemaVersion: ENRICHED_LEAKAGE_SCHEMA_VERSION,
    season: enriched.season,
    round: enriched.round,
    status: issues.length ? "FAIL" : warnings.length ? "WARNING" : "PASS",
    issues,
    warnings
  };
}

module.exports = {
  checkEnrichedLeakage
};
