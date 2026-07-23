const { CONGESTION_THRESHOLDS } = require("./constants");
const { round, sanitize } = require("./math");

const DAY_MS = 864e5;
const POSITION_IDS = {
  GOL: 1,
  LAT: 2,
  ZAG: 3,
  MEI: 4,
  ATA: 5,
  TEC: 6
};

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 100) {
  const number = finite(value);
  if (number === null) return null;
  return Math.min(max, Math.max(min, number));
}

function matchTime(match) {
  const date = match?.startsAt || match?.matchDate || match?.date;
  const timestamp = date ? new Date(date).getTime() : null;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isFinished(match) {
  return match?.status === "FINISHED"
    || (finite(match?.homeScore) !== null && finite(match?.awayScore) !== null);
}

function resultForTeam(match, teamId) {
  const home = Number(match.homeClubId) === Number(teamId);
  const goalsFor = home ? finite(match.homeScore) : finite(match.awayScore);
  const goalsAgainst = home ? finite(match.awayScore) : finite(match.homeScore);
  if (goalsFor === null || goalsAgainst === null) return null;
  return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
}

function goalsForTeam(match, teamId) {
  return Number(match.homeClubId) === Number(teamId) ? finite(match.homeScore) : finite(match.awayScore);
}

function goalsAgainstTeam(match, teamId) {
  return Number(match.homeClubId) === Number(teamId) ? finite(match.awayScore) : finite(match.homeScore);
}

function priorFinishedMatches({ teamId, matches, cutoffIso, window = 5 }) {
  const cutoff = new Date(cutoffIso || new Date().toISOString()).getTime();
  if (!Number.isFinite(cutoff)) return [];
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => {
      const time = matchTime(match);
      return time !== null
        && time < cutoff
        && (Number(match.homeClubId) === Number(teamId) || Number(match.awayClubId) === Number(teamId))
        && isFinished(match);
    })
    .sort((a, b) => matchTime(a) - matchTime(b))
    .slice(-window);
}

function venueMatches(matches, teamId, homeAway) {
  return matches.filter((match) => (
    homeAway === "HOME"
      ? Number(match.homeClubId) === Number(teamId)
      : Number(match.awayClubId) === Number(teamId)
  ));
}

function recentFormFromMatches(matches, teamId, window = 5) {
  if (!matches.length) {
    return {
      status: "INSUFFICIENT_SAMPLE",
      sampleSize: 0,
      window,
      lastMatches: [],
      wins: null,
      draws: null,
      losses: null,
      goalsFor: null,
      goalsAgainst: null,
      formIndex: null,
      unavailableSignals: ["no_finished_matches_before_fixture"]
    };
  }

  const results = matches.map((match) => ({
    matchId: match.matchId ?? null,
    round: match.round ?? null,
    opponentClubId: Number(match.homeClubId) === Number(teamId) ? match.awayClubId : match.homeClubId,
    competition: match.competition || null,
    homeAway: Number(match.homeClubId) === Number(teamId) ? "HOME" : "AWAY",
    result: resultForTeam(match, teamId),
    goalsFor: goalsForTeam(match, teamId),
    goalsAgainst: goalsAgainstTeam(match, teamId),
    startsAt: match.startsAt || null
  }));
  const wins = results.filter((item) => item.result === "W").length;
  const draws = results.filter((item) => item.result === "D").length;
  const losses = results.filter((item) => item.result === "L").length;
  const goalsFor = results.reduce((sum, item) => sum + Number(item.goalsFor || 0), 0);
  const goalsAgainst = results.reduce((sum, item) => sum + Number(item.goalsAgainst || 0), 0);
  const formIndex = clamp(((wins * 3 + draws) / (results.length * 3)) * 100);

  return {
    status: results.length >= 3 ? "AVAILABLE" : "PARTIAL",
    sampleSize: results.length,
    window,
    lastMatches: results,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    averageGoalsFor: round(goalsFor / results.length, 3),
    averageGoalsAgainst: round(goalsAgainst / results.length, 3),
    formIndex,
    unavailableSignals: results.length < 3 ? ["small_recent_form_sample"] : []
  };
}

function strengthProfile(matches, teamId, kind, venueMatchesForTeam = []) {
  if (!matches.length) {
    return {
      index: null,
      status: "INSUFFICIENT_SAMPLE",
      sampleSize: 0,
      components: {
        goalRate: null,
        regularity: null,
        sampleConfidence: null,
        venueAdjustment: null
      },
      unavailableSignals: ["no_finished_matches_before_fixture"]
    };
  }

  const goalsFor = matches.map((match) => goalsForTeam(match, teamId)).filter((value) => value !== null);
  const goalsAgainst = matches.map((match) => goalsAgainstTeam(match, teamId)).filter((value) => value !== null);
  const results = matches.map((match) => resultForTeam(match, teamId));
  const wins = results.filter((result) => result === "W").length;
  const draws = results.filter((result) => result === "D").length;
  const averageFor = goalsFor.length ? goalsFor.reduce((sum, value) => sum + value, 0) / goalsFor.length : null;
  const averageAgainst = goalsAgainst.length ? goalsAgainst.reduce((sum, value) => sum + value, 0) / goalsAgainst.length : null;
  const regularity = ((wins + draws * 0.5) / matches.length) * 15;
  const sampleConfidence = Math.min(matches.length, 5) / 5 * 10;
  const venueGoalsFor = venueMatchesForTeam.map((match) => goalsForTeam(match, teamId)).filter((value) => value !== null);
  const venueGoalsAgainst = venueMatchesForTeam.map((match) => goalsAgainstTeam(match, teamId)).filter((value) => value !== null);
  const venueAverage = venueGoalsFor.length ? venueGoalsFor.reduce((sum, value) => sum + value, 0) / venueGoalsFor.length : null;
  const venueAverageAgainst = venueGoalsAgainst.length ? venueGoalsAgainst.reduce((sum, value) => sum + value, 0) / venueGoalsAgainst.length : null;

  let goalRate;
  let venueAdjustment;
  if (kind === "offensive") {
    goalRate = averageFor === null ? null : clamp(averageFor / 3 * 50, 0, 50);
    venueAdjustment = venueAverage === null || venueMatchesForTeam.length < 2 || averageFor === null
      ? null
      : clamp((venueAverage - averageFor) * 5, -5, 5);
  } else {
    goalRate = averageAgainst === null ? null : clamp((1 - averageAgainst / 3) * 45, 0, 45);
    venueAdjustment = venueAverageAgainst === null || venueMatchesForTeam.length < 2 || averageAgainst === null
      ? null
      : clamp((averageAgainst - venueAverageAgainst) * 5, -5, 5);
  }
  const regularityScore = clamp(regularity, 0, 15);
  const index = clamp((goalRate ?? 0) + regularityScore + sampleConfidence + (venueAdjustment ?? 0));
  const unavailableSignals = [];
  if (venueMatchesForTeam.length < 2) unavailableSignals.push("small_home_away_sample");
  if (averageFor === null || averageAgainst === null) unavailableSignals.push("missing_score_sample");

  return {
    index,
    status: matches.length >= 3 ? "AVAILABLE" : "PARTIAL",
    sampleSize: matches.length,
    components: {
      goalRate: round(goalRate),
      regularity: round(regularityScore),
      sampleConfidence: round(sampleConfidence),
      venueAdjustment: round(venueAdjustment)
    },
    averages: {
      goalsFor: round(averageFor, 3),
      goalsAgainst: round(averageAgainst, 3)
    },
    unavailableSignals
  };
}

function calculateOffensiveStrength({ matches, teamId, cutoffIso, homeAway }) {
  const recent = priorFinishedMatches({ teamId, matches, cutoffIso });
  const venue = venueMatches(recent, teamId, homeAway);
  return strengthProfile(recent, teamId, "offensive", venue);
}

function calculateDefensiveStrength({ matches, teamId, cutoffIso, homeAway }) {
  const recent = priorFinishedMatches({ teamId, matches, cutoffIso });
  const venue = venueMatches(recent, teamId, homeAway);
  return strengthProfile(recent, teamId, "defensive", venue);
}

function calculateVenuePerformance({ matches, teamId, cutoffIso, homeAway }) {
  const recent = priorFinishedMatches({ teamId, matches, cutoffIso });
  const venue = venueMatches(recent, teamId, homeAway);
  if (!venue.length) {
    return {
      index: null,
      status: "INSUFFICIENT_SAMPLE",
      sampleSize: 0,
      offensiveIndex: null,
      defensiveIndex: null,
      averageGoalsFor: null,
      averageGoalsAgainst: null,
      unavailableSignals: [`no_${String(homeAway).toLowerCase()}_matches_before_fixture`]
    };
  }
  const offensive = strengthProfile(venue, teamId, "offensive", venue);
  const defensive = strengthProfile(venue, teamId, "defensive", venue);
  const goalsFor = venue.map((match) => goalsForTeam(match, teamId)).filter((value) => value !== null);
  const goalsAgainst = venue.map((match) => goalsAgainstTeam(match, teamId)).filter((value) => value !== null);
  return {
    index: clamp((Number(offensive.index || 0) + Number(defensive.index || 0)) / 2),
    status: venue.length >= 2 ? "PARTIAL" : "SMALL_SAMPLE",
    sampleSize: venue.length,
    offensiveIndex: offensive.index,
    defensiveIndex: defensive.index,
    averageGoalsFor: goalsFor.length ? round(goalsFor.reduce((sum, value) => sum + value, 0) / goalsFor.length, 3) : null,
    averageGoalsAgainst: goalsAgainst.length ? round(goalsAgainst.reduce((sum, value) => sum + value, 0) / goalsAgainst.length, 3) : null,
    unavailableSignals: venue.length < 2 ? ["small_home_away_sample"] : []
  };
}

function buildTeamPerformanceContext({ teamId, matches, clubs, cutoffIso, homeAway, formWindow = 5 }) {
  const recentMatches = priorFinishedMatches({ teamId, matches, cutoffIso, window: formWindow });
  const form = recentFormFromMatches(recentMatches, teamId, formWindow);
  const offensive = calculateOffensiveStrength({ matches, teamId, cutoffIso, homeAway });
  const defensive = calculateDefensiveStrength({ matches, teamId, cutoffIso, homeAway });
  const homePerformance = calculateVenuePerformance({ matches, teamId, cutoffIso, homeAway: "HOME" });
  const awayPerformance = calculateVenuePerformance({ matches, teamId, cutoffIso, homeAway: "AWAY" });
  return sanitize({
    teamId: Number(teamId),
    club: clubs?.[Number(teamId)] || null,
    homeAway: homeAway || null,
    offensiveStrength: offensive.index,
    offensiveStrengthDetails: offensive,
    defensiveStrength: defensive.index,
    defensiveStrengthDetails: defensive,
    recentTeamForm: form,
    homePerformanceIndex: homePerformance,
    awayPerformanceIndex: awayPerformance,
    unavailableSignals: [...new Set([
      ...offensive.unavailableSignals,
      ...defensive.unavailableSignals,
      ...form.unavailableSignals
    ])]
  });
}

function competitionType(competition) {
  if (competition === "brasileirao-serie-a") return "league";
  if (competition === "copa-do-brasil") return "cup";
  if (competition === "libertadores" || competition === "sul-americana") return "continental";
  return null;
}

function nextMatchImportance(match) {
  if (!match) {
    return {
      status: "UNAVAILABLE",
      type: null,
      stage: null,
      index: null,
      unavailableSignals: ["next_match_not_available"]
    };
  }
  const type = competitionType(match.competition);
  const stage = match.stage || match.phase || null;
  const base = type === "league" ? 50 : type === "cup" ? 65 : type === "continental" ? 70 : null;
  return {
    status: type ? "AVAILABLE" : "PARTIAL",
    type,
    stage,
    index: base,
    semantics: "categorical_context_index_not_probability",
    unavailableSignals: [
      ...(type ? [] : ["competition_type_unavailable"]),
      ...(stage ? [] : ["match_stage_not_provided_by_source"])
    ]
  };
}

function fixtureForTeam({ teamId, match, matches }) {
  const targetTime = matchTime(match);
  if (targetTime === null) {
    return {
      previousMatch: null,
      nextMatch: null,
      lastMatchDate: null,
      nextMatchDate: null,
      restDaysBeforeCurrentMatch: null,
      restDaysAfterCurrentMatch: null,
      matchesLast7Days: null,
      matchesNext7Days: null,
      fixtureCongestionIndex: null,
      rotationRiskIndex: null,
      nextMatchImportance: nextMatchImportance(null),
      unavailableSignals: ["fixture_date_unavailable"]
    };
  }
  const teamMatches = (Array.isArray(matches) ? matches : [])
    .filter((item) => Number(item.homeClubId) === Number(teamId) || Number(item.awayClubId) === Number(teamId))
    .filter((item) => matchTime(item) !== null)
    .sort((a, b) => matchTime(a) - matchTime(b));
  const previous = [...teamMatches].reverse().find((item) => matchTime(item) < targetTime && isFinished(item)) || null;
  const next = teamMatches.find((item) => matchTime(item) > targetTime) || null;
  const windowStart = targetTime - CONGESTION_THRESHOLDS.sevenDayWindowDays * DAY_MS;
  const windowEnd = targetTime + CONGESTION_THRESHOLDS.sevenDayWindowDays * DAY_MS;
  const past7 = teamMatches.filter((item) => {
    const time = matchTime(item);
    return time >= windowStart && time < targetTime && isFinished(item);
  });
  const next7 = teamMatches.filter((item) => {
    const time = matchTime(item);
    return time > targetTime && time <= windowEnd;
  });
  const restBefore = previous ? round((targetTime - matchTime(previous)) / DAY_MS, 2) : null;
  const restAfter = next ? round((matchTime(next) - targetTime) / DAY_MS, 2) : null;
  const reasons = [];
  if (restBefore !== null && restBefore < 3) reasons.push("rest_before_less_than_72h");
  else if (restBefore !== null && restBefore < 5) reasons.push("rest_before_less_than_120h");
  if (restAfter !== null && restAfter < 3) reasons.push("next_match_less_than_72h");
  if (past7.length + next7.length >= CONGESTION_THRESHOLDS.highSevenDayMatchCount) reasons.push("three_or_more_matches_in_7d_window");
  else if (past7.length + next7.length >= CONGESTION_THRESHOLDS.mediumSevenDayMatchCount) reasons.push("two_matches_in_7d_window");
  const nextCompetitionType = next ? competitionType(next.competition) : null;
  if (next && nextCompetitionType && nextCompetitionType !== "league" && restAfter !== null && restAfter <= 4) reasons.push("important_match_within_next_4_days");
  const congestionIndex = clamp(
    (restBefore === null ? 0 : restBefore < 3 ? 55 : restBefore < 5 ? 25 : 0)
    + (restAfter === null ? 0 : restAfter < 3 ? 25 : restAfter < 5 ? 10 : 0)
    + Math.min(past7.length + next7.length, 3) * 10
    + (reasons.includes("important_match_within_next_4_days") ? 15 : 0)
  );
  const unavailableSignals = [];
  if (!previous) unavailableSignals.push("previous_match_not_available");
  if (!next) unavailableSignals.push("next_match_not_available");
  if (!teamMatches.length) unavailableSignals.push("team_calendar_not_available");
  return {
    previousMatch: previous,
    nextMatch: next,
    lastMatchDate: previous?.startsAt || null,
    nextMatchDate: next?.startsAt || null,
    restDaysBeforeCurrentMatch: restBefore,
    restDaysAfterCurrentMatch: restAfter,
    matchesLast7Days: past7.length,
    matchesNext7Days: next7.length,
    fixtureCongestionIndex: teamMatches.length ? congestionIndex : null,
    fixtureCongestion: {
      index: teamMatches.length ? congestionIndex : null,
      level: congestionIndex === null ? "UNAVAILABLE" : congestionIndex >= 60 ? "HIGH" : congestionIndex >= 25 ? "MEDIUM" : "LOW",
      reasons,
      semantics: "context_signal_not_confirmed_rotation"
    },
    rotationRiskIndex: teamMatches.length ? congestionIndex : null,
    rotationRisk: {
      index: teamMatches.length ? congestionIndex : null,
      semantics: "SLVS_ESTIMATE_NOT_CONFIRMED_LINEUP",
      reasons
    },
    nextMatchImportance: nextMatchImportance(next),
    unavailableSignals
  };
}

function matchupIndex({ ownDefensiveStrength, opponentOffensiveStrength, ownOffensiveStrength, opponentDefensiveStrength, homeAway, recentFormIndex }) {
  const venueAdjustment = homeAway === "HOME" ? 5 : homeAway === "AWAY" ? -5 : 0;
  const cleanSheet = ownDefensiveStrength === null || opponentOffensiveStrength === null
    ? null
    : clamp(ownDefensiveStrength * 0.6 + (100 - opponentOffensiveStrength) * 0.3 + venueAdjustment + (recentFormIndex === null ? 0 : recentFormIndex * 0.1));
  const concedingRisk = ownDefensiveStrength === null || opponentOffensiveStrength === null
    ? null
    : clamp(opponentOffensiveStrength * 0.55 + (100 - ownDefensiveStrength) * 0.35 - venueAdjustment + (recentFormIndex === null ? 0 : (100 - recentFormIndex) * 0.1));
  const offensiveOpportunity = ownOffensiveStrength === null || opponentDefensiveStrength === null
    ? null
    : clamp(ownOffensiveStrength * 0.55 + (100 - opponentDefensiveStrength) * 0.35 + venueAdjustment + (recentFormIndex === null ? 0 : recentFormIndex * 0.1));
  return { cleanSheet, concedingRisk, offensiveOpportunity };
}

function buildMatchContext({ match, matches, clubs, nowIso }) {
  const cutoffIso = match.startsAt || nowIso || new Date().toISOString();
  const homeClubId = Number(match.homeClubId);
  const awayClubId = Number(match.awayClubId);
  const home = buildTeamPerformanceContext({ teamId: homeClubId, matches, clubs, cutoffIso, homeAway: "HOME" });
  const away = buildTeamPerformanceContext({ teamId: awayClubId, matches, clubs, cutoffIso, homeAway: "AWAY" });
  const homeCalendar = fixtureForTeam({ teamId: homeClubId, match, matches });
  const awayCalendar = fixtureForTeam({ teamId: awayClubId, match, matches });
  const homeIndices = matchupIndex({
    ownDefensiveStrength: home.defensiveStrength,
    opponentOffensiveStrength: away.offensiveStrength,
    ownOffensiveStrength: home.offensiveStrength,
    opponentDefensiveStrength: away.defensiveStrength,
    homeAway: "HOME",
    recentFormIndex: home.recentTeamForm.formIndex
  });
  const awayIndices = matchupIndex({
    ownDefensiveStrength: away.defensiveStrength,
    opponentOffensiveStrength: home.offensiveStrength,
    ownOffensiveStrength: away.offensiveStrength,
    opponentDefensiveStrength: home.defensiveStrength,
    homeAway: "AWAY",
    recentFormIndex: away.recentTeamForm.formIndex
  });
  return sanitize({
    schemaVersion: "match-context/v1",
    matchId: match.matchId ?? null,
    round: match.round ?? null,
    competition: match.competition || null,
    startsAt: match.startsAt || null,
    status: match.status || null,
    venue: match.venue || null,
    homeTeam: home,
    awayTeam: away,
    homeClub: home.club,
    awayClub: away.club,
    homeOffensiveStrength: home.offensiveStrength,
    awayOffensiveStrength: away.offensiveStrength,
    homeDefensiveStrength: home.defensiveStrength,
    awayDefensiveStrength: away.defensiveStrength,
    homeCleanSheetIndex: homeIndices.cleanSheet,
    awayCleanSheetIndex: awayIndices.cleanSheet,
    homeConcedingRiskIndex: homeIndices.concedingRisk,
    awayConcedingRiskIndex: awayIndices.concedingRisk,
    homeOffensiveOpportunityIndex: homeIndices.offensiveOpportunity,
    awayOffensiveOpportunityIndex: awayIndices.offensiveOpportunity,
    restDaysHome: homeCalendar.restDaysBeforeCurrentMatch,
    restDaysAway: awayCalendar.restDaysBeforeCurrentMatch,
    restDaysAfterHome: homeCalendar.restDaysAfterCurrentMatch,
    restDaysAfterAway: awayCalendar.restDaysAfterCurrentMatch,
    congestionHome: homeCalendar.fixtureCongestionIndex,
    congestionAway: awayCalendar.fixtureCongestionIndex,
    rotationRiskHome: homeCalendar.rotationRiskIndex,
    rotationRiskAway: awayCalendar.rotationRiskIndex,
    homeFixture: homeCalendar,
    awayFixture: awayCalendar,
    semantics: {
      cleanSheetIndex: "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY",
      concedingRiskIndex: "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY",
      offensiveOpportunityIndex: "SLVS_INDEX_NOT_GOAL_PROBABILITY",
      rotationRiskIndex: "SLVS_ESTIMATE_NOT_CONFIRMED_LINEUP"
    },
    unavailableSignals: [...new Set([
      ...home.unavailableSignals,
      ...away.unavailableSignals,
      ...homeCalendar.unavailableSignals,
      ...awayCalendar.unavailableSignals
    ])]
  });
}

function buildAthleteContext({ athlete, matchContext }) {
  if (!athlete || !matchContext) {
    return {
      status: "UNAVAILABLE",
      athleteId: athlete?.athleteId ?? null,
      playerName: athlete?.nickname || athlete?.name || null,
      clubId: athlete?.clubId ?? null,
      unavailableSignals: ["athlete_fixture_context_not_available"]
    };
  }
  const isHome = Number(athlete.clubId) === Number(matchContext.homeTeam.teamId);
  const ownTeam = isHome ? matchContext.homeTeam : matchContext.awayTeam;
  const opponentTeam = isHome ? matchContext.awayTeam : matchContext.homeTeam;
  const fixture = isHome ? matchContext.homeFixture : matchContext.awayFixture;
  const homeAway = isHome ? "HOME" : "AWAY";
  const indices = isHome
    ? { cleanSheet: matchContext.homeCleanSheetIndex, conceding: matchContext.homeConcedingRiskIndex, opportunity: matchContext.homeOffensiveOpportunityIndex }
    : { cleanSheet: matchContext.awayCleanSheetIndex, conceding: matchContext.awayConcedingRiskIndex, opportunity: matchContext.awayOffensiveOpportunityIndex };
  const positionId = Number(athlete.positionId);
  const base = {
    status: "AVAILABLE",
    athleteId: athlete.athleteId ?? null,
    playerName: athlete.nickname || athlete.name || null,
    clubId: athlete.clubId ?? null,
    positionId: Number.isFinite(positionId) ? positionId : null,
    clubStrength: ownTeam.offensiveStrength,
    opponentStrength: opponentTeam.defensiveStrength,
    cleanSheetIndex: indices.cleanSheet,
    concedingRiskIndex: indices.conceding,
    offensiveOpportunityIndex: indices.opportunity,
    restDays: fixture.restDaysBeforeCurrentMatch,
    congestion: fixture.fixtureCongestionIndex,
    rotationRisk: fixture.rotationRiskIndex,
    homeAway,
    fixtureContext: matchContext.matchId,
    unavailableSignals: [...new Set([
      ...(ownTeam.unavailableSignals || []),
      ...(opponentTeam.unavailableSignals || []),
      ...(fixture.unavailableSignals || [])
    ])]
  };
  if (positionId === POSITION_IDS.GOL) {
    return {
      ...base,
      type: "goalkeeperContext",
      opponentOffensiveStrength: opponentTeam.offensiveStrength,
      recentTeamDefensiveForm: ownTeam.recentTeamForm,
      semantics: "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY"
    };
  }
  if (positionId === POSITION_IDS.LAT || positionId === POSITION_IDS.ZAG) {
    return {
      ...base,
      type: "defensiveContext",
      opponentOffensiveStrength: opponentTeam.offensiveStrength,
      teamDefensiveStrength: ownTeam.defensiveStrength,
      semantics: "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY"
    };
  }
  if (positionId === POSITION_IDS.MEI || positionId === POSITION_IDS.ATA) {
    return {
      ...base,
      type: "attackingContext",
      opponentDefensiveStrength: opponentTeam.defensiveStrength,
      teamOffensiveStrength: ownTeam.offensiveStrength,
      semantics: "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY"
    };
  }
  return { ...base, type: "teamContext" };
}

function buildReserveRulesContract() {
  return {
    schemaVersion: "cartola-reserve-rules-contract/v1",
    status: "UNAVAILABLE_OFFICIAL_RULES_NOT_EXPOSED",
    source: {
      endpoint: "/cartola/time/:timeId",
      fieldsObserved: ["reservas", "formacao", "capitao"],
      semantics: "raw_public_team_payload_only"
    },
    official: {
      reserveQuantity: null,
      allowedPositions: null,
      substitutionRule: null,
      luxuryReserveEligibility: null,
      luxuryReservePosition: null,
      luxuryReserveEntryConditions: null
    },
    unavailableReasons: [
      "public_market_endpoint_does_not_publish_current_reserve_rules",
      "public_team_payload_is_not_a_versioned_rules_contract",
      "no_official_source_configured_for_reserva_de_luxo"
    ],
    doNotInfer: true
  };
}

function buildFormationContract() {
  return {
    schemaVersion: "tactical-formation-contract/v1",
    status: "CONTRACT_ONLY_BACKEND_DOES_NOT_ASSEMBLE_TEAMS",
    formations: [
      { code: "4-3-3", goalkeeper: 1, defenders: { lateral: 2, centerBack: 2 }, midfielders: 3, forwards: 3, coach: 1 },
      { code: "4-4-2", goalkeeper: 1, defenders: { lateral: 2, centerBack: 2 }, midfielders: 4, forwards: 2, coach: 1 },
      { code: "3-4-3", goalkeeper: 1, defenders: { lateral: 0, centerBack: 3 }, midfielders: 4, forwards: 3, coach: 1 },
      { code: "3-5-2", goalkeeper: 1, defenders: { lateral: 0, centerBack: 3 }, midfielders: 5, forwards: 2, coach: 1 },
      { code: "5-3-2", goalkeeper: 1, defenders: { lateral: 2, centerBack: 3 }, midfielders: 3, forwards: 2, coach: 1 },
      { code: "4-5-1", goalkeeper: 1, defenders: { lateral: 2, centerBack: 2 }, midfielders: 5, forwards: 1, coach: 1 }
    ],
    officialEngineImpact: false
  };
}

module.exports = {
  POSITION_IDS,
  buildAthleteContext,
  buildFormationContract,
  buildMatchContext,
  buildReserveRulesContract,
  buildTeamPerformanceContext,
  calculateDefensiveStrength,
  calculateOffensiveStrength,
  calculateVenuePerformance,
  clamp,
  fixtureForTeam,
  nextMatchImportance,
  priorFinishedMatches,
  recentFormFromMatches
};
