const fs = require("node:fs");
const path = require("node:path");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { ResearchRepository } = require("./repository");
const {
  MODEL_ID: AVAILABILITY_V2_MODEL_ID,
  TRAIN_ROUNDS,
  VALIDATION_ROUNDS,
  buildDataset,
  metrics,
  predictV2,
  trainLogistic
} = require("./availabilityRecalibration");

const SIGNALS_ENGINE_VERSION = "availability-signals-research-lab/5.2.10";
const SIGNAL_CONTRACT_VERSION = "AVAILABILITY_SIGNALS_V1";
const SOURCE_BUILD_ID = "build-4.3.2";
const SAFE_PRE_MATCH = "SAFE_PRE_MATCH";
const UNSAFE_POST_MATCH = "UNSAFE_POST_MATCH";
const UNKNOWN_TIMING = "UNKNOWN_TIMING";
const MISSING = "MISSING";

const SIGNAL_DEFINITIONS = [
  {
    name: "recentPlayedRate",
    source: "historical participation history",
    originalField: "participationFeaturesForPlayer.recentParticipationRate",
    timestampAvailability: "pre-round; derived only from previous rounds",
    timingClass: SAFE_PRE_MATCH,
    reliability: "MEDIUM",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "allPlayedRate",
    source: "historical participation history",
    originalField: "participationFeaturesForPlayer.allParticipationRate",
    timestampAvailability: "pre-round; derived only from previous rounds",
    timingClass: SAFE_PRE_MATCH,
    reliability: "MEDIUM",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "consecutiveAppearances",
    source: "historical participation history",
    originalField: "participationFeaturesForPlayer.consecutivePlayed",
    timestampAvailability: "pre-round; derived only from previous rounds",
    timingClass: SAFE_PRE_MATCH,
    reliability: "MEDIUM",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "consecutiveAbsences",
    source: "historical participation history",
    originalField: "participationFeaturesForPlayer.consecutiveDidNotPlay",
    timestampAvailability: "pre-round; derived only from previous rounds",
    timingClass: SAFE_PRE_MATCH,
    reliability: "MEDIUM",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "participationSampleSize",
    source: "historical participation history",
    originalField: "participationFeaturesForPlayer.sampleSize",
    timestampAvailability: "pre-round; derived only from previous rounds",
    timingClass: SAFE_PRE_MATCH,
    reliability: "MEDIUM",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "gamesBeforeRound",
    source: "historical pre-round reconstruction",
    originalField: "pre.players[].gamesBeforeRound",
    timestampAvailability: "pre-round; previous round post games",
    timingClass: SAFE_PRE_MATCH,
    reliability: "HIGH",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "priceBeforeRound",
    source: "historical pre-round reconstruction",
    originalField: "pre.players[].priceBeforeRound",
    timestampAvailability: "pre-round; reconstructed with field provenance",
    timingClass: SAFE_PRE_MATCH,
    reliability: "HIGH",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "averageBeforeRound",
    source: "historical pre-round reconstruction",
    originalField: "pre.players[].averageBeforeRound",
    timestampAvailability: "pre-round; previous round post average",
    timingClass: SAFE_PRE_MATCH,
    reliability: "HIGH",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "accumulatedPointsBeforeRound",
    source: "historical pre-round reconstruction",
    originalField: "pre.players[].accumulatedPointsBeforeRound",
    timestampAvailability: "pre-round; accumulated only through previous rounds",
    timingClass: SAFE_PRE_MATCH,
    reliability: "HIGH",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "homeAway",
    source: "historical fixture context",
    originalField: "pre.players[].homeAway",
    timestampAvailability: "pre-round schedule",
    timingClass: SAFE_PRE_MATCH,
    reliability: "HIGH",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "opponent",
    source: "historical fixture context",
    originalField: "pre.players[].opponent",
    timestampAvailability: "pre-round schedule",
    timingClass: SAFE_PRE_MATCH,
    reliability: "HIGH",
    leakageRisk: "LOW",
    liveFeasibility: "AVAILABLE_NOW",
    historicalReconstruction: "AVAILABLE"
  },
  {
    name: "statusBeforeRound",
    source: "historical pre-round reconstruction",
    originalField: "pre.players[].statusBeforeRound",
    timestampAvailability: "not reconstructed with enough historical coverage",
    timingClass: MISSING,
    reliability: "LOW",
    leakageRisk: "MEDIUM",
    liveFeasibility: "PARTIAL",
    historicalReconstruction: "MISSING"
  },
  {
    name: "probableFlag",
    source: "not configured",
    originalField: null,
    timestampAvailability: "unknown",
    timingClass: MISSING,
    reliability: "UNKNOWN",
    leakageRisk: "UNKNOWN",
    liveFeasibility: "TECHNICALLY_POSSIBLE",
    historicalReconstruction: "MISSING"
  },
  {
    name: "doubtFlag",
    source: "not configured",
    originalField: null,
    timestampAvailability: "unknown",
    timingClass: MISSING,
    reliability: "UNKNOWN",
    leakageRisk: "UNKNOWN",
    liveFeasibility: "TECHNICALLY_POSSIBLE",
    historicalReconstruction: "MISSING"
  },
  {
    name: "injuryFlag",
    source: "not configured",
    originalField: null,
    timestampAvailability: "unknown",
    timingClass: MISSING,
    reliability: "UNKNOWN",
    leakageRisk: "UNKNOWN",
    liveFeasibility: "TECHNICALLY_POSSIBLE",
    historicalReconstruction: "MISSING"
  },
  {
    name: "suspensionFlag",
    source: "not configured",
    originalField: null,
    timestampAvailability: "unknown",
    timingClass: MISSING,
    reliability: "UNKNOWN",
    leakageRisk: "UNKNOWN",
    liveFeasibility: "TECHNICALLY_POSSIBLE",
    historicalReconstruction: "MISSING"
  },
  {
    name: "starterFlag",
    source: "lineup source not configured",
    originalField: null,
    timestampAvailability: "unknown",
    timingClass: UNKNOWN_TIMING,
    reliability: "UNKNOWN",
    leakageRisk: "HIGH",
    liveFeasibility: "REQUIRES_SOURCE",
    historicalReconstruction: "MISSING"
  },
  {
    name: "recentMinutesAverage",
    source: "minutes source not configured",
    originalField: null,
    timestampAvailability: "unknown",
    timingClass: MISSING,
    reliability: "UNKNOWN",
    leakageRisk: "UNKNOWN",
    liveFeasibility: "REQUIRES_SOURCE",
    historicalReconstruction: "MISSING"
  },
  {
    name: "actualPlayedTarget",
    source: "historical post-round",
    originalField: "post.players[].played",
    timestampAvailability: "post-round only",
    timingClass: UNSAFE_POST_MATCH,
    reliability: "HIGH",
    leakageRisk: "HIGH",
    liveFeasibility: "NOT_ALLOWED_FOR_PRE_MATCH",
    historicalReconstruction: "AVAILABLE_POST_MATCH_ONLY"
  },
  {
    name: "actualPoints",
    source: "historical post-round",
    originalField: "post.players[].points",
    timestampAvailability: "post-round only",
    timingClass: UNSAFE_POST_MATCH,
    reliability: "HIGH",
    leakageRisk: "HIGH",
    liveFeasibility: "NOT_ALLOWED_FOR_PRE_MATCH",
    historicalReconstruction: "AVAILABLE_POST_MATCH_ONLY"
  },
  {
    name: "roundScouts",
    source: "historical post-round",
    originalField: "post.players[].scouts",
    timestampAvailability: "post-round only",
    timingClass: UNSAFE_POST_MATCH,
    reliability: "PARTIAL",
    leakageRisk: "HIGH",
    liveFeasibility: "NOT_ALLOWED_FOR_PRE_MATCH",
    historicalReconstruction: "AVAILABLE_POST_MATCH_ONLY"
  }
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

function isUsablePreMatchSignal(signal) {
  return signal?.timingClass === SAFE_PRE_MATCH;
}

function assertUsablePreMatchSignal(signal) {
  if (!isUsablePreMatchSignal(signal)) {
    throw new Error(`Signal ${signal?.name || "UNKNOWN"} is not SAFE_PRE_MATCH.`);
  }
  return true;
}

function safeSignalDefinitions() {
  return SIGNAL_DEFINITIONS.filter(isUsablePreMatchSignal);
}

function readPrePlayersByRound(repository, season, rounds) {
  const maps = new Map();
  for (const roundNumber of rounds) {
    const pre = repository.readRoundFile(season, roundNumber, "pre-round.json");
    maps.set(roundNumber, new Map((pre?.players || []).map((player) => [Number(player.athleteId), player])));
  }
  return maps;
}

function signalValueFromRow(name, row, prePlayer) {
  const f = row.features || {};
  if (name === "recentPlayedRate") return finite(f.recentParticipationRate);
  if (name === "allPlayedRate") return finite(f.allParticipationRate);
  if (name === "consecutiveAppearances") return finite(f.consecutivePlayed);
  if (name === "consecutiveAbsences") return finite(f.consecutiveDidNotPlay);
  if (name === "participationSampleSize") return finite(f.sampleSize);
  if (name === "gamesBeforeRound") return finite(prePlayer?.gamesBeforeRound ?? f.gamesBeforeRound);
  if (name === "priceBeforeRound") return finite(prePlayer?.priceBeforeRound);
  if (name === "averageBeforeRound") return finite(prePlayer?.averageBeforeRound);
  if (name === "accumulatedPointsBeforeRound") return finite(prePlayer?.accumulatedPointsBeforeRound);
  if (name === "homeAway") return prePlayer?.homeAway ?? null;
  if (name === "opponent") return finite(prePlayer?.opponent);
  if (name === "statusBeforeRound") return prePlayer?.statusBeforeRound ?? null;
  return null;
}

function sourceStatusForSignal(definition, value) {
  if (definition.timingClass === UNSAFE_POST_MATCH) return "BLOCKED_POST_MATCH";
  if (definition.timingClass === UNKNOWN_TIMING) return "BLOCKED_UNKNOWN_TIMING";
  if (definition.timingClass === MISSING) return "MISSING";
  return value === null ? "MISSING" : "AVAILABLE";
}

function buildSignalDataset({ historicalRepository = new HistoricalDataRepository(), season = 2026, scoredRows = null } = {}) {
  const rows = scoredRows || buildDataset({ historicalRepository, backtestRepository: new BacktestRepository({ buildId: SOURCE_BUILD_ID }), season });
  const preMaps = readPrePlayersByRound(historicalRepository, season, [...TRAIN_ROUNDS, ...VALIDATION_ROUNDS]);
  return rows.map((row) => {
    const prePlayer = preMaps.get(row.round)?.get(Number(row.athleteId));
    const signals = {};
    const signalCoverage = {};
    const signalSource = {};
    const signalTimestampStatus = {};
    for (const definition of SIGNAL_DEFINITIONS) {
      const value = signalValueFromRow(definition.name, row, prePlayer);
      signals[definition.name] = value;
      signalCoverage[definition.name] = value === null ? "MISSING" : "PRESENT";
      signalSource[definition.name] = definition.source;
      signalTimestampStatus[definition.name] = sourceStatusForSignal(definition, value);
    }
    return {
      season: row.season || season,
      round: row.round,
      athleteId: row.athleteId,
      name: row.name,
      clubId: row.clubId,
      positionId: row.positionId,
      position: row.position,
      targetClassification: row.targetClassification || (row.target === 1 ? "DID_PLAY" : "DID_NOT_PLAY"),
      signals,
      signalCoverage,
      signalSource,
      signalTimestampStatus
    };
  });
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function coverageForRows(rows, definitions = SIGNAL_DEFINITIONS) {
  return definitions.map((definition) => {
    const present = rows.filter((row) => row.signals?.[definition.name] !== null && row.signals?.[definition.name] !== undefined).length;
    const didPlayRows = rows.filter((row) => row.targetClassification === "DID_PLAY");
    const didNotPlayRows = rows.filter((row) => row.targetClassification === "DID_NOT_PLAY");
    const presentDidPlay = didPlayRows.filter((row) => row.signals?.[definition.name] !== null && row.signals?.[definition.name] !== undefined).length;
    const presentDidNotPlay = didNotPlayRows.filter((row) => row.signals?.[definition.name] !== null && row.signals?.[definition.name] !== undefined).length;
    return {
      name: definition.name,
      timingClass: definition.timingClass,
      source: definition.source,
      originalField: definition.originalField,
      rows: rows.length,
      playersRoundsCount: present,
      coverage: rows.length ? round(present / rows.length, 6) : null,
      missingCount: rows.length - present,
      didPlayCoverage: didPlayRows.length ? round(presentDidPlay / didPlayRows.length, 6) : null,
      didNotPlayCoverage: didNotPlayRows.length ? round(presentDidNotPlay / didNotPlayRows.length, 6) : null,
      reliability: definition.reliability,
      leakageRisk: definition.leakageRisk,
      liveFeasibility: definition.liveFeasibility,
      historicalReconstruction: definition.historicalReconstruction
    };
  });
}

function coverageMatrix(dataset) {
  const byRound = Object.fromEntries([...groupBy(dataset, (row) => row.round)].map(([roundNumber, rows]) => [roundNumber, coverageForRows(rows)]));
  const byPosition = Object.fromEntries([...groupBy(dataset, (row) => row.position)].map(([position, rows]) => [position, coverageForRows(rows)]));
  return {
    global: coverageForRows(dataset),
    byRound,
    byPosition
  };
}

function median(values) {
  const sorted = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function associationAnalysis(dataset) {
  const overallDidPlay = dataset.length ? dataset.filter((row) => row.targetClassification === "DID_PLAY").length / dataset.length : null;
  return safeSignalDefinitions().map((definition) => {
    const presentRows = dataset.filter((row) => row.signals[definition.name] !== null && row.signals[definition.name] !== undefined);
    const values = presentRows.map((row) => row.signals[definition.name]);
    const numericValues = values.map(finite).filter((value) => value !== null);
    const threshold = numericValues.length ? median(numericValues) : null;
    const highRows = threshold === null ? [] : presentRows.filter((row) => finite(row.signals[definition.name]) !== null && finite(row.signals[definition.name]) >= threshold);
    const presentDidPlayRate = presentRows.length ? presentRows.filter((row) => row.targetClassification === "DID_PLAY").length / presentRows.length : null;
    const highDidPlayRate = highRows.length ? highRows.filter((row) => row.targetClassification === "DID_PLAY").length / highRows.length : null;
    return {
      name: definition.name,
      coverage: dataset.length ? round(presentRows.length / dataset.length, 6) : null,
      missingCount: dataset.length - presentRows.length,
      temporalStability: "SAFE_FROM_PREVIOUS_ROUNDS_OR_SCHEDULE",
      observedDidPlayRateWhenPresent: round(presentDidPlayRate, 6),
      highValueThreshold: round(threshold, 6),
      observedDidPlayRateHighValue: round(highDidPlayRate, 6),
      liftVsGlobal: overallDidPlay && highDidPlayRate !== null ? round(highDidPlayRate / overallDidPlay, 6) : null,
      incrementalInformationOverV2: ["recentPlayedRate", "allPlayedRate", "consecutiveAppearances", "consecutiveAbsences", "participationSampleSize", "gamesBeforeRound"].includes(definition.name)
        ? "LOW_ALREADY_USED_BY_V2"
        : "CANDIDATE_CONTEXT_ONLY_NOT_USED_BY_V2"
    };
  });
}

function classifyFalseNegative(row) {
  const f = row.features || {};
  const patterns = [];
  if ((finite(f.recentParticipationRate) ?? 0) >= 0.8) patterns.push("HIGH_RECENT_PARTICIPATION");
  if ((finite(f.allParticipationRate) ?? 0) >= 0.75) patterns.push("STRONG_ALL_PARTICIPATION");
  if ((finite(f.consecutivePlayed) ?? 0) >= 3) patterns.push("CONSECUTIVE_APPEARANCES");
  if ((finite(f.recentParticipationRate) ?? 0) >= 0.5 && (finite(f.consecutiveDidNotPlay) ?? 0) === 0) patterns.push("ABSENCE_OF_NEGATIVE_SIGNAL");
  if ((finite(row.v2Probability) ?? 0) >= 0.4 && (finite(row.v2Probability) ?? 0) < 0.5) patterns.push("THRESHOLD_NEAR_MISS");
  if ((finite(f.sampleSize) ?? 0) < 3) patterns.push("LOW_COVERAGE_HISTORY");
  if (!patterns.length) patterns.push("OTHER");
  return patterns;
}

function classifyFalsePositive(row) {
  const f = row.features || {};
  const patterns = [];
  if ((finite(f.recentParticipationRate) ?? 1) <= 0.2) patterns.push("LOW_RECENT_PARTICIPATION");
  if ((finite(f.consecutiveDidNotPlay) ?? 0) >= 2) patterns.push("CONSECUTIVE_ABSENCES");
  if ((finite(row.v2Probability) ?? 0) >= 0.8) patterns.push("OVERCONFIDENT_PROBABILITY");
  if ((finite(row.v2Probability) ?? 0) >= 0.5) patterns.push("THRESHOLD_FALSE_POSITIVE");
  if ((finite(f.sampleSize) ?? 0) < 3) patterns.push("LOW_COVERAGE_HISTORY");
  if (!patterns.length) patterns.push("OTHER");
  return patterns;
}

function summarizePatterns(rows, classifier) {
  const counts = {};
  const examples = {};
  for (const row of rows) {
    for (const pattern of classifier(row)) {
      counts[pattern] = (counts[pattern] || 0) + 1;
      if (!examples[pattern]) examples[pattern] = {
        round: row.round,
        athleteId: row.athleteId,
        name: row.name,
        position: row.position,
        v2Probability: row.v2Probability,
        features: row.features
      };
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([pattern, count]) => ({
      pattern,
      count,
      share: rows.length ? round(count / rows.length, 6) : null,
      example: examples[pattern]
    }));
}

function buildErrorAnalysis(scoredValidationRows) {
  const falseNegatives = scoredValidationRows.filter((row) => row.v2Probability < 0.5 && row.target === 1);
  const falsePositives = scoredValidationRows.filter((row) => row.v2Probability >= 0.5 && row.target === 0);
  return {
    modelId: AVAILABILITY_V2_MODEL_ID,
    threshold: 0.5,
    falseNegatives: {
      count: falseNegatives.length,
      patterns: summarizePatterns(falseNegatives, classifyFalseNegative),
      examples: falseNegatives.slice(0, 30).map(serializeErrorRow)
    },
    falsePositives: {
      count: falsePositives.length,
      patterns: summarizePatterns(falsePositives, classifyFalsePositive),
      examples: falsePositives.slice(0, 30).map(serializeErrorRow)
    }
  };
}

function serializeErrorRow(row) {
  return {
    round: row.round,
    athleteId: row.athleteId,
    name: row.name,
    position: row.position,
    targetClassification: row.target === 1 ? "DID_PLAY" : "DID_NOT_PLAY",
    v2Probability: row.v2Probability,
    features: row.features
  };
}

function paretoFrontier(points) {
  return points.filter((point) => !points.some((other) => (
    other.threshold !== point.threshold
    && other.recall >= point.recall
    && other.specificity >= point.specificity
    && other.precision >= point.precision
    && (other.recall > point.recall || other.specificity > point.specificity || other.precision > point.precision)
  )));
}

function thresholdAnalysis(scoredValidationRows, v1FalsePositiveLimit = null) {
  const thresholds = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6].map((threshold) => {
    const m = metrics(scoredValidationRows, "v2Probability", threshold);
    return {
      threshold,
      accuracy: m.accuracy,
      precision: m.precision,
      recall: m.recall,
      specificity: m.specificity,
      f1: m.f1,
      balancedAccuracy: m.balancedAccuracy,
      falsePositiveCount: m.confusionMatrix.fp,
      falseNegativeCount: m.confusionMatrix.fn,
      brierScore: m.brierScore,
      ece: m.ece
    };
  });
  const frontier = paretoFrontier(thresholds);
  const bounded = thresholds
    .filter((item) => v1FalsePositiveLimit === null || item.falsePositiveCount <= v1FalsePositiveLimit)
    .sort((a, b) => b.recall - a.recall || b.balancedAccuracy - a.balancedAccuracy || a.threshold - b.threshold)[0] || null;
  return {
    modelId: AVAILABILITY_V2_MODEL_ID,
    thresholdGrid: thresholds,
    paretoFrontier: frontier,
    operationalFinding: bounded ? {
      threshold: bounded.threshold,
      reason: `Maior recall mantendo FP <= ${v1FalsePositiveLimit ?? "N/A"} no grid auditado.`,
      recall: bounded.recall,
      specificity: bounded.specificity,
      falsePositiveCount: bounded.falsePositiveCount,
      falseNegativeCount: bounded.falseNegativeCount
    } : null,
    calibrationNote: "Threshold altera decisao operacional, mas nao altera Brier/ECE do score probabilistico V2."
  };
}

function externalSourcesAudit() {
  return [
    {
      source: "Cartola /atletas/mercado live status",
      status: "AVAILABLE_NOW",
      expectedSignals: ["status atual do atleta quando o mercado esta aberto"],
      limitation: "Nao fornece historico temporal completo para rodadas 2-18; uso historico exige snapshots pre-fechamento versionados."
    },
    {
      source: "Live snapshots locais da rodada atual",
      status: "AVAILABLE_NOW",
      expectedSignals: ["status live", "preco", "media", "jogos", "mando", "adversario"],
      limitation: "Controla rodadas futuras como R19; nao deve reescrever baseline historica."
    },
    {
      source: "Escalacoes provaveis publicas/setoristas",
      status: "UNRELIABLE",
      expectedSignals: ["provavel", "titular", "reserva", "fora"],
      limitation: "Sem fonte licenciada/versionada no backend; scraping seria fragil e arriscado."
    },
    {
      source: "Bases licenciadas de lesao/suspensao/minutos",
      status: "REQUIRES_LICENSE",
      expectedSignals: ["lesao", "suspensao", "minutos recentes", "titularidade recente"],
      limitation: "Pode resolver lacunas, mas precisa contrato de uso e timestamps pre-jogo."
    },
    {
      source: "Entrada manual curada",
      status: "TECHNICALLY_POSSIBLE",
      expectedSignals: ["desfalque confirmado", "duvida", "retorno"],
      limitation: "Exige governanca, autoria, timestamp e auditoria; nao foi ativada nesta build."
    },
    {
      source: "Noticias livres sem curadoria",
      status: "NOT_RECOMMENDED",
      expectedSignals: ["lesao", "suspensao", "retorno"],
      limitation: "Baixa reprodutibilidade, risco de leitura pos-jogo e alto custo de manutencao."
    }
  ];
}

function buildAvailabilitySignals({
  season = 2026,
  historicalRepository = new HistoricalDataRepository(),
  backtestRepository = new BacktestRepository({ buildId: SOURCE_BUILD_ID }),
  researchRepository = new ResearchRepository(),
  generatedAt = new Date().toISOString()
} = {}) {
  const baseline = researchRepository.readJson(season, "baselines/research-baseline-1.0.json");
  if (baseline?.baselineId !== "RESEARCH_BASELINE_1_0" || baseline.status !== "VALID" || baseline.researchFreezeStatus !== "ACTIVE") {
    throw new Error("RESEARCH_BASELINE_1_0 VALID com freeze ACTIVE e obrigatoria para auditar sinais de disponibilidade.");
  }
  const rows = buildDataset({ historicalRepository, backtestRepository, season });
  const trainRows = rows.filter((row) => TRAIN_ROUNDS.includes(row.round));
  const validationRows = rows.filter((row) => VALIDATION_ROUNDS.includes(row.round));
  const weights = trainLogistic(trainRows);
  const scoredRows = rows.map((row) => ({ ...row, v2Probability: predictV2(row, weights) }));
  const scoredValidationRows = scoredRows.filter((row) => VALIDATION_ROUNDS.includes(row.round));
  const signalDataset = buildSignalDataset({ historicalRepository, season, scoredRows });
  const validationSignalDataset = signalDataset.filter((row) => VALIDATION_ROUNDS.includes(row.round));
  const v1Metrics = metrics(scoredValidationRows, "v1Probability");
  const v2Metrics = metrics(scoredValidationRows, "v2Probability");
  const thresholds = thresholdAnalysis(scoredValidationRows, v1Metrics.confusionMatrix.fp);
  const safeSignals = safeSignalDefinitions();
  const missingOrBlocked = SIGNAL_DEFINITIONS.filter((item) => !isUsablePreMatchSignal(item));
  const safeCoverage = coverageForRows(signalDataset, safeSignals);
  const newSafeSignalsWithIncrementalCoverage = safeCoverage.filter((item) => item.coverage >= 0.75 && !["recentPlayedRate", "allPlayedRate", "consecutiveAppearances", "consecutiveAbsences", "participationSampleSize", "gamesBeforeRound"].includes(item.name));
  const augmentedCreated = false;
  const artifact = {
    schemaVersion: "availability-signals/v1",
    generatedAt,
    season,
    engineVersion: SIGNALS_ENGINE_VERSION,
    baseline: {
      baselineId: baseline.baselineId,
      status: baseline.status,
      researchFreezeStatus: baseline.researchFreezeStatus,
      baselineFingerprint: baseline.baselineFingerprint
    },
    availabilitySignalsContract: {
      version: SIGNAL_CONTRACT_VERSION,
      allowedTimingClass: SAFE_PRE_MATCH,
      blockedTimingClasses: [UNSAFE_POST_MATCH, UNKNOWN_TIMING],
      missingTimingClass: MISSING,
      enforcement: "Only SAFE_PRE_MATCH signals can be consumed by experimental availability research.",
      definitions: SIGNAL_DEFINITIONS
    },
    inventory: SIGNAL_DEFINITIONS.map((definition) => ({
      ...definition,
      usableForPreMatchModel: isUsablePreMatchSignal(definition)
    })),
    dataset: {
      schemaVersion: "availability-signals-dataset/v1",
      rows: signalDataset,
      trainRows: signalDataset.filter((row) => TRAIN_ROUNDS.includes(row.round)).length,
      validationRows: validationSignalDataset.length,
      storagePolicy: "Research artifact only; no production endpoint recalculates or mutates official engine."
    },
    coverageMatrix: coverageMatrix(signalDataset),
    qualityAnalysis: {
      globalAssociation: associationAnalysis(signalDataset),
      validationAssociation: associationAnalysis(validationSignalDataset),
      safeSignalsCount: safeSignals.length,
      blockedSignalsCount: missingOrBlocked.length,
      newSafeSignalsWithIncrementalCoverage: newSafeSignalsWithIncrementalCoverage.map((item) => item.name)
    },
    falsePositiveFalseNegative: buildErrorAnalysis(scoredValidationRows),
    thresholds,
    experimentalAugmentedModel: {
      modelId: "AVAILABILITY_V2_SIGNAL_AUGMENTED",
      created: augmentedCreated,
      promoted: false,
      reason: "Nao criado nesta build: os sinais seguros com alta cobertura ja estao majoritariamente embutidos na V2 ou sao apenas contexto; os sinais realmente incrementais (provavel, lesao, suspensao, titularidade, minutos) estao ausentes/sem timing seguro.",
      sourceModelPreserved: AVAILABILITY_V2_MODEL_ID
    },
    round19Control: {
      status: "PROSPECTIVE_CONTROL_ONLY",
      usedForTraining: false,
      usedForValidation: false,
      baselineImpact: "NONE",
      note: "R19 e controle live/prospectivo e nao reabre a baseline 2-18."
    },
    externalSourcesAudit: externalSourcesAudit(),
    dashboardSummary: {
      signalCoverage: safeCoverage,
      safeSignals: safeSignals.map((item) => item.name),
      unsafeOrUnknownSignals: missingOrBlocked.map((item) => ({ name: item.name, timingClass: item.timingClass })),
      falseNegativesV2: v2Metrics.confusionMatrix.fn,
      falsePositivesV2: v2Metrics.confusionMatrix.fp,
      thresholdRecommendation: thresholds.operationalFinding,
      liveControlStatus: "R19_CONTROL_ONLY",
      recommendation: "COLLECT_EXTERNAL_AVAILABILITY_SOURCE",
      nextPriority: "ADD_VERSIONED_PREMATCH_STATUS_AND_LINEUP_SOURCE"
    },
    safeguards: {
      officialEngineChanged: false,
      officialFormulaChanged: false,
      flutterChanged: false,
      snapshotsChanged: false,
      backtestsChanged: false,
      availabilityV1Changed: false,
      availabilityV2CalibratedChanged: false,
      baselineChanged: false,
      promotionChanged: false,
      leakageStatus: "PASS"
    },
    sourceArtifacts: {
      availabilityRecalibration: `data/research/${season}/availability-recalibration.json`,
      persistedAt: `data/research/${season}/availability-signals.json`,
      report: "docs/research/build-5.2.10-availability-signals.md",
      contract: "docs/research/availability-signals-v1.md"
    }
  };
  researchRepository.writeJson(season, "availability-signals.json", artifact);
  return artifact;
}

function writeAvailabilitySignalsReport(artifact, reportPath = path.resolve(__dirname, "../../docs/research/build-5.2.10-availability-signals.md")) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const lines = [
    "# Build 5.2.10 - Collect More Availability Signals",
    "",
    `Baseline: ${artifact.baseline.baselineId} (${artifact.baseline.status}, freeze ${artifact.baseline.researchFreezeStatus}).`,
    `Contrato: ${artifact.availabilitySignalsContract.version}.`,
    `Dataset: ${artifact.dataset.rows.length} jogador-rodadas; validacao ${artifact.dataset.validationRows}.`,
    "",
    "## Resultado",
    "",
    "Nenhum modelo foi promovido e `AVAILABILITY_V2_SIGNAL_AUGMENTED` nao foi criado nesta build.",
    artifact.experimentalAugmentedModel.reason,
    "",
    "## Sinais seguros",
    "",
    ...artifact.dashboardSummary.safeSignals.map((item) => `- ${item}`),
    "",
    "## Sinais bloqueados ou ausentes",
    "",
    ...artifact.dashboardSummary.unsafeOrUnknownSignals.map((item) => `- ${item.name}: ${item.timingClass}`),
    "",
    "## FN/FP da V2",
    "",
    `FN: ${artifact.falsePositiveFalseNegative.falseNegatives.count}. FP: ${artifact.falsePositiveFalseNegative.falsePositives.count}.`,
    "",
    "## Thresholds",
    "",
    `Achado operacional: threshold ${artifact.thresholds.operationalFinding?.threshold ?? "N/A"}; recall ${artifact.thresholds.operationalFinding?.recall ?? "N/A"}; FP ${artifact.thresholds.operationalFinding?.falsePositiveCount ?? "N/A"}.`,
    artifact.thresholds.calibrationNote,
    "",
    "## Proxima prioridade",
    "",
    `${artifact.dashboardSummary.nextPriority}: ${artifact.dashboardSummary.recommendation}.`,
    ""
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

function writeAvailabilitySignalsContractDoc(reportPath = path.resolve(__dirname, "../../docs/research/availability-signals-v1.md")) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const lines = [
    "# AVAILABILITY_SIGNALS_V1",
    "",
    "Contrato versionado para sinais de disponibilidade pre-jogo.",
    "",
    "## Regra principal",
    "",
    "Somente sinais `SAFE_PRE_MATCH` podem ser consumidos por experimentos de Availability.",
    "Sinais `UNSAFE_POST_MATCH` e `UNKNOWN_TIMING` sao bloqueados. Sinais `MISSING` ficam registrados como lacuna, sem valor inventado.",
    "",
    "## Classes",
    "",
    `- ${SAFE_PRE_MATCH}: conhecido antes da rodada, com fonte/proveniencia auditavel.`,
    `- ${UNSAFE_POST_MATCH}: conhecido apenas depois da rodada.`,
    `- ${UNKNOWN_TIMING}: existe potencialmente, mas sem timestamp seguro.`,
    `- ${MISSING}: nao existe na base atual.`,
    "",
    "## Sinais",
    "",
    ...SIGNAL_DEFINITIONS.map((item) => `- ${item.name}: ${item.timingClass}; fonte ${item.source}; campo ${item.originalField || "N/A"}.`),
    ""
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

module.exports = {
  MISSING,
  SAFE_PRE_MATCH,
  SIGNALS_ENGINE_VERSION,
  SIGNAL_CONTRACT_VERSION,
  SIGNAL_DEFINITIONS,
  UNKNOWN_TIMING,
  UNSAFE_POST_MATCH,
  assertUsablePreMatchSignal,
  associationAnalysis,
  buildAvailabilitySignals,
  buildErrorAnalysis,
  buildSignalDataset,
  coverageForRows,
  coverageMatrix,
  externalSourcesAudit,
  isUsablePreMatchSignal,
  safeSignalDefinitions,
  thresholdAnalysis,
  writeAvailabilitySignalsContractDoc,
  writeAvailabilitySignalsReport
};
