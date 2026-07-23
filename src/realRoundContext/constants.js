const REAL_CONTEXT_SCHEMA_VERSION = "real-round-context/v1";
const REAL_RESULTS_SCHEMA_VERSION = "real-match-results/v1";
const TEAM_CONTEXT_SCHEMA_VERSION = "real-team-context/v1";
const CALENDAR_CONTEXT_SCHEMA_VERSION = "multi-competition-calendar-context/v1";
const PLAYER_CONTEXT_SCHEMA_VERSION = "player-context-contract/v1";
const REAL_ROUND_EVALUATION_SCHEMA_VERSION = "real-round-evaluation/v1";
const CONTEXT_FEATURE_DIAGNOSTICS_SCHEMA_VERSION = "context-feature-diagnostics/v1";
const MATCH_CONTEXT_SCHEMA_VERSION = "match-context/v1";
const TEAM_CONTEXT_DIAGNOSTICS_SCHEMA_VERSION = "team-context-diagnostics/v1";
const FORMATION_CONTRACT_SCHEMA_VERSION = "tactical-formation-contract/v1";
const RESERVE_RULES_CONTRACT_SCHEMA_VERSION = "cartola-reserve-rules-contract/v1";
const CONTEXT_ENGINE_VERSION = "real-round-context-engine/5.2.0";

const BRASILEIRAO_COMPETITION = {
  id: "brasileirao-serie-a",
  name: "Brasileirao Serie A",
  source: "Cartola FC public API",
  sourceEndpoint: "/partidas",
  status: "AVAILABLE"
};

const PREPARED_COMPETITIONS = [
  BRASILEIRAO_COMPETITION,
  {
    id: "copa-do-brasil",
    name: "Copa do Brasil",
    source: null,
    sourceEndpoint: null,
    status: "UNAVAILABLE_SOURCE_NOT_CONFIGURED"
  },
  {
    id: "libertadores",
    name: "Libertadores",
    source: null,
    sourceEndpoint: null,
    status: "UNAVAILABLE_SOURCE_NOT_CONFIGURED"
  },
  {
    id: "sul-americana",
    name: "Sul-Americana",
    source: null,
    sourceEndpoint: null,
    status: "UNAVAILABLE_SOURCE_NOT_CONFIGURED"
  }
];

const CONTEXT_CACHE_POLICY = {
  schemaVersion: "real-round-context-cache-policy/v1",
  futureFixtureTtlSeconds: 900,
  liveFixtureTtlSeconds: 60,
  finishedFixtureTtlSeconds: 21600,
  fallbackPolicy: "Use latest successful upstream response, then latest valid live snapshot, never erase valid data on upstream failure.",
  rationale: [
    "Agenda futura muda pouco durante o dia.",
    "Jogo ao vivo e mais volatil.",
    "Resultado encerrado pode ser mantido por mais tempo."
  ]
};

const CONGESTION_THRESHOLDS = {
  schemaVersion: "fixture-congestion-thresholds/v1",
  shortRestHours: 72,
  moderateRestHours: 120,
  nextImportantMatchHours: 96,
  sevenDayWindowDays: 7,
  highSevenDayMatchCount: 3,
  mediumSevenDayMatchCount: 2
};

module.exports = {
  BRASILEIRAO_COMPETITION,
  CALENDAR_CONTEXT_SCHEMA_VERSION,
  CONGESTION_THRESHOLDS,
  CONTEXT_CACHE_POLICY,
  CONTEXT_ENGINE_VERSION,
  CONTEXT_FEATURE_DIAGNOSTICS_SCHEMA_VERSION,
  FORMATION_CONTRACT_SCHEMA_VERSION,
  MATCH_CONTEXT_SCHEMA_VERSION,
  PLAYER_CONTEXT_SCHEMA_VERSION,
  PREPARED_COMPETITIONS,
  REAL_CONTEXT_SCHEMA_VERSION,
  REAL_RESULTS_SCHEMA_VERSION,
  REAL_ROUND_EVALUATION_SCHEMA_VERSION,
  TEAM_CONTEXT_DIAGNOSTICS_SCHEMA_VERSION,
  TEAM_CONTEXT_SCHEMA_VERSION,
  RESERVE_RULES_CONTRACT_SCHEMA_VERSION
};
