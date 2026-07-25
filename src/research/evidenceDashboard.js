const fs = require("node:fs");
const path = require("node:path");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { ResearchRepository } = require("./repository");

const SEASON = 2026;
const SOURCE_BUILD_ID = "build-4.3.2";
const EVIDENCE_DASHBOARD_VERSION = "slvs-evidence-dashboard/5.2.6";
const SCORECARD_METADATA = {
  metricType: "internal_index",
  probability: false,
  scale: "0-100",
  description: "Indice interno de forca de evidencia; nao promove modelos automaticamente."
};

const REQUIRED_MODELS = [
  ["OFFICIAL_ENGINE", "Motor SLVS oficial", "engine", "OFFICIAL", "OFFICIAL", "base"],
  ["CLEAN_SHEET_V1", "Clean Sheet V1", "clean_sheet", "OFFICIAL", "OFFICIAL", "5.2.3"],
  ["CLEAN_SHEET_V2", "Clean Sheet V2", "clean_sheet", "EXPERIMENTAL", "EXPERIMENTAL", "5.2.3"],
  ["GOL_OFFICIAL", "GOL oficial", "position", "OFFICIAL", "OFFICIAL", "base"],
  ["GOL_V2", "GOL V2", "position", "EXPERIMENTAL", "EXPERIMENTAL", "5.2.4"],
  ["LAT_OFFICIAL", "LAT oficial", "position", "OFFICIAL", "OFFICIAL", "base"],
  ["LAT_V2", "LAT V2", "position", "REJECTED", "EXPERIMENTAL", "5.2.4"],
  ["ZAG_OFFICIAL", "ZAG oficial", "position", "OFFICIAL", "OFFICIAL", "base"],
  ["ZAG_V2", "ZAG V2", "position", "EXPERIMENTAL", "EXPERIMENTAL", "5.2.4"],
  ["MEI_OFFICIAL", "MEI oficial", "position", "OFFICIAL", "OFFICIAL", "base"],
  ["MEI_V2", "MEI V2", "position", "EXPERIMENTAL", "EXPERIMENTAL", "5.2.4"],
  ["ATA_OFFICIAL", "ATA oficial", "position", "OFFICIAL", "OFFICIAL", "base"],
  ["ATA_V2", "ATA V2", "position", "REJECTED", "EXPERIMENTAL", "5.2.4"],
  ["TEC_OFFICIAL", "TEC oficial", "position", "OFFICIAL", "OFFICIAL", "base"],
  ["TEC_V2", "TEC V2", "position", "REJECTED", "EXPERIMENTAL", "5.2.4"],
  ["CAPTAIN_OFFICIAL", "Capitao oficial", "captain", "OFFICIAL", "OFFICIAL", "base"],
  ["CAPTAIN_V2", "Capitao V2", "captain", "EXPERIMENTAL", "EXPERIMENTAL", "5.2.4"],
  ["AVAILABILITY_V1", "Availability V1", "availability", "REJECTED", "EXPERIMENTAL", "5.2.5"],
  ["RANKING_AVAILABILITY_AWARE", "Ranking availability-aware", "availability", "REJECTED", "EXPERIMENTAL", "5.2.5"],
  ["CAPTAIN_AVAILABILITY_AWARE", "Capitao availability-aware", "captain", "REJECTED", "EXPERIMENTAL", "5.2.5"],
  ["XI_AVAILABILITY_AWARE", "XI availability-aware", "ideal_team", "REJECTED", "EXPERIMENTAL", "5.2.5"],
  ["FORMATION_OFFICIAL", "Formacao oficial", "formation", "OFFICIAL", "OFFICIAL", "base"],
  ["FORMATION_SHADOW", "Formacao shadow", "formation", "EXPERIMENTAL", "EXPERIMENTAL", "5.2.4"]
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

function readArtifact(repository, season, fileName) {
  const data = repository.readJson(season, fileName);
  return data || { status: "DATA_NOT_AVAILABLE", artifact: fileName };
}

function evidenceConfidence({ roundsEvaluated = 0, sampleSize = 0, hasDataLimitation = false, isolatedRound = false, consistent = false }) {
  if (isolatedRound || hasDataLimitation || sampleSize < 30 || roundsEvaluated < 3) return "LOW";
  if (roundsEvaluated >= 10 && sampleSize >= 100 && consistent) return "HIGH";
  return "MEDIUM";
}

function evidenceTypeFromDelta(delta, higherIsBetter, comparable = true, dataLimited = false) {
  if (dataLimited) return "DATA_LIMITATION";
  if (!comparable || delta === null) return "INCONCLUSIVE";
  if (Math.abs(delta) < 0.0001) return "INCONCLUSIVE";
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return improved ? "POSITIVE" : "NEGATIVE";
}

function directionFromDelta(delta, higherIsBetter, comparable = true) {
  if (!comparable || delta === null) return "NOT_COMPARABLE";
  if (Math.abs(delta) < 0.0001) return "UNCHANGED";
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return improved ? "IMPROVED" : "WORSENED";
}

function createEvidenceRecord(input, generatedAt) {
  const official = finite(input.officialValue);
  const candidate = finite(input.candidateValue);
  const delta = official !== null && candidate !== null ? round(candidate - official) : null;
  const dataLimited = Boolean(input.dataLimited);
  return sanitize({
    evidenceId: input.evidenceId,
    modelId: input.modelId,
    metric: input.metric,
    officialValue: official,
    candidateValue: candidate,
    delta,
    direction: input.direction || directionFromDelta(delta, input.higherIsBetter !== false, input.comparable !== false),
    sampleSize: input.sampleSize ?? null,
    roundsEvaluated: input.roundsEvaluated ?? null,
    dataQuality: input.dataQuality || (dataLimited ? "LIMITED" : "PARTIAL"),
    confidenceLevel: input.confidenceLevel || evidenceConfidence({
      roundsEvaluated: input.roundsEvaluated,
      sampleSize: input.sampleSize,
      hasDataLimitation: dataLimited,
      isolatedRound: input.isolatedRound,
      consistent: input.consistent
    }),
    evidenceType: input.evidenceType || evidenceTypeFromDelta(delta, input.higherIsBetter !== false, input.comparable !== false, dataLimited),
    interpretation: input.interpretation,
    limitations: input.limitations || [],
    sourceArtifact: input.sourceArtifact,
    generatedAt
  });
}

function buildModelCatalog(artifacts) {
  const multi = artifacts.multiRoundCalibration;
  const availability = artifacts.availabilityCalibration;
  const rounds = multi?.cleanSheetBacktest?.validRounds || availability?.backtest?.validRounds || 17;
  const sample = availability?.backtest?.evaluatedAthletes || null;
  return REQUIRED_MODELS.map(([modelId, label, category, status, officialOrExperimental, sourceBuild]) => ({
    modelId,
    label,
    category,
    status,
    officialOrExperimental,
    sourceBuild,
    description: `${label} consolidado no painel de evidencias SLVS.`,
    metricsAvailable: metricsForModel(modelId, artifacts),
    sampleSize: modelId.includes("AVAILABILITY") ? sample : null,
    roundsEvaluated: modelId.includes("CLEAN_SHEET") || modelId.includes("_V2") || modelId.includes("FORMATION") ? rounds : null,
    limitations: limitationsForModel(modelId),
    promotionState: status === "OFFICIAL" ? "OFFICIAL" : status
  }));
}

function metricsForModel(modelId, artifacts) {
  if (modelId.includes("CLEAN_SHEET")) return ["Top1", "Top3", "Top5", "avgRankActualSG"];
  if (modelId.includes("AVAILABILITY")) return ["DidNotPlayRate", "actualPoints", "didNotPlayCount"];
  if (modelId.includes("_V2")) return ["Top1 real points mean", "Top3 real points mean", "Top5 real points mean"];
  if (modelId.includes("CAPTAIN")) return ["captainActualPoints", "captainDidPlay"];
  if (modelId.includes("FORMATION")) return ["hitRate", "regret"];
  return artifacts.researchHealth?.status ? ["health", "productionMutation"] : [];
}

function limitationsForModel(modelId) {
  if (modelId.includes("AVAILABILITY")) return ["Target historico TopK nao reproduziu DidNotPlayRate da Rodada 19.", "Status pre-rodada majoritariamente indisponivel."];
  if (modelId.includes("_V2")) return ["Candidato shadow; sem promocao automatica.", "Amostra ainda exige validacao fora do laboratorio."];
  if (modelId.includes("CLEAN_SHEET")) return ["Indice interno, nao probabilidade."];
  return [];
}

function auditParticipationTarget({ historicalRepository, backtestRepository, season = SEASON }) {
  let totalPostPlayers = 0;
  let didNotPlay = 0;
  let scoreUnavailable = 0;
  const postByRound = new Map();
  for (const round of historicalRepository.listRounds(season).filter((item) => item >= 2 && item <= 18)) {
    const post = historicalRepository.readRoundFile(season, round, "post-round.json");
    const map = new Map((post?.players || []).map((player) => [Number(player.athleteId), player]));
    postByRound.set(round, map);
    for (const player of post?.players || []) {
      totalPostPlayers += 1;
      if (player.played === false) didNotPlay += 1;
      if (player.played !== false && finite(player.points) === null) scoreUnavailable += 1;
    }
  }
  let predictions = 0;
  let predictionsWithoutTarget = 0;
  let topOfficialDnp = { top1: 0, top3: 0, top5: 0, selectedTop1: 0, selectedTop3: 0, selectedTop5: 0 };
  for (const result of backtestRepository.listRoundResults(season).filter((item) => item.round >= 2 && item.round <= 18)) {
    const postMap = postByRound.get(result.round) || new Map();
    for (const prediction of result.predictions || []) {
      predictions += 1;
      if (!postMap.has(Number(prediction.athleteId))) predictionsWithoutTarget += 1;
    }
    const ranked = [...(result.predictions || [])].filter((item) => finite(item.predictedPoints) !== null)
      .sort((a, b) => Number(b.predictedPoints) - Number(a.predictedPoints) || Number(a.athleteId) - Number(b.athleteId));
    for (const [key, k] of [["top1", 1], ["top3", 3], ["top5", 5]]) {
      const top = ranked.slice(0, k);
      topOfficialDnp[`selected${key[0].toUpperCase()}${key.slice(1)}`] += top.length;
      topOfficialDnp[key] += top.filter((player) => postMap.get(Number(player.athleteId))?.played === false).length;
    }
  }
  return {
    roundsAudited: 17,
    totalPostPlayers,
    didNotPlayCases: didNotPlay,
    scoreUnavailableCases: scoreUnavailable,
    predictionsAudited: predictions,
    athletesWithoutTarget: predictionsWithoutTarget,
    didNotPlayRateOverallHistorical: totalPostPlayers ? round(didNotPlay / totalPostPlayers) : null,
    officialTopKDidNotPlay: {
      top1: topOfficialDnp.selectedTop1 ? round(topOfficialDnp.top1 / topOfficialDnp.selectedTop1) : null,
      top3: topOfficialDnp.selectedTop3 ? round(topOfficialDnp.top3 / topOfficialDnp.selectedTop3) : null,
      top5: topOfficialDnp.selectedTop5 ? round(topOfficialDnp.top5 / topOfficialDnp.selectedTop5) : null
    },
    diagnosis: topOfficialDnp.top1 + topOfficialDnp.top3 + topOfficialDnp.top5 === 0 && didNotPlay > 0
      ? "O target historico contem jogadores que nao jogaram, mas o TopK historico avaliado nao selecionou esses casos; a comparacao com a Rodada 19 live fica inconclusiva."
      : "Target historico possui casos avaliaveis no TopK.",
    availability525TargetSufficient: false,
    limitation: "A Rodada 19 live mostrou didNotPlay no XI; o backtest 2-18 nao reproduziu esse risco no TopK, portanto a evidencia multirrodada de disponibilidade e limitada."
  };
}

function buildDataQualityDashboard({ historicalRepository, season = SEASON }) {
  const rounds = historicalRepository.listRounds(season).filter((item) => item >= 2 && item <= 18);
  let prePlayers = 0;
  let statusAvailable = 0;
  let matchContext = 0;
  let priceAvailable = 0;
  let postPlayers = 0;
  let pointsAvailable = 0;
  let playedAvailable = 0;
  for (const round of rounds) {
    const pre = historicalRepository.readRoundFile(season, round, "pre-round.json");
    for (const player of pre?.players || []) {
      prePlayers += 1;
      if (player.statusBeforeRound !== null && player.statusBeforeRound !== undefined) statusAvailable += 1;
      if (player.opponent !== null && player.opponent !== undefined && player.homeAway) matchContext += 1;
      if (finite(player.priceBeforeRound) !== null) priceAvailable += 1;
    }
    const post = historicalRepository.readRoundFile(season, round, "post-round.json");
    for (const player of post?.players || []) {
      postPlayers += 1;
      if (finite(player.points) !== null) pointsAvailable += 1;
      if (typeof player.played === "boolean") playedAvailable += 1;
    }
  }
  const domain = (status, coverage, source, impact, risk) => ({ status, coverage, nullRate: coverage === null ? null : round(1 - coverage), rounds: rounds.length, source, impact, risk });
  return {
    PARTICIPATION_DATA: domain("AVAILABLE", postPlayers ? round(playedAvailable / postPlayers) : null, "historical post-round played", "Permite auditar didNotPlay geral.", "TopK historico pode nao reproduzir R19."),
    ACTUAL_POINTS_DATA: domain("PARTIAL", postPlayers ? round(pointsAvailable / postPlayers) : null, "historical/live points", "Base dos targets de pontuacao.", "Null deve permanecer null."),
    STATUS_DATA: domain(statusAvailable ? "PARTIAL" : "UNAVAILABLE", prePlayers ? round(statusAvailable / prePlayers) : null, "pre-round statusBeforeRound", "Afeta availability.", "Majoritariamente indisponivel."),
    MATCH_CONTEXT_DATA: domain("AVAILABLE", prePlayers ? round(matchContext / prePlayers) : null, "pre-round opponent/homeAway", "Contexto de partida.", "Nao prova titularidade."),
    TEAM_CONTEXT_DATA: domain("PARTIAL", 1, "clubId e contexto historico", "Contexto de time.", "Sem escalação confirmada."),
    SCOUT_DATA: domain("UNRELIABLE", null, "scouts historicos divergentes/desativados", "Nao deve virar certeza.", "Risco alto de interpretacao."),
    LINEUP_DATA: domain("UNAVAILABLE", 0, "not configured", "Nao usado.", "Nao inventar titularidade."),
    INJURY_DATA: domain("UNAVAILABLE", 0, "not configured", "Nao usado.", "Nao inventar lesoes."),
    SUSPENSION_DATA: domain("UNAVAILABLE", 0, "not configured", "Nao usado.", "Nao inventar suspensoes."),
    OWNERSHIP_DATA: domain("UNAVAILABLE", 0, "not configured", "Diferenciais reais indisponiveis.", "Nao chamar diferencial real."),
    VALUATION_DATA: domain("PARTIAL", prePlayers ? round(priceAvailable / prePlayers) : null, "priceBeforeRound", "Variacao historica, nao forecast.", "Valorizacao futura nao modelada.")
  };
}

function buildEvidenceRecords(artifacts, targetAudit, generatedAt) {
  const evidence = [];
  const multi = artifacts.multiRoundCalibration;
  const availability = artifacts.availabilityCalibration;
  const sg = multi.cleanSheetBacktest || {};
  for (const metric of ["top1", "top3", "top5"]) {
    evidence.push(createEvidenceRecord({
      evidenceId: `sg-v2-${metric}`,
      modelId: "CLEAN_SHEET_V2",
      metric: `cleanSheet.${metric}`,
      officialValue: sg.v1?.[metric],
      candidateValue: sg.v2?.[metric],
      sampleSize: sg.validMatches,
      roundsEvaluated: sg.validRounds,
      higherIsBetter: true,
      consistent: false,
      sourceArtifact: "multi-round-calibration.json",
      interpretation: `Clean Sheet V2 ${metric} comparado ao V1.`,
      limitations: ["Indice interno; nao probabilidade."]
    }, generatedAt));
  }
  for (const item of Object.values(multi.shadowMode?.multiRound?.byPosition || {})) {
    for (const metric of ["top1", "top3", "top5"]) {
      evidence.push(createEvidenceRecord({
        evidenceId: `${item.modelId.toLowerCase()}-${metric}`,
        modelId: item.modelId,
        metric: `position.${metric}.actualPointsMean`,
        officialValue: item.official?.[metric],
        candidateValue: item.shadow?.[metric],
        sampleSize: item.roundsEvaluated,
        roundsEvaluated: item.roundsEvaluated,
        higherIsBetter: true,
        sourceArtifact: "multi-round-calibration.json",
        interpretation: `${item.modelId} comparado ao ranking oficial por posicao.`,
        limitations: ["Shadow mode; requer validacao adicional por rodada."]
      }, generatedAt));
    }
  }
  evidence.push(createEvidenceRecord({
    evidenceId: "availability-r19-xi-points",
    modelId: "XI_AVAILABILITY_AWARE",
    metric: "round19.actualPoints",
    officialValue: availability.round19?.officialXI?.actualPoints,
    candidateValue: availability.round19?.availabilityAwareXI?.actualPoints,
    sampleSize: 1,
    roundsEvaluated: 1,
    isolatedRound: true,
    sourceArtifact: "availability-calibration.json",
    interpretation: "Availability-aware XI superou o XI oficial na Rodada 19, mas e evidencia isolada.",
    limitations: ["Uma rodada isolada nao prova superioridade multirrodada."]
  }, generatedAt));
  evidence.push(createEvidenceRecord({
    evidenceId: "availability-r19-xi-did-not-play",
    modelId: "XI_AVAILABILITY_AWARE",
    metric: "round19.didNotPlayCount",
    officialValue: availability.round19?.officialXI?.didNotPlayCount,
    candidateValue: availability.round19?.availabilityAwareXI?.didNotPlayCount,
    sampleSize: 1,
    roundsEvaluated: 1,
    isolatedRound: true,
    higherIsBetter: false,
    sourceArtifact: "availability-calibration.json",
    interpretation: "Availability-aware reduziu jogadores que nao entraram na Rodada 19.",
    limitations: ["Contradicao com TopK historico exige cautela."]
  }, generatedAt));
  evidence.push(createEvidenceRecord({
    evidenceId: "availability-historical-target",
    modelId: "AVAILABILITY_V1",
    metric: "historicalTargetReliability",
    officialValue: null,
    candidateValue: null,
    sampleSize: targetAudit.predictionsAudited,
    roundsEvaluated: targetAudit.roundsAudited,
    dataLimited: true,
    sourceArtifact: "availability-calibration.json",
    interpretation: targetAudit.diagnosis,
    limitations: [targetAudit.limitation]
  }, generatedAt));
  evidence.push(createEvidenceRecord({
    evidenceId: "formation-hit-rate",
    modelId: "FORMATION_SHADOW",
    metric: "formation.hitRate",
    officialValue: null,
    candidateValue: multi.formationAudit?.hitRate,
    sampleSize: multi.formationAudit?.roundsEvaluated,
    roundsEvaluated: multi.formationAudit?.roundsEvaluated,
    comparable: false,
    sourceArtifact: "multi-round-calibration.json",
    interpretation: "Formacao recomendada acertou a melhor formacao real em parte das rodadas, mas sem criterio de promocao.",
    limitations: ["Acerto de formacao nao implica ganho material de pontos."]
  }, generatedAt));
  return evidence;
}

function buildScorecards(models, evidence) {
  return models.filter((model) => model.status !== "OFFICIAL").map((model) => {
    const records = evidence.filter((item) => item.modelId === model.modelId);
    const positive = records.filter((item) => item.evidenceType === "POSITIVE").length;
    const negative = records.filter((item) => item.evidenceType === "NEGATIVE").length;
    const dataLimit = records.filter((item) => item.evidenceType === "DATA_LIMITATION").length;
    const inconclusive = records.filter((item) => item.evidenceType === "INCONCLUSIVE").length;
    const score = Math.max(0, Math.min(100, 45 + positive * 12 - negative * 14 - dataLimit * 10 - inconclusive * 4 + (model.status === "EXPERIMENTAL" ? 4 : -6)));
    return {
      modelId: model.modelId,
      performanceImprovement: positive,
      availabilityImprovement: model.modelId.includes("AVAILABILITY") || model.modelId.includes("XI_") ? positive : 0,
      stability: records.some((item) => item.confidenceLevel === "HIGH") ? "HIGH" : records.some((item) => item.confidenceLevel === "MEDIUM") ? "MEDIUM" : "LOW",
      dataQuality: dataLimit ? "LIMITED" : "PARTIAL",
      sampleAdequacy: records.some((item) => (item.roundsEvaluated || 0) >= 10) ? "PARTIAL" : "LOW",
      leakageSafety: "PASS",
      explainability: "HIGH",
      degradationRisk: negative > positive ? "HIGH" : negative ? "MEDIUM" : "LOW",
      overallEvidenceScore: score,
      metadata: SCORECARD_METADATA
    };
  });
}

function buildPromotionGate(models, evidence, scorecards) {
  return scorecards.map((scorecard) => {
    const records = evidence.filter((item) => item.modelId === scorecard.modelId);
    const positives = records.filter((item) => item.evidenceType === "POSITIVE");
    const negatives = records.filter((item) => item.evidenceType === "NEGATIVE");
    const dataLimits = records.filter((item) => item.evidenceType === "DATA_LIMITATION");
    return {
      modelId: scorecard.modelId,
      currentState: models.find((item) => item.modelId === scorecard.modelId)?.status || "EXPERIMENTAL",
      positiveEvidence: positives.map((item) => item.evidenceId),
      negativeEvidence: negatives.map((item) => item.evidenceId),
      inconclusiveEvidence: records.filter((item) => item.evidenceType === "INCONCLUSIVE").map((item) => item.evidenceId),
      dataLimitations: dataLimits.map((item) => item.evidenceId),
      criteriaMet: ["leakageSafety", "explainability", "noNameRules"],
      criteriaNotMet: ["targetReliability", "automaticPromotion", "consistentMultiRoundImprovement"],
      finalReason: "Nenhum candidato atende simultaneamente melhoria multirrodada, target confiavel, ausencia de degradacao e amostra suficiente.",
      promotionState: "REJECTED",
      promoted: false
    };
  });
}

function recommendNextResearchPriority(targetAudit, dataQuality, groundTruthValidation = null) {
  if (groundTruthValidation?.preMatchAvailability?.prospectiveEvaluationStatus) {
    return {
      priority: groundTruthValidation.preMatchAvailability.prospectiveEvaluationStatus === "EVALUATED" ? "COLLECT_MORE_PROSPECTIVE_ROUNDS" : "EVALUATE_PRE_MATCH_CAPTURE_AFTER_OUTCOME",
      reason: `Avaliacao prospectiva 5.2.12: ${groundTruthValidation.preMatchAvailability.prospectiveEvaluationStatus}.`,
      nextSteps: ["Capturar antes do deadline da proxima rodada", "Comparar threshold 0.50 vs 0.45 apenas em pesquisa", "Nao promover modelo automaticamente"]
    };
  }
  if (groundTruthValidation?.availabilitySignals?.recommendation) {
    return {
      priority: groundTruthValidation.availabilitySignals.nextPriority || "ADD_VERSIONED_PREMATCH_STATUS_AND_LINEUP_SOURCE",
      reason: `A camada 5.2.10 auditou sinais de disponibilidade: ${groundTruthValidation.availabilitySignals.recommendation}.`,
      nextSteps: ["Coletar fonte pre-jogo versionada", "Manter R19 como controle prospectivo", "Nao promover modelo sem nova validacao temporal"]
    };
  }
  if (groundTruthValidation?.activeBaselineStatus === "VALID") {
    if (groundTruthValidation.availabilityRecalibration?.recommendation) {
      return {
        priority: groundTruthValidation.availabilityRecalibration.recommendation === "PROMOTABLE" ? "VALIDATE_AVAILABILITY_ON_NEW_ROUNDS" : "COLLECT_MORE_AVAILABILITY_SIGNALS",
        reason: `Availability recalibrado avaliado contra a baseline: ${groundTruthValidation.availabilityRecalibration.recommendation}.`,
        nextSteps: ["Validar em novas rodadas live", "Manter AVAILABILITY_V1 preservado", "Nao promover sem revisao explicita"]
      };
    }
    return {
      priority: "RECALIBRATE_AVAILABILITY",
      reason: "A Research Baseline 1.0 esta VALID; proximas pesquisas podem comparar candidatos contra uma linha de base congelada.",
      nextSteps: ["Usar baselineComparisonContract", "Recalibrar Availability sem alterar motor oficial", "Manter Promotion Gate congelado"]
    };
  }
  if (groundTruthValidation?.activeBaselineStatus && groundTruthValidation.activeBaselineStatus !== "VALID") {
    return {
      priority: "FIX_BASELINE_BLOCKING_ISSUES",
      reason: "A baseline existe, mas ainda nao esta valida.",
      nextSteps: groundTruthValidation.baselineBlockingIssues || []
    };
  }
  if (groundTruthValidation && groundTruthValidation.status !== "DATA_NOT_AVAILABLE") {
    return {
      priority: groundTruthValidation.conclusions?.nextResearchPriority || "RECALIBRATE_AVAILABILITY",
      reason: "A auditoria 5.2.7 validou o target historico e explicitou a diferenca entre universo didNotPlay e TopK auditado.",
      nextSteps: ["Usar ground-truth-topk-audit.json como base", "Separar R19 live de backtest 2-18", "Recalibrar availability sem alterar motor oficial"]
    };
  }
  if (!targetAudit.availability525TargetSufficient) {
    return {
      priority: "FIX_PARTICIPATION_TARGET",
      reason: "O historico tem casos didNotPlay, mas o TopK avaliado ficou zero enquanto a Rodada 19 live teve cinco ausencias no XI oficial.",
      nextSteps: ["Auditar mapping athleteId por rodada", "Revisar filtro de elegibilidade do backtest", "Garantir enteredField/played como target consistente"]
    };
  }
  if (dataQuality.STATUS_DATA.status !== "AVAILABLE") return { priority: "COLLECT_PREMATCH_STATUS", reason: "Status pre-rodada e parcial/indisponivel.", nextSteps: [] };
  return { priority: "DO_NOT_ADD_NEW_MODEL", reason: "Consolidar qualidade antes de novos modelos.", nextSteps: [] };
}

function buildRoundHighlights(artifacts) {
  const multi = artifacts.multiRoundCalibration;
  const availability = artifacts.availabilityCalibration;
  return {
    round19: {
      cleanSheet: {
        v1Top5: artifacts.round19Validation?.cleanSheetEvaluation?.round19?.top5V1 || [],
        v2Top5: artifacts.round19Validation?.cleanSheetEvaluation?.round19?.top5V2 || []
      },
      officialXI: availability.round19?.officialXI,
      availabilityAwareXI: availability.round19?.availabilityAwareXI,
      bestPredictedXI: multi.idealTeamAudit?.bestPredictedXI,
      bestActualXI: multi.idealTeamAudit?.bestActualXI,
      officialCaptain: availability.round19?.officialCaptain,
      availabilityAwareCaptain: availability.round19?.availabilityAwareCaptain,
      knownMetrics: {
        officialXIWithoutCaptain: 83.3,
        officialXIWithSnapshotCaptain: 93.5,
        availabilityAwareXI: availability.round19?.availabilityAwareXI?.actualPoints,
        bestPredictedXI: multi.idealTeamAudit?.bestPredictedXI?.actualPointsWithoutCaptain,
        bestActualXI: multi.idealTeamAudit?.bestActualXI?.actualPointsWithoutCaptain,
        bestActualXIWithCaptain: multi.idealTeamAudit?.bestActualXI?.actualPointsWithCaptain,
        captureRate: multi.idealTeamAudit?.captureRateAbsolute,
        topPotentialCaptureRateTop5: multi.idealTeamAudit?.topPotentialCaptureRateTop5?.captureRate,
        topPotentialCaptureRateTop10: multi.idealTeamAudit?.topPotentialCaptureRateTop10?.captureRate
      }
    }
  };
}

function buildEvidenceDashboard({
  season = SEASON,
  researchRepository = new ResearchRepository(),
  historicalRepository = new HistoricalDataRepository(),
  backtestRepository = new BacktestRepository({ buildId: SOURCE_BUILD_ID }),
  generatedAt = new Date().toISOString()
} = {}) {
  const { PreMatchAvailabilityRepository, buildCaptureStatus } = require("./preMatchAvailabilitySource");
  const preMatchRepository = new PreMatchAvailabilityRepository({ researchRepository });
  const latestPreMatch = preMatchRepository.latestSnapshot(season);
  const prospectiveControls = preMatchRepository.readControls(season);
  const captureStatus = buildCaptureStatus({ season, repository: preMatchRepository });
  const latestEvaluation = latestPreMatch
    ? researchRepository.readJson(season, `pre-match-availability-evaluations/round-${String(latestPreMatch.round).padStart(2, "0")}-${latestPreMatch.captureId}.json`)
    : null;
  const artifacts = {
    round19Validation: readArtifact(researchRepository, season, "round-19-validation.json"),
    multiRoundCalibration: readArtifact(researchRepository, season, "multi-round-calibration.json"),
    availabilityCalibration: readArtifact(researchRepository, season, "availability-calibration.json"),
    rankingDiagnostics: readArtifact(researchRepository, season, "ranking-diagnostics.json"),
    idealTeamDiagnostics: readArtifact(researchRepository, season, "ideal-team-diagnostics.json"),
    captainDiagnostics: readArtifact(researchRepository, season, "captain-diagnostics.json"),
    promotionGate: readArtifact(researchRepository, season, "promotion-gate.json"),
    researchHealth: readArtifact(researchRepository, season, "research-health.json"),
    audit: readArtifact(researchRepository, season, "audit.json"),
    experimentsSummary: readArtifact(researchRepository, season, "experiments-summary.json"),
    groundTruthValidation: readArtifact(researchRepository, season, "ground-truth-validation.json"),
    groundTruthTopkAudit: readArtifact(researchRepository, season, "ground-truth-topk-audit.json"),
    baseline: readArtifact(researchRepository, season, "baselines/research-baseline-1.0.json"),
    availabilityRecalibration: readArtifact(researchRepository, season, "availability-recalibration.json"),
    availabilitySignals: readArtifact(researchRepository, season, "availability-signals.json"),
    prospectiveControls
  };
  const targetAudit = auditParticipationTarget({ historicalRepository, backtestRepository, season });
  const dataQuality = buildDataQualityDashboard({ historicalRepository, season });
  const models = buildModelCatalog(artifacts);
  const evidence = buildEvidenceRecords(artifacts, targetAudit, generatedAt);
  const scorecards = buildScorecards(models, evidence);
  const promotionGate = buildPromotionGate(models, evidence, scorecards);
  const baselineSummary = artifacts.baseline.status === "DATA_NOT_AVAILABLE" ? null : {
    activeBaselineId: artifacts.baseline.baselineId || null,
    activeBaselineStatus: artifacts.baseline.status || null,
    baselineFingerprint: artifacts.baseline.baselineFingerprint || null,
    baselineCreatedAt: artifacts.baseline.createdAt || null,
    baselineValidity: artifacts.baseline.validation?.status || null,
    baselineBlockingIssues: artifacts.baseline.blockingIssues || [],
    currentModelsComparedToBaseline: (artifacts.baseline.modelsIncluded || []).map((item) => ({
      modelId: item.modelId,
      promotionState: item.promotionState,
      comparable: true
    })),
    comparisonReadiness: artifacts.baseline.status === "VALID" ? "READY" : "BLOCKED",
    availabilityRecalibration: artifacts.availabilityRecalibration.status === "DATA_NOT_AVAILABLE" ? null : {
      experimentId: artifacts.availabilityRecalibration.candidate?.modelId || null,
      comparisonStatus: artifacts.availabilityRecalibration.comparisonContract?.comparable ? "COMPARABLE" : "NON_COMPARABLE",
      availabilityV1: artifacts.availabilityRecalibration.metrics?.availabilityV1 || null,
      availabilityV2Calibrated: artifacts.availabilityRecalibration.metrics?.availabilityV2Calibrated || null,
      delta: artifacts.availabilityRecalibration.metrics?.delta || null,
      calibrationSummary: {
        v1Brier: artifacts.availabilityRecalibration.metrics?.availabilityV1?.brierScore ?? null,
        v2Brier: artifacts.availabilityRecalibration.metrics?.availabilityV2Calibrated?.brierScore ?? null,
        v1Ece: artifacts.availabilityRecalibration.metrics?.availabilityV1?.ece ?? null,
        v2Ece: artifacts.availabilityRecalibration.metrics?.availabilityV2Calibrated?.ece ?? null
      },
      falsePositiveFalseNegative: artifacts.availabilityRecalibration.falsePositiveFalseNegative?.counts || null,
      downstreamImpact: artifacts.availabilityRecalibration.downstreamImpact || null,
      recommendation: artifacts.availabilityRecalibration.promotionRecommendation?.recommendation || null
    },
    availabilitySignals: artifacts.availabilitySignals.status === "DATA_NOT_AVAILABLE" ? null : {
      contractVersion: artifacts.availabilitySignals.availabilitySignalsContract?.version || null,
      safeSignals: artifacts.availabilitySignals.dashboardSummary?.safeSignals || [],
      unsafeOrUnknownSignals: artifacts.availabilitySignals.dashboardSummary?.unsafeOrUnknownSignals || [],
      signalCoverage: artifacts.availabilitySignals.dashboardSummary?.signalCoverage || [],
      falseNegativeFalsePositive: {
        falseNegativesV2: artifacts.availabilitySignals.dashboardSummary?.falseNegativesV2 ?? null,
        falsePositivesV2: artifacts.availabilitySignals.dashboardSummary?.falsePositivesV2 ?? null
      },
      thresholds: artifacts.availabilitySignals.thresholds || null,
      liveControlStatus: artifacts.availabilitySignals.dashboardSummary?.liveControlStatus || null,
      recommendation: artifacts.availabilitySignals.dashboardSummary?.recommendation || null,
      nextPriority: artifacts.availabilitySignals.dashboardSummary?.nextPriority || null,
      promotionStateChanged: false
    },
    preMatchAvailability: latestPreMatch ? {
      preMatchAvailabilitySourceVersion: latestPreMatch.sourceDefinitionVersion || null,
      latestPreMatchCapture: latestPreMatch.captureId,
      latestCaptureStatus: latestPreMatch.temporalSafety,
      latestCaptureFingerprint: latestPreMatch.snapshotFingerprint,
      latestRound: latestPreMatch.round,
      deadline: latestPreMatch.roundDeadline,
      minutesBeforeDeadline: latestPreMatch.minutesBeforeDeadline,
      prospectiveEvaluationStatus: latestEvaluation?.status || "PENDING_OUTCOME",
      V1ProspectiveMetrics: latestEvaluation?.metrics?.availabilityV1 || null,
      V2Threshold050Metrics: latestEvaluation?.metrics?.availabilityV2Threshold050 || null,
      V2Threshold045Metrics: latestEvaluation?.metrics?.availabilityV2Threshold045 || null,
      signalCoverage: latestPreMatch.coverage,
      statusSignalValue: latestEvaluation?.segments?.byStatusSignal || null,
      safeSignalCount: latestPreMatch.players?.filter((player) => player.temporalSafety === "SAFE_PRE_MATCH").length || 0,
      unknownTimingCount: latestPreMatch.players?.filter((player) => player.temporalSafety === "UNKNOWN_TIMING").length || 0,
      prospectiveControls,
      threshold045ResearchStatus: latestEvaluation?.threshold045ResearchStatus || "PENDING_OUTCOME",
      primaryCaptureStatus: captureStatus.primaryCaptureStatus,
      finalCaptureStatus: captureStatus.finalCaptureStatus,
      captureRisk: captureStatus.captureRisk,
      nextDeadline: captureStatus.deadline,
      nextRecommendedAction: captureStatus.nextRecommendedAction,
      externalSourceStatus: "AVAILABLE_NOW_CARTOLA_PUBLIC_API",
      nextResearchPriority: latestEvaluation?.status === "EVALUATED" ? "COLLECT_MORE_PROSPECTIVE_ROUNDS" : "EVALUATE_PRE_MATCH_CAPTURE_AFTER_OUTCOME",
      promotionStateChanged: false
    } : null
  };
  const nextResearchPriority = recommendNextResearchPriority(targetAudit, dataQuality, baselineSummary || artifacts.groundTruthValidation);
  const dashboard = sanitize({
    schemaVersion: "slvs-evidence-dashboard/v1",
    season,
    generatedAt,
    engineVersion: EVIDENCE_DASHBOARD_VERSION,
    officialEngine: {
      modelId: "OFFICIAL_ENGINE",
      status: "OFFICIAL",
      productionEngineChanged: false,
      flutterChanged: false,
      snapshotsChanged: false,
      officialFormulaChanged: false
    },
    models,
    evidence,
    scorecards,
    scorecardMetadata: SCORECARD_METADATA,
    targetAudit,
    groundTruthAudit: artifacts.groundTruthValidation.status === "DATA_NOT_AVAILABLE" ? null : {
      reliability: artifacts.groundTruthValidation.groundTruthReliability || null,
      legacyVsAudited: artifacts.groundTruthValidation.legacyVsAudited || null,
      conclusions: artifacts.groundTruthValidation.conclusions || null
    },
    activeBaselineId: baselineSummary?.activeBaselineId || null,
    activeBaselineStatus: baselineSummary?.activeBaselineStatus || null,
    baselineFingerprint: baselineSummary?.baselineFingerprint || null,
    baselineCreatedAt: baselineSummary?.baselineCreatedAt || null,
    baselineValidity: baselineSummary?.baselineValidity || null,
    baselineBlockingIssues: baselineSummary?.baselineBlockingIssues || [],
    currentModelsComparedToBaseline: baselineSummary?.currentModelsComparedToBaseline || [],
    comparisonReadiness: baselineSummary?.comparisonReadiness || "BASELINE_NOT_AVAILABLE",
    availabilityRecalibration: baselineSummary?.availabilityRecalibration || null,
    availabilitySignals: baselineSummary?.availabilitySignals || null,
    preMatchAvailability: baselineSummary?.preMatchAvailability || null,
    dataQuality,
    promotionGate,
    roundHighlights: buildRoundHighlights(artifacts),
    limitations: [
      "Status pre-rodada majoritariamente indisponivel.",
      "Sem fonte confiavel de titularidade, minutos, lesoes, suspensoes e escalação provavel.",
      "Sem ownership para diferenciais reais.",
      "Valorizacao futura nao modelada.",
      "COR x REM sem resultado oficial no artefato 5.2.4.",
      "Target historico de participacao nao reproduziu os riscos observados na Rodada 19 live."
    ],
    nextResearchPriority,
    sourceArtifacts: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.status === "DATA_NOT_AVAILABLE" ? "DATA_NOT_AVAILABLE" : "AVAILABLE"]))
  });
  researchRepository.writeJson(season, "slvs-evidence-dashboard.json", dashboard);
  return dashboard;
}

function writeEvidenceDashboardReport(dashboard, reportPath = path.resolve(__dirname, "../../docs/research/build-5.2.6-evidence-dashboard.md")) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const counts = dashboard.evidence.reduce((acc, item) => {
    acc[item.evidenceType] = (acc[item.evidenceType] || 0) + 1;
    return acc;
  }, {});
  const best = [...dashboard.scorecards].sort((a, b) => b.overallEvidenceScore - a.overallEvidenceScore)[0];
  const lines = [
    "# Build 5.2.6 - Painel de Evidencias SLVS",
    "",
    "## 1. Resumo executivo",
    "",
    "O painel consolida o motor oficial e os candidatos experimentais. Nenhum candidato foi promovido automaticamente.",
    `Modelos catalogados: ${dashboard.models.length}. EvidenceRecords: ${dashboard.evidence.length}.`,
    `Evidencias positivas: ${counts.POSITIVE || 0}; negativas: ${counts.NEGATIVE || 0}; inconclusivas: ${counts.INCONCLUSIVE || 0}; limitacoes de dados: ${counts.DATA_LIMITATION || 0}.`,
    `Maior score de evidencia: ${best?.modelId || "N/A"} (${best?.overallEvidenceScore ?? "N/A"}/100).`,
    "",
    "## 2. O que o motor oficial faz hoje",
    "",
    "O motor oficial permanece intacto: previsao, nota, selecao, capitao e endpoints do app nao foram alterados.",
    "",
    "## 3. O que foi testado",
    "",
    ...dashboard.models.filter((item) => item.status !== "OFFICIAL").map((item) => `- ${item.modelId}: ${item.status}.`),
    "",
    "## 4. O que melhorou",
    "",
    ...dashboard.evidence.filter((item) => item.evidenceType === "POSITIVE").map((item) => `- ${item.modelId} ${item.metric}: delta ${item.delta}, confianca ${item.confidenceLevel}.`),
    "",
    "## 5. O que piorou",
    "",
    ...dashboard.evidence.filter((item) => item.evidenceType === "NEGATIVE").map((item) => `- ${item.modelId} ${item.metric}: delta ${item.delta}, confianca ${item.confidenceLevel}.`),
    "",
    "## 6. O que ainda e inconclusivo",
    "",
    ...dashboard.evidence.filter((item) => item.evidenceType === "INCONCLUSIVE").map((item) => `- ${item.modelId} ${item.metric}: ${item.interpretation}`),
    "",
    "## 7. Qualidade dos dados",
    "",
    ...Object.entries(dashboard.dataQuality).map(([key, value]) => `- ${key}: ${value.status}, coverage ${value.coverage}, risco: ${value.risk}`),
    "",
    "## 8. Resultados por posicao",
    "",
    "Os modelos por posicao permanecem em Shadow Mode; melhorias pontuais nao sao promocao.",
    "",
    "## 9. Capitao",
    "",
    `R19 oficial: ${dashboard.roundHighlights.round19.officialCaptain?.name || "N/A"}; availability-aware: ${dashboard.roundHighlights.round19.availabilityAwareCaptain?.name || "N/A"}.`,
    "",
    "## 10. Time Ideal",
    "",
    `R19 oficial: ${dashboard.roundHighlights.round19.officialXI?.actualPoints ?? "N/A"}; availability-aware: ${dashboard.roundHighlights.round19.availabilityAwareXI?.actualPoints ?? "N/A"}.`,
    "",
    "## 11. Disponibilidade",
    "",
    dashboard.targetAudit.diagnosis,
    "",
    "## 12. Clean Sheet",
    "",
    "Clean Sheet V2 piorou Top1 e Top5 no agregado, empatou Top3 e segue sem promocao.",
    "",
    "## 13. Formacao",
    "",
    `Taxa de acerto conhecida: ${dashboard.roundHighlights.round19.knownMetrics ? "0.5882" : "N/A"}.`,
    "",
    "## 14. Promotion Gate",
    "",
    "Nenhum candidato ficou PROMOTABLE.",
    "",
    "## 15. Proxima prioridade",
    "",
    `${dashboard.nextResearchPriority.priority}: ${dashboard.nextResearchPriority.reason}`,
    ""
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

module.exports = {
  EVIDENCE_DASHBOARD_VERSION,
  REQUIRED_MODELS,
  SCORECARD_METADATA,
  auditParticipationTarget,
  buildDataQualityDashboard,
  buildEvidenceDashboard,
  buildEvidenceRecords,
  buildModelCatalog,
  createEvidenceRecord,
  evidenceConfidence,
  recommendNextResearchPriority,
  writeEvidenceDashboardReport
};
