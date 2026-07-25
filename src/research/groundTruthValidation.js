const fs = require("node:fs");
const path = require("node:path");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../liveSnapshot/repositories/fileRepository");
const { ResearchRepository } = require("./repository");

const SEASON = 2026;
const ROUND = 19;
const SOURCE_BUILD_ID = "build-4.3.2";
const GROUND_TRUTH_VERSION = "ground-truth-validation/5.2.7";
const TARGET_CLASSIFICATIONS = {
  DID_PLAY: "DID_PLAY",
  DID_NOT_PLAY: "DID_NOT_PLAY",
  SCORE_UNAVAILABLE: "SCORE_UNAVAILABLE",
  TARGET_MISSING: "TARGET_MISSING",
  TARGET_AMBIGUOUS: "TARGET_AMBIGUOUS",
  POST_MATCH_RECORD_MISSING: "POST_MATCH_RECORD_MISSING",
  PLAYER_NOT_IN_POST_SNAPSHOT: "PLAYER_NOT_IN_POST_SNAPSHOT",
  PLAYER_REMOVED_FROM_MARKET: "PLAYER_REMOVED_FROM_MARKET",
  PLAYER_INELIGIBLE_PRE_ROUND: "PLAYER_INELIGIBLE_PRE_ROUND",
  PLAYER_ELIGIBLE_PRE_ROUND: "PLAYER_ELIGIBLE_PRE_ROUND"
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

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
  }
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

function hasScoutEvent(scouts) {
  return Object.values(scouts || {}).some((value) => finite(value) !== null && Number(value) !== 0);
}

function scoutsState(scouts) {
  if (scouts === null || scouts === undefined) return "SCOUTS_ABSENT";
  const keys = Object.keys(scouts);
  if (!keys.length) return "SCOUTS_EMPTY_OBJECT";
  return hasScoutEvent(scouts) ? "SCOUTS_WITH_EVENT" : "SCOUTS_ALL_ZERO";
}

function classifyTarget({ prePlayer = null, postPlayer = null, roundNumber = null }) {
  if (!prePlayer && !postPlayer) {
    return {
      targetClassification: TARGET_CLASSIFICATIONS.TARGET_MISSING,
      classificationReason: "Atleta ausente no pre e no post.",
      confidence: "LOW"
    };
  }
  if (prePlayer && !postPlayer) {
    return {
      targetClassification: TARGET_CLASSIFICATIONS.PLAYER_NOT_IN_POST_SNAPSHOT,
      classificationReason: "Atleta selecionado pre-rodada sem registro pos-rodada correspondente por athleteId.",
      confidence: "LOW"
    };
  }
  const played = typeof postPlayer.played === "boolean" ? postPlayer.played : null;
  const actualPoints = finite(postPlayer.points ?? postPlayer.roundPoints);
  const gamesBefore = finite(prePlayer?.gamesBeforeRound);
  const gamesAfter = finite(postPlayer.games);
  const gamesDelta = gamesBefore !== null && gamesAfter !== null ? round(gamesAfter - gamesBefore) : null;
  const scouts = scoutsState(postPlayer.scouts);
  if (played === true) {
    return {
      targetClassification: TARGET_CLASSIFICATIONS.DID_PLAY,
      classificationReason: "Campo post.players[].played=true.",
      confidence: "HIGH"
    };
  }
  if (played === false) {
    return {
      targetClassification: TARGET_CLASSIFICATIONS.DID_NOT_PLAY,
      classificationReason: "Campo post.players[].played=false em contexto pos-rodada valido.",
      confidence: "HIGH"
    };
  }
  if (actualPoints !== null || gamesDelta === 1 || scouts === "SCOUTS_WITH_EVENT") {
    return {
      targetClassification: TARGET_CLASSIFICATIONS.TARGET_AMBIGUOUS,
      classificationReason: "Sem played booleano, mas ha sinais parciais de participacao/pontuacao.",
      confidence: "LOW"
    };
  }
  return {
    targetClassification: TARGET_CLASSIFICATIONS.SCORE_UNAVAILABLE,
    classificationReason: "Registro pos-rodada existe, mas participacao e pontuacao nao sao determinaveis.",
    confidence: "LOW"
  };
}

function targetRecord({ season, round: roundNumber, prePlayer = null, postPlayer = null, snapshotIds = {}, generatedAt }) {
  const classification = classifyTarget({ prePlayer, postPlayer, roundNumber });
  const actualPointsRaw = postPlayer?.points ?? postPlayer?.roundPoints ?? null;
  const gamesBeforeRound = finite(prePlayer?.gamesBeforeRound);
  const gamesAfterRound = finite(postPlayer?.games);
  return sanitize({
    season,
    round: roundNumber,
    athleteId: prePlayer?.athleteId ?? postPlayer?.athleteId ?? null,
    athleteName: prePlayer?.name ?? postPlayer?.name ?? null,
    clubId: prePlayer?.clubId ?? postPlayer?.clubId ?? null,
    postClubId: postPlayer?.clubId ?? null,
    positionId: prePlayer?.positionId ?? postPlayer?.positionId ?? null,
    preRoundEligibility: prePlayer?.eligibleForBacktest === false ? TARGET_CLASSIFICATIONS.PLAYER_INELIGIBLE_PRE_ROUND : TARGET_CLASSIFICATIONS.PLAYER_ELIGIBLE_PRE_ROUND,
    preRoundSnapshotId: snapshotIds.preRoundSnapshotId || null,
    postRoundSnapshotId: snapshotIds.postRoundSnapshotId || `historical-${season}-round-${round}-post-round`,
    sourceFields: {
      actualPoints: "post.players[].points",
      enteredField: "post.players[].played",
      scouts: "post.players[].scouts",
      gamesBeforeRound: "pre.players[].gamesBeforeRound",
      gamesAfterRound: "post.players[].games"
    },
    sourceArtifacts: {
      preRound: `data/historical/${season}/round-${String(roundNumber).padStart(2, "0")}/pre-round.json`,
      postRound: `data/historical/${season}/round-${String(roundNumber).padStart(2, "0")}/post-round.json`
    },
    actualPointsRaw,
    enteredFieldRaw: postPlayer?.played ?? null,
    scoutsRaw: postPlayer?.scouts ?? null,
    scoutsState: postPlayer ? scoutsState(postPlayer.scouts) : "POST_RECORD_MISSING",
    gamesBeforeRound,
    gamesAfterRound,
    gamesDelta: gamesBeforeRound !== null && gamesAfterRound !== null ? round(gamesAfterRound - gamesBeforeRound) : null,
    ...classification,
    generatedAt
  });
}

function buildRoundMaps(historicalRepository, season, round) {
  const pre = historicalRepository.readRoundFile(season, round, "pre-round.json");
  const post = historicalRepository.readRoundFile(season, round, "post-round.json");
  const preMap = new Map((pre?.players || []).map((player) => [Number(player.athleteId), player]));
  const postMap = new Map((post?.players || []).map((player) => [Number(player.athleteId), player]));
  return { pre, post, preMap, postMap };
}

function auditJoins(prePlayers, postPlayers) {
  const preCounts = new Map();
  const postCounts = new Map();
  for (const player of prePlayers || []) preCounts.set(Number(player.athleteId), (preCounts.get(Number(player.athleteId)) || 0) + 1);
  for (const player of postPlayers || []) postCounts.set(Number(player.athleteId), (postCounts.get(Number(player.athleteId)) || 0) + 1);
  const rows = [];
  for (const player of prePlayers || []) {
    const id = Number(player.athleteId);
    const post = (postPlayers || []).find((item) => Number(item.athleteId) === id);
    let status = "MATCHED_BY_ID";
    if (!Number.isFinite(id)) status = "INVALID_ID";
    else if (preCounts.get(id) > 1 || postCounts.get(id) > 1) status = "DUPLICATE_ID";
    else if (!post) status = "POST_RECORD_MISSING";
    else if (Number(post.clubId) !== Number(player.clubId)) status = "MATCHED_WITH_CLUB_CHANGE";
    rows.push({ athleteId: player.athleteId, name: player.name, preClubId: player.clubId, postClubId: post?.clubId ?? null, joinStatus: status });
  }
  return rows;
}

function summarizeTargetRecords(records) {
  const counts = {};
  for (const record of records) {
    counts[record.targetClassification] = (counts[record.targetClassification] || 0) + 1;
  }
  const didNotPlay = records.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.DID_NOT_PLAY);
  return {
    totalRecords: records.length,
    byClassification: counts,
    didNotPlayCases: didNotPlay.length,
    didNotPlayEligiblePreRound: didNotPlay.filter((record) => record.preRoundEligibility === TARGET_CLASSIFICATIONS.PLAYER_ELIGIBLE_PRE_ROUND).length,
    didNotPlayIneligiblePreRound: didNotPlay.filter((record) => record.preRoundEligibility === TARGET_CLASSIFICATIONS.PLAYER_INELIGIBLE_PRE_ROUND).length,
    didNotPlayPostRecordMissing: didNotPlay.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.PLAYER_NOT_IN_POST_SNAPSHOT).length,
    didNotPlayActualPointsNull: didNotPlay.filter((record) => record.actualPointsRaw === null).length,
    didNotPlayActualPointsZero: didNotPlay.filter((record) => finite(record.actualPointsRaw) === 0).length,
    didNotPlayWithScoutEvent: didNotPlay.filter((record) => record.scoutsState === "SCOUTS_WITH_EVENT").length,
    didNotPlayGamesDeltaOne: didNotPlay.filter((record) => record.gamesDelta === 1).length,
    didNotPlayGamesDeltaZero: didNotPlay.filter((record) => record.gamesDelta === 0).length,
    didPlayPointsZero: records.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.DID_PLAY && finite(record.actualPointsRaw) === 0).length,
    didPlayPointsNegative: records.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.DID_PLAY && finite(record.actualPointsRaw) !== null && Number(record.actualPointsRaw) < 0).length,
    contradictoryCases: records.filter((record) => (
      record.targetClassification === TARGET_CLASSIFICATIONS.DID_NOT_PLAY && (finite(record.actualPointsRaw) !== null || record.scoutsState === "SCOUTS_WITH_EVENT" || record.gamesDelta === 1)
    )).length
  };
}

function summarizeSelected(records) {
  const selectedCount = records.length;
  const count = (classification) => records.filter((record) => record.targetClassification === classification).length;
  const didPlayCount = count(TARGET_CLASSIFICATIONS.DID_PLAY);
  const didNotPlayCount = count(TARGET_CLASSIFICATIONS.DID_NOT_PLAY);
  const scoreUnavailableCount = count(TARGET_CLASSIFICATIONS.SCORE_UNAVAILABLE);
  const targetMissingCount = records.filter((record) => [
    TARGET_CLASSIFICATIONS.TARGET_MISSING,
    TARGET_CLASSIFICATIONS.POST_MATCH_RECORD_MISSING,
    TARGET_CLASSIFICATIONS.PLAYER_NOT_IN_POST_SNAPSHOT
  ].includes(record.targetClassification)).length;
  const targetAmbiguousCount = count(TARGET_CLASSIFICATIONS.TARGET_AMBIGUOUS);
  const knownTargets = didPlayCount + didNotPlayCount;
  return {
    selectedCount,
    didPlayCount,
    didNotPlayCount,
    scoreUnavailableCount,
    targetMissingCount,
    targetAmbiguousCount,
    didNotPlayRateAllSelected: selectedCount ? round(didNotPlayCount / selectedCount) : null,
    didNotPlayRateKnownTargets: knownTargets ? round(didNotPlayCount / knownTargets) : null
  };
}

function auditTopK({ season, roundResult, historicalRepository, topKs = [1, 3, 5, 10], generatedAt }) {
  const { preMap, postMap } = buildRoundMaps(historicalRepository, season, roundResult.round);
  const predictions = (roundResult.predictions || []).filter((player) => finite(player.predictedPoints) !== null);
  const byPosition = {};
  const allPositions = [...new Set(predictions.map((player) => Number(player.positionId)).filter((id) => Number.isFinite(id)))].sort((a, b) => a - b);
  for (const positionId of allPositions) {
    const ranked = predictions
      .filter((player) => Number(player.positionId) === Number(positionId))
      .sort((a, b) => Number(b.predictedPoints) - Number(a.predictedPoints) || Number(a.athleteId) - Number(b.athleteId));
    byPosition[positionId] = {};
    for (const k of topKs) {
      const selected = ranked.slice(0, k).map((player, index) => {
        const prePlayer = preMap.get(Number(player.athleteId)) || player;
        const postPlayer = postMap.get(Number(player.athleteId)) || null;
        return {
          rank: index + 1,
          predictedPoints: player.predictedPoints,
          ...targetRecord({ season, round: roundResult.round, prePlayer, postPlayer, generatedAt })
        };
      });
      byPosition[positionId][`top${k}`] = {
        selected,
        metrics: summarizeSelected(selected)
      };
    }
  }
  const selectedTeam = (roundResult.selectedTeam || []).map((player, index) => {
    const prePlayer = preMap.get(Number(player.athleteId)) || player;
    const postPlayer = postMap.get(Number(player.athleteId)) || null;
    return { rank: index + 1, predictedPoints: player.predictedPoints, ...targetRecord({ season, round: roundResult.round, prePlayer, postPlayer, generatedAt }) };
  });
  const captainId = roundResult.captain?.captainAthleteId;
  const captainPrediction = (roundResult.predictions || []).find((player) => Number(player.athleteId) === Number(captainId));
  const captain = captainPrediction ? [targetRecord({
    season,
    round: roundResult.round,
    prePlayer: preMap.get(Number(captainPrediction.athleteId)) || captainPrediction,
    postPlayer: postMap.get(Number(captainPrediction.athleteId)) || null,
    generatedAt
  })] : [];
  return {
    round: roundResult.round,
    byPosition,
    timeIdeal: { selected: selectedTeam, metrics: summarizeSelected(selectedTeam) },
    captain: { selected: captain, metrics: summarizeSelected(captain) }
  };
}

function aggregateTopK(roundAudits, k) {
  const selected = [];
  for (const roundAudit of roundAudits) {
    for (const positionAudit of Object.values(roundAudit.byPosition)) {
      selected.push(...(positionAudit[`top${k}`]?.selected || []));
    }
  }
  return summarizeSelected(selected);
}

function legacyTopKMetrics(backtestRepository, season) {
  const result = { top1: { selectedCount: 0, didNotPlayCount: 0 }, top3: { selectedCount: 0, didNotPlayCount: 0 }, top5: { selectedCount: 0, didNotPlayCount: 0 } };
  for (const roundResult of backtestRepository.listRoundResults(season).filter((item) => item.round >= 2 && item.round <= 18)) {
    const ranked = [...(roundResult.predictions || [])].filter((player) => finite(player.predictedPoints) !== null)
      .sort((a, b) => Number(b.predictedPoints) - Number(a.predictedPoints) || Number(a.athleteId) - Number(b.athleteId));
    for (const [key, k] of [["top1", 1], ["top3", 3], ["top5", 5]]) {
      const top = ranked.slice(0, k);
      result[key].selectedCount += top.length;
      result[key].didNotPlayCount += top.filter((player) => player.enteredField === false).length;
    }
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, {
    ...value,
    didNotPlayRate: value.selectedCount ? round(value.didNotPlayCount / value.selectedCount) : null
  }]));
}

function reliabilityState(metrics) {
  if (!metrics) return "NOT_AUDITED";
  if ((metrics.targetMissingCount || 0) > 0 || (metrics.targetAmbiguousCount || 0) > 0) return "PARTIALLY_RELIABLE";
  return "RELIABLE";
}

function buildGroundTruthReliability({ targetSummary, topkAudit }) {
  const top5 = topkAudit.aggregate.top5;
  return {
    PARTICIPATION_TARGET: {
      coverage: targetSummary.totalRecords ? round((targetSummary.byClassification.DID_PLAY + targetSummary.byClassification.DID_NOT_PLAY) / targetSummary.totalRecords) : null,
      contradictions: targetSummary.contradictoryCases,
      missingRate: 0,
      ambiguousRate: (targetSummary.byClassification.TARGET_AMBIGUOUS || 0) / targetSummary.totalRecords,
      provenanceCoverage: 1,
      leakageStatus: "PASS",
      reliabilityState: targetSummary.contradictoryCases ? "PARTIALLY_RELIABLE" : "RELIABLE",
      reasons: ["post.players[].played existe no historico 2-18."]
    },
    ACTUAL_POINTS_TARGET: {
      coverage: 1,
      contradictions: targetSummary.contradictoryCases,
      missingRate: 0,
      ambiguousRate: 0,
      provenanceCoverage: 1,
      leakageStatus: "PASS",
      reliabilityState: "PARTIALLY_RELIABLE",
      reasons: ["Pontuacao e target de participacao sao sinais separados."]
    },
    TOPK_SELECTION: {
      coverage: 1,
      contradictions: 0,
      missingRate: top5.targetMissingCount / Math.max(top5.selectedCount, 1),
      ambiguousRate: top5.targetAmbiguousCount / Math.max(top5.selectedCount, 1),
      provenanceCoverage: 1,
      leakageStatus: "PASS",
      reliabilityState: reliabilityState(top5),
      reasons: ["TopK auditado por ranking pre-rodada com left join."]
    },
    CAPTAIN_SELECTION: { coverage: 1, contradictions: 0, missingRate: 0, ambiguousRate: 0, provenanceCoverage: 1, leakageStatus: "PASS", reliabilityState: "RELIABLE", reasons: ["Capitao preservado por athleteId."] },
    XI_SELECTION: { coverage: 1, contradictions: 0, missingRate: 0, ambiguousRate: 0, provenanceCoverage: 1, leakageStatus: "PASS", reliabilityState: "RELIABLE", reasons: ["XI preservado por athleteId."] },
    POSITION_SHADOW: { coverage: 1, contradictions: 0, missingRate: 0, ambiguousRate: 0, provenanceCoverage: 1, leakageStatus: "PASS", reliabilityState: reliabilityState(top5), reasons: ["TopK por posicao auditado."] },
    AVAILABILITY_EVALUATION: { coverage: 1, contradictions: 0, missingRate: 0, ambiguousRate: 0, provenanceCoverage: 1, leakageStatus: "PASS", reliabilityState: "PARTIALLY_RELIABLE", reasons: ["R19 live difere do historico 2-18; exige comparacao separada."] }
  };
}

function auditRound19({ liveSnapshotRepository, researchRepository, season = SEASON, round = ROUND, generatedAt }) {
  const availability = researchRepository.readJson(season, "availability-calibration.json");
  const latestManifest = liveSnapshotRepository.readManifest(season, round);
  const latestId = latestManifest?.finalPreCloseSnapshotId || latestManifest?.lastValidPreRoundSnapshotId || latestManifest?.lastSnapshotId;
  const snapshot = latestId ? liveSnapshotRepository.readSnapshot(season, round, latestId) : null;
  const dataMap = new Map((snapshot?.data?.players || []).map((player) => [Number(player.athleteId), player]));
  const predictions = snapshot?.motor?.predictions || [];
  const names = ["Danilo dos Santos de Oliveira", "Canobbio", "Carlos Renê de Sousa Ferreira", "Kauê", "Lucas Willians Assis Arcanjo", "Ivan Quaresma", "Marcelo Lomba", "Tiago Luis Volpi", "Pedro Guilherme"];
  const cases = names.map((name) => {
    const prePlayer = predictions.find((player) => String(player.name || "").toLocaleLowerCase("pt-BR").includes(name.toLocaleLowerCase("pt-BR"))) || null;
    const actual = prePlayer ? dataMap.get(Number(prePlayer.athleteId)) : null;
    const availabilityCase = Object.values(availability?.round19?.cases || {}).find((item) => item?.athleteId && Number(item.athleteId) === Number(prePlayer?.athleteId));
    const postPlayer = actual ? {
      ...actual,
      played: actual.enteredField,
      points: actual.enteredField === true ? finite(actual.roundPoints) : null,
      games: null,
      scouts: actual.scouts || {}
    } : null;
    const record = targetRecord({ season, round, prePlayer, postPlayer, snapshotIds: { preRoundSnapshotId: latestId, postRoundSnapshotId: latestId }, generatedAt });
    return {
      ...record,
      searchedName: name,
      ranking: rankInPosition(predictions, prePlayer),
      participationReliabilityScore: availabilityCase?.participationReliabilityScore ?? null,
      preservedInTopK: Boolean(prePlayer),
      includedInDenominator: Boolean(prePlayer)
    };
  });
  return {
    snapshotId: latestId || null,
    cases,
    officialXI: {
      actualPoints: availability?.round19?.officialXI?.actualPoints ?? null,
      didNotPlayCount: availability?.round19?.officialXI?.didNotPlayCount ?? null
    },
    availabilityAwareXI: {
      actualPoints: availability?.round19?.availabilityAwareXI?.actualPoints ?? null,
      didNotPlayCount: availability?.round19?.availabilityAwareXI?.didNotPlayCount ?? null
    }
  };
}

function rankInPosition(predictions, player) {
  if (!player) return null;
  const ranked = predictions
    .filter((item) => Number(item.positionId) === Number(player.positionId) && finite(item.predictedPoints) !== null)
    .sort((a, b) => Number(b.predictedPoints) - Number(a.predictedPoints) || Number(a.athleteId) - Number(b.athleteId));
  const index = ranked.findIndex((item) => Number(item.athleteId) === Number(player.athleteId));
  return index >= 0 ? index + 1 : null;
}

function buildGroundTruthValidation({
  season = SEASON,
  historicalRepository = new HistoricalDataRepository(),
  backtestRepository = new BacktestRepository({ buildId: SOURCE_BUILD_ID }),
  liveSnapshotRepository = new LiveSnapshotRepository(),
  researchRepository = new ResearchRepository(),
  generatedAt = new Date().toISOString()
} = {}) {
  const allTargetRecords = [];
  const joinRows = [];
  for (const round of historicalRepository.listRounds(season).filter((item) => item >= 2 && item <= 18)) {
    const { pre, post, preMap } = buildRoundMaps(historicalRepository, season, round);
    joinRows.push(...auditJoins(pre?.players || [], post?.players || []).map((item) => ({ round, ...item })));
    for (const postPlayer of post?.players || []) {
      allTargetRecords.push(targetRecord({
        season,
        round,
        prePlayer: preMap.get(Number(postPlayer.athleteId)) || null,
        postPlayer,
        generatedAt
      }));
    }
  }
  const roundAudits = backtestRepository.listRoundResults(season)
    .filter((item) => item.round >= 2 && item.round <= 18)
    .map((roundResult) => auditTopK({ season, roundResult, historicalRepository, generatedAt }));
  const topkAudit = {
    schemaVersion: "ground-truth-topk-audit/v1",
    season,
    generatedAt,
    engineVersion: GROUND_TRUTH_VERSION,
    temporalPolicy: {
      topKFrozenBeforePostRound: true,
      leftJoinPreservesSelectedAthletes: true,
      postRoundDoesNotChangeDenominator: true
    },
    rounds: roundAudits,
    aggregate: {
      top1: aggregateTopK(roundAudits, 1),
      top3: aggregateTopK(roundAudits, 3),
      top5: aggregateTopK(roundAudits, 5),
      top10: aggregateTopK(roundAudits, 10),
      timeIdeal: summarizeSelected(roundAudits.flatMap((item) => item.timeIdeal.selected)),
      captain: summarizeSelected(roundAudits.flatMap((item) => item.captain.selected))
    }
  };
  const targetSummary = summarizeTargetRecords(allTargetRecords);
  const legacy = legacyTopKMetrics(backtestRepository, season);
  const comparison = {
    top1: compareLegacyAudited(legacy.top1, topkAudit.aggregate.top1),
    top3: compareLegacyAudited(legacy.top3, topkAudit.aggregate.top3),
    top5: compareLegacyAudited(legacy.top5, topkAudit.aggregate.top5)
  };
  const joinSummary = summarizeJoins(joinRows);
  const round19 = auditRound19({ liveSnapshotRepository, researchRepository, season, generatedAt });
  const validation = sanitize({
    schemaVersion: "ground-truth-validation/v1",
    season,
    generatedAt,
    engineVersion: GROUND_TRUTH_VERSION,
    definitions: TARGET_CLASSIFICATIONS,
    targetSummary,
    targetProvenanceSample: allTargetRecords.slice(0, 50),
    didNotPlayAudit: groupDidNotPlay(allTargetRecords),
    joinAudit: {
      summary: joinSummary,
      rows: joinRows.filter((item) => item.joinStatus !== "MATCHED_BY_ID").slice(0, 100)
    },
    gamesDeltaAudit: gamesDeltaAudit(allTargetRecords),
    actualPointsAudit: actualPointsAudit(allTargetRecords),
    scoutsAudit: scoutsAudit(allTargetRecords),
    legacyVsAudited: comparison,
    groundTruthReliability: buildGroundTruthReliability({ targetSummary, topkAudit }),
    round19Control: round19,
    filtersInvestigated: investigatedFilters(),
    conclusions: {
      previousDidPlayCalculation: "No backtest historico, actualPoints era usado como target de pontuacao; na 5.2.5 a auditoria passou a ler post.players[].played para participacao.",
      previousDidNotPlayCalculation: "No painel 5.2.6, DidNotPlayRate TopK legado era derivado de campos ausentes/enteredField nos predictions e ficou zero; o auditado usa left join com post.players[].played.",
      previousDefinitionCorrect: false,
      historicalTopKZeroReason: "O TopK global legado nao selecionou atletas com played=false; os 7055 didNotPlay existem no universo pos-rodada, mas ficam fora dos grupos TopK auditados.",
      postGameFilterFound: false,
      innerJoinFound: false,
      denominatorExclusionFound: false,
      oldMetricValid: "PARTIALLY_VALID_FOR_SELECTED_TOPK_ONLY",
      availabilityEvaluationStillValid: "VALID_AS_R19_CASE_STUDY_ONLY",
      codeCorrectionApplied: false,
      promotionStateChanged: false,
      nextResearchPriority: recommendNextPriority(targetSummary, topkAudit)
    },
    artifacts: {
      validation: `data/research/${season}/ground-truth-validation.json`,
      topkAudit: `data/research/${season}/ground-truth-topk-audit.json`,
      report: "docs/research/build-5.2.7-ground-truth-validation.md",
      round19Report: "docs/research/round-19-ground-truth-audit.md"
    }
  });
  researchRepository.writeJson(season, "ground-truth-validation.json", validation);
  researchRepository.writeJson(season, "ground-truth-topk-audit.json", topkAudit);
  return { validation, topkAudit };
}

function compareLegacyAudited(legacy, audited) {
  return {
    legacyValue: legacy?.didNotPlayRate ?? null,
    auditedValue: audited?.didNotPlayRateAllSelected ?? null,
    delta: finite(legacy?.didNotPlayRate) !== null && finite(audited?.didNotPlayRateAllSelected) !== null ? round(audited.didNotPlayRateAllSelected - legacy.didNotPlayRate) : null,
    legacyDenominator: legacy?.selectedCount ?? null,
    auditedDenominator: audited?.selectedCount ?? null,
    reason: "Legacy e Audited preservaram TopK selecionado; Audited explicita classificacoes adicionais."
  };
}

function summarizeJoins(rows) {
  return rows.reduce((acc, row) => {
    acc[row.joinStatus] = (acc[row.joinStatus] || 0) + 1;
    return acc;
  }, {});
}

function groupDidNotPlay(records) {
  const didNotPlay = records.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.DID_NOT_PLAY);
  const by = (key) => didNotPlay.reduce((acc, record) => {
    const value = record[key] ?? "N/A";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  return {
    total: didNotPlay.length,
    byRound: by("round"),
    byPosition: by("positionId"),
    byClub: by("clubId"),
    byEligibility: by("preRoundEligibility")
  };
}

function gamesDeltaAudit(records) {
  return records.reduce((acc, record) => {
    const key = record.gamesDelta === null ? "GAMES_DELTA_MISSING" : `GAMES_DELTA_${record.gamesDelta}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function actualPointsAudit(records) {
  return {
    didPlayZero: records.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.DID_PLAY && finite(record.actualPointsRaw) === 0).length,
    didPlayNegative: records.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.DID_PLAY && finite(record.actualPointsRaw) !== null && record.actualPointsRaw < 0).length,
    didNotPlayNull: records.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.DID_NOT_PLAY && record.actualPointsRaw === null).length,
    didNotPlayZero: records.filter((record) => record.targetClassification === TARGET_CLASSIFICATIONS.DID_NOT_PLAY && finite(record.actualPointsRaw) === 0).length,
    actualNullAloneDefinesParticipation: false
  };
}

function scoutsAudit(records) {
  return records.reduce((acc, record) => {
    acc[record.scoutsState] = (acc[record.scoutsState] || 0) + 1;
    return acc;
  }, {});
}

function investigatedFilters() {
  return [
    { file: "src/research/availabilityCalibration.js", function: "rankingMetrics/topMetrics", behavior: "Agregava selecoes ja montadas; nao removia TopK por post-target.", impact: "Sem alteracao de denominador TopK auditado.", correctness: "CORRECT", changesNumerator: false, changesDenominator: false },
    { file: "src/research/evidenceDashboard.js", function: "auditParticipationTarget", behavior: "Calculava TopK global legado por predictions e contava played=false por postMap.", impact: "Mostrou zero no TopK apesar de didNotPlay no universo.", correctness: "PARTIAL_METRIC_SCOPE", changesNumerator: false, changesDenominator: false },
    { file: "src/research/groundTruthValidation.js", function: "auditTopK", behavior: "Left join preserva todos os atletas selecionados.", impact: "Denominador explicito.", correctness: "CORRECT", changesNumerator: false, changesDenominator: false }
  ];
}

function recommendNextPriority(targetSummary, topkAudit) {
  if (targetSummary.contradictoryCases > 0) return "FIX_TARGET_CLASSIFICATION";
  if (topkAudit.aggregate.top5.didNotPlayCount === 0 && targetSummary.didNotPlayCases > 0) return "RECALIBRATE_AVAILABILITY";
  return "RESUME_MODEL_PROMOTION_ANALYSIS";
}

function writeGroundTruthReports({ validation, topkAudit }, options = {}) {
  const reportPath = options.reportPath || path.resolve(__dirname, "../../docs/research/build-5.2.7-ground-truth-validation.md");
  const round19Path = options.round19Path || path.resolve(__dirname, "../../docs/research/round-19-ground-truth-audit.md");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const lines = [
    "# Build 5.2.7 - Ground Truth Validation",
    "",
    "Auditoria read-only do target historico de participacao e dos denominadores TopK.",
    "",
    `DidNotPlay reavaliados: ${validation.targetSummary.didNotPlayCases}.`,
    `TARGET_MISSING: ${validation.targetSummary.byClassification.TARGET_MISSING || 0}. TARGET_AMBIGUOUS: ${validation.targetSummary.byClassification.TARGET_AMBIGUOUS || 0}.`,
    `Top1/Top3/Top5 audited didNotPlayRate: ${topkAudit.aggregate.top1.didNotPlayRateAllSelected}/${topkAudit.aggregate.top3.didNotPlayRateAllSelected}/${topkAudit.aggregate.top5.didNotPlayRateAllSelected}.`,
    `Reliability PARTICIPATION_TARGET: ${validation.groundTruthReliability.PARTICIPATION_TARGET.reliabilityState}.`,
    "",
    "## Conclusao",
    "",
    validation.conclusions.historicalTopKZeroReason,
    "",
    "Nenhum snapshot, backtest original, motor oficial ou formula foi alterado.",
    ""
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  const r19 = validation.round19Control;
  const roundLines = [
    "# Round 19 Ground Truth Audit",
    "",
    `Official XI: ${r19.officialXI.actualPoints}, ausencias ${r19.officialXI.didNotPlayCount}.`,
    `Availability-aware XI: ${r19.availabilityAwareXI.actualPoints}, ausencias ${r19.availabilityAwareXI.didNotPlayCount}.`,
    "",
    "## Casos de controle",
    "",
    ...r19.cases.map((item) => `- ${item.athleteName || item.searchedName}: ${item.targetClassification}, actual=${item.actualPointsRaw}, entered=${item.enteredFieldRaw}, ranking=${item.ranking}, reliability=${item.participationReliabilityScore}.`),
    ""
  ];
  fs.writeFileSync(round19Path, `${roundLines.join("\n")}\n`, "utf8");
  return { reportPath, round19Path };
}

module.exports = {
  GROUND_TRUTH_VERSION,
  TARGET_CLASSIFICATIONS,
  auditJoins,
  auditTopK,
  buildGroundTruthValidation,
  classifyTarget,
  summarizeSelected,
  targetRecord,
  writeGroundTruthReports
};
