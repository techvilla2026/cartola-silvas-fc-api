const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { fetchLiveSources } = require("../liveSnapshot/services/cartolaClient");
const { asNumberOrNull, mapClubs, mapMatches, mapPlayers, mapPositions, mapStatuses } = require("../liveSnapshot/services/mapper");
const { canonicalStringify, contentHash } = require("../liveSnapshot/integrity/canonical");
const { ResearchRepository } = require("./repository");
const {
  buildParticipationHistoryForRound,
  enrichWithAvailability,
  participationFeaturesForPlayer
} = require("./availabilityCalibration");
const {
  TRAIN_ROUNDS,
  buildDataset,
  predictV2,
  trainLogistic
} = require("./availabilityRecalibration");

const PRE_MATCH_SOURCE_VERSION = "PRE_MATCH_AVAILABILITY_SOURCE_V1";
const PRE_MATCH_SNAPSHOT_SCHEMA = "pre-match-availability-source/v1";
const PRE_MATCH_ENGINE_VERSION = "pre-match-availability-source/5.2.15";
const SOURCE_BUILD_ID = "build-4.3.2";
const SAFE_PRE_MATCH = "SAFE_PRE_MATCH";
const UNKNOWN_TIMING = "UNKNOWN_TIMING";
const POST_MATCH_BLOCKED = "POST_MATCH_BLOCKED";
const PRIMARY_CAPTURE_WINDOW = { minMinutesBeforeDeadline: 120, maxMinutesBeforeDeadline: 360 };
const FINAL_CAPTURE_WINDOW = { minMinutesBeforeDeadline: 30, maxMinutesBeforeDeadline: 90 };
const AUTO_CAPTURE_REASON_CODES = {
  CAPTURE_CREATED: "CAPTURE_CREATED",
  ALREADY_CAPTURED: "ALREADY_CAPTURED",
  OUTSIDE_CAPTURE_WINDOW: "OUTSIDE_CAPTURE_WINDOW",
  MARKET_CLOSED: "MARKET_CLOSED",
  ROUND_NOT_READY: "ROUND_NOT_READY",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  TEMPORAL_VALIDATION_FAILED: "TEMPORAL_VALIDATION_FAILED"
};
const VALID_CONTROL_STATES = new Set(["PENDING_OUTCOME", "OUTCOME_AVAILABLE", "EVALUATED", "INVALID_TEMPORAL_CAPTURE"]);

const AVAILABLE_NOW_SOURCES = [
  {
    sourceId: "cartola-mercado-status-public-api",
    sourceType: "public_api",
    endpoint: "/mercado/status",
    origin: "https://api.cartolafc.globo.com/mercado/status",
    authenticationRequired: false,
    licenseStatus: "PUBLIC_ENDPOINT_USED_BY_PROJECT",
    termsRisk: "LOW_FOR_READ_ONLY_PROXY_USAGE",
    availabilityTiming: "live before/during market window",
    historicalAvailability: "not complete without saved snapshots",
    currentAvailability: "AVAILABLE_NOW",
    fieldsProvided: ["temporada", "rodada_atual", "status_mercado", "fechamento"],
    reliability: "HIGH_FOR_DEADLINE",
    recommendedUse: "deadline, current round, temporal proof"
  },
  {
    sourceId: "cartola-atletas-mercado-public-api",
    sourceType: "public_api",
    endpoint: "/atletas/mercado",
    origin: "https://api.cartolafc.globo.com/atletas/mercado",
    authenticationRequired: false,
    licenseStatus: "PUBLIC_ENDPOINT_USED_BY_PROJECT",
    termsRisk: "LOW_FOR_READ_ONLY_PROXY_USAGE",
    availabilityTiming: "live before/during market window",
    historicalAvailability: "not complete without saved snapshots",
    currentAvailability: "AVAILABLE_NOW",
    fieldsProvided: ["atleta_id", "apelido", "nome", "clube_id", "posicao_id", "status_id", "preco_num", "media_num", "jogos_num"],
    reliability: "MEDIUM_FOR_AVAILABILITY_STATUS",
    recommendedUse: "statusRaw/statusNormalized and player identity"
  },
  {
    sourceId: "cartola-partidas-public-api",
    sourceType: "public_api",
    endpoint: "/partidas",
    origin: "https://api.cartolafc.globo.com/partidas",
    authenticationRequired: false,
    licenseStatus: "PUBLIC_ENDPOINT_USED_BY_PROJECT",
    termsRisk: "LOW_FOR_READ_ONLY_PROXY_USAGE",
    availabilityTiming: "live schedule before round",
    historicalAvailability: "partial through existing snapshots/historical data",
    currentAvailability: "AVAILABLE_NOW",
    fieldsProvided: ["rodada", "partidas", "timestamp", "clube_casa_id", "clube_visitante_id"],
    reliability: "HIGH_FOR_FIXTURE_CONTEXT",
    recommendedUse: "fixture context and fallback deadline context"
  },
  {
    sourceId: "curated-manual-pre-match-input",
    sourceType: "manual_curated",
    endpoint: "data/research/{season}/manual-pre-match-input",
    origin: "local audited file",
    authenticationRequired: false,
    licenseStatus: "PROJECT_CURATED_INPUT",
    termsRisk: "DEPENDS_ON_HUMAN_SOURCE_REFERENCE",
    availabilityTiming: "only valid when observedAt is before deadline",
    historicalAvailability: "prospective only from first saved input",
    currentAvailability: "TECHNICALLY_POSSIBLE",
    fieldsProvided: ["probableFlag", "doubtFlag", "injuryFlag", "suspensionFlag", "starterFlag", "relatedFlag"],
    reliability: "DEPENDS_ON_CONFIDENCE_AND_REFERENCE",
    recommendedUse: "optional auditable enrichment, never silent overwrite"
  }
];

const NON_INTEGRATED_SOURCES = [
  { sourceId: "free-news-scraping", status: "NOT_RECOMMENDED", reason: "Nao ha fonte estruturada, timestamp canonico ou garantia de termos." },
  { sourceId: "setoristas-lineup-social", status: "UNRELIABLE", reason: "Pode ser util futuramente com curadoria manual, mas nao como integracao automatica." },
  { sourceId: "licensed-injury-suspension-minutes", status: "REQUIRES_LICENSE", reason: "Nao integrar sem contrato/licenca e timestamps pre-jogo." }
];

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function compactTimestamp(value) {
  return String(value || "").replace(/[-:.TZ]/g, "").slice(0, 14) || "unknown";
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalStringify(value)).digest("hex");
}

function parseDeadline(marketStatusBody, fallbackDeadline = null) {
  if (fallbackDeadline) {
    const date = new Date(fallbackDeadline);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const timestamp = marketStatusBody?.fechamento?.timestamp;
  if (timestamp !== null && timestamp !== undefined) {
    const ms = Number(timestamp) < 10_000_000_000 ? Number(timestamp) * 1000 : Number(timestamp);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function temporalRelation(capturedAt, deadline) {
  if (!capturedAt || !deadline) {
    return { captureRelationToDeadline: UNKNOWN_TIMING, minutesBeforeDeadline: null, temporalSafety: UNKNOWN_TIMING };
  }
  const captured = new Date(capturedAt).getTime();
  const limit = new Date(deadline).getTime();
  if (Number.isNaN(captured) || Number.isNaN(limit)) {
    return { captureRelationToDeadline: UNKNOWN_TIMING, minutesBeforeDeadline: null, temporalSafety: UNKNOWN_TIMING };
  }
  const minutes = Math.floor((limit - captured) / 60000);
  if (captured < limit) {
    return { captureRelationToDeadline: "BEFORE_DEADLINE", minutesBeforeDeadline: minutes, temporalSafety: SAFE_PRE_MATCH };
  }
  return { captureRelationToDeadline: "AFTER_DEADLINE", minutesBeforeDeadline: minutes, temporalSafety: POST_MATCH_BLOCKED };
}

function captureWindowForMinutes(minutesBeforeDeadline) {
  if (minutesBeforeDeadline === null || minutesBeforeDeadline === undefined) return "UNKNOWN";
  if (minutesBeforeDeadline < 0) return "MARKET_CLOSED";
  if (minutesBeforeDeadline >= PRIMARY_CAPTURE_WINDOW.minMinutesBeforeDeadline && minutesBeforeDeadline <= PRIMARY_CAPTURE_WINDOW.maxMinutesBeforeDeadline) return "PRIMARY";
  if (minutesBeforeDeadline >= FINAL_CAPTURE_WINDOW.minMinutesBeforeDeadline && minutesBeforeDeadline <= FINAL_CAPTURE_WINDOW.maxMinutesBeforeDeadline) return "FINAL";
  return "OUTSIDE";
}

function snapshotCaptureType(snapshot) {
  return snapshot?.captureType || "PRIMARY";
}

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeStatus(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return { statusRaw: rawValue ?? null, statusNormalized: "UNKNOWN", probableFlag: null, doubtFlag: null, injuryFlag: null, suspensionFlag: null, confidence: "LOW" };
  }
  const raw = String(rawValue);
  const normalized = stripAccents(raw).toLowerCase();
  if (normalized.includes("provavel")) {
    return { statusRaw: raw, statusNormalized: "PROBABLE", probableFlag: true, doubtFlag: false, injuryFlag: false, suspensionFlag: false, confidence: "HIGH" };
  }
  if (normalized.includes("duvida") || normalized.includes("doubt")) {
    return { statusRaw: raw, statusNormalized: "DOUBT", probableFlag: false, doubtFlag: true, injuryFlag: false, suspensionFlag: false, confidence: "MEDIUM" };
  }
  if (normalized.includes("contund") || normalized.includes("lesion") || normalized.includes("injur")) {
    return { statusRaw: raw, statusNormalized: "INJURED", probableFlag: false, doubtFlag: false, injuryFlag: true, suspensionFlag: false, confidence: "HIGH" };
  }
  if (normalized.includes("suspens")) {
    return { statusRaw: raw, statusNormalized: "SUSPENDED", probableFlag: false, doubtFlag: false, injuryFlag: false, suspensionFlag: true, confidence: "HIGH" };
  }
  if (normalized.includes("fora") || normalized.includes("out")) {
    return { statusRaw: raw, statusNormalized: "OUT", probableFlag: false, doubtFlag: false, injuryFlag: null, suspensionFlag: null, confidence: "MEDIUM" };
  }
  if (normalized.includes("regular") || normalized.includes("disponivel") || normalized.includes("available")) {
    return { statusRaw: raw, statusNormalized: "AVAILABLE", probableFlag: null, doubtFlag: false, injuryFlag: false, suspensionFlag: false, confidence: "MEDIUM" };
  }
  return { statusRaw: raw, statusNormalized: "UNKNOWN", probableFlag: null, doubtFlag: null, injuryFlag: null, suspensionFlag: null, confidence: "LOW" };
}

function assertSignalTemporalSafety(signal) {
  if (signal?.temporalSafety === UNKNOWN_TIMING) {
    throw new Error(`Signal ${signal.signalType || "UNKNOWN"} has UNKNOWN_TIMING.`);
  }
  if (signal?.temporalSafety === POST_MATCH_BLOCKED) {
    throw new Error(`Signal ${signal.signalType || "UNKNOWN"} is POST_MATCH_BLOCKED.`);
  }
  return true;
}

function playerStatusName(player, statusesById) {
  return statusesById.get(Number(player.statusId)) || null;
}

function playerClub(player, clubsById) {
  const club = clubsById.get(Number(player.clubId));
  return club ? { id: club.id, name: club.name, fantasyName: club.fantasyName, abbreviation: club.abbreviation } : { id: player.clubId, name: null, fantasyName: null, abbreviation: null };
}

function playerPosition(player, positionsById) {
  const position = positionsById.get(Number(player.positionId));
  return position ? { id: position.id, name: position.name, abbreviation: position.abbreviation } : { id: player.positionId, name: null, abbreviation: null };
}

function confidenceFromManual(input, fallback = "LOW") {
  const value = String(input?.confidence || fallback).toUpperCase();
  return ["HIGH", "MEDIUM", "LOW"].includes(value) ? value : fallback;
}

function manualTemporalSafety(input, deadline) {
  const observedAt = input?.observedAt || null;
  if (!observedAt || !deadline) return UNKNOWN_TIMING;
  const observed = new Date(observedAt).getTime();
  const limit = new Date(deadline).getTime();
  if (Number.isNaN(observed) || Number.isNaN(limit)) return UNKNOWN_TIMING;
  return observed < limit ? SAFE_PRE_MATCH : POST_MATCH_BLOCKED;
}

function canonicalManualSignal(input, deadline, capturedAt) {
  const temporalSafety = manualTemporalSafety(input, deadline);
  return {
    playerId: asNumberOrNull(input.playerId),
    signalType: input.signalType || null,
    value: input.value ?? null,
    sourceDescription: input.sourceDescription || null,
    sourceReference: input.sourceReference || null,
    observedAt: input.observedAt || null,
    enteredAt: input.enteredAt || capturedAt,
    enteredBy: input.enteredBy || "system",
    confidence: confidenceFromManual(input),
    notes: input.notes || null,
    temporalSafety
  };
}

function coverageForPlayers(players) {
  const totalPlayers = players.length;
  const count = (predicate) => players.filter(predicate).length;
  const withStatus = count((player) => player.statusNormalized && player.statusNormalized !== "UNKNOWN");
  const fieldCount = (field) => count((player) => player[field] !== null && player[field] !== undefined);
  const pct = (value) => totalPlayers ? round(value / totalPlayers, 6) : null;
  const byPosition = {};
  for (const player of players) {
    const key = player.position?.abbreviation || player.position?.name || "UNKNOWN";
    if (!byPosition[key]) byPosition[key] = [];
    byPosition[key].push(player);
  }
  return {
    totalPlayers,
    playersWithStatus: withStatus,
    playersWithProbableFlag: fieldCount("probableFlag"),
    playersWithDoubtFlag: fieldCount("doubtFlag"),
    playersWithInjuryFlag: fieldCount("injuryFlag"),
    playersWithSuspensionFlag: fieldCount("suspensionFlag"),
    playersWithStarterFlag: fieldCount("starterFlag"),
    percentages: {
      status: pct(withStatus),
      probableFlag: pct(fieldCount("probableFlag")),
      doubtFlag: pct(fieldCount("doubtFlag")),
      injuryFlag: pct(fieldCount("injuryFlag")),
      suspensionFlag: pct(fieldCount("suspensionFlag")),
      starterFlag: pct(fieldCount("starterFlag"))
    },
    byPosition: Object.fromEntries(Object.entries(byPosition).map(([position, rows]) => [position, coverageForPlayersShallow(rows)])),
    warnings: [
      ...(pct(withStatus) !== null && pct(withStatus) < 0.5 ? ["LOW_STATUS_COVERAGE"] : []),
      ...(fieldCount("starterFlag") === 0 ? ["STARTER_FLAG_UNAVAILABLE"] : [])
    ]
  };
}

function coverageForPlayersShallow(players) {
  const totalPlayers = players.length;
  const count = (predicate) => players.filter(predicate).length;
  const pct = (value) => totalPlayers ? round(value / totalPlayers, 6) : null;
  const withStatus = count((player) => player.statusNormalized && player.statusNormalized !== "UNKNOWN");
  return {
    totalPlayers,
    playersWithStatus: withStatus,
    playersWithProbableFlag: count((player) => player.probableFlag !== null && player.probableFlag !== undefined),
    playersWithDoubtFlag: count((player) => player.doubtFlag !== null && player.doubtFlag !== undefined),
    playersWithInjuryFlag: count((player) => player.injuryFlag !== null && player.injuryFlag !== undefined),
    playersWithSuspensionFlag: count((player) => player.suspensionFlag !== null && player.suspensionFlag !== undefined),
    playersWithStarterFlag: count((player) => player.starterFlag !== null && player.starterFlag !== undefined),
    statusCoverage: pct(withStatus)
  };
}

function sourceProvenance(sources) {
  return [
    { sourceId: "cartola-mercado-status-public-api", endpoint: sources.marketStatus?.endpoint || "/mercado/status", capturedAt: sources.marketStatus?.capturedAt || null, httpStatus: sources.marketStatus?.status || null },
    { sourceId: "cartola-atletas-mercado-public-api", endpoint: sources.market?.endpoint || "/atletas/mercado", capturedAt: sources.market?.capturedAt || null, httpStatus: sources.market?.status || null },
    { sourceId: "cartola-partidas-public-api", endpoint: sources.matches?.endpoint || "/partidas", capturedAt: sources.matches?.capturedAt || null, httpStatus: sources.matches?.status || null }
  ];
}

function frozenAvailabilityPredictions({ players, historicalRepository, season, round }) {
  const rows = buildDataset({ historicalRepository, backtestRepository: new BacktestRepository({ buildId: SOURCE_BUILD_ID }), season });
  const trainRows = rows.filter((row) => TRAIN_ROUNDS.includes(row.round));
  const weights = trainLogistic(trainRows);
  const history = buildParticipationHistoryForRound(historicalRepository, season, round);
  const byPlayer = new Map();
  for (const player of players) {
    const sourcePlayer = {
      athleteId: player.playerId,
      name: player.name,
      positionId: player.position?.id,
      clubId: player.club?.id,
      statusBeforeRound: player.statusNormalized === "UNKNOWN" ? null : player.statusNormalized,
      gamesBeforeRound: player.gamesBeforeRound,
      homeAway: null,
      opponent: null,
      predictedPoints: player.averageBeforeRound
    };
    const historyRows = history.get(Number(player.playerId)) || [];
    const enriched = enrichWithAvailability(sourcePlayer, historyRows);
    const row = {
      round,
      athleteId: player.playerId,
      target: null,
      v1Probability: roundNumber((finite(enriched.participationReliabilityScore) ?? 50) / 100, 6),
      features: participationFeaturesForPlayer(sourcePlayer, historyRows)
    };
    const probabilityV2 = predictV2(row, weights);
    byPlayer.set(Number(player.playerId), {
      probabilityV1: row.v1Probability,
      probabilityV2,
      decisionV2Threshold050: probabilityV2 >= 0.5,
      decisionV2Threshold045: probabilityV2 >= 0.45,
      v2OfficialThresholdPreserved: 0.5,
      v2ExperimentalThreshold: 0.45
    });
  }
  return byPlayer;
}

function roundNumber(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

class PreMatchAvailabilityRepository {
  constructor({ researchRepository = new ResearchRepository() } = {}) {
    this.researchRepository = researchRepository;
  }

  seasonDir(season) {
    return this.researchRepository.seasonDir(season);
  }

  availabilityDir(season) {
    return path.join(this.seasonDir(season), "pre-match-availability");
  }

  manualDir(season) {
    return path.join(this.seasonDir(season), "manual-pre-match-input");
  }

  snapshotPath(season, round, captureId) {
    return path.join(this.availabilityDir(season), `round-${String(round).padStart(2, "0")}`, `${captureId}.json`);
  }

  existingCaptureOfType(season, round, captureType) {
    return this.listSnapshots(season, round).find((snapshot) => snapshot.temporalSafety === SAFE_PRE_MATCH && snapshotCaptureType(snapshot) === captureType) || null;
  }

  selectEvaluationSnapshot(season, round) {
    const snapshots = this.listSnapshots(season, round).filter((snapshot) => snapshot.temporalSafety === SAFE_PRE_MATCH);
    return snapshots.find((snapshot) => snapshotCaptureType(snapshot) === "FINAL")
      || snapshots.find((snapshot) => snapshotCaptureType(snapshot) === "PRIMARY")
      || snapshots[snapshots.length - 1]
      || null;
  }

  saveSnapshot(snapshot) {
    const filePath = this.snapshotPath(snapshot.season, snapshot.round, snapshot.captureId);
    ensureDir(path.dirname(filePath));
    if (fs.existsSync(filePath)) {
      throw new Error(`Snapshot pre-jogo imutavel ja existe: ${snapshot.captureId}`);
    }
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    return filePath;
  }

  readSnapshot(season, round, captureId) {
    const filePath = this.snapshotPath(season, round, captureId);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  listSnapshots(season, round = null) {
    const root = this.availabilityDir(season);
    if (!fs.existsSync(root)) return [];
    const roundDirs = round === null
      ? fs.readdirSync(root).filter((name) => /^round-\d{2}$/.test(name))
      : [`round-${String(round).padStart(2, "0")}`];
    const snapshots = [];
    for (const dirName of roundDirs) {
      const dir = path.join(root, dirName);
      if (!fs.existsSync(dir)) continue;
      for (const fileName of fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
        const snapshot = JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf8"));
        snapshots.push(snapshot);
      }
    }
    return snapshots.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
  }

  latestSnapshot(season, round = null) {
    const snapshots = this.listSnapshots(season, round);
    return snapshots[snapshots.length - 1] || null;
  }

  controlsPath(season) {
    return path.join(this.seasonDir(season), "prospective-availability-controls.json");
  }

  readControls(season) {
    const filePath = this.controlsPath(season);
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: "prospective-availability-controls/v1", season, controls: [] };
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  writeControls(season, registry) {
    const filePath = this.controlsPath(season);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    return filePath;
  }

  upsertControl(snapshot, status) {
    if (!VALID_CONTROL_STATES.has(status)) throw new Error(`Estado prospectivo invalido: ${status}`);
    const registry = this.readControls(snapshot.season);
    const control = {
      round: snapshot.round,
      captureId: snapshot.captureId,
      capturedAt: snapshot.capturedAt,
      deadline: snapshot.roundDeadline,
      coverage: snapshot.coverage,
      availabilityModelVersion: "AVAILABILITY_V1 + AVAILABILITY_V2_CALIBRATED",
      status
    };
    registry.controls = registry.controls.filter((item) => item.captureId !== snapshot.captureId);
    registry.controls.push(control);
    registry.controls.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
    this.writeControls(snapshot.season, registry);
    return control;
  }

  saveManualInput(season, round, manualRecord) {
    const dir = path.join(this.manualDir(season), `round-${String(round).padStart(2, "0")}`);
    ensureDir(dir);
    const filePath = path.join(dir, `${manualRecord.manualInputId}.json`);
    if (fs.existsSync(filePath)) {
      throw new Error(`Entrada manual imutavel ja existe: ${manualRecord.manualInputId}`);
    }
    fs.writeFileSync(filePath, `${JSON.stringify(manualRecord, null, 2)}\n`, "utf8");
    return filePath;
  }
}

function buildPreMatchAvailabilitySnapshot({
  sources,
  season: requestedSeason,
  round: requestedRound,
  capturedAt = new Date().toISOString(),
  deadline: requestedDeadline = null,
  manualInputs = [],
  captureType = "PRIMARY",
  historicalRepository = new HistoricalDataRepository()
} = {}) {
  const marketStatusBody = sources?.marketStatus?.body || {};
  const marketBody = sources?.market?.body || {};
  const matchesBody = sources?.matches?.body || {};
  const season = Number(requestedSeason || marketStatusBody.temporada || new Date(capturedAt).getUTCFullYear());
  const round = Number(requestedRound || marketStatusBody.rodada_atual || matchesBody.rodada);
  if (!Number.isInteger(round) || round <= 0) throw new Error("Rodada valida e obrigatoria para snapshot pre-jogo.");
  const roundDeadline = parseDeadline(marketStatusBody, requestedDeadline);
  const temporal = temporalRelation(capturedAt, roundDeadline);
  const clubs = mapClubs(marketBody, matchesBody);
  const positions = mapPositions(marketBody);
  const statuses = mapStatuses(marketBody);
  const matches = mapMatches(matchesBody);
  const rawPlayers = mapPlayers(marketBody);
  const statusesById = new Map(statuses.map((item) => [Number(item.id), item.name]));
  const clubsById = new Map(clubs.map((item) => [Number(item.id), item]));
  const positionsById = new Map(positions.map((item) => [Number(item.id), item]));
  const manualByPlayer = new Map();
  for (const input of manualInputs) {
    const signal = canonicalManualSignal(input, roundDeadline, capturedAt);
    if (!manualByPlayer.has(Number(signal.playerId))) manualByPlayer.set(Number(signal.playerId), []);
    manualByPlayer.get(Number(signal.playerId)).push(signal);
  }
  const players = rawPlayers.map((player) => {
    const status = normalizeStatus(playerStatusName(player, statusesById));
    const manualSignals = manualByPlayer.get(Number(player.athleteId)) || [];
    const merged = { ...status };
    for (const signal of manualSignals) {
      if (signal.temporalSafety !== SAFE_PRE_MATCH) continue;
      if (signal.signalType === "probableFlag") merged.probableFlag = Boolean(signal.value);
      if (signal.signalType === "doubtFlag") merged.doubtFlag = Boolean(signal.value);
      if (signal.signalType === "injuryFlag") merged.injuryFlag = Boolean(signal.value);
      if (signal.signalType === "suspensionFlag") merged.suspensionFlag = Boolean(signal.value);
    }
    return {
      playerId: player.athleteId,
      name: player.name,
      nickname: player.nickname,
      club: playerClub(player, clubsById),
      position: playerPosition(player, positionsById),
      statusRaw: status.statusRaw,
      statusNormalized: status.statusNormalized,
      probableFlag: merged.probableFlag,
      doubtFlag: merged.doubtFlag,
      injuryFlag: merged.injuryFlag,
      suspensionFlag: merged.suspensionFlag,
      starterFlag: null,
      relatedFlag: null,
      sourceId: "cartola-atletas-mercado-public-api",
      sourceTimestamp: sources?.market?.capturedAt || null,
      captureTimestamp: capturedAt,
      temporalSafety: temporal.temporalSafety,
      confidence: merged.confidence || status.confidence,
      priceBeforeRound: player.price,
      averageBeforeRound: player.average,
      gamesBeforeRound: player.games,
      manualSignals
    };
  });
  const predictions = frozenAvailabilityPredictions({ players, historicalRepository, season, round });
  const playersWithPredictions = players.map((player) => ({
    ...player,
    frozenPredictions: predictions.get(Number(player.playerId)) || {
      probabilityV1: null,
      probabilityV2: null,
      decisionV2Threshold050: null,
      decisionV2Threshold045: null,
      v2OfficialThresholdPreserved: 0.5,
      v2ExperimentalThreshold: 0.45
    }
  }));
  const base = {
    schemaVersion: PRE_MATCH_SNAPSHOT_SCHEMA,
    sourceDefinitionVersion: PRE_MATCH_SOURCE_VERSION,
    engineVersion: PRE_MATCH_ENGINE_VERSION,
    season,
    round,
    capturedAt,
    roundDeadline,
    captureRelationToDeadline: temporal.captureRelationToDeadline,
    minutesBeforeDeadline: temporal.minutesBeforeDeadline,
    temporalSafety: temporal.temporalSafety,
    sources: sourceProvenance(sources || {}),
    captureType,
    captureWindow: captureType,
    sourceInventory: AVAILABLE_NOW_SOURCES,
    rejectedSources: NON_INTEGRATED_SOURCES,
    players: playersWithPredictions,
    clubs,
    positions,
    matches,
    coverage: coverageForPlayers(playersWithPredictions),
    missingFields: {
      starterFlag: "UNAVAILABLE_SOURCE_NOT_CONFIGURED",
      relatedFlag: "UNAVAILABLE_SOURCE_NOT_CONFIGURED",
      recentMinutesAverage: "UNAVAILABLE_SOURCE_NOT_CONFIGURED"
    },
    temporalValidation: {
      capturedAt,
      roundDeadline,
      captureRelationToDeadline: temporal.captureRelationToDeadline,
      temporalSafety: temporal.temporalSafety,
      safeForModeling: temporal.temporalSafety === SAFE_PRE_MATCH
    },
    thresholdPolicy: {
      officialThresholdPreserved: 0.5,
      experimentalThreshold045: 0.45,
      thresholdOfficialChanged: false
    },
    immutable: true,
    r19BaselinePolicy: round === 19 ? "PROSPECTIVE_CONTROL_ONLY_NOT_BASELINE" : "PROSPECTIVE_COLLECTION"
  };
  const captureIdSeed = { season, round, capturedAt, sourceHash: sha256({ sources: base.sources, playerCount: players.length }) };
  const captureId = `pre-match-${season}-r${String(round).padStart(2, "0")}-${String(captureType).toLowerCase()}-${compactTimestamp(capturedAt)}-${sha256(captureIdSeed).slice(0, 8)}`;
  const snapshot = {
    ...base,
    captureId,
    snapshotFingerprint: null,
    integrity: {
      algorithm: "sha256",
      canonicalizationVersion: "canonical-json/v1",
      contentHash: null
    }
  };
  snapshot.snapshotFingerprint = contentHash({ ...snapshot, snapshotFingerprint: null, integrity: { ...snapshot.integrity, contentHash: null } });
  snapshot.integrity.contentHash = snapshot.snapshotFingerprint;
  return snapshot;
}

async function capturePreMatchAvailability({
  season,
  round,
  deadline = null,
  dryRun = false,
  forceInvalidCapture = false,
  sources = null,
  manualInputs = [],
  captureType = "PRIMARY",
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  repository = new PreMatchAvailabilityRepository(),
  historicalRepository = new HistoricalDataRepository(),
  now = () => new Date()
} = {}) {
  const fetchedSources = sources || await fetchLiveSources({ fetchImpl, timeoutMs });
  const capturedAt = now().toISOString();
  const snapshot = buildPreMatchAvailabilitySnapshot({
    sources: fetchedSources,
    season,
    round,
    capturedAt,
    deadline,
    manualInputs,
    captureType,
    historicalRepository
  });
  if (snapshot.temporalSafety !== SAFE_PRE_MATCH && !forceInvalidCapture) {
    throw new Error(`Captura pre-jogo invalida: ${snapshot.temporalSafety}.`);
  }
  const report = {
    dryRun,
    saved: false,
    captureId: snapshot.captureId,
    season: snapshot.season,
    round: snapshot.round,
    capturedAt: snapshot.capturedAt,
    roundDeadline: snapshot.roundDeadline,
    temporalSafety: snapshot.temporalSafety,
    captureRelationToDeadline: snapshot.captureRelationToDeadline,
    minutesBeforeDeadline: snapshot.minutesBeforeDeadline,
    snapshotFingerprint: snapshot.snapshotFingerprint,
    totalPlayers: snapshot.coverage.totalPlayers,
    coverage: snapshot.coverage
  };
  if (!dryRun) {
    repository.saveSnapshot(snapshot);
    repository.upsertControl(snapshot, snapshot.temporalSafety === SAFE_PRE_MATCH ? "PENDING_OUTCOME" : "INVALID_TEMPORAL_CAPTURE");
    report.saved = true;
  }
  return { snapshot, report };
}

function createManualPreMatchInput({
  season = 2026,
  round,
  deadline,
  inputs,
  enteredAt = new Date().toISOString(),
  enteredBy = "system",
  repository = new PreMatchAvailabilityRepository()
} = {}) {
  if (!Number.isInteger(Number(round)) || Number(round) <= 0) throw new Error("Rodada valida e obrigatoria para entrada manual.");
  const signals = (inputs || []).map((item) => canonicalManualSignal({ ...item, enteredAt, enteredBy }, deadline, enteredAt));
  const manualInputId = `manual-pre-match-${season}-r${String(round).padStart(2, "0")}-${compactTimestamp(enteredAt)}-${sha256(signals).slice(0, 8)}`;
  const record = {
    schemaVersion: "manual-pre-match-input/v1",
    manualInputId,
    season,
    round: Number(round),
    deadline: deadline || null,
    enteredAt,
    enteredBy,
    immutable: true,
    signals,
    auditTrail: [
      {
        action: "CREATE",
        at: enteredAt,
        by: enteredBy,
        fingerprint: sha256(signals)
      }
    ],
    temporalSafetySummary: {
      safe: signals.filter((item) => item.temporalSafety === SAFE_PRE_MATCH).length,
      unknown: signals.filter((item) => item.temporalSafety === UNKNOWN_TIMING).length,
      postMatchBlocked: signals.filter((item) => item.temporalSafety === POST_MATCH_BLOCKED).length
    }
  };
  repository.saveManualInput(season, Number(round), record);
  return record;
}

function confusionMetrics(rows, probabilityKey, threshold = 0.5) {
  const c = { tp: 0, tn: 0, fp: 0, fn: 0 };
  for (const row of rows) {
    const predicted = row[probabilityKey] >= threshold ? 1 : 0;
    if (predicted === 1 && row.target === 1) c.tp += 1;
    else if (predicted === 0 && row.target === 0) c.tn += 1;
    else if (predicted === 1 && row.target === 0) c.fp += 1;
    else c.fn += 1;
  }
  const total = rows.length;
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  const specificity = c.tn + c.fp ? c.tn / (c.tn + c.fp) : null;
  const f1 = precision !== null && recall !== null && precision + recall ? 2 * precision * recall / (precision + recall) : null;
  const bins = reliabilityBins(rows, probabilityKey);
  const ece = total ? bins.reduce((sum, bin) => sum + (bin.count / total) * (bin.absoluteError || 0), 0) : null;
  return {
    count: total,
    threshold,
    confusionMatrix: c,
    accuracy: total ? round((c.tp + c.tn) / total) : null,
    precision: round(precision),
    recall: round(recall),
    specificity: round(specificity),
    f1: round(f1),
    balancedAccuracy: recall !== null && specificity !== null ? round((recall + specificity) / 2) : null,
    brierScore: total ? round(rows.reduce((sum, row) => sum + (row[probabilityKey] - row.target) ** 2, 0) / total, 6) : null,
    logLoss: total ? round(rows.reduce((sum, row) => {
      const p = Math.max(0.001, Math.min(0.999, row[probabilityKey]));
      return sum - (row.target * Math.log(p) + (1 - row.target) * Math.log(1 - p));
    }, 0) / total, 6) : null,
    rocAuc: auc(rows, probabilityKey),
    prAuc: prAuc(rows, probabilityKey),
    ece: round(ece, 6)
  };
}

function auc(rows, probabilityKey) {
  const positives = rows.filter((row) => row.target === 1);
  const negatives = rows.filter((row) => row.target === 0);
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const p of positives) {
    for (const n of negatives) {
      if (p[probabilityKey] > n[probabilityKey]) wins += 1;
      else if (p[probabilityKey] === n[probabilityKey]) wins += 0.5;
    }
  }
  return round(wins / (positives.length * negatives.length));
}

function prAuc(rows, probabilityKey) {
  const sorted = [...rows].sort((a, b) => b[probabilityKey] - a[probabilityKey]);
  const positives = rows.filter((row) => row.target === 1).length;
  if (!positives) return null;
  let tp = 0;
  let fp = 0;
  let previousRecall = 0;
  let area = 0;
  for (const row of sorted) {
    if (row.target === 1) tp += 1;
    else fp += 1;
    const recall = tp / positives;
    const precision = tp / (tp + fp);
    area += (recall - previousRecall) * precision;
    previousRecall = recall;
  }
  return round(area);
}

function reliabilityBins(rows, probabilityKey, bins = 10) {
  const result = [];
  for (let i = 0; i < bins; i += 1) {
    const min = i / bins;
    const max = (i + 1) / bins;
    const bucket = rows.filter((row) => row[probabilityKey] >= min && (i === bins - 1 ? row[probabilityKey] <= max : row[probabilityKey] < max));
    const predictedMean = bucket.length ? bucket.reduce((sum, row) => sum + row[probabilityKey], 0) / bucket.length : null;
    const observedRate = bucket.length ? bucket.reduce((sum, row) => sum + row.target, 0) / bucket.length : null;
    result.push({ bin: `${round(min, 1)}-${round(max, 1)}`, count: bucket.length, absoluteError: predictedMean === null ? null : Math.abs(predictedMean - observedRate) });
  }
  return result;
}

function evaluatePreMatchAvailability({
  season = 2026,
  round,
  captureId = null,
  repository = new PreMatchAvailabilityRepository(),
  historicalRepository = new HistoricalDataRepository()
} = {}) {
  const snapshot = captureId ? repository.readSnapshot(season, round, captureId) : repository.selectEvaluationSnapshot(season, round);
  if (!snapshot) throw new Error("Snapshot pre-jogo nao encontrado para avaliacao.");
  const post = historicalRepository.readRoundFile(season, round, "post-round.json");
  if (!post) {
    const pending = {
      schemaVersion: "pre-match-availability-evaluation/v1",
      sourceDefinitionVersion: PRE_MATCH_SOURCE_VERSION,
      season,
      round,
      captureId: snapshot.captureId,
      snapshotFingerprint: snapshot.snapshotFingerprint,
      evaluatedAt: new Date().toISOString(),
      status: "PENDING_OUTCOME",
      targetRows: 0,
      reason: `Outcome real da rodada ${round} nao encontrado.`,
      metrics: null
    };
    repository.researchRepository.writeJson(season, `pre-match-availability-evaluations/round-${String(round).padStart(2, "0")}-${snapshot.captureId}.json`, pending);
    return pending;
  }
  const postById = new Map((post.players || []).map((player) => [Number(player.athleteId), player]));
  const rows = snapshot.players
    .map((player) => {
      const outcome = postById.get(Number(player.playerId));
      const played = typeof outcome?.played === "boolean" ? outcome.played : null;
      if (typeof played !== "boolean") return null;
      return {
        playerId: player.playerId,
        name: player.name,
        position: player.position?.abbreviation || player.position?.name || null,
        club: player.club?.abbreviation || player.club?.fantasyName || player.club?.name || null,
        statusRaw: player.statusRaw,
        statusNormalized: player.statusNormalized || "UNKNOWN",
        hasStatusSignal: Boolean(player.statusNormalized && player.statusNormalized !== "UNKNOWN"),
        target: played ? 1 : 0,
        probabilityV1: finite(player.frozenPredictions?.probabilityV1),
        probabilityV2: finite(player.frozenPredictions?.probabilityV2)
      };
    })
    .filter((row) => row && row.probabilityV1 !== null && row.probabilityV2 !== null);
  const artifact = {
    schemaVersion: "pre-match-availability-evaluation/v1",
    sourceDefinitionVersion: PRE_MATCH_SOURCE_VERSION,
    season,
    round,
    captureId: snapshot.captureId,
    snapshotFingerprint: snapshot.snapshotFingerprint,
    evaluatedAt: new Date().toISOString(),
    status: "EVALUATED",
    targetRows: rows.length,
    temporalPolicy: "Snapshot congelado nao e alterado; outcome posterior usado somente para avaliacao.",
    metrics: {
      availabilityV1: confusionMetrics(rows, "probabilityV1", 0.5),
      availabilityV2Threshold050: confusionMetrics(rows, "probabilityV2", 0.5),
      availabilityV2Threshold045: confusionMetrics(rows, "probabilityV2", 0.45)
    },
    segments: buildProspectiveSegments(rows),
    errors: buildProspectiveErrors(rows),
    threshold045ResearchStatus: classifyThreshold045(rows)
  };
  repository.researchRepository.writeJson(season, `pre-match-availability-evaluations/round-${String(round).padStart(2, "0")}-${snapshot.captureId}.json`, artifact);
  const registry = repository.readControls(season);
  registry.controls = registry.controls.map((control) => control.captureId === snapshot.captureId ? { ...control, status: "EVALUATED", evaluationArtifact: `pre-match-availability-evaluations/round-${String(round).padStart(2, "0")}-${snapshot.captureId}.json` } : control);
  repository.writeControls(season, registry);
  return artifact;
}

function buildCaptureStatus({
  season = 2026,
  round = null,
  deadline = null,
  currentTime = new Date().toISOString(),
  repository = new PreMatchAvailabilityRepository()
} = {}) {
  const latest = round ? repository.latestSnapshot(season, round) : repository.latestSnapshot(season);
  const currentRound = Number(round || latest?.round || null) || null;
  const roundDeadline = deadline || latest?.roundDeadline || null;
  const temporal = temporalRelation(currentTime, roundDeadline);
  const minutesToDeadline = temporal.minutesBeforeDeadline;
  const primary = currentRound ? repository.existingCaptureOfType(season, currentRound, "PRIMARY") : null;
  const final = currentRound ? repository.existingCaptureOfType(season, currentRound, "FINAL") : null;
  const latestValidCapture = final || primary || (latest?.temporalSafety === SAFE_PRE_MATCH ? latest : null);
  let captureRisk = "NONE";
  if (roundDeadline && minutesToDeadline !== null && minutesToDeadline < 0 && !latestValidCapture) captureRisk = "MISSED_CAPTURE";
  else if (roundDeadline && minutesToDeadline !== null && minutesToDeadline < 120 && minutesToDeadline >= 0 && !latestValidCapture) captureRisk = "CAPTURE_AT_RISK";
  const window = captureWindowForMinutes(minutesToDeadline);
  let nextRecommendedAction = "NO_ACTION";
  if (captureRisk === "MISSED_CAPTURE") nextRecommendedAction = "MARKET_CLOSED_WITHOUT_VALID_CAPTURE";
  else if (final) nextRecommendedAction = "CAPTURE_COMPLETE";
  else if (window === "FINAL") nextRecommendedAction = "READY_TO_CAPTURE_FINAL";
  else if (primary && window !== "FINAL") nextRecommendedAction = "WAITING_FOR_FINAL_WINDOW";
  else if (window === "PRIMARY") nextRecommendedAction = "READY_TO_CAPTURE_PRIMARY";
  else if (!latestValidCapture && captureRisk === "CAPTURE_AT_RISK") nextRecommendedAction = "CAPTURE_AT_RISK";
  return {
    schemaVersion: "pre-match-availability-capture-status/v1",
    season,
    currentRound,
    deadline: roundDeadline,
    currentTime,
    minutesToDeadline,
    captureWindow: window,
    primaryCaptureStatus: primary ? "CAPTURED" : "MISSING",
    finalCaptureStatus: final ? "CAPTURED" : "MISSING",
    latestValidCapture: latestValidCapture ? {
      captureId: latestValidCapture.captureId,
      captureType: snapshotCaptureType(latestValidCapture),
      capturedAt: latestValidCapture.capturedAt,
      fingerprint: latestValidCapture.snapshotFingerprint
    } : null,
    coverage: latestValidCapture?.coverage || null,
    captureRisk,
    nextRecommendedAction
  };
}

async function autoCapturePreMatchAvailability({
  season = 2026,
  dryRun = false,
  sources = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  repository = new PreMatchAvailabilityRepository(),
  historicalRepository = new HistoricalDataRepository(),
  now = () => new Date()
} = {}) {
  let fetchedSources;
  try {
    fetchedSources = sources || await fetchLiveSources({ fetchImpl, timeoutMs });
  } catch (error) {
    return {
      schemaVersion: "pre-match-auto-capture-result/v1",
      reasonCode: AUTO_CAPTURE_REASON_CODES.SOURCE_UNAVAILABLE,
      actionTaken: "NONE",
      error: error.message
    };
  }
  const currentTime = now().toISOString();
  const marketStatus = fetchedSources.marketStatus?.body || {};
  const matches = fetchedSources.matches?.body || {};
  const round = Number(marketStatus.rodada_atual || matches.rodada);
  if (!Number.isInteger(round) || round <= 0) {
    return { schemaVersion: "pre-match-auto-capture-result/v1", reasonCode: AUTO_CAPTURE_REASON_CODES.ROUND_NOT_READY, actionTaken: "NONE" };
  }
  const deadline = parseDeadline(marketStatus);
  const temporal = temporalRelation(currentTime, deadline);
  if (temporal.temporalSafety === POST_MATCH_BLOCKED) {
    return { schemaVersion: "pre-match-auto-capture-result/v1", reasonCode: AUTO_CAPTURE_REASON_CODES.MARKET_CLOSED, actionTaken: "NONE", round, deadline, currentTime, minutesToDeadline: temporal.minutesBeforeDeadline };
  }
  if (temporal.temporalSafety !== SAFE_PRE_MATCH) {
    return { schemaVersion: "pre-match-auto-capture-result/v1", reasonCode: AUTO_CAPTURE_REASON_CODES.TEMPORAL_VALIDATION_FAILED, actionTaken: "NONE", round, deadline, currentTime };
  }
  const captureWindow = captureWindowForMinutes(temporal.minutesBeforeDeadline);
  if (!["PRIMARY", "FINAL"].includes(captureWindow)) {
    return {
      schemaVersion: "pre-match-auto-capture-result/v1",
      reasonCode: AUTO_CAPTURE_REASON_CODES.OUTSIDE_CAPTURE_WINDOW,
      actionTaken: "NONE",
      round,
      deadline,
      currentTime,
      minutesToDeadline: temporal.minutesBeforeDeadline,
      captureWindow,
      existingCaptures: repository.listSnapshots(season, round).map((snapshot) => ({ captureId: snapshot.captureId, captureType: snapshotCaptureType(snapshot), temporalSafety: snapshot.temporalSafety }))
    };
  }
  const existing = repository.existingCaptureOfType(season, round, captureWindow);
  if (existing) {
    return {
      schemaVersion: "pre-match-auto-capture-result/v1",
      reasonCode: AUTO_CAPTURE_REASON_CODES.ALREADY_CAPTURED,
      actionTaken: "NONE",
      round,
      deadline,
      currentTime,
      minutesToDeadline: temporal.minutesBeforeDeadline,
      captureWindow,
      existingCaptureId: existing.captureId
    };
  }
  const actionThatWouldBeTaken = `CREATE_${captureWindow}_CAPTURE`;
  if (dryRun) {
    return {
      schemaVersion: "pre-match-auto-capture-result/v1",
      reasonCode: AUTO_CAPTURE_REASON_CODES.CAPTURE_CREATED,
      dryRun: true,
      actionTaken: "DRY_RUN",
      actionThatWouldBeTaken,
      round,
      deadline,
      currentTime,
      minutesToDeadline: temporal.minutesBeforeDeadline,
      captureWindow,
      existingCaptures: repository.listSnapshots(season, round).map((snapshot) => ({ captureId: snapshot.captureId, captureType: snapshotCaptureType(snapshot), temporalSafety: snapshot.temporalSafety }))
    };
  }
  const captured = await capturePreMatchAvailability({
    season,
    round,
    sources: fetchedSources,
    captureType: captureWindow,
    repository,
    historicalRepository,
    now
  });
  return {
    schemaVersion: "pre-match-auto-capture-result/v1",
    reasonCode: AUTO_CAPTURE_REASON_CODES.CAPTURE_CREATED,
    actionTaken: actionThatWouldBeTaken,
    round,
    deadline,
    currentTime,
    minutesToDeadline: temporal.minutesBeforeDeadline,
    captureWindow,
    captureId: captured.snapshot.captureId,
    fingerprint: captured.snapshot.snapshotFingerprint
  };
}

function buildProspectiveSegments(rows) {
  const segment = (items) => ({
    sampleSize: items.length,
    v2Threshold050: confusionMetrics(items, "probabilityV2", 0.5),
    v2Threshold045: confusionMetrics(items, "probabilityV2", 0.45)
  });
  const byStatusSignal = {
    WITH_STATUS_SIGNAL: segment(rows.filter((row) => row.hasStatusSignal)),
    WITHOUT_STATUS_SIGNAL: segment(rows.filter((row) => !row.hasStatusSignal))
  };
  const statuses = [...new Set(rows.map((row) => row.statusNormalized || "UNKNOWN"))].sort();
  const byStatusNormalized = Object.fromEntries(statuses.map((status) => {
    const items = rows.filter((row) => (row.statusNormalized || "UNKNOWN") === status);
    return [status, {
      sampleSize: items.length,
      didPlay: items.filter((row) => row.target === 1).length,
      didNotPlay: items.filter((row) => row.target === 0).length,
      realParticipationRate: items.length ? round(items.filter((row) => row.target === 1).length / items.length, 6) : null
    }];
  }));
  const byPosition = Object.fromEntries([...new Set(rows.map((row) => row.position || "UNKNOWN"))].sort().map((position) => [position, segment(rows.filter((row) => (row.position || "UNKNOWN") === position))]));
  return { byStatusSignal, byStatusNormalized, byPosition };
}

function errorRows(rows, threshold) {
  return rows
    .map((row) => {
      const probability = row.probabilityV2;
      const decision = probability >= threshold;
      if (decision && row.target === 0) return { ...serializeProspectiveError(row, probability, decision), errorType: "FP" };
      if (!decision && row.target === 1) return { ...serializeProspectiveError(row, probability, decision), errorType: "FN" };
      return null;
    })
    .filter(Boolean);
}

function serializeProspectiveError(row, probability, decision) {
  return {
    playerId: row.playerId,
    playerName: row.name,
    position: row.position,
    club: row.club,
    probability,
    decision,
    actualPlayed: row.target === 1,
    statusRaw: row.statusRaw,
    statusNormalized: row.statusNormalized,
    statusCoverage: row.hasStatusSignal ? "WITH_STATUS_SIGNAL" : "WITHOUT_STATUS_SIGNAL",
    availableSignals: {
      statusRaw: row.statusRaw,
      statusNormalized: row.statusNormalized
    }
  };
}

function buildProspectiveErrors(rows) {
  const threshold050Errors = errorRows(rows, 0.5);
  const threshold045Errors = errorRows(rows, 0.45);
  const fn050 = threshold050Errors.filter((row) => row.errorType === "FN");
  const fp050 = threshold050Errors.filter((row) => row.errorType === "FP");
  const fn045 = threshold045Errors.filter((row) => row.errorType === "FN");
  const fp045 = threshold045Errors.filter((row) => row.errorType === "FP");
  const recoveredFNBy045 = fn050.filter((row) => rows.find((item) => item.playerId === row.playerId)?.probabilityV2 >= 0.45).length;
  const newFPBy045 = fp045.filter((row) => !fp050.some((old) => old.playerId === row.playerId)).length;
  return {
    threshold050: { falsePositives: fp050, falseNegatives: fn050 },
    threshold045: { falsePositives: fp045, falseNegatives: fn045 },
    tradeoff: {
      recoveredFNBy045,
      newFPBy045,
      netTradeoff: recoveredFNBy045 - newFPBy045
    }
  };
}

function classifyThreshold045(rows) {
  if (rows.length < 30) return "INSUFFICIENT_SAMPLE";
  const m50 = confusionMetrics(rows, "probabilityV2", 0.5);
  const m45 = confusionMetrics(rows, "probabilityV2", 0.45);
  const errors = buildProspectiveErrors(rows).tradeoff;
  if (errors.recoveredFNBy045 > 0 && errors.newFPBy045 <= errors.recoveredFNBy045 && (m45.balancedAccuracy ?? 0) >= (m50.balancedAccuracy ?? 0)) return "PROMISING";
  if ((m45.balancedAccuracy ?? 0) < (m50.balancedAccuracy ?? 0) - 0.02 || errors.newFPBy045 > errors.recoveredFNBy045 * 2) return "WORSE";
  return "NEUTRAL";
}

function writePreMatchAvailabilityDocs(reportPath = path.resolve(__dirname, "../../docs/research/build-5.2.11-pre-match-availability-source.md"), contractPath = path.resolve(__dirname, "../../docs/research/pre-match-availability-source-v1.md")) {
  ensureDir(path.dirname(reportPath));
  const report = [
    "# Build 5.2.11 - Pre-Match Availability Source V1",
    "",
    "Cria uma fonte prospectiva, versionada e auditavel de sinais pre-jogo de disponibilidade.",
    "",
    "## Fontes integradas",
    "",
    "- Cartola FC `/mercado/status` para rodada e deadline.",
    "- Cartola FC `/atletas/mercado` para atletas, clubes, posicoes e status.",
    "- Cartola FC `/partidas` para contexto de confrontos.",
    "- Entrada manual curada opcional com audit trail e timestamp.",
    "",
    "## Fontes recusadas",
    "",
    ...NON_INTEGRATED_SOURCES.map((item) => `- ${item.sourceId}: ${item.status}; ${item.reason}`),
    "",
    "## Garantias",
    "",
    "- Snapshot imutavel por captureId.",
    "- Fingerprint SHA-256 canonico.",
    "- Validacao capturedAt < deadline.",
    "- `UNKNOWN_TIMING` e `POST_MATCH_BLOCKED` nao entram em modelo.",
    "- Threshold 0.50 preservado; 0.45 e apenas pesquisa operacional.",
    "- R19 continua fora da baseline.",
    ""
  ];
  fs.writeFileSync(reportPath, `${report.join("\n")}\n`, "utf8");
  const contract = [
    "# PRE_MATCH_AVAILABILITY_SOURCE_V1",
    "",
    "Contrato canonico para snapshots prospectivos de disponibilidade pre-jogo.",
    "",
    "Campos principais: `schemaVersion`, `sourceDefinitionVersion`, `season`, `round`, `capturedAt`, `roundDeadline`, `captureRelationToDeadline`, `sources`, `players`, `coverage`, `snapshotFingerprint`.",
    "",
    "Cada jogador preserva `statusRaw`, `statusNormalized`, flags de disponibilidade quando existirem, `sourceId`, `sourceTimestamp`, `captureTimestamp`, `temporalSafety` e `confidence`.",
    "",
    "Classes temporais: `SAFE_PRE_MATCH`, `UNKNOWN_TIMING`, `POST_MATCH_BLOCKED`.",
    ""
  ];
  fs.writeFileSync(contractPath, `${contract.join("\n")}\n`, "utf8");
  return { reportPath, contractPath };
}

module.exports = {
  AVAILABLE_NOW_SOURCES,
  AUTO_CAPTURE_REASON_CODES,
  FINAL_CAPTURE_WINDOW,
  NON_INTEGRATED_SOURCES,
  POST_MATCH_BLOCKED,
  PRE_MATCH_ENGINE_VERSION,
  PRE_MATCH_SOURCE_VERSION,
  PRE_MATCH_SNAPSHOT_SCHEMA,
  PRIMARY_CAPTURE_WINDOW,
  PreMatchAvailabilityRepository,
  SAFE_PRE_MATCH,
  UNKNOWN_TIMING,
  assertSignalTemporalSafety,
  autoCapturePreMatchAvailability,
  buildPreMatchAvailabilitySnapshot,
  buildCaptureStatus,
  capturePreMatchAvailability,
  captureWindowForMinutes,
  coverageForPlayers,
  createManualPreMatchInput,
  evaluatePreMatchAvailability,
  normalizeStatus,
  temporalRelation,
  writePreMatchAvailabilityDocs
};
