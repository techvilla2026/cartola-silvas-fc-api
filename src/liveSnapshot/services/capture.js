const crypto = require("node:crypto");
const { LIVE_SNAPSHOT_SCHEMA_VERSION } = require("../domain/constants");
const { closingDateFromMarketStatus, determineCapturePhase, isValidPreRoundSnapshot } = require("../domain/time");
const { attachIntegrity } = require("../integrity/canonical");
const { fetchLiveSources } = require("./cartolaClient");
const { buildAvailability, mapClubs, mapMatches, mapPlayers, mapPositions, mapStatuses } = require("./mapper");
const { runSnapshotMotor } = require("./motor");

function snapshotIdFrom({ season, round, capturedAt }) {
  const compact = capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = crypto.randomBytes(4).toString("hex");
  return `live-${season}-r${String(round).padStart(2, "0")}-${compact}-${random}`;
}

function sourceProvenance(source) {
  return {
    sourceEndpoint: source.endpoint,
    capturedAt: source.capturedAt,
    available: Boolean(source.body),
    httpStatus: source.status
  };
}

function sourceEndpoints(sources) {
  return {
    marketStatus: sources.marketStatus.endpoint,
    market: sources.market.endpoint,
    matches: sources.matches.endpoint
  };
}

async function captureLivePreRoundSnapshot(options) {
  const {
    season: requestedSeason,
    round: requestedRound,
    dryRun = false,
    forceInvalidCapture = false,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    repository,
    now = () => new Date()
  } = options;

  const sources = options.sources || await fetchLiveSources({ fetchImpl, timeoutMs });
  const capturedAt = now().toISOString();
  const marketStatusBody = sources.marketStatus.body;
  const marketBody = sources.market.body;
  const matchesBody = sources.matches.body;
  const season = Number(requestedSeason || marketStatusBody?.temporada || new Date(capturedAt).getUTCFullYear());
  const round = Number(requestedRound || marketStatusBody?.rodada_atual || matchesBody?.rodada);
  const closing = closingDateFromMarketStatus(marketStatusBody);
  const marketClosingAt = closing ? closing.toISOString() : null;
  const capturePhase = determineCapturePhase(capturedAt, marketClosingAt);
  const valid = isValidPreRoundSnapshot({ capturePhase, marketClosingAt });
  const players = mapPlayers(marketBody);
  const matches = mapMatches(matchesBody);
  const motorResult = runSnapshotMotor({ players, matches, isValidPreRoundSnapshot: valid });

  if (!valid && !dryRun && !forceInvalidCapture) {
    throw new Error("Snapshot temporalmente invalido; use --force-invalid-capture apenas para auditoria.");
  }

  const snapshotBase = {
    schemaVersion: LIVE_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: snapshotIdFrom({ season, round, capturedAt }),
    season,
    round,
    capturedAt,
    marketStatus: {
      statusMercado: marketStatusBody?.status_mercado ?? null,
      raw: marketStatusBody || null
    },
    marketClosingAt,
    capturePhase,
    isValidPreRoundSnapshot: valid,
    snapshotRole: options.snapshotRole || (valid ? "CHECKPOINT" : "INVALID_AUDIT_CAPTURE"),
    finalPreCloseDistanceToClosingSeconds: valid && marketClosingAt
      ? Math.floor((new Date(marketClosingAt).getTime() - new Date(capturedAt).getTime()) / 1000)
      : null,
    source: "Cartola FC public API",
    sourceEndpoints: sourceEndpoints(sources),
    engineVersions: motorResult.engineVersions,
    dataAvailability: buildAvailability({ marketStatusBody, marketBody, matchesBody, motorResult }),
    dataProvenance: {
      market: sourceProvenance(sources.market),
      matches: sourceProvenance(sources.matches),
      marketStatus: sourceProvenance(sources.marketStatus)
    },
    data: {
      players,
      clubs: mapClubs(marketBody, matchesBody),
      positions: mapPositions(marketBody),
      statuses: mapStatuses(marketBody),
      matches
    },
    motor: {
      available: motorResult.available,
      unavailableReason: motorResult.unavailableReason || null,
      predictions: motorResult.predictions || null,
      idealTeam: motorResult.idealTeam || null,
      centralRecommendations: motorResult.centralRecommendations || null,
      userLineup: motorResult.userLineup,
      comparator: motorResult.comparator
    }
  };
  const snapshot = attachIntegrity(snapshotBase);

  const report = {
    dryRun,
    saved: false,
    snapshotId: snapshot.snapshotId,
    season,
    round,
    capturedAt,
    marketClosingAt,
    capturePhase,
    isValidPreRoundSnapshot: valid,
    snapshotRole: snapshot.snapshotRole,
    contentHash: snapshot.integrity.contentHash,
    players: players.length,
    matches: matches.length
  };

  if (!dryRun) {
    repository.saveSnapshot(snapshot);
    report.saved = true;
  }

  return { snapshot, report };
}

module.exports = {
  captureLivePreRoundSnapshot,
  snapshotIdFrom
};
