const SCHEMA_VERSION = "historical-round-data/v1";
const VALIDATION_STATUS = {
  VALID: "VALID",
  VALID_WITH_WARNINGS: "VALID_WITH_WARNINGS",
  INVALID: "INVALID",
  NOT_VALIDATED: "NOT_VALIDATED"
};

const LEAK_FREE_UNAVAILABLE_FIELDS = [
  "priceBeforeRound",
  "averageBeforeRound",
  "gamesBeforeRound",
  "statusBeforeRound",
  "accumulatedScoutsBeforeRound",
  "lineupProbabilityBeforeRound",
  "matchResultsBeforeRound"
];

const POSITIONS = {
  1: { id: 1, name: "Goleiro", abbreviation: "gol" },
  2: { id: 2, name: "Lateral", abbreviation: "lat" },
  3: { id: 3, name: "Zagueiro", abbreviation: "zag" },
  4: { id: 4, name: "Meia", abbreviation: "mei" },
  5: { id: 5, name: "Atacante", abbreviation: "ata" },
  6: { id: 6, name: "Tecnico", abbreviation: "tec" }
};

const STATUSES = {
  2: { id: 2, name: "Duvida" },
  3: { id: 3, name: "Suspenso" },
  5: { id: 5, name: "Contundido" },
  6: { id: 6, name: "Nulo" },
  7: { id: 7, name: "Provavel" }
};

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value) {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function toBoolean(value) {
  if (value === true || value === "True" || value === "true") {
    return true;
  }

  if (value === false || value === "False" || value === "false") {
    return false;
  }

  return null;
}

function normalizeScouts(row) {
  const ignored = new Set([
    "atletas.apelido",
    "atletas.apelido_abreviado",
    "atletas.atleta_id",
    "atletas.clube.id.full.name",
    "atletas.clube_id",
    "atletas.craque",
    "atletas.entrou_em_campo",
    "atletas.foto",
    "atletas.jogos_num",
    "atletas.media_num",
    "atletas.nome",
    "atletas.pontos_num",
    "atletas.posicao_id",
    "atletas.preco_num",
    "atletas.rodada_id",
    "atletas.slug",
    "atletas.status_id",
    "atletas.variacao_num"
  ]);
  const scouts = {};

  for (const [key, value] of Object.entries(row)) {
    if (!ignored.has(key) && value !== "") {
      scouts[key] = toNumber(value);
    }
  }

  return scouts;
}

function normalizePlayer(row, sourceReference) {
  return {
    athleteId: toInteger(row["atletas.atleta_id"]),
    name: row["atletas.nome"] || null,
    nickname: row["atletas.apelido"] || null,
    abbreviatedName: row["atletas.apelido_abreviado"] || null,
    clubId: toInteger(row["atletas.clube_id"]),
    clubName: row["atletas.clube.id.full.name"] || null,
    positionId: toInteger(row["atletas.posicao_id"]),
    statusId: toInteger(row["atletas.status_id"]),
    price: toNumber(row["atletas.preco_num"]),
    priceVariation: toNumber(row["atletas.variacao_num"]),
    average: toNumber(row["atletas.media_num"]),
    points: toNumber(row["atletas.pontos_num"]),
    games: toInteger(row["atletas.jogos_num"]),
    played: toBoolean(row["atletas.entrou_em_campo"]),
    scouts: normalizeScouts(row),
    rawSourceReference: sourceReference
  };
}

function normalizeMatch(match) {
  return {
    matchId: match.partida_id ?? null,
    round: null,
    homeClubId: match.clube_casa_id ?? null,
    awayClubId: match.clube_visitante_id ?? null,
    date: match.partida_data ?? null,
    venue: match.local ?? null,
    homeScore: match.placar_oficial_mandante ?? null,
    awayScore: match.placar_oficial_visitante ?? null,
    valid: match.valida ?? null,
    status: match.status_transmissao_tr || match.periodo_tr || null,
    rawSourceReference: {
      source: "cartola-official-public-api",
      endpoint: "/partidas/:round"
    }
  };
}

function createHistoricalRoundData({
  season,
  round,
  source,
  sourceVersion,
  collectedAt,
  validatedAt,
  validationStatus,
  marketContext,
  players,
  matches,
  clubs,
  metadata
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    season,
    round,
    source,
    sourceVersion,
    collectedAt,
    validatedAt: validatedAt || null,
    validationStatus: validationStatus || VALIDATION_STATUS.NOT_VALIDATED,
    marketContext: marketContext || {},
    players: players || [],
    matches: matches || [],
    clubs: clubs || {},
    positions: POSITIONS,
    statuses: STATUSES,
    metadata: metadata || {}
  };
}

function createPreRoundData({ season, round, source, sourceVersion, collectedAt, matches, metadata }) {
  const leakSafeMatches = (matches || []).map((match) => ({
    ...match,
    homeScore: null,
    awayScore: null,
    status: null
  }));

  return createHistoricalRoundData({
    season,
    round,
    source,
    sourceVersion,
    collectedAt,
    validationStatus: VALIDATION_STATUS.VALID_WITH_WARNINGS,
    marketContext: {
      dataType: "PRE_ROUND_DATA",
      notAvailableForLeakFreeBacktest: LEAK_FREE_UNAVAILABLE_FIELDS
    },
    players: [],
    matches: leakSafeMatches,
    metadata: {
      ...(metadata || {}),
      note: "Dados historicos pre-rodada nao foram reconstruidos sem risco de vazamento futuro."
    }
  });
}

module.exports = {
  SCHEMA_VERSION,
  VALIDATION_STATUS,
  LEAK_FREE_UNAVAILABLE_FIELDS,
  POSITIONS,
  STATUSES,
  nowIso,
  toNumber,
  normalizeScouts,
  normalizePlayer,
  normalizeMatch,
  createHistoricalRoundData,
  createPreRoundData
};
