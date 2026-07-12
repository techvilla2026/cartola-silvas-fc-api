const { canonicalStringify, contentHash } = require("../integrity/canonical");

const PREDICTION_MEANINGFUL_DELTA = 0.1;

function sortedBy(items, keyFn) {
  return [...(items || [])].sort((a, b) => String(keyFn(a)).localeCompare(String(keyFn(b))));
}

function roundPrediction(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) / PREDICTION_MEANINGFUL_DELTA) * PREDICTION_MEANINGFUL_DELTA;
}

function logicalSnapshotPayload(snapshot) {
  return {
    season: snapshot.season,
    round: snapshot.round,
    marketClosingAt: snapshot.marketClosingAt,
    marketStatus: snapshot.marketStatus?.statusMercado ?? null,
    players: sortedBy(snapshot.data?.players, (player) => player.athleteId).map((player) => ({
      athleteId: player.athleteId,
      clubId: player.clubId,
      positionId: player.positionId,
      statusId: player.statusId,
      price: player.price,
      average: player.average,
      games: player.games
    })),
    matches: sortedBy(snapshot.data?.matches, (match) => match.matchId).map((match) => ({
      matchId: match.matchId,
      homeClubId: match.homeClubId,
      awayClubId: match.awayClubId,
      matchDate: match.matchDate,
      timestamp: match.timestamp,
      location: match.location,
      valid: match.valid
    })),
    motor: {
      idealTeam: sortedBy(snapshot.motor?.idealTeam?.players, (player) => player.athleteId).map((player) => player.athleteId),
      captainAthleteId: snapshot.motor?.idealTeam?.captainAthleteId || null,
      viceCaptainAthleteId: snapshot.motor?.idealTeam?.viceCaptainAthleteId || null,
      predictions: sortedBy(snapshot.motor?.predictions, (player) => player.athleteId).map((player) => ({
        athleteId: player.athleteId,
        predictedPoints: roundPrediction(player.predictedPoints),
        analysisBand: player.analysisBand || null,
        dataQualityRoundedScore: player.dataQualityRoundedScore ?? null
      })),
      central: sortedBy(snapshot.motor?.centralRecommendations, (item) => `${item.type}:${item.athleteId}`).map((item) => ({
        type: item.type,
        status: item.status,
        athleteId: item.athleteId
      }))
    }
  };
}

function logicalFingerprint(snapshot) {
  return contentHash(logicalSnapshotPayload(snapshot));
}

function indexBy(items, keyFn) {
  const index = new Map();
  for (const item of items || []) index.set(String(keyFn(item)), item);
  return index;
}

function compareSnapshots(previous, current) {
  if (!previous || !current) {
    return { hasSignificantChange: Boolean(current), reason: "NO_PREVIOUS_VALID_SNAPSHOT", changes: {} };
  }

  const changes = {
    changedPlayers: 0,
    statusChanges: 0,
    priceChanges: 0,
    predictionChanges: 0,
    idealTeamChanged: false,
    captainChanged: false,
    viceChanged: false,
    matchChanges: 0,
    closingChanged: previous.marketClosingAt !== current.marketClosingAt,
    centralChanged: false
  };

  const previousPlayers = indexBy(previous.data?.players, (player) => player.athleteId);
  const currentPlayers = indexBy(current.data?.players, (player) => player.athleteId);
  const playerIds = new Set([...previousPlayers.keys(), ...currentPlayers.keys()]);

  for (const id of playerIds) {
    const before = previousPlayers.get(id);
    const after = currentPlayers.get(id);
    if (!before || !after) {
      changes.changedPlayers += 1;
      continue;
    }
    let changed = false;
    if (before.statusId !== after.statusId) {
      changes.statusChanges += 1;
      changed = true;
    }
    if (before.price !== after.price) {
      changes.priceChanges += 1;
      changed = true;
    }
    if (before.average !== after.average || before.games !== after.games || before.clubId !== after.clubId || before.positionId !== after.positionId) {
      changed = true;
    }
    if (changed) changes.changedPlayers += 1;
  }

  const previousPredictions = indexBy(previous.motor?.predictions, (player) => player.athleteId);
  const currentPredictions = indexBy(current.motor?.predictions, (player) => player.athleteId);
  for (const [id, after] of currentPredictions.entries()) {
    const before = previousPredictions.get(id);
    if (!before) continue;
    if (Math.abs(Number(after.predictedPoints || 0) - Number(before.predictedPoints || 0)) >= PREDICTION_MEANINGFUL_DELTA) {
      changes.predictionChanges += 1;
    }
  }

  const previousMatches = logicalSnapshotPayload(previous).matches;
  const currentMatches = logicalSnapshotPayload(current).matches;
  changes.matchChanges = previousMatches.filter((match, index) => canonicalStringify(match) !== canonicalStringify(currentMatches[index])).length +
    Math.max(0, currentMatches.length - previousMatches.length);

  const previousTeam = (previous.motor?.idealTeam?.players || []).map((player) => player.athleteId).sort();
  const currentTeam = (current.motor?.idealTeam?.players || []).map((player) => player.athleteId).sort();
  changes.idealTeamChanged = canonicalStringify(previousTeam) !== canonicalStringify(currentTeam);
  changes.captainChanged = previous.motor?.idealTeam?.captainAthleteId !== current.motor?.idealTeam?.captainAthleteId;
  changes.viceChanged = previous.motor?.idealTeam?.viceCaptainAthleteId !== current.motor?.idealTeam?.viceCaptainAthleteId;
  changes.centralChanged = canonicalStringify(logicalSnapshotPayload(previous).motor.central) !== canonicalStringify(logicalSnapshotPayload(current).motor.central);

  const hasSignificantChange = Object.entries(changes).some(([key, value]) => (
    typeof value === "boolean" ? value : key !== "changedPlayers" && Number(value) > 0
  ));

  return {
    hasSignificantChange,
    reason: hasSignificantChange ? "SIGNIFICANT_CHANGE" : "NO_SIGNIFICANT_CHANGE",
    previousFingerprint: logicalFingerprint(previous),
    currentFingerprint: logicalFingerprint(current),
    changes,
    summary: hasSignificantChange ? "Mudanca relevante detectada." : "Sem mudanca relevante."
  };
}

module.exports = {
  PREDICTION_MEANINGFUL_DELTA,
  compareSnapshots,
  logicalFingerprint,
  logicalSnapshotPayload
};
