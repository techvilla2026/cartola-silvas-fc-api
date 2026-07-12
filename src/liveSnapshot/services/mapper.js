const { AVAILABILITY } = require("../domain/constants");

function asNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asBooleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function mapObjectValues(obj, mapper) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).map(([id, value]) => mapper(id, value || {}));
}

function mapPlayers(marketBody) {
  return (marketBody?.atletas || []).map((athlete) => ({
    athleteId: asNumberOrNull(athlete.atleta_id),
    nickname: athlete.apelido ?? null,
    abbreviatedNickname: athlete.apelido_abreviado ?? null,
    name: athlete.nome ?? null,
    slug: athlete.slug ?? null,
    clubId: asNumberOrNull(athlete.clube_id),
    positionId: asNumberOrNull(athlete.posicao_id),
    statusId: asNumberOrNull(athlete.status_id),
    price: asNumberOrNull(athlete.preco_num),
    average: asNumberOrNull(athlete.media_num),
    roundPoints: asNumberOrNull(athlete.pontos_num),
    priceVariation: asNumberOrNull(athlete.variacao_num),
    games: asNumberOrNull(athlete.jogos_num),
    enteredField: asBooleanOrNull(athlete.entrou_em_campo),
    scouts: athlete.scout && typeof athlete.scout === "object" ? athlete.scout : null,
    photo: athlete.foto ?? null,
    rawFieldNames: Object.keys(athlete || {}).sort()
  }));
}

function mapClubs(marketBody, matchesBody) {
  const clubs = marketBody?.clubes || matchesBody?.clubes || {};
  return mapObjectValues(clubs, (id, club) => ({
    id: asNumberOrNull(club.id ?? id),
    name: club.nome ?? null,
    fantasyName: club.nome_fantasia ?? null,
    abbreviation: club.abreviacao ?? null,
    slug: club.slug ?? null,
    nickname: club.apelido ?? null,
    badges: club.escudos ?? null,
    available: asBooleanOrNull(club.disponivel)
  }));
}

function mapPositions(marketBody) {
  return mapObjectValues(marketBody?.posicoes, (id, position) => ({
    id: asNumberOrNull(position.id ?? id),
    name: position.nome ?? null,
    abbreviation: position.abreviacao ?? null
  }));
}

function mapStatuses(marketBody) {
  return mapObjectValues(marketBody?.status, (id, status) => ({
    id: asNumberOrNull(status.id ?? id),
    name: status.nome ?? null
  }));
}

function mapMatches(matchesBody) {
  return (matchesBody?.partidas || []).map((match) => ({
    round: asNumberOrNull(matchesBody?.rodada),
    matchId: asNumberOrNull(match.partida_id),
    homeClubId: asNumberOrNull(match.clube_casa_id),
    awayClubId: asNumberOrNull(match.clube_visitante_id),
    matchDate: match.partida_data ?? null,
    timestamp: asNumberOrNull(match.timestamp),
    location: match.local ?? null,
    valid: asBooleanOrNull(match.valida),
    statusTransmission: match.status_transmissao_tr ?? null,
    statusTimer: match.status_cronometro_tr ?? null,
    officialHomeScore: asNumberOrNull(match.placar_oficial_mandante),
    officialAwayScore: asNumberOrNull(match.placar_oficial_visitante),
    homeAwayByClub: {
      [String(match.clube_casa_id)]: "HOME",
      [String(match.clube_visitante_id)]: "AWAY"
    },
    rawFieldNames: Object.keys(match || {}).sort()
  }));
}

function buildAvailability({ marketStatusBody, marketBody, matchesBody, motorResult }) {
  const players = Array.isArray(marketBody?.atletas) && marketBody.atletas.length > 0;
  const clubs = Boolean(marketBody?.clubes || matchesBody?.clubes);
  const positions = Boolean(marketBody?.posicoes);
  const statuses = Boolean(marketBody?.status);
  const matches = Array.isArray(matchesBody?.partidas);
  const scouts = players && marketBody.atletas.some((athlete) => athlete.scout && Object.keys(athlete.scout).length > 0);
  const marketClosingAt = Boolean(marketStatusBody?.fechamento);

  return {
    market: marketBody ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    players: players ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    clubs: clubs ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    positions: positions ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    statuses: statuses ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    matches: matches ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    marketStatus: marketStatusBody ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    marketClosingAt: marketClosingAt ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    scouts: scouts ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    lineupProbability: AVAILABILITY.NOT_CAPTURED,
    userLineup: AVAILABILITY.NOT_APPLICABLE,
    analysisPrediction: motorResult?.available ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    analysisScore: motorResult?.available ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    dataQuality: motorResult?.available ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    idealTeam: motorResult?.teamAvailable ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    captain: motorResult?.captainAvailable ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    viceCaptain: motorResult?.captainAvailable ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
    centralRecommendations: motorResult?.centralAvailable ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE
  };
}

module.exports = {
  asNumberOrNull,
  buildAvailability,
  mapClubs,
  mapMatches,
  mapPlayers,
  mapPositions,
  mapStatuses
};
