const { fetchCartolaJson } = require("../liveSnapshot/services/cartolaClient");
const { BacktestRepository } = require("../backtest/repository");
const { POSITION_LABELS } = require("../backtest/constants");
const {
  CALENDAR_CONTEXT_SCHEMA_VERSION,
  CONTEXT_CACHE_POLICY,
  CONTEXT_ENGINE_VERSION,
  CONTEXT_FEATURE_DIAGNOSTICS_SCHEMA_VERSION,
  PLAYER_CONTEXT_SCHEMA_VERSION,
  REAL_CONTEXT_SCHEMA_VERSION,
  REAL_RESULTS_SCHEMA_VERSION,
  REAL_ROUND_EVALUATION_SCHEMA_VERSION,
  TEAM_CONTEXT_SCHEMA_VERSION
} = require("./constants");
const { buildTeamCalendarContext, multiCompetitionStatus, normalizeRoundPayload } = require("./normalizer");
const { errorMetrics, round, sanitize } = require("./math");
const {
  buildAthleteContext,
  buildMatchContext,
  buildTeamPerformanceContext,
  buildReserveRulesContract,
  buildFormationContract,
  nextMatchImportance
} = require("./metrics");

const memoryCache = new Map();

function latestSnapshot(repository, season) {
  const rounds = repository.listRounds(season).sort((a, b) => b - a);
  for (const round of rounds) {
    const manifest = repository.readManifest(season, round);
    const snapshotId = manifest?.lastValidPreRoundSnapshotId || manifest?.lastSnapshotId;
    if (!snapshotId) continue;
    const snapshot = repository.readSnapshot(season, round, snapshotId);
    if (snapshot) return snapshot;
  }
  return null;
}

function normalizeSnapshot(snapshot, nowIso) {
  return normalizeRoundPayload({
    matchesPayload: {
      rodada: snapshot.round,
      partidas: snapshot.data?.matches || [],
      clubes: snapshot.data?.clubs || {}
    },
    marketPayload: {
      atletas: snapshot.data?.players || [],
      clubes: snapshot.data?.clubs || {},
      posicoes: snapshot.data?.positions || {},
      status: snapshot.data?.statuses || {}
    },
    marketStatusPayload: snapshot.marketStatus?.raw || snapshot.marketStatus || {},
    capturedAt: snapshot.capturedAt,
    season: snapshot.season,
    nowIso
  });
}

async function fetchOfficialRound({ fetchImpl, timeoutMs, season, nowIso }) {
  const [marketStatus, matches] = await Promise.all([
    fetchCartolaJson({ fetchImpl, timeoutMs, endpoint: "/mercado/status", userAgent: `${CONTEXT_ENGINE_VERSION}` }),
    fetchCartolaJson({ fetchImpl, timeoutMs, endpoint: "/partidas", userAgent: `${CONTEXT_ENGINE_VERSION}` })
  ]);
  let market = null;
  let marketError = null;
  try {
    market = await fetchCartolaJson({ fetchImpl, timeoutMs, endpoint: "/atletas/mercado", userAgent: `${CONTEXT_ENGINE_VERSION}` });
  } catch (error) {
    marketError = error.message;
  }
  return {
    normalized: normalizeRoundPayload({
      matchesPayload: matches.body,
      marketStatusPayload: marketStatus.body,
      marketPayload: market?.body || null,
      capturedAt: new Date().toISOString(),
      season,
      nowIso
    }),
    marketError
  };
}

async function buildRoundContext(options) {
  const season = options.season || 2026;
  const nowIso = options.nowIso || new Date().toISOString();
  const cacheKey = `round-context:${season}`;
  let sourceStatus = "LIVE_UPSTREAM";
  let normalized;
  let upstreamError = null;
  let optionalMarketError = null;

  try {
    const fetched = await fetchOfficialRound(options);
    normalized = fetched.normalized;
    optionalMarketError = fetched.marketError;
    memoryCache.set(cacheKey, { normalized, updatedAt: new Date().toISOString() });
  } catch (error) {
    upstreamError = error.message;
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      normalized = cached.normalized;
      sourceStatus = "STALE_MEMORY_CACHE";
    } else {
      const snapshot = latestSnapshot(options.liveSnapshotRepository, season);
      if (!snapshot) throw error;
      normalized = normalizeSnapshot(snapshot, nowIso);
      sourceStatus = "STALE_LIVE_SNAPSHOT_FALLBACK";
    }
  }

  const historical = historicalMatches(options.historicalRepository, season);
  const allMatches = historical.concat(normalized.matches || []);
  const matchContexts = (normalized.matches || [])
    .filter((match) => match.homeClubId && match.awayClubId)
    .map((match) => buildMatchContext({
      match,
      matches: allMatches,
      clubs: normalized.clubs,
      nowIso
    }));
  const contextByMatchId = new Map(matchContexts.map((context) => [String(context.matchId), context]));
  const athleteContexts = (normalized.athletes || []).map((athlete) => {
    const matchContext = matchContexts.find((context) => (
      Number(context.homeTeam?.teamId) === Number(athlete.clubId)
      || Number(context.awayTeam?.teamId) === Number(athlete.clubId)
    ));
    return {
      ...athlete,
      context: buildAthleteContext({ athlete, matchContext })
    };
  });
  const teamContexts = [];
  const seenTeamIds = new Set();
  for (const context of matchContexts) {
    for (const team of [context.homeTeam, context.awayTeam]) {
      if (!team || seenTeamIds.has(team.teamId)) continue;
      seenTeamIds.add(team.teamId);
      teamContexts.push(team);
    }
  }

  return sanitize({
    schemaVersion: REAL_CONTEXT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    season,
    engineVersion: CONTEXT_ENGINE_VERSION,
    sourceStatus,
    stale: sourceStatus !== "LIVE_UPSTREAM",
    lastSuccessfulUpdate: memoryCache.get(cacheKey)?.updatedAt || null,
    upstreamError,
    optionalMarketError,
    cachePolicy: CONTEXT_CACHE_POLICY,
    competitions: multiCompetitionStatus(),
    contextStatus: "AVAILABLE_WHEN_REAL_MATCH_HISTORY_EXISTS",
    officialEngineImpact: false,
    contextSemantics: {
      strengths: "SLVS_INTERNAL_INDEX_FROM_REAL_FINISHED_MATCHES",
      cleanSheetIndex: "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY",
      concedingRiskIndex: "SLVS_ESTIMATE_NOT_OFFICIAL_PROBABILITY",
      offensiveOpportunityIndex: "SLVS_INDEX_NOT_GOAL_PROBABILITY",
      rotationRiskIndex: "SLVS_ESTIMATE_NOT_CONFIRMED_LINEUP",
      temporalRule: "Only finished matches before each fixture are used for that fixture's context."
    },
    teamContexts,
    matchContexts,
    athleteContexts,
    ...normalized
  });
}

function historicalMatches(historicalRepository, season) {
  if (!historicalRepository || typeof historicalRepository.listRounds !== "function") return [];
  return historicalRepository.listRounds(season).flatMap((round) => {
    const post = historicalRepository.readRoundFile(season, round, "post-round.json");
    return (post?.matches || []).map((match) => ({
      competition: "brasileirao-serie-a",
      competitionName: "Brasileirao Serie A",
      season,
      round: match.round || round,
      matchId: match.matchId || null,
      stableId: String(match.matchId || `${season}-${round}-${match.homeClubId}-${match.awayClubId}`),
      homeClubId: match.homeClubId,
      awayClubId: match.awayClubId,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore) ? "FINISHED" : "UNKNOWN",
      startsAt: match.date ? new Date(`${String(match.date).replace(" ", "T")}-03:00`).toISOString() : null,
      venue: match.venue || null,
      source: "Cartola FC public API via historical dataset",
      sourceEndpoint: "/partidas/:round",
      capturedAt: post.collectedAt || null
    }));
  });
}

async function buildResults(options) {
  const context = await buildRoundContext(options);
  const results = context.matches.filter((match) => match.status === "FINISHED");
  return sanitize({
    schemaVersion: REAL_RESULTS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    season: context.season,
    round: context.currentRound,
    source: "Cartola FC public API",
    sourceStatus: context.sourceStatus,
    stale: context.stale,
    results,
    totals: {
      matches: context.matches.length,
      finished: results.length,
      future: context.counts.future,
      live: context.counts.live
    }
  });
}

async function buildTeamContext(options) {
  const context = await buildRoundContext(options);
  const allMatches = historicalMatches(options.historicalRepository, context.season).concat(context.matches);
  const teamContext = buildTeamCalendarContext({
    teamId: options.teamId,
    matches: allMatches,
    clubs: context.clubs,
    nowIso: options.nowIso || new Date().toISOString()
  });
  const nextHomeAway = teamContext.nextMatch
    ? Number(teamContext.nextMatch.homeClubId) === Number(options.teamId) ? "HOME" : "AWAY"
    : null;
  const performance = buildTeamPerformanceContext({
    teamId: options.teamId,
    matches: allMatches,
    clubs: context.clubs,
    cutoffIso: options.nowIso || new Date().toISOString(),
    homeAway: nextHomeAway
  });
  return sanitize({
    schemaVersion: TEAM_CONTEXT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    season: context.season,
    sourceStatus: context.sourceStatus,
    stale: context.stale,
    competitions: context.competitions,
    ...teamContext,
    ...performance,
    nextMatchImportance: nextMatchImportance(teamContext.nextMatch),
    contextSemantics: context.contextSemantics,
    officialEngineImpact: false
  });
}

async function buildCalendarContext(options) {
  const teamContext = await buildTeamContext(options);
  return sanitize({
    schemaVersion: CALENDAR_CONTEXT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    season: teamContext.season,
    teamId: teamContext.teamId,
    competitions: teamContext.competitions,
    previousMatch: teamContext.previousMatch,
    nextMatch: teamContext.nextMatch,
    nextMatchImportance: teamContext.nextMatchImportance,
    fixtureCongestion: teamContext.fixtureCongestion,
    rotationRiskSignal: teamContext.rotationRiskSignal,
    sourceStatus: teamContext.sourceStatus,
    stale: teamContext.stale
  });
}

function buildPlayerContextContract() {
  return {
    schemaVersion: PLAYER_CONTEXT_SCHEMA_VERSION,
    status: "CONTRACT_PREPARED_NO_OFFICIAL_ENGINE_IMPACT",
    fields: {
      clubId: null,
      positionId: null,
      status: null,
      probableStarter: null,
      rotationRiskSignal: null,
      matchContext: null,
      clubRest: null,
      fixtureCongestion: null,
      importantMatchNearby: null,
      homeAway: null,
      teamRecentForm: null,
      clubStrength: null,
      opponentStrength: null,
      cleanSheetIndex: null,
      concedingRiskIndex: null,
      offensiveOpportunityIndex: null,
      restDays: null,
      congestion: null,
      rotationRisk: null,
      fixtureContext: null,
      goalkeeperContext: null,
      defensiveContext: null,
      attackingContext: null
    },
    unavailableSources: {
      absences: "UNAVAILABLE_SOURCE_NOT_CONFIGURED",
      probableLineups: "UNAVAILABLE_SOURCE_NOT_CONFIGURED",
      confirmedLineups: "UNAVAILABLE_SOURCE_NOT_CONFIGURED",
      lineupProbability: "UNAVAILABLE_SOURCE_NOT_CONFIGURED"
    },
    formationContract: buildFormationContract(),
    reserveRulesContract: buildReserveRulesContract(),
    officialEngineImpact: false
  };
}

function buildRealRoundEvaluation({ season = 2026, backtestRepository } = {}) {
  const repository = backtestRepository || new BacktestRepository({ buildId: "build-4.3.2" });
  const summary = repository.readJson(season, "run-summary.json");
  const rounds = repository.listRoundResults(season).filter(Boolean);
  const comparisons = rounds.flatMap((roundData) => (roundData.predictions || [])
    .filter((item) => Number.isFinite(item.predictedPoints) && Number.isFinite(item.actualPoints))
    .map((item) => ({
      round: roundData.round,
      athleteId: item.athleteId,
      predictedScore: item.predictedPoints,
      actualScore: item.actualPoints,
      absoluteError: round(Math.abs(item.predictedPoints - item.actualPoints)),
      signedError: round(item.predictedPoints - item.actualPoints),
      predictionCapturedAt: "PRE_ROUND_HISTORICAL_FREEZE",
      resultCapturedAt: "POST_ROUND_HISTORICAL_DATA",
      sourceBuildId: summary?.buildId || "build-4.3.2"
    })));
  const teamDiagnostics = rounds.map((roundData) => {
    const team = roundData.selectedTeam || [];
    const sorted = [...team].sort((a, b) => Number(b.actualPoints ?? -Infinity) - Number(a.actualPoints ?? -Infinity));
    const captain = roundData.captain || {};
    return {
      round: roundData.round,
      realTotal: roundData.metrics?.team?.actualTotal ?? null,
      predictedTotal: roundData.metrics?.team?.predictedTotal ?? null,
      bestPlayer: sorted[0] || null,
      worstPlayer: sorted[sorted.length - 1] || null,
      captain,
      averageByPosition: Object.fromEntries(Object.entries(groupBy(team, (item) => POSITION_LABELS[item.positionId] || String(item.positionId)))
        .map(([position, items]) => [position, round(items.reduce((sum, item) => sum + Number(item.actualPoints || 0), 0) / (items.length || 1))])),
      positivePlayers: team.filter((item) => Number(item.actualPoints) > 0).length,
      negativePlayers: team.filter((item) => Number(item.actualPoints) < 0).length,
      above5Players: team.filter((item) => Number(item.actualPoints) >= 5).length
    };
  });

  return sanitize({
    schemaVersion: REAL_ROUND_EVALUATION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    season,
    sourceBuildId: summary?.buildId || "build-4.3.2",
    temporalPolicy: {
      predictionsMustBeCapturedBeforeResults: true,
      sourceDecisionsFrozenBeforePostRoundComparison: rounds.every((item) => item.decisionsFrozenBeforePostRoundComparison === true),
      retroactivePredictionForbidden: true
    },
    comparedRounds: [...new Set(comparisons.map((item) => item.round))],
    comparisons,
    metrics: errorMetrics(comparisons),
    analysisBands: Object.fromEntries(Object.entries(groupBy(rounds.flatMap((roundData) => roundData.predictions || []), (item) => item.analysisBand || "NOT_EVALUATED"))
      .map(([band, items]) => [band, {
        count: items.length,
        averageActual: round(items.reduce((sum, item) => sum + Number(item.actualPoints || 0), 0) / (items.length || 1)),
        sampleStatus: items.length < 30 ? "SMALL_SAMPLE" : "OK"
      }])),
    captain: {
      rounds: rounds.length,
      bestRate: summary?.metrics?.captain?.bestRate ?? null,
      top3Rate: summary?.metrics?.captain?.top3Rate ?? null,
      averageActual: summary?.metrics?.captain?.averageActual ?? null,
      averageGapToBest: summary?.metrics?.captain?.averageGapToBest ?? null
    },
    teamDiagnostics
  });
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});
}

function buildContextFeatureDiagnostics({ season = 2026, backtestRepository } = {}) {
  const evaluation = buildRealRoundEvaluation({ season, backtestRepository });
  return sanitize({
    schemaVersion: CONTEXT_FEATURE_DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    season,
    officialEngineImpact: false,
    availableFeatures: [
      "homeAway",
      "teamRecentFormFromHistoricalPreviousRounds",
      "priceBeforeRound",
      "averageBeforeRound",
      "gamesBeforeRound",
      "position",
      "fixtureCongestionContract",
      "multiCompetitionContract"
    ],
    unavailableRealFeatures: [
      "absences",
      "probableLineups",
      "confirmedLineups",
      "libertadoresSchedule",
      "sulAmericanaSchedule",
      "copaDoBrasilSchedule"
    ],
    researchCandidatesPrepared: [
      "context-home-away-candidate",
      "context-recent-form-candidate",
      "context-rest-candidate",
      "context-fixture-congestion-candidate",
      "context-combined-candidate"
    ],
    baselineMetrics: evaluation.metrics,
    promotionGateStatus: "NO_AUTOMATIC_PROMOTION"
  });
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

function findMatchContext(context, { matchId, homeClubId, awayClubId } = {}) {
  const contexts = context.matchContexts || [];
  if (matchId !== null && matchId !== undefined) {
    const exact = contexts.find((item) => String(item.matchId) === String(matchId));
    if (exact) return exact;
  }
  if (homeClubId && awayClubId) {
    return contexts.find((item) => (
      Number(item.homeTeam?.teamId) === Number(homeClubId)
      && Number(item.awayTeam?.teamId) === Number(awayClubId)
    )) || null;
  }
  return contexts[0] || null;
}

function goalkeeperComparison({ context, requestedNames }) {
  const goalkeepers = (context.athletes || []).filter((athlete) => Number(athlete.positionId) === 1);
  const contexts = context.matchContexts || [];
  const requested = requestedNames.map((name) => {
    const athlete = goalkeepers.find((item) => normalizeName(item.nickname || item.name) === normalizeName(name));
    return athlete ? { requestedName: name, athlete } : { requestedName: name, status: "NOT_FOUND_IN_CURRENT_MARKET" };
  });
  const top = [...goalkeepers]
    .sort((left, right) => Number(right.average ?? -Infinity) - Number(left.average ?? -Infinity) || Number(left.athleteId ?? 0) - Number(right.athleteId ?? 0))
    .slice(0, 5)
    .map((athlete) => ({ requestedName: null, athlete }));
  const all = [...requested.filter((item) => item.athlete), ...top]
    .filter((item, index, array) => array.findIndex((candidate) => candidate.athlete?.athleteId === item.athlete?.athleteId) === index);
  const comparisons = all.map(({ requestedName, athlete }) => {
    const fixture = contexts.find((item) => Number(item.homeTeam?.teamId) === Number(athlete.clubId) || Number(item.awayTeam?.teamId) === Number(athlete.clubId));
    if (!fixture) {
      return {
        requestedName,
        athleteId: athlete.athleteId,
        playerName: athlete.nickname || athlete.name || null,
        clubId: athlete.clubId ?? null,
        average: athlete.average ?? null,
        status: "FIXTURE_CONTEXT_UNAVAILABLE",
        cleanSheetIndex: null,
        concedingRiskIndex: null,
        opponentOffensiveStrength: null,
        homeAway: null,
        rest: null,
        congestion: null,
        unavailableSignals: ["current_fixture_not_available"]
      };
    }
    const isHome = Number(fixture.homeTeam.teamId) === Number(athlete.clubId);
    const team = isHome ? fixture.homeTeam : fixture.awayTeam;
    const opponent = isHome ? fixture.awayTeam : fixture.homeTeam;
    const calendar = isHome ? fixture.homeFixture : fixture.awayFixture;
    return {
      requestedName,
      athleteId: athlete.athleteId,
      playerName: athlete.nickname || athlete.name || null,
      clubId: athlete.clubId ?? null,
      average: athlete.average ?? null,
      status: "AVAILABLE",
      matchId: fixture.matchId,
      opponentClubId: opponent.teamId,
      cleanSheetIndex: isHome ? fixture.homeCleanSheetIndex : fixture.awayCleanSheetIndex,
      concedingRiskIndex: isHome ? fixture.homeConcedingRiskIndex : fixture.awayConcedingRiskIndex,
      opponentOffensiveStrength: opponent.offensiveStrength,
      homeAway: isHome ? "HOME" : "AWAY",
      rest: calendar.restDaysBeforeCurrentMatch,
      congestion: calendar.fixtureCongestionIndex,
      rotationRisk: calendar.rotationRiskIndex,
      semantics: fixture.semantics
    };
  });
  return {
    status: comparisons.length ? "PARTIAL_OR_AVAILABLE" : "UNAVAILABLE",
    requestedNames,
    unavailableRequestedNames: requested.filter((item) => !item.athlete).map((item) => item.requestedName),
    comparisons
  };
}

async function buildTeamContextDiagnostic(options = {}) {
  const context = await buildRoundContext(options);
  const matchContext = findMatchContext(context, options);
  const requestedNames = ["Ivan", "Pedro Rangel", "Everson", "Rossi", "Carlos Miguel"];
  if (!matchContext) {
    return sanitize({
      schemaVersion: "team-context-diagnostics/v1",
      status: "MATCH_CONTEXT_UNAVAILABLE",
      sourceStatus: context.sourceStatus,
      season: context.season,
      requestedFixture: {
        matchId: options.matchId ?? null,
        homeClubId: options.homeClubId ?? null,
        awayClubId: options.awayClubId ?? null
      },
      availableFixtures: (context.matchContexts || []).map((item) => ({
        matchId: item.matchId,
        homeClubId: item.homeTeam?.teamId,
        awayClubId: item.awayTeam?.teamId,
        startsAt: item.startsAt
      })),
      goalkeeperComparison: goalkeeperComparison({ context, requestedNames }),
      unavailableSignals: ["requested_fixture_not_found"]
    });
  }
  return sanitize({
    schemaVersion: "team-context-diagnostics/v1",
    status: "AVAILABLE",
    generatedAt: new Date().toISOString(),
    season: context.season,
    sourceStatus: context.sourceStatus,
    stale: context.stale,
    match: {
      matchId: matchContext.matchId,
      round: matchContext.round,
      startsAt: matchContext.startsAt,
      homeTeam: matchContext.homeClub,
      awayTeam: matchContext.awayClub
    },
    home: {
      team: matchContext.homeTeam,
      offensiveStrength: matchContext.homeOffensiveStrength,
      defensiveStrength: matchContext.homeDefensiveStrength,
      recentForm: matchContext.homeTeam.recentTeamForm,
      homePerformance: matchContext.homeTeam.homePerformanceIndex,
      cleanSheetIndex: matchContext.homeCleanSheetIndex,
      concedingRisk: matchContext.homeConcedingRiskIndex,
      rest: matchContext.restDaysHome,
      congestion: matchContext.congestionHome,
      rotationRisk: matchContext.rotationRiskHome
    },
    away: {
      team: matchContext.awayTeam,
      offensiveStrength: matchContext.awayOffensiveStrength,
      defensiveStrength: matchContext.awayDefensiveStrength,
      recentForm: matchContext.awayTeam.recentTeamForm,
      awayPerformance: matchContext.awayTeam.awayPerformanceIndex,
      cleanSheetIndex: matchContext.awayCleanSheetIndex,
      concedingRisk: matchContext.awayConcedingRiskIndex,
      rest: matchContext.restDaysAway,
      congestion: matchContext.congestionAway,
      rotationRisk: matchContext.rotationRiskAway
    },
    confrontation: {
      cleanSheetIndex: {
        home: matchContext.homeCleanSheetIndex,
        away: matchContext.awayCleanSheetIndex
      },
      concedingRisk: {
        home: matchContext.homeConcedingRiskIndex,
        away: matchContext.awayConcedingRiskIndex
      },
      offensiveOpportunity: {
        home: matchContext.homeOffensiveOpportunityIndex,
        away: matchContext.awayOffensiveOpportunityIndex
      },
      semantics: matchContext.semantics
    },
    goalkeeperComparison: goalkeeperComparison({ context, requestedNames }),
    unavailableSignals: matchContext.unavailableSignals
  });
}

module.exports = {
  buildCalendarContext,
  buildContextFeatureDiagnostics,
  buildPlayerContextContract,
  buildRealRoundEvaluation,
  buildResults,
  buildRoundContext,
  buildTeamContextDiagnostic,
  buildReserveRulesContract,
  buildFormationContract,
  buildTeamContext,
  memoryCache
};
