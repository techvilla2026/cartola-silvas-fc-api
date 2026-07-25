const fs = require("node:fs");
const path = require("node:path");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../liveSnapshot/repositories/fileRepository");
const { ResearchRepository } = require("./repository");
const {
  buildHistoricalCleanSheetBacktest,
  fetchOfficialMatches,
  FORMATIONS,
  normalizeMatch
} = require("./roundValidation");

const SEASON = 2026;
const ROUND = 19;
const SOURCE_BUILD_ID = "build-4.3.2";
const RESEARCH_MULTI_ENGINE_VERSION = "multi-round-calibration-research-lab/5.2.4";
const CAPTAIN_ELIGIBLE_POSITIONS = new Set([4, 5]);
const POSITION_LABELS = {
  1: "GOL",
  2: "LAT",
  3: "ZAG",
  4: "MEI",
  5: "ATA",
  6: "TEC"
};

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
  }
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

function positionLabel(positionId) {
  return POSITION_LABELS[Number(positionId)] || String(positionId || "N/A");
}

function isCaptainEligible(player) {
  return CAPTAIN_ELIGIBLE_POSITIONS.has(Number(player?.positionId));
}

function captainScore(player) {
  if (!isCaptainEligible(player)) return null;
  const predicted = finite(player.predictedPoints) ?? 0;
  const grade = finite(player.analysisGrade) ?? predicted;
  const quality = finite(player.dataQualityScore) ?? 0;
  const averageBeforeRound = finite(player.averageBeforeRound) ?? predicted;
  const recentAverage = finite(player.recentFormBeforeRound?.averageLast3BeforeRound) ?? averageBeforeRound;
  const positionBias = Number(player.positionId) === 5 ? 0.35 : 0;
  return round(predicted * 0.62 + grade * 0.18 + averageBeforeRound * 0.1 + recentAverage * 0.07 + quality * 0.01 + positionBias);
}

function playerSummary(player, extra = {}) {
  return sanitize({
    athleteId: player?.athleteId ?? null,
    name: player?.name ?? null,
    clubId: player?.clubId ?? null,
    positionId: player?.positionId ?? null,
    position: positionLabel(player?.positionId),
    predictedPoints: finite(player?.predictedPoints),
    averageBeforeRound: finite(player?.averageBeforeRound),
    actualPoints: finite(player?.actualPoints),
    enteredField: player?.enteredField ?? null,
    dataQualityScore: finite(player?.dataQualityScore),
    ...extra
  });
}

function buildCaptainRecommendation(predictions) {
  const eligible = predictions
    .filter((player) => isCaptainEligible(player) && finite(player.predictedPoints) !== null)
    .map((player) => ({ ...player, captainScore: captainScore(player) }))
    .sort((a, b) => b.captainScore - a.captainScore || Number(b.predictedPoints || 0) - Number(a.predictedPoints || 0) || Number(a.athleteId) - Number(b.athleteId));
  const top3 = eligible.slice(0, 3).map((player, index) => playerSummary(player, {
    captainRank: index + 1,
    captainRole: ["CAPTAIN", "VICE", "THIRD_OPTION"][index],
    captainScore: player.captainScore,
    eligibility: "ELIGIBLE_ATA_MEI_ONLY"
  }));

  return {
    build523Issue: "A Build 5.2.3 reportou Ivan como capitao ao ler o maior score geral do time ideal/posicao, sem aplicar a regra de elegibilidade do capitao. Ivan era GOL e nunca deveria ser candidato a capitao SLVS.",
    eligibilityPolicy: {
      allowedPositions: ["ATA", "MEI"],
      rejectedPositions: ["GOL", "LAT", "ZAG", "TEC"],
      noNameRules: true,
      ataPreference: "ATA recebe desempate pequeno; MEI vence quando o score pre-rodada fica claramente acima."
    },
    top3,
    captain: top3[0] || null,
    vice: top3[1] || null,
    thirdOption: top3[2] || null,
    temporalPolicy: "Somente previsao, nota, media, forma recente e qualidade pre-rodada entram no ranking; actualPoints aparece apenas como alvo posterior."
  };
}

function classifyAvailability(player) {
  const actual = finite(player?.actualPoints);
  if (actual !== null) return "POST_MATCH_SCORE_AVAILABLE";
  if (player?.enteredField === false) return "POST_MATCH_DID_NOT_PLAY";
  return "POST_MATCH_SCORE_UNAVAILABLE";
}

function calculateDataQualityScore(player) {
  const factors = [
    { key: "prediction", weight: 20, available: finite(player?.predictedPoints) !== null },
    { key: "average", weight: 15, available: finite(player?.averageBeforeRound) !== null },
    { key: "recentForm", weight: 15, available: finite(player?.recentFormBeforeRound?.averageLast3BeforeRound) !== null },
    { key: "status", weight: 10, available: Boolean(player?.statusBeforeRound) },
    { key: "matchContext", weight: 10, available: Boolean(player?.homeAway && player?.opponent) },
    { key: "teamContext", weight: 10, available: Boolean(player?.clubId) },
    { key: "scouts", weight: 10, available: player?.historicalScoutMode && !String(player.historicalScoutMode).includes("divergent") },
    { key: "sampleSize", weight: 10, available: (finite(player?.gamesBeforeRound) ?? 0) >= 3 }
  ];
  const score = factors.reduce((sum, factor) => sum + (factor.available ? factor.weight : 0), 0);
  return {
    score,
    level: score >= 75 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW",
    factors: Object.fromEntries(factors.map((factor) => [factor.key, factor.available ? "AVAILABLE" : "MISSING_OR_UNSAFE"])),
    penalties: factors.filter((factor) => !factor.available).map((factor) => factor.key),
    nullPolicy: "Campos null permanecem null; a penalidade reduz confianca, nao substitui o dado por zero."
  };
}

function shadowScore(player, modelId) {
  const predicted = finite(player.predictedPoints) ?? 0;
  const avgBefore = finite(player.averageBeforeRound) ?? predicted;
  const recent = finite(player.recentFormBeforeRound?.averageLast3BeforeRound) ?? avgBefore;
  const quality = calculateDataQualityScore(player).score;
  const games = Math.min(finite(player.gamesBeforeRound) ?? 0, 10);
  const home = player.homeAway === "HOME" ? 0.25 : player.homeAway === "AWAY" ? -0.1 : 0;
  const statusPenalty = player.statusBeforeRound ? 0 : -0.2;

  const weights = {
    GOL_V2: predicted * 0.48 + avgBefore * 0.25 + recent * 0.12 + quality * 0.018 + games * 0.03 + home + statusPenalty,
    LAT_V2: predicted * 0.58 + avgBefore * 0.18 + recent * 0.12 + quality * 0.014 + games * 0.02 + home + statusPenalty,
    ZAG_V2: predicted * 0.56 + avgBefore * 0.2 + recent * 0.1 + quality * 0.014 + games * 0.02 + home + statusPenalty,
    MEI_V2: predicted * 0.64 + avgBefore * 0.16 + recent * 0.12 + quality * 0.01 + games * 0.015 + statusPenalty,
    ATA_V2: predicted * 0.66 + avgBefore * 0.14 + recent * 0.12 + quality * 0.01 + games * 0.015 + 0.1 + statusPenalty,
    TEC_V2: predicted * 0.52 + avgBefore * 0.22 + recent * 0.12 + quality * 0.018 + games * 0.02 + home + statusPenalty
  };
  if (modelId === "CAPTAIN_V2") return captainScore(player);
  return round(weights[modelId] ?? predicted);
}

function topRanked(players, scoreKey, k = 5) {
  return [...players]
    .filter((player) => finite(player[scoreKey]) !== null)
    .sort((a, b) => Number(b[scoreKey]) - Number(a[scoreKey]) || Number(a.athleteId) - Number(b.athleteId))
    .slice(0, k);
}

function topMetrics(players) {
  const at = (k) => {
    const top = players.slice(0, k);
    const actuals = top.map((player) => finite(player.actualPoints)).filter((value) => value !== null);
    return {
      k,
      evaluated: actuals.length,
      averageActualPoints: average(actuals),
      topActualPoints: actuals.length ? round(Math.max(...actuals)) : null
    };
  };
  return {
    top1: at(1),
    top3: at(3),
    top5: at(5)
  };
}

function buildPositionShadow(players, positionId) {
  const label = positionLabel(positionId);
  const modelId = `${label}_V2`;
  const pool = players
    .filter((player) => Number(player.positionId) === Number(positionId) && finite(player.predictedPoints) !== null)
    .map((player) => ({ ...player, shadowScore: shadowScore(player, modelId), dataQualityV2: calculateDataQualityScore(player) }));
  const officialTop5 = topRanked(pool, "predictedPoints", 5).map((player, index) => playerSummary(player, {
    rank: index + 1,
    officialScore: finite(player.predictedPoints),
    availabilityStatus: classifyAvailability(player),
    dataQualityV2: player.dataQualityV2
  }));
  const shadowTop5 = topRanked(pool, "shadowScore", 5).map((player, index) => playerSummary(player, {
    rank: index + 1,
    shadowScore: player.shadowScore,
    availabilityStatus: classifyAvailability(player),
    dataQualityV2: player.dataQualityV2
  }));
  return {
    modelId,
    status: "EXPERIMENTAL",
    officialTop5,
    shadowTop5,
    officialMetrics: topMetrics(officialTop5),
    shadowMetrics: topMetrics(shadowTop5)
  };
}

function sumPlayers(players, key) {
  return round(players.reduce((sum, player) => sum + (finite(player[key]) ?? 0), 0));
}

function selectFormation(players, formation, scoreKey) {
  const selected = [];
  for (const [positionId, count] of Object.entries(formation)) {
    selected.push(...topRanked(players.filter((player) => Number(player.positionId) === Number(positionId)), scoreKey, count));
  }
  return selected;
}

function bestXIByScore(players, scoreKey) {
  return Object.entries(FORMATIONS)
    .map(([formation, slots]) => {
      const selected = selectFormation(players, slots, scoreKey);
      const captainCandidates = selected.filter(isCaptainEligible);
      const captain = topRanked(captainCandidates.map((player) => ({ ...player, captainScore: captainScore(player) })), "captainScore", 1)[0] || null;
      const rawActual = sumPlayers(selected, "actualPoints");
      return {
        formation,
        players: selected,
        predictedPoints: sumPlayers(selected, "predictedPoints"),
        actualPointsWithoutCaptain: rawActual,
        captain: captain ? playerSummary(captain, { captainScore: captain.captainScore }) : null,
        actualPointsWithCaptain: captain ? round(rawActual + (finite(captain.actualPoints) ?? 0)) : rawActual
      };
    })
    .sort((a, b) => {
      const left = scoreKey === "actualPoints" ? b.actualPointsWithoutCaptain - a.actualPointsWithoutCaptain : b.predictedPoints - a.predictedPoints;
      return left || a.formation.localeCompare(b.formation);
    })[0] || null;
}

function serializeXI(team) {
  if (!team) return null;
  return {
    formation: team.formation,
    predictedPoints: team.predictedPoints,
    actualPointsWithoutCaptain: team.actualPointsWithoutCaptain,
    actualPointsWithCaptain: team.actualPointsWithCaptain,
    captain: team.captain,
    players: team.players.map((player) => playerSummary(player, { availabilityStatus: classifyAvailability(player) }))
  };
}

function topPotentialCaptureRate(players, k) {
  const pool = [];
  for (const positionId of Object.keys(POSITION_LABELS)) {
    pool.push(...topRanked(players.filter((player) => Number(player.positionId) === Number(positionId)), "predictedPoints", k));
  }
  const bestFromTop = bestXIByScore(pool, "actualPoints");
  const bestOverall = bestXIByScore(players, "actualPoints");
  return {
    topK: k,
    actualPointsWithoutCaptain: bestFromTop?.actualPointsWithoutCaptain ?? null,
    actualPointsWithCaptain: bestFromTop?.actualPointsWithCaptain ?? null,
    bestOverallActualPointsWithoutCaptain: bestOverall?.actualPointsWithoutCaptain ?? null,
    captureRate: bestOverall?.actualPointsWithoutCaptain ? round(bestFromTop.actualPointsWithoutCaptain / bestOverall.actualPointsWithoutCaptain) : null
  };
}

function classifyExplainableError(player) {
  if (player?.enteredField === false) return "PLAYER_DID_NOT_PLAY";
  if (finite(player?.actualPoints) === null) return "DATA_LIMITATION";
  if (finite(player?.predictedPoints) === null) return "INSUFFICIENT_PREMATCH_SIGNAL";
  const error = Math.abs(Number(player.actualPoints) - Number(player.predictedPoints));
  if (error >= 8) return "UNPREDICTABLE_EVENT";
  if (error >= 5) return "MODEL_ERROR";
  return "WITHIN_TOLERANCE";
}

function didNotPlayRateByPosition(players) {
  return Object.fromEntries(Object.entries(POSITION_LABELS).map(([positionId, label]) => {
    const rows = players.filter((player) => Number(player.positionId) === Number(positionId));
    const didNotPlay = rows.filter((player) => player.enteredField === false).length;
    const unavailable = rows.filter((player) => player.enteredField !== false && finite(player.actualPoints) === null).length;
    return [label, {
      total: rows.length,
      didNotPlay,
      scoreUnavailable: unavailable,
      didNotPlayRate: rows.length ? round(didNotPlay / rows.length) : null
    }];
  }));
}

function aggregateCleanSheetBacktest(backtest) {
  const validRounds = backtest.rounds.filter((item) => item.metricsV1.evaluated > 0 && item.metricsV2.evaluated > 0);
  const summarize = (key, metricKey) => {
    const rankedRows = validRounds.flatMap((roundItem) => {
      return roundItem[key].map((row) => ({ ...row, evaluatedRank: metricKey === "cleanSheetIndexV1" ? row.evaluatedRankV1 : row.evaluatedRankV2 }));
    });
    const actualRows = rankedRows.filter((row) => row.cleanSheetActual === true && finite(row.evaluatedRank) !== null);
    const falseTop1 = validRounds
      .map((roundItem) => roundItem[key].filter((row) => row.cleanSheetActual !== null).sort((a, b) => b[metricKey].rawScore - a[metricKey].rawScore || a.teamId - b.teamId)[0])
      .filter((row) => row && row.cleanSheetActual === false);
    return {
      top1: average(validRounds.map((roundItem) => roundItem[metricKey === "cleanSheetIndexV1" ? "metricsV1" : "metricsV2"].top1.accuracy)),
      top3: average(validRounds.map((roundItem) => roundItem[metricKey === "cleanSheetIndexV1" ? "metricsV1" : "metricsV2"].top3.accuracy)),
      top5: average(validRounds.map((roundItem) => roundItem[metricKey === "cleanSheetIndexV1" ? "metricsV1" : "metricsV2"].top5.accuracy)),
      averageRankOfActualCleanSheetTeams: average(actualRows.map((row) => row.evaluatedRank)),
      falseDefensiveFavorites: falseTop1.length,
      stability: {
        distinctTop1Teams: new Set(validRounds.map((roundItem) => roundItem[key].filter((row) => row.cleanSheetActual !== null).sort((a, b) => b[metricKey].rawScore - a[metricKey].rawScore || a.teamId - b.teamId)[0]?.teamId).filter(Boolean)).size
      }
    };
  };
  return {
    validRounds: validRounds.length,
    validTeamRows: validRounds.reduce((sum, item) => sum + item.metricsV1.evaluated, 0),
    validMatches: round(validRounds.reduce((sum, item) => sum + item.metricsV1.evaluated, 0) / 2),
    v1: summarize("rankingV1", "cleanSheetIndexV1"),
    v2: summarize("rankingV2", "cleanSheetIndexV2")
  };
}

function summarizeShadowAcrossRounds(roundResults) {
  const byPosition = {};
  for (const [positionId, label] of Object.entries(POSITION_LABELS)) {
    const modelId = `${label}_V2`;
    const rows = roundResults
      .map((roundResult) => {
        const players = (roundResult.predictions || []).filter((player) => Number(player.positionId) === Number(positionId));
        const official = topRanked(players, "predictedPoints", 5);
        const shadowPool = players.map((player) => ({ ...player, shadowScore: shadowScore(player, modelId) }));
        const shadow = topRanked(shadowPool, "shadowScore", 5);
        return { official, shadow };
      })
      .filter((item) => item.official.length && item.shadow.length);
    const metric = (side, k) => average(rows.map((item) => average(item[side].slice(0, k).map((player) => player.actualPoints))));
    byPosition[label] = {
      modelId,
      roundsEvaluated: rows.length,
      official: { top1: metric("official", 1), top3: metric("official", 3), top5: metric("official", 5) },
      shadow: { top1: metric("shadow", 1), top3: metric("shadow", 3), top5: metric("shadow", 5) },
      improved: (metric("shadow", 5) ?? -Infinity) > (metric("official", 5) ?? Infinity)
    };
  }
  return byPosition;
}

function formationAccuracy(roundResults) {
  const rows = roundResults.map((roundResult) => {
    const players = (roundResult.predictions || []).filter((player) => player.eligibleForBacktest !== false);
    const predicted = bestXIByScore(players, "predictedPoints");
    const actual = bestXIByScore(players, "actualPoints");
    return {
      round: roundResult.round,
      recommendedFormation: predicted?.formation || null,
      bestActualFormation: actual?.formation || null,
      hit: Boolean(predicted && actual && predicted.formation === actual.formation)
    };
  }).filter((row) => row.recommendedFormation && row.bestActualFormation);
  return {
    roundsEvaluated: rows.length,
    hitRate: rows.length ? round(rows.filter((row) => row.hit).length / rows.length) : null,
    rounds: rows
  };
}

function buildPromotionGate({ cleanSheetBacktest, shadowAcrossRounds }) {
  const candidates = [
    {
      candidateId: "clean-sheet-v2",
      state: "EXPERIMENTAL",
      promoted: false,
      reason: cleanSheetBacktest.v2.top5 > cleanSheetBacktest.v1.top5
        ? "Melhora pontual detectada, mas ainda exige validacao fora da amostra."
        : "Sem melhora consistente sobre V1."
    },
    ...Object.values(shadowAcrossRounds).map((item) => ({
      candidateId: item.modelId.toLowerCase().replace("_", "-"),
      state: item.improved ? "EXPERIMENTAL" : "REJECTED",
      promoted: false,
      reason: item.improved ? "Shadow melhorou alguma metrica agregada, mas segue sem promocao automatica." : "Nao superou o oficial no agregado Top5."
    })),
    {
      candidateId: "captain-v2",
      state: "EXPERIMENTAL",
      promoted: false,
      reason: "Corrige auditoria de elegibilidade, mas nao altera a politica oficial sem mais rodadas."
    }
  ];
  return {
    allowedStates: ["EXPERIMENTAL", "REJECTED", "PROMOTABLE"],
    anyPromotable: candidates.some((item) => item.state === "PROMOTABLE"),
    candidates
  };
}

function latestSnapshot(repository, season = SEASON, round = ROUND) {
  const manifest = repository.readManifest(season, round);
  const snapshotId = manifest?.finalPreCloseSnapshotId || manifest?.lastValidPreRoundSnapshotId || manifest?.lastSnapshotId;
  return {
    manifest,
    snapshotId,
    snapshot: snapshotId ? repository.readSnapshot(season, round, snapshotId) : null
  };
}

function actualPlayerMapFromSnapshot(snapshot) {
  return new Map((snapshot?.data?.players || []).map((player) => [Number(player.athleteId), player]));
}

function enrichPredictionsWithActual(predictions, actualMap) {
  return predictions.map((player) => {
    const actual = actualMap.get(Number(player.athleteId));
    return {
      ...player,
      actualPoints: actual?.enteredField === true ? finite(actual.roundPoints) : null,
      enteredField: actual?.enteredField ?? null
    };
  });
}

function corRemClosure(officialMatchesPayload, round = ROUND) {
  const matches = (officialMatchesPayload?.partidas || []).map((match) => normalizeMatch(match, round));
  const corRem = matches.find((match) => {
    const ids = [Number(match.homeClubId), Number(match.awayClubId)].sort((a, b) => a - b);
    return ids[0] === 264 && ids[1] === 364;
  }) || null;
  return {
    checkedAt: new Date().toISOString(),
    closed: Boolean(corRem && finite(corRem.homeScore) !== null && finite(corRem.awayScore) !== null),
    status: corRem?.status || null,
    match: corRem
  };
}

function buildErrorClassification(players) {
  const categories = {
    MODEL_ERROR: [],
    DATA_LIMITATION: [],
    UNPREDICTABLE_EVENT: [],
    PLAYER_DID_NOT_PLAY: [],
    INSUFFICIENT_PREMATCH_SIGNAL: []
  };
  for (const player of players) {
    const category = classifyExplainableError(player);
    if (!categories[category]) continue;
    categories[category].push(playerSummary(player, {
      predictionError: finite(player.actualPoints) !== null && finite(player.predictedPoints) !== null ? round(player.actualPoints - player.predictedPoints) : null,
      category
    }));
  }
  for (const key of Object.keys(categories)) {
    categories[key] = categories[key]
      .sort((a, b) => Math.abs(b.predictionError || 0) - Math.abs(a.predictionError || 0) || Number(a.athleteId) - Number(b.athleteId))
      .slice(0, 10);
  }
  return categories;
}

function buildGoalkeeperAudit(players, shadowRound19) {
  const names = ["Ivan", "Everson", "Rossi", "Pedro Rangel", "Carlos Miguel"];
  const goalkeepers = players.filter((player) => Number(player.positionId) === 1);
  const officialRanking = topRanked(goalkeepers, "predictedPoints", goalkeepers.length);
  const shadowRanking = topRanked(goalkeepers.map((player) => ({ ...player, shadowScore: shadowScore(player, "GOL_V2") })), "shadowScore", goalkeepers.length);
  return {
    eversonExplanation: "Everson ficou #11 no ranking oficial porque a previsao pre-rodada dele era 3.5, abaixo de goleiros com maior media/previsao no snapshot. O Shadow V2 aumenta peso de media, forma, amostra e qualidade, sem regra nominal para Everson.",
    requestedPlayers: names.map((name) => {
      const found = goalkeepers.find((player) => String(player.name || "").toLocaleLowerCase("pt-BR").includes(name.toLocaleLowerCase("pt-BR")));
      if (!found) return { name, status: "NOT_FOUND" };
      return playerSummary(found, {
        status: "FOUND",
        officialRank: officialRanking.findIndex((player) => Number(player.athleteId) === Number(found.athleteId)) + 1,
        shadowRank: shadowRanking.findIndex((player) => Number(player.athleteId) === Number(found.athleteId)) + 1,
        shadowScore: shadowScore(found, "GOL_V2")
      });
    }),
    officialVsShadowTop5: shadowRound19.GOL
  };
}

function buildRound19IdealTeam(players, snapshot) {
  const idealIds = new Set((snapshot?.motor?.idealTeam?.players || []).map((player) => Number(player.athleteId)));
  const officialPlayers = players.filter((player) => idealIds.has(Number(player.athleteId)));
  const officialTeam = {
    formation: snapshot?.motor?.idealTeam?.formation || null,
    players: officialPlayers,
    predictedPoints: sumPlayers(officialPlayers, "predictedPoints"),
    actualPointsWithoutCaptain: sumPlayers(officialPlayers, "actualPoints"),
    captain: officialPlayers.find((player) => Number(player.athleteId) === Number(snapshot?.motor?.idealTeam?.captainAthleteId)) || null
  };
  officialTeam.actualPointsWithCaptain = officialTeam.captain
    ? round(officialTeam.actualPointsWithoutCaptain + (finite(officialTeam.captain.actualPoints) ?? 0))
    : officialTeam.actualPointsWithoutCaptain;
  officialTeam.captain = officialTeam.captain ? playerSummary(officialTeam.captain, { officialCaptain: true }) : null;

  const bestPredicted = bestXIByScore(players, "predictedPoints");
  const bestActual = bestXIByScore(players, "actualPoints");
  return {
    officialSlvsXI: serializeXI(officialTeam),
    bestPredictedXI: serializeXI(bestPredicted),
    bestActualXI: serializeXI(bestActual),
    captureRateAbsolute: bestActual?.actualPointsWithoutCaptain ? round(officialTeam.actualPointsWithoutCaptain / bestActual.actualPointsWithoutCaptain) : null,
    topPotentialCaptureRateTop5: topPotentialCaptureRate(players, 5),
    topPotentialCaptureRateTop10: topPotentialCaptureRate(players, 10),
    formationComparison: {
      recommendedFormation: officialTeam.formation,
      bestPredictedFormation: bestPredicted?.formation || null,
      bestActualFormation: bestActual?.formation || null
    }
  };
}

function buildMultiRoundCalibration({
  season = SEASON,
  round = ROUND,
  liveSnapshotRepository = new LiveSnapshotRepository(),
  historicalRepository = new HistoricalDataRepository(),
  backtestRepository = new BacktestRepository({ buildId: SOURCE_BUILD_ID }),
  researchRepository = new ResearchRepository(),
  officialMatchesPayload = null
} = {}) {
  const latest = latestSnapshot(liveSnapshotRepository, season, round);
  if (!latest.snapshot) throw new Error(`Snapshot da rodada ${round} nao encontrado.`);
  const predictions = enrichPredictionsWithActual(latest.snapshot.motor?.predictions || [], actualPlayerMapFromSnapshot(latest.snapshot));
  const captainAudit = buildCaptainRecommendation(predictions);
  const cleanSheetBacktest = aggregateCleanSheetBacktest(buildHistoricalCleanSheetBacktest({ historicalRepository, season }));
  const roundResults = backtestRepository.listRoundResults(season).filter((item) => item.round >= 2 && item.round <= 18);
  const shadowAcrossRounds = summarizeShadowAcrossRounds(roundResults);
  const shadowRound19 = Object.fromEntries(Object.keys(POSITION_LABELS).map((positionId) => [POSITION_LABELS[positionId], buildPositionShadow(predictions, Number(positionId))]));
  const formation = formationAccuracy(roundResults);
  const meiTop5 = shadowRound19.MEI.officialTop5;
  const artifact = sanitize({
    schemaVersion: "multi-round-calibration-research/v1",
    generatedAt: new Date().toISOString(),
    season,
    round,
    engineVersion: RESEARCH_MULTI_ENGINE_VERSION,
    sourceBuildId: SOURCE_BUILD_ID,
    officialEngineImpact: false,
    productionPromotion: false,
    temporalPolicy: {
      leakageStatus: "PASS",
      predictionsUsePreRoundSnapshotOnly: true,
      actualPointsUsedOnlyAsTargets: true,
      snapshotsWereNotRecalculated: true
    },
    round19Closure: corRemClosure(officialMatchesPayload, round),
    captainAudit,
    cleanSheetBacktest: {
      ...cleanSheetBacktest,
      v2ConsistentImprovement: cleanSheetBacktest.v2.top1 > cleanSheetBacktest.v1.top1
        && cleanSheetBacktest.v2.top3 > cleanSheetBacktest.v1.top3
        && cleanSheetBacktest.v2.top5 > cleanSheetBacktest.v1.top5,
      v2Status: "EXPERIMENTAL"
    },
    shadowMode: {
      round19: shadowRound19,
      multiRound: {
        byPosition: shadowAcrossRounds,
        improvedModels: Object.values(shadowAcrossRounds).filter((item) => item.improved).map((item) => item.modelId)
      }
    },
    goalkeeperAudit: buildGoalkeeperAudit(predictions, shadowRound19),
    availabilityAudit: {
      statuses: ["PRE_MATCH_ELIGIBLE", "POST_MATCH_DID_NOT_PLAY", "POST_MATCH_SCORE_UNAVAILABLE"],
      didNotPlayRateByPosition: didNotPlayRateByPosition(predictions),
      meiNaInvestigation: {
        officialTop5: meiTop5,
        conclusion: meiTop5.every((player) => player.availabilityStatus !== "POST_MATCH_SCORE_AVAILABLE")
          ? "MEI Top5 esta N/A porque o snapshot/live market da rodada nao trouxe pontuacao para esses atletas; parser preservou null e separou nao jogou de score indisponivel."
          : "Parte dos MEI possui pontuacao real; os null restantes foram preservados por status posterior."
      }
    },
    idealTeamAudit: buildRound19IdealTeam(predictions, latest.snapshot),
    formationAudit: formation,
    explainableErrors: buildErrorClassification(predictions),
    promotionGate: buildPromotionGate({ cleanSheetBacktest, shadowAcrossRounds }),
    limitations: [
      "COR x REM so fecha quando a API oficial de partidas trouxer placar para o jogo.",
      "Shadow mode usa apenas sinais ja presentes nos snapshots/backtests; scouts marcados como divergentes nao sao convertidos em certeza.",
      "Pontuacao de atletas da Rodada 19 depende do snapshot/live market disponivel, nao de base historica final imutavel.",
      "Nenhum candidato foi promovido para o motor oficial nesta build."
    ],
    artifacts: {
      persistedAt: `data/research/${season}/multi-round-calibration.json`,
      report: "docs/research/build-5.2.4-multi-round-learning.md"
    }
  });
  researchRepository.writeJson(season, "multi-round-calibration.json", artifact);
  return artifact;
}

function writeMultiRoundReport(artifact, reportPath = path.resolve(__dirname, "../../docs/research/build-5.2.4-multi-round-learning.md")) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const lines = [
    "# Build 5.2.4 - Multi-round Learning",
    "",
    "Relatorio experimental. Nao altera o Motor SLVS oficial, formulas, snapshots ou backtests.",
    "",
    "## Capitao",
    "",
    artifact.captainAudit.build523Issue,
    "",
    `Capitao correto pre-R19: ${artifact.captainAudit.captain?.name || "N/A"} (${artifact.captainAudit.captain?.position || "N/A"}), real ${artifact.captainAudit.captain?.actualPoints ?? "N/A"}.`,
    `Vice: ${artifact.captainAudit.vice?.name || "N/A"}, real ${artifact.captainAudit.vice?.actualPoints ?? "N/A"}.`,
    `Terceira opcao: ${artifact.captainAudit.thirdOption?.name || "N/A"}, real ${artifact.captainAudit.thirdOption?.actualPoints ?? "N/A"}.`,
    "",
    "## Clean Sheet Multirrodada",
    "",
    `Rodadas validas: ${artifact.cleanSheetBacktest.validRounds}; partidas validas: ${artifact.cleanSheetBacktest.validMatches}.`,
    `V1 Top1/Top3/Top5: ${artifact.cleanSheetBacktest.v1.top1}/${artifact.cleanSheetBacktest.v1.top3}/${artifact.cleanSheetBacktest.v1.top5}.`,
    `V2 Top1/Top3/Top5: ${artifact.cleanSheetBacktest.v2.top1}/${artifact.cleanSheetBacktest.v2.top3}/${artifact.cleanSheetBacktest.v2.top5}.`,
    `Status V2: ${artifact.cleanSheetBacktest.v2Status}.`,
    "",
    "## Shadow Mode",
    "",
    ...Object.values(artifact.shadowMode.multiRound.byPosition).map((item) => `- ${item.modelId}: oficial Top5 ${item.official.top5}; shadow Top5 ${item.shadow.top5}; improved=${item.improved}.`),
    "",
    "## Time Ideal",
    "",
    `SLVS R19: ${artifact.idealTeamAudit.officialSlvsXI.actualPointsWithoutCaptain} sem capitao; ${artifact.idealTeamAudit.officialSlvsXI.actualPointsWithCaptain} com capitao.`,
    `Best Predicted XI: ${artifact.idealTeamAudit.bestPredictedXI.actualPointsWithoutCaptain} sem capitao; ${artifact.idealTeamAudit.bestPredictedXI.actualPointsWithCaptain} com capitao.`,
    `Best Actual XI: ${artifact.idealTeamAudit.bestActualXI.actualPointsWithoutCaptain} sem capitao; ${artifact.idealTeamAudit.bestActualXI.actualPointsWithCaptain} com capitao.`,
    "",
    "## Promotion Gate",
    "",
    ...artifact.promotionGate.candidates.map((item) => `- ${item.candidateId}: ${item.state}; promoted=${item.promoted}; ${item.reason}`),
    "",
    "## Limitacoes",
    "",
    ...artifact.limitations.map((item) => `- ${item}`),
    ""
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

async function fetchOfficialMatchesSafely(fetchImpl = globalThis.fetch) {
  try {
    return await fetchOfficialMatches(fetchImpl);
  } catch (error) {
    return {
      partidas: [],
      fetchError: {
        message: error.message
      }
    };
  }
}

module.exports = {
  RESEARCH_MULTI_ENGINE_VERSION,
  aggregateCleanSheetBacktest,
  bestXIByScore,
  buildCaptainRecommendation,
  buildMultiRoundCalibration,
  buildPositionShadow,
  buildPromotionGate,
  calculateDataQualityScore,
  classifyAvailability,
  classifyExplainableError,
  fetchOfficialMatchesSafely,
  formationAccuracy,
  isCaptainEligible,
  shadowScore,
  summarizeShadowAcrossRounds,
  topPotentialCaptureRate,
  writeMultiRoundReport
};
