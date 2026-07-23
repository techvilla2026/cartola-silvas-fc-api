const {
  BRASILEIRAO_COMPETITION,
  CONGESTION_THRESHOLDS,
  PREPARED_COMPETITIONS
} = require("./constants");
const { average, round, sanitize } = require("./math");

function parseDate(value) {
  if (!value) return null;
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return new Date(`${text.replace(" ", "T")}-03:00`).toISOString();
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clubId(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeClubs(rawClubs) {
  const entries = Array.isArray(rawClubs) ? rawClubs : Object.values(rawClubs || {});
  const clubs = {};
  for (const club of entries.filter(Boolean)) {
    const id = clubId(club.id);
    if (!id) continue;
    clubs[id] = {
      id,
      name: club.nome || club.name || null,
      officialName: club.nome_oficial || club.nome_completo || club.officialName || null,
      fantasyName: club.nome_fantasia || club.fantasyName || club.nome || club.name || null,
      abbreviation: club.abreviacao || club.abbreviation || club.nome || club.name || null,
      nickname: club.apelido || null,
      slug: club.slug || null,
      badges: club.escudos || club.badges || null,
      sourceStatus: "AVAILABLE"
    };
  }
  return clubs;
}

function normalizeDictionary(raw, mapper) {
  const entries = Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([id, value]) => ({ id, ...(value || {}) }));
  return entries.map((value) => mapper(value)).filter(Boolean);
}

function normalizeAthletes(rawAthletes) {
  return (Array.isArray(rawAthletes) ? rawAthletes : []).filter(Boolean).map((athlete) => ({
    athleteId: numberOrNull(athlete.atleta_id ?? athlete.athleteId),
    nickname: athlete.apelido ?? athlete.nickname ?? null,
    abbreviatedNickname: athlete.apelido_abreviado ?? athlete.abbreviatedNickname ?? null,
    name: athlete.nome ?? athlete.name ?? null,
    slug: athlete.slug ?? null,
    clubId: clubId(athlete.clube_id ?? athlete.clubId),
    positionId: numberOrNull(athlete.posicao_id ?? athlete.positionId),
    statusId: numberOrNull(athlete.status_id ?? athlete.statusId),
    price: numberOrNull(athlete.preco_num ?? athlete.price),
    average: numberOrNull(athlete.media_num ?? athlete.average),
    roundPoints: numberOrNull(athlete.pontos_num ?? athlete.roundPoints),
    priceVariation: numberOrNull(athlete.variacao_num ?? athlete.priceVariation),
    games: numberOrNull(athlete.jogos_num ?? athlete.games),
    lastRound: numberOrNull(athlete.rodada_id ?? athlete.lastRound),
    enteredField: typeof athlete.entrou_em_campo === "boolean" ? athlete.entrou_em_campo : null,
    scouts: athlete.scout && typeof athlete.scout === "object" ? athlete.scout : null,
    photo: athlete.foto ?? athlete.photo ?? null,
    source: "Cartola FC public API",
    sourceEndpoint: "/atletas/mercado"
  }));
}

function normalizePositions(rawPositions) {
  return normalizeDictionary(rawPositions, (position) => {
    const id = numberOrNull(position.id);
    return id ? { id, name: position.nome || position.name || null, abbreviation: position.abreviacao || position.abbreviation || null } : null;
  });
}

function normalizeStatuses(rawStatuses) {
  return normalizeDictionary(rawStatuses, (status) => {
    const id = numberOrNull(status.id);
    return id ? { id, name: status.nome || status.name || null } : null;
  });
}

function matchStatus(match, nowIso) {
  const homeScore = numberOrNull(match.placar_oficial_mandante ?? match.officialHomeScore ?? match.homeScore);
  const awayScore = numberOrNull(match.placar_oficial_visitante ?? match.officialAwayScore ?? match.awayScore);
  const startsAt = parseDate(match.partida_data ?? match.matchDate ?? match.date ?? match.timestamp);
  const now = new Date(nowIso || Date.now()).getTime();
  const start = startsAt ? new Date(startsAt).getTime() : null;
  const timer = String(match.status_cronometro_tr ?? match.statusTimer ?? "").trim();
  const period = String(match.periodo_tr ?? "").trim();

  if (/ENCERRADA|POS_JOGO/i.test(`${match.status_transmissao_tr || ""} ${period}`)
    && Number.isFinite(homeScore) && Number.isFinite(awayScore)) return "FINISHED";
  if (timer || period) return "LIVE";
  if (Number.isFinite(homeScore) && Number.isFinite(awayScore) && start && start <= now) return "FINISHED";
  if (start && start > now) return "FUTURE";
  if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) return "FINISHED";
  return "SCHEDULED_UNKNOWN_TIME";
}

function normalizeMatch(match, options = {}) {
  const homeClubId = clubId(match.clube_casa_id ?? match.homeClubId);
  const awayClubId = clubId(match.clube_visitante_id ?? match.awayClubId);
  const startsAt = parseDate(match.partida_data ?? match.matchDate ?? match.date ?? match.timestamp);
  const homeScore = numberOrNull(match.placar_oficial_mandante ?? match.officialHomeScore ?? match.homeScore);
  const awayScore = numberOrNull(match.placar_oficial_visitante ?? match.officialAwayScore ?? match.awayScore);
  const status = matchStatus(match, options.nowIso);
  const capturedAt = options.capturedAt || new Date().toISOString();

  return sanitize({
    competition: BRASILEIRAO_COMPETITION.id,
    competitionName: BRASILEIRAO_COMPETITION.name,
    season: options.season,
    round: numberOrNull(match.rodada ?? match.round ?? options.round),
    matchId: numberOrNull(match.partida_id ?? match.matchId) ?? null,
    stableId: String(match.partida_id ?? match.matchId ?? `${options.season}-${options.round}-${homeClubId}-${awayClubId}`),
    homeClubId,
    awayClubId,
    homeScore,
    awayScore,
    status,
    startsAt,
    venue: match.local ?? match.location ?? match.venue ?? null,
    homeStandingPosition: numberOrNull(match.clube_casa_posicao ?? match.homeStandingPosition),
    awayStandingPosition: numberOrNull(match.clube_visitante_posicao ?? match.awayStandingPosition),
    homeRecentResults: Array.isArray(match.aproveitamento_mandante) ? match.aproveitamento_mandante : null,
    awayRecentResults: Array.isArray(match.aproveitamento_visitante) ? match.aproveitamento_visitante : null,
    championshipId: numberOrNull(match.campeonato_id ?? match.championshipId),
    stage: match.fase ?? match.stage ?? match.phase ?? null,
    source: "Cartola FC public API",
    sourceEndpoint: "/partidas",
    capturedAt,
    informationStatus: startsAt && homeClubId && awayClubId ? "AVAILABLE" : "PARTIAL",
    rawStatus: {
      valid: match.valida ?? match.valid ?? null,
      statusTransmission: match.status_transmissao_tr ?? match.statusTransmission ?? null,
      statusTimer: match.status_cronometro_tr ?? match.statusTimer ?? null
    }
  });
}

function normalizeRoundPayload({ matchesPayload, marketStatusPayload, marketPayload, capturedAt, season = 2026, nowIso }) {
  const currentRound = numberOrNull(marketStatusPayload?.rodada_atual ?? marketStatusPayload?.raw?.rodada_atual ?? matchesPayload?.rodada);
  const rawMatches = matchesPayload?.partidas || matchesPayload?.matches || [];
  const matches = rawMatches.map((match) => normalizeMatch(match, {
    capturedAt,
    nowIso,
    round: currentRound,
    season
  }));
  const clubs = normalizeClubs(marketPayload?.clubes || matchesPayload?.clubes || matchesPayload?.clubs || {});
  const athletes = normalizeAthletes(marketPayload?.atletas || marketPayload?.players || []);
  const positions = normalizePositions(marketPayload?.posicoes || marketPayload?.positions || {});
  const statuses = normalizeStatuses(marketPayload?.status || marketPayload?.statuses || {});
  const closedMatches = matches.filter((match) => match.status === "FINISHED").length;
  const liveMatches = matches.filter((match) => match.status === "LIVE").length;
  const futureMatches = matches.filter((match) => match.status === "FUTURE" || match.status === "SCHEDULED_UNKNOWN_TIME").length;

  return sanitize({
    currentRound,
    market: {
      round: currentRound,
      status: marketStatusPayload?.status_mercado ?? marketStatusPayload?.raw?.status_mercado ?? null,
      season: marketStatusPayload?.temporada ?? marketStatusPayload?.raw?.temporada ?? season,
      closesAt: parseDate(marketStatusPayload?.fechamento?.timestamp ?? marketStatusPayload?.raw?.fechamento?.timestamp),
      source: "Cartola FC public API",
      sourceEndpoint: "/mercado/status",
      capturedAt,
      sourceStatus: currentRound ? "AVAILABLE" : "PARTIAL",
      athleteSourceStatus: athletes.length ? "AVAILABLE" : "UNAVAILABLE",
      endpointStatus: marketPayload ? "AVAILABLE" : "UNAVAILABLE_OPTIONAL_SOURCE"
    },
    matches,
    clubs,
    athletes,
    positions,
    statuses,
    sourceAvailability: {
      matches: matches.length ? "AVAILABLE" : "UNAVAILABLE",
      clubs: Object.keys(clubs).length ? "AVAILABLE" : "UNAVAILABLE",
      athletes: athletes.length ? "AVAILABLE" : "UNAVAILABLE_OPTIONAL_SOURCE",
      positions: positions.length ? "AVAILABLE" : "UNAVAILABLE_OPTIONAL_SOURCE",
      statuses: statuses.length ? "AVAILABLE" : "UNAVAILABLE_OPTIONAL_SOURCE"
    },
    counts: {
      total: matches.length,
      closed: closedMatches,
      live: liveMatches,
      future: futureMatches
    },
    seasonValidation: {
      expectedSeason: season,
      marketSeason: marketStatusPayload?.temporada ?? marketStatusPayload?.raw?.temporada ?? null,
      status: (marketStatusPayload?.temporada ?? marketStatusPayload?.raw?.temporada) === season ? "PASS" : "UNKNOWN_OR_MISMATCH"
    }
  });
}

function hoursBetween(leftIso, rightIso) {
  if (!leftIso || !rightIso) return null;
  const left = new Date(leftIso).getTime();
  const right = new Date(rightIso).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return round((right - left) / 36e5, 2);
}

function isImportantCompetition(match) {
  return ["copa-do-brasil", "libertadores", "sul-americana"].includes(match.competition);
}

function fixtureCongestion({ previousMatch, nextMatch, past7, next7, nowIso }) {
  const reasons = [];
  const referenceNow = nowIso || new Date().toISOString();
  const previousRestHours = previousMatch ? Math.abs(hoursBetween(previousMatch.startsAt, referenceNow)) : null;
  const nextRestHours = nextMatch ? Math.abs(hoursBetween(referenceNow, nextMatch.startsAt)) : null;

  if (Number.isFinite(previousRestHours) && previousRestHours < CONGESTION_THRESHOLDS.shortRestHours) reasons.push("played_less_than_72h_before");
  if (Number.isFinite(nextRestHours) && nextRestHours < CONGESTION_THRESHOLDS.shortRestHours) reasons.push("next_match_less_than_72h");
  if (past7.length + next7.length >= CONGESTION_THRESHOLDS.highSevenDayMatchCount) reasons.push("three_or_more_matches_in_7d_window");
  else if (past7.length + next7.length >= CONGESTION_THRESHOLDS.mediumSevenDayMatchCount) reasons.push("two_matches_in_7d_window");
  if (nextMatch && isImportantCompetition(nextMatch) && Number.isFinite(nextRestHours) && nextRestHours <= CONGESTION_THRESHOLDS.nextImportantMatchHours) {
    reasons.push("important_match_within_next_4_days");
  }

  const level = reasons.some((reason) => ["played_less_than_72h_before", "next_match_less_than_72h", "three_or_more_matches_in_7d_window", "important_match_within_next_4_days"].includes(reason))
    ? "HIGH"
    : reasons.length
      ? "MEDIUM"
      : "LOW";

  return {
    level,
    reasons,
    thresholds: CONGESTION_THRESHOLDS
  };
}

function resultForTeam(match, teamId) {
  if (!Number.isFinite(match.homeScore) || !Number.isFinite(match.awayScore)) return null;
  const isHome = Number(match.homeClubId) === Number(teamId);
  const goalsFor = isHome ? match.homeScore : match.awayScore;
  const goalsAgainst = isHome ? match.awayScore : match.homeScore;
  return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
}

function buildTeamCalendarContext({ teamId, matches, clubs, nowIso = new Date().toISOString() }) {
  const id = Number(teamId);
  const now = new Date(nowIso).getTime();
  const teamMatches = matches
    .filter((match) => Number(match.homeClubId) === id || Number(match.awayClubId) === id)
    .filter((match) => match.startsAt)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const previous = [...teamMatches].reverse().find((match) => new Date(match.startsAt).getTime() < now) || null;
  const next = teamMatches.find((match) => new Date(match.startsAt).getTime() >= now) || null;
  const sevenDaysMs = CONGESTION_THRESHOLDS.sevenDayWindowDays * 864e5;
  const past7 = teamMatches.filter((match) => {
    const date = new Date(match.startsAt).getTime();
    return date < now && now - date <= sevenDaysMs;
  });
  const next7 = teamMatches.filter((match) => {
    const date = new Date(match.startsAt).getTime();
    return date >= now && date - now <= sevenDaysMs;
  });
  const lastFinished = teamMatches.filter((match) => match.status === "FINISHED" && new Date(match.startsAt).getTime() < now).slice(-5);
  const recentResults = lastFinished.map((match) => ({
    matchId: match.matchId,
    opponentClubId: Number(match.homeClubId) === id ? match.awayClubId : match.homeClubId,
    competition: match.competition,
    homeAway: Number(match.homeClubId) === id ? "HOME" : "AWAY",
    result: resultForTeam(match, id),
    goalsFor: Number(match.homeClubId) === id ? match.homeScore : match.awayScore,
    goalsAgainst: Number(match.homeClubId) === id ? match.awayScore : match.homeScore,
    startsAt: match.startsAt
  }));
  const wins = recentResults.filter((item) => item.result === "W").length;
  const draws = recentResults.filter((item) => item.result === "D").length;
  const losses = recentResults.filter((item) => item.result === "L").length;
  const homeResults = recentResults.filter((item) => item.homeAway === "HOME");
  const awayResults = recentResults.filter((item) => item.homeAway === "AWAY");

  return sanitize({
    teamId: id,
    club: clubs?.[id] || null,
    previousMatch: previous,
    lastMatchDate: previous?.startsAt || null,
    previousCompetition: previous?.competition || null,
    hoursSincePreviousMatch: previous ? Math.abs(hoursBetween(previous.startsAt, nowIso)) : null,
    daysSincePreviousMatch: previous ? round(Math.abs(hoursBetween(previous.startsAt, nowIso)) / 24, 2) : null,
    nextMatch: next,
    nextMatchDate: next?.startsAt || null,
    nextCompetition: next?.competition || null,
    hoursUntilNextMatch: next ? Math.abs(hoursBetween(nowIso, next.startsAt)) : null,
    daysUntilNextMatch: next ? round(Math.abs(hoursBetween(nowIso, next.startsAt)) / 24, 2) : null,
    matchesLast7Days: past7.length,
    matchesNext7Days: next7.length,
    hasKnockoutMatchNearby: next7.some(isImportantCompetition),
    hasLibertadoresNearby: next7.some((match) => match.competition === "libertadores"),
    hasSulAmericanaNearby: next7.some((match) => match.competition === "sul-americana"),
    hasCopaDoBrasilNearby: next7.some((match) => match.competition === "copa-do-brasil"),
    fixtureCongestion: fixtureCongestion({ previousMatch: previous, nextMatch: next, past7, next7 }),
    rotationRiskSignal: {
      level: fixtureCongestion({ previousMatch: previous, nextMatch: next, past7, next7 }).level,
      semantics: "contextual_signal_not_confirmed_lineup"
    },
    recentForm: {
      status: recentResults.length ? "AVAILABLE" : "INSUFFICIENT_SAMPLE",
      sampleSize: recentResults.length,
      lastMatches: recentResults,
      wins,
      draws,
      losses,
      goalsFor: recentResults.reduce((sum, item) => sum + Number(item.goalsFor || 0), 0),
      goalsAgainst: recentResults.reduce((sum, item) => sum + Number(item.goalsAgainst || 0), 0)
    },
    homeAwayPerformance: {
      status: recentResults.length >= 3 ? "PARTIAL" : "INSUFFICIENT_SAMPLE",
      home: {
        sampleSize: homeResults.length,
        averageGoalsFor: average(homeResults.map((item) => item.goalsFor)),
        averageGoalsAgainst: average(homeResults.map((item) => item.goalsAgainst))
      },
      away: {
        sampleSize: awayResults.length,
        averageGoalsFor: average(awayResults.map((item) => item.goalsFor)),
        averageGoalsAgainst: average(awayResults.map((item) => item.goalsAgainst))
      }
    },
    unavailableDataContracts: {
      absences: { status: "UNAVAILABLE_SOURCE_NOT_CONFIGURED", value: null },
      probableLineup: { status: "UNAVAILABLE_SOURCE_NOT_CONFIGURED", value: null },
      confirmedLineup: { status: "UNAVAILABLE_SOURCE_NOT_CONFIGURED", value: null },
      lineupProbability: { status: "UNAVAILABLE_SOURCE_NOT_CONFIGURED", value: null }
    }
  });
}

function multiCompetitionStatus() {
  return PREPARED_COMPETITIONS.map((competition) => ({
    ...competition,
    realDataIntegrated: competition.status === "AVAILABLE"
  }));
}

module.exports = {
  buildTeamCalendarContext,
  fixtureCongestion,
  matchStatus,
  multiCompetitionStatus,
  normalizeMatch,
  normalizeRoundPayload,
  parseDate
};
