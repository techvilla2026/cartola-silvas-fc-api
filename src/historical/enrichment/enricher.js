const { ENRICHED_SCHEMA_VERSION } = require("./enrichedRepository");

function playedWithPoints(player) {
  return player && player.played === true && Number.isFinite(Number(player.points));
}

function buildPostIndex(historicalRepository, season, beforeRound) {
  const historyByAthlete = new Map();

  for (let round = 1; round < beforeRound; round += 1) {
    const post = historicalRepository.readRoundFile(season, round, "post-round.json");
    if (!post) continue;

    for (const player of post.players || []) {
      if (!playedWithPoints(player)) continue;
      const key = String(player.athleteId);
      const history = historyByAthlete.get(key) || [];
      history.push({
        round,
        points: Number(player.points),
        priceVariation: Number(player.priceVariation || 0),
        scouts: player.scouts || {},
        clubId: player.clubId,
        positionId: player.positionId
      });
      historyByAthlete.set(key, history);
    }
  }

  return historyByAthlete;
}

function recentForm(history, round) {
  const ordered = [...(history || [])].filter((item) => item.round < round).sort((a, b) => b.round - a.round);
  const last3 = ordered.slice(0, 3);
  const points = last3.map((item) => item.points);
  const pointsLast1 = ordered[0]?.points ?? null;
  const variationLast1 = ordered[0]?.priceVariation ?? null;

  return {
    reconstructed: true,
    sourceRounds: last3.map((item) => item.round),
    pointsLast1BeforeRound: pointsLast1,
    pointsLast3BeforeRound: points,
    averageLast3BeforeRound: points.length ? Number((points.reduce((sum, value) => sum + value, 0) / points.length).toFixed(4)) : null,
    variationLast1BeforeRound: variationLast1,
    appearancesLast3BeforeRound: points.length,
    negativeScoresLast3BeforeRound: points.filter((value) => value < 0).length,
    scoresAbove5Last3BeforeRound: points.filter((value) => value >= 5).length
  };
}

function enrichRound({ season, round, historicalRepository }) {
  const pre = historicalRepository.readRoundFile(season, round, "pre-round.json");
  if (!pre) throw new Error(`pre-round ausente para rodada ${round}.`);

  const historyByAthlete = buildPostIndex(historicalRepository, season, round);
  let enrichedPlayers = 0;
  let insufficientRecent = 0;

  const players = (pre.players || []).map((player) => {
    const history = historyByAthlete.get(String(player.athleteId)) || [];
    const recent = recentForm(history, round);
    if (recent.appearancesLast3BeforeRound > 0) enrichedPlayers += 1;
    else insufficientRecent += 1;

    return {
      ...player,
      schemaVersion: undefined,
      statusBeforeRound: {
        statusId: null,
        statusName: null,
        probable: null,
        doubtful: null,
        suspended: null,
        injured: null,
        unavailable: null,
        marketStatusAtCapture: null,
        capturedAt: null,
        availability: "unavailable",
        classification: "unavailable"
      },
      recentFormBeforeRound: recent,
      historicalScoutsBeforeRound: {
        mode: "disabled",
        scouts: {},
        reason: "Scouts historicos permanecem desativados como oficiais por divergencias entre fontes."
      },
      missingDataPolicy: {
        statusBeforeRound: "unavailable-not-invented",
        lineupProbabilityBeforeRound: "unavailable-not-invented",
        recentFormBeforeRound: "reconstructed-from-previous-rounds-only",
        historicalScoutMode: "disabled"
      },
      fieldProvenance: {
        ...(player.fieldProvenance || {}),
        statusBeforeRound: {
          status: "unavailable",
          method: "notReconstructed",
          confidence: "none",
          allowedForBacktest: false,
          note: "Nenhuma fonte publica auditada comprovou snapshot pre-fechamento por rodada."
        },
        recentFormBeforeRound: {
          status: recent.appearancesLast3BeforeRound > 0 ? "reconstructed" : "unavailable",
          method: "previousPostRoundsOnly",
          sourceRound: recent.sourceRounds,
          sourceFile: "data/historical/2026/round-XX/post-round.json",
          confidence: recent.appearancesLast3BeforeRound > 0 ? "high" : "none",
          allowedForBacktest: true,
          note: "Usa somente rodadas anteriores a rodada avaliada."
        },
        historicalScoutsBeforeRound: {
          status: "disabled",
          method: "notUsedAsOfficial",
          confidence: "none",
          allowedForBacktest: false,
          note: "Divergencias de scouts impedem uso como scouts oficiais."
        }
      },
      enrichmentStatus: recent.appearancesLast3BeforeRound > 0 ? "ENRICHED" : "PARTIALLY_ENRICHED",
      eligibleForParityBacktest: Boolean(player.eligibleForBacktest),
      ineligibilityReasons: player.ineligibilityReasons || []
    };
  }).map((player) => {
    const copy = { ...player };
    delete copy.schemaVersion;
    return copy;
  });

  const enriched = {
    schemaVersion: ENRICHED_SCHEMA_VERSION,
    season,
    round,
    sourcePreRoundSchemaVersion: pre.schemaVersion,
    generatedAt: new Date().toISOString(),
    enrichmentStatus: "READY",
    historicalScoutMode: "disabled",
    enrichmentSources: [
      {
        name: "caRtola post-round local derivado",
        url: "https://github.com/henriquepgomide/caRtola",
        license: "MIT",
        role: "recentFormBeforeRound"
      }
    ],
    missingDataPolicy: {
      statusBeforeRound: "unavailable-not-invented",
      lineupProbabilityBeforeRound: "unavailable-not-invented",
      historicalScoutMode: "disabled"
    },
    readiness: {
      status: pre.readiness?.status || "UNKNOWN",
      totalPlayers: players.length,
      eligiblePlayers: players.filter((player) => player.eligibleForParityBacktest).length,
      enrichedPlayers,
      insufficientRecent
    },
    matches: pre.matches || [],
    players
  };

  const provenance = {
    schemaVersion: "historical-enrichment-provenance/v1",
    season,
    round,
    generatedAt: enriched.generatedAt,
    policies: enriched.missingDataPolicy,
    sources: enriched.enrichmentSources,
    fieldSummary: {
      recentFormBeforeRound: "reconstructed",
      statusBeforeRound: "unavailable",
      historicalScoutsBeforeRound: "disabled"
    }
  };

  const validation = {
    schemaVersion: "historical-enriched-validation/v1",
    season,
    round,
    validationStatus: "VALID_WITH_LIMITATIONS",
    limitations: [
      "Status pre-rodada nao recuperado com seguranca temporal.",
      "Scouts historicos nao habilitados como oficiais.",
      "Forma recente usa apenas atletas com pontuacao registrada antes da rodada."
    ],
    totals: enriched.readiness
  };

  return { enriched, provenance, validation };
}

module.exports = {
  buildPostIndex,
  enrichRound,
  recentForm
};
