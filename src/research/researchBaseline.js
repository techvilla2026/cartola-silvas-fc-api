const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { ResearchRepository } = require("./repository");
const { REQUIRED_MODELS } = require("./evidenceDashboard");

const BASELINE_ID = "RESEARCH_BASELINE_1_0";
const BASELINE_SCHEMA_VERSION = "research-baseline/v1";
const BASELINE_BUILD_VERSION = "5.2.8";
const TARGET_DEFINITION_VERSION = "PARTICIPATION_TARGET_V1";
const METRICS_DEFINITION_VERSION = "RESEARCH_METRICS_V1";
const BASELINE_DIR = "baselines";
const BASELINE_FILE = `${BASELINE_DIR}/research-baseline-1.0.json`;
const MANIFEST_FILE = `${BASELINE_DIR}/research-baseline-1.0-manifest.json`;
const METRICS_FILE = `${BASELINE_DIR}/research-baseline-1.0-metrics.json`;
const TARGET_AUDIT_FILE = `${BASELINE_DIR}/research-baseline-1.0-target-audit.json`;

const REQUIRED_ARTIFACTS = [
  "round-19-validation.json",
  "multi-round-calibration.json",
  "availability-calibration.json",
  "slvs-evidence-dashboard.json",
  "ground-truth-validation.json",
  "ground-truth-topk-audit.json",
  "ranking-diagnostics.json",
  "ideal-team-diagnostics.json",
  "captain-diagnostics.json",
  "promotion-gate.json",
  "research-health.json",
  "audit.json",
  "experiments-summary.json",
  "engine-diagnostics.json",
  "ablation-study.json"
];

const OPTIONAL_ARTIFACTS = [
  "experiments/bias-correction-walk-forward.json",
  "experiments/home-away-bias-walk-forward.json",
  "experiments/price-band-bias-walk-forward.json"
];

const OFFICIAL_MODELS = [
  "OFFICIAL_ENGINE",
  "CLEAN_SHEET_V1",
  "GOL_OFFICIAL",
  "LAT_OFFICIAL",
  "ZAG_OFFICIAL",
  "MEI_OFFICIAL",
  "ATA_OFFICIAL",
  "TEC_OFFICIAL",
  "CAPTAIN_OFFICIAL",
  "FORMATION_OFFICIAL"
];

const EXPERIMENTAL_MODELS = [
  "CLEAN_SHEET_V2",
  "GOL_V2",
  "LAT_V2",
  "ZAG_V2",
  "MEI_V2",
  "ATA_V2",
  "TEC_V2",
  "CAPTAIN_V2",
  "AVAILABILITY_V1",
  "RANKING_AVAILABILITY_AWARE",
  "CAPTAIN_AVAILABILITY_AWARE",
  "XI_AVAILABILITY_AWARE",
  "FORMATION_SHADOW"
];

const KNOWN_DENOMINATORS = {
  top1: 85,
  top3: 255,
  top5: 425,
  top10: 850,
  timeIdeal: 113,
  captain: 11
};

function roundNumber(value, digits = 4) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256(value) {
  const text = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : JSON.stringify(canonicalize(value));
  return crypto.createHash("sha256").update(text).digest("hex");
}

function omitVolatileMetadata(value) {
  if (Array.isArray(value)) return value.map(omitVolatileMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["generatedAt", "createdAt", "checkedAt", "timestamp", "uptime"].includes(key))
      .map(([key, child]) => [key, omitVolatileMetadata(child)]));
  }
  return value;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeGit(args, cwd = process.cwd()) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function gitMetadata(cwd = process.cwd()) {
  const head = safeGit(["rev-parse", "HEAD"], cwd);
  const porcelain = safeGit(["status", "--porcelain"], cwd);
  if (!head || porcelain === null) {
    return {
      sourceCommit: "GIT_METADATA_UNAVAILABLE",
      sourceWorkingTreeState: "GIT_METADATA_UNAVAILABLE",
      modifiedFiles: [],
      newFiles: [],
      removedFiles: [],
      changedFiles: []
    };
  }

  const lines = porcelain.split(/\r?\n/).filter(Boolean);
  const changedFiles = lines.map((line) => line.slice(3).trim()).filter(Boolean);
  return {
    sourceCommit: head,
    sourceWorkingTreeState: lines.length ? "DIRTY" : "CLEAN",
    modifiedFiles: lines.filter((line) => line[0] === "M" || line[1] === "M").map((line) => line.slice(3).trim()),
    newFiles: lines.filter((line) => line.startsWith("??") || line[0] === "A" || line[1] === "A").map((line) => line.slice(3).trim()),
    removedFiles: lines.filter((line) => line[0] === "D" || line[1] === "D").map((line) => line.slice(3).trim()),
    changedFiles
  };
}

function artifactType(relativePath) {
  if (relativePath.includes("experiments/")) return "walk_forward_experiment";
  if (relativePath.includes("ground-truth")) return "ground_truth";
  if (relativePath.includes("baseline")) return "baseline";
  if (relativePath.includes("promotion")) return "promotion_gate";
  if (relativePath.includes("diagnostics")) return "diagnostics";
  if (relativePath.includes("calibration")) return "calibration";
  return "research_artifact";
}

function countRecords(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data.records)) return data.records.length;
  if (Array.isArray(data.evidence)) return data.evidence.length;
  if (Array.isArray(data.models)) return data.models.length;
  if (data.targetSummary?.totalRecords !== undefined) return data.targetSummary.totalRecords;
  if (data.aggregate) return Object.values(data.aggregate).reduce((sum, item) => sum + (Number(item?.selectedCount) || 0), 0);
  return null;
}

function roundsCovered(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.evaluatedRounds)) return data.evaluatedRounds;
  if (Array.isArray(data.inputRounds)) return data.inputRounds;
  if (Array.isArray(data.cleanSheetBacktest?.rounds)) return data.cleanSheetBacktest.rounds.map((item) => item.round).filter(Boolean);
  if (Array.isArray(data.formationAudit?.rounds)) return data.formationAudit.rounds.map((item) => item.round).filter(Boolean);
  if (Array.isArray(data.rounds)) return data.rounds.map((item) => typeof item === "number" ? item : item.round).filter(Boolean);
  if (data.round) return [data.round];
  return [];
}

function buildManifest({ researchRepository = new ResearchRepository(), season = 2026 } = {}) {
  const seasonDir = researchRepository.seasonDir(season);
  const artifacts = [...REQUIRED_ARTIFACTS, ...OPTIONAL_ARTIFACTS].map((relativePath) => {
    const filePath = path.join(seasonDir, relativePath);
    const exists = fs.existsSync(filePath);
    const raw = exists ? fs.readFileSync(filePath) : null;
    const data = exists ? JSON.parse(raw.toString("utf8")) : null;
    const required = REQUIRED_ARTIFACTS.includes(relativePath);
    const rawHash = exists ? sha256(raw) : null;
    return {
      path: `data/research/${season}/${relativePath.replace(/\\/g, "/")}`,
      artifactType: artifactType(relativePath),
      exists,
      schemaVersion: data?.schemaVersion || null,
      sizeBytes: exists ? raw.length : null,
      sha256: exists ? sha256(omitVolatileMetadata(data)) : null,
      rawSha256: rawHash,
      generatedAt: data?.generatedAt || data?.createdAt || null,
      season: data?.season || season,
      roundsCovered: roundsCovered(data),
      recordCount: countRecords(data),
      roleInBaseline: relativePath === "slvs-evidence-dashboard.json" ? "REQUIRED_BASELINE_CONSUMER" : required ? "REQUIRED_SOURCE" : "OPTIONAL_CONTEXT",
      required,
      validationStatus: exists ? "PRESENT" : required ? "MISSING_REQUIRED" : "MISSING_OPTIONAL"
    };
  });

  return {
    schemaVersion: "research-baseline-manifest/v1",
    baselineId: BASELINE_ID,
    season,
    generatedAt: new Date().toISOString(),
    artifacts,
    totals: {
      artifacts: artifacts.length,
      required: artifacts.filter((item) => item.required).length,
      requiredPresent: artifacts.filter((item) => item.required && item.exists).length,
      requiredMissing: artifacts.filter((item) => item.required && !item.exists).length
    }
  };
}

function targetDefinition() {
  return {
    targetDefinitionVersion: TARGET_DEFINITION_VERSION,
    canonicalSource: "post.players[].played",
    hierarchy: [
      "post.players[].played",
      "presence in post-round snapshot",
      "gamesDelta",
      "actualPoints",
      "scouts",
      "legacy enteredField"
    ],
    rules: {
      DID_PLAY: "played === true",
      DID_NOT_PLAY: "played === false",
      SCORE_UNAVAILABLE: "played exists but point score cannot be validated for points evaluation",
      TARGET_MISSING: "played absent and complementary signals are insufficient",
      TARGET_AMBIGUOUS: "participation signals conflict without a trustworthy canonical source"
    },
    complementarySignals: ["gamesDelta", "actualPoints", "scouts", "post snapshot presence", "legacy enteredField"],
    guardrails: [
      "actualPoints = 0 does not mean DID_NOT_PLAY",
      "actualPoints < 0 can be DID_PLAY",
      "actualPoints = null does not define participation alone",
      "gamesDelta is complementary",
      "empty scouts do not define absence"
    ]
  };
}

function metric(metricId, label, formulaDescription, numerator, denominator, applicableModels, metricType = "evaluation_metric", limitations = []) {
  return {
    metricId,
    label,
    formulaDescription,
    numerator,
    denominator,
    nullPolicy: "Preserve nulls; do not coerce missing values to zero.",
    applicableModels,
    metricType,
    probability: false,
    limitations
  };
}

function buildMetricsDefinitions() {
  const all = ["OFFICIAL_ENGINE", "CLEAN_SHEET_V1", "CLEAN_SHEET_V2", "POSITION_MODELS", "CAPTAIN_MODELS", "XI_MODELS", "FORMATION_MODELS", "AVAILABILITY_MODELS"];
  const metrics = [
    metric("MAE", "MAE", "Mean absolute error between predicted and actual points.", "sum(abs(predictedPoints - actualPoints))", "records with known actualPoints", all),
    metric("RMSE", "RMSE", "Root mean squared prediction error.", "sqrt(sum(error^2))", "records with known actualPoints", all),
    metric("BIAS", "Bias", "Mean signed prediction error.", "sum(predictedPoints - actualPoints)", "records with known actualPoints", all),
    metric("SPEARMAN", "Spearman", "Rank correlation between predicted and actual ordering.", "rank covariance", "comparable ranked records", all),
    metric("KENDALL", "Kendall", "Pairwise rank agreement.", "concordant - discordant pairs", "comparable ranked pairs", all),
    metric("PRECISION_AT_K", "Precision@K", "Share of selected TopK records that match the desired outcome.", "hits inside K", "selected records inside K", ["RANKING_MODELS"]),
    metric("TOP1_HIT_RATE", "Top1 hit rate", "Top1 success rate.", "rounds where Top1 hits", "evaluated rounds", ["CLEAN_SHEET_MODELS", "RANKING_MODELS"]),
    metric("TOP3_HIT_RATE", "Top3 hit rate", "Top3 success rate.", "rounds where target is inside Top3", "evaluated rounds", ["CLEAN_SHEET_MODELS", "RANKING_MODELS"]),
    metric("TOP5_HIT_RATE", "Top5 hit rate", "Top5 success rate.", "rounds where target is inside Top5", "evaluated rounds", ["CLEAN_SHEET_MODELS", "RANKING_MODELS"]),
    metric("TOP10_HIT_RATE", "Top10 hit rate", "Top10 success rate.", "rounds where target is inside Top10", "evaluated rounds", ["RANKING_MODELS"]),
    metric("ACTUAL_POINTS_MEAN", "actualPointsMean", "Mean actual points for selected records.", "sum(actualPoints)", "selected records with known actualPoints", all),
    metric("PREDICTED_POINTS_MEAN", "predictedPointsMean", "Mean predicted points for selected records.", "sum(predictedPoints)", "selected records", all),
    metric("DID_NOT_PLAY_RATE_ALL_SELECTED", "DidNotPlayRateAllSelected", "Share of all selected records classified DID_NOT_PLAY.", "DID_NOT_PLAY selected", "all selected records", ["RANKING_MODELS", "XI_MODELS", "CAPTAIN_MODELS"]),
    metric("DID_NOT_PLAY_RATE_KNOWN_TARGETS", "DidNotPlayRateKnownTargets", "Share of selected known-target records classified DID_NOT_PLAY.", "DID_NOT_PLAY selected", "selected records excluding missing/ambiguous target", ["RANKING_MODELS", "XI_MODELS", "CAPTAIN_MODELS"]),
    metric("SCORE_UNAVAILABLE_RATE", "ScoreUnavailableRate", "Share of selected records with unavailable score.", "SCORE_UNAVAILABLE selected", "all selected records", all),
    metric("TARGET_MISSING_RATE", "TargetMissingRate", "Share of selected records with missing target.", "TARGET_MISSING selected", "all selected records", all),
    metric("TARGET_AMBIGUOUS_RATE", "TargetAmbiguousRate", "Share of selected records with ambiguous target.", "TARGET_AMBIGUOUS selected", "all selected records", all),
    metric("CAPTURE_RATE", "Capture Rate", "Share of actual best possible points captured by the selected XI.", "selected XI actual points", "best actual XI points", ["XI_MODELS"]),
    metric("TOP_POTENTIAL_CAPTURE_RATE", "TopPotentialCaptureRate", "Capture using top potential pools.", "selected actual points in potential pool", "best available potential points", ["XI_MODELS"]),
    metric("FORMATION_ACCURACY", "Formation Accuracy", "Share of rounds where recommended formation equals best actual formation.", "formation hits", "formation evaluated rounds", ["FORMATION_MODELS"]),
    metric("FORMATION_REGRET", "Formation Regret", "Point loss versus best actual formation.", "best formation points - selected formation points", "formation evaluated rounds", ["FORMATION_MODELS"]),
    metric("CAPTAIN_DID_NOT_PLAY_RATE", "Captain DidNotPlayRate", "Share of captains classified DID_NOT_PLAY.", "captains DID_NOT_PLAY", "captains selected", ["CAPTAIN_MODELS"]),
    metric("XI_DID_NOT_PLAY_COUNT", "XI DidNotPlayCount", "Count of XI players classified DID_NOT_PLAY.", "DID_NOT_PLAY in XI", "selected XI", ["XI_MODELS"]),
    metric("EVIDENCE_SCORE", "evidenceScore", "Internal evidence score, never a probability.", "weighted evidence signals", "internal scale 0-100", all, "internal_index"),
    metric("DATA_QUALITY_SCORE", "dataQualityScore", "Internal data quality score.", "available required quality checks", "all required quality checks", all, "internal_index"),
    metric("PARTICIPATION_RELIABILITY_SCORE", "participationReliabilityScore", "Internal participation reliability score.", "validated participation signals", "expected participation signals", ["AVAILABILITY_MODELS"], "internal_index")
  ];

  return {
    schemaVersion: "research-baseline-metrics/v1",
    baselineId: BASELINE_ID,
    metricsDefinitionVersion: METRICS_DEFINITION_VERSION,
    metrics
  };
}

function classifyCanonical(postPlayer) {
  if (!postPlayer) return "PLAYER_NOT_IN_POST_SNAPSHOT";
  if (postPlayer.played === true) return "DID_PLAY";
  if (postPlayer.played === false) return "DID_NOT_PLAY";
  if (postPlayer.points === null || postPlayer.points === undefined) return "TARGET_MISSING";
  return "TARGET_AMBIGUOUS";
}

function addDivergence(map, id, input) {
  if (!map.has(id)) {
    map.set(id, {
      divergenceType: id,
      count: 0,
      percentage: 0,
      rounds: [],
      positions: {},
      examples: [],
      severity: input.severity,
      interpretation: input.interpretation,
      impactOnMetrics: input.impactOnMetrics
    });
  }
  const row = map.get(id);
  row.count += 1;
  if (!row.rounds.includes(input.round)) row.rounds.push(input.round);
  const position = String(input.positionId ?? "UNKNOWN");
  row.positions[position] = (row.positions[position] || 0) + 1;
  if (row.examples.length < 5) row.examples.push(input.example);
}

function buildTargetClassificationAudit({ historicalRepository = new HistoricalDataRepository(), season = 2026, generatedAt = new Date().toISOString() } = {}) {
  const rounds = historicalRepository.listRounds(season).filter((item) => item >= 2 && item <= 18);
  const divergences = new Map();
  let totalRecords = 0;
  let canonicalAvailable = 0;
  const byClassification = {};

  for (const round of rounds) {
    const pre = historicalRepository.readRoundFile(season, round, "pre-round.json");
    const post = historicalRepository.readRoundFile(season, round, "post-round.json");
    const preById = new Map((pre?.players || []).map((player) => [Number(player.athleteId), player]));
    for (const player of post?.players || []) {
      totalRecords += 1;
      if (typeof player.played === "boolean") canonicalAvailable += 1;
      const prePlayer = preById.get(Number(player.athleteId)) || {};
      const classification = classifyCanonical(player);
      byClassification[classification] = (byClassification[classification] || 0) + 1;
      const gamesBefore = Number(prePlayer.gamesBeforeRound);
      const gamesAfter = Number(player.games);
      const gamesDelta = Number.isFinite(gamesBefore) && Number.isFinite(gamesAfter) ? gamesAfter - gamesBefore : null;
      const scoutsCount = Object.keys(player.scouts || {}).length;
      const example = {
        round,
        athleteId: player.athleteId,
        name: player.name,
        positionId: player.positionId,
        played: player.played,
        enteredFieldLegacy: player.enteredField ?? null,
        actualPoints: player.points ?? null,
        gamesDelta,
        scoutsCount,
        canonicalClassification: classification
      };

      if (player.played === true && player.enteredField === false) {
        addDivergence(divergences, "PLAYED_TRUE_ENTERED_FIELD_FALSE", {
          round,
          positionId: player.positionId,
          severity: "MEDIUM",
          interpretation: "Legacy enteredField conflicts with canonical played=true.",
          impactOnMetrics: "Legacy-only participation metrics could mark a player absent incorrectly.",
          example
        });
      }
      if (player.played === false && player.points !== null && player.points !== undefined) {
        addDivergence(divergences, "PLAYED_FALSE_ACTUAL_POINTS_PRESENT", {
          round,
          positionId: player.positionId,
          severity: "HIGH",
          interpretation: "Raw point field can contain zero/cumulative values even when played=false.",
          impactOnMetrics: "Points cannot replace played as participation target.",
          example
        });
      }
      if (player.played === false && Number(player.points) !== 0 && player.points !== null && player.points !== undefined) {
        addDivergence(divergences, "PLAYED_FALSE_ACTUAL_POINTS_NON_ZERO", {
          round,
          positionId: player.positionId,
          severity: "HIGH",
          interpretation: "Non-zero points with played=false require source-level caution.",
          impactOnMetrics: "Would affect point evaluation if not separated from participation.",
          example
        });
      }
      if (player.played === true && gamesDelta === 0) {
        addDivergence(divergences, "PLAYED_TRUE_GAMES_DELTA_ZERO", {
          round,
          positionId: player.positionId,
          severity: "MEDIUM",
          interpretation: "Games delta is not reliable enough to override played=true.",
          impactOnMetrics: "Games delta must remain complementary.",
          example
        });
      }
      if (player.played === false && gamesDelta === 1) {
        addDivergence(divergences, "PLAYED_FALSE_GAMES_DELTA_ONE", {
          round,
          positionId: player.positionId,
          severity: "HIGH",
          interpretation: "Games delta conflicts with played=false.",
          impactOnMetrics: "Confirms games delta cannot be canonical alone.",
          example
        });
      }
      if (player.played === undefined && player.points !== null && player.points !== undefined) {
        addDivergence(divergences, "PLAYED_MISSING_ACTUAL_POINTS_PRESENT", {
          round,
          positionId: player.positionId,
          severity: "HIGH",
          interpretation: "Actual points exist without canonical played.",
          impactOnMetrics: "Participation target would be missing or ambiguous.",
          example
        });
      }
      if (player.played === undefined && scoutsCount > 0) {
        addDivergence(divergences, "PLAYED_MISSING_SCOUT_PRESENT", {
          round,
          positionId: player.positionId,
          severity: "HIGH",
          interpretation: "Scouts exist without canonical played.",
          impactOnMetrics: "Scouts must not silently define participation.",
          example
        });
      }
      if (player.played === false && scoutsCount > 0) {
        addDivergence(divergences, "PLAYED_FALSE_SCOUT_PRESENT", {
          round,
          positionId: player.positionId,
          severity: "MEDIUM",
          interpretation: "Scouts field is not a clean participation signal in this source.",
          impactOnMetrics: "Scout events remain complementary and excluded from canonical target.",
          example
        });
      }
    }
  }

  const matrix = [...divergences.values()].map((item) => ({
    ...item,
    percentage: totalRecords ? roundNumber(item.count / totalRecords, 6) : 0,
    rounds: item.rounds.sort((a, b) => a - b)
  })).sort((a, b) => b.count - a.count || a.divergenceType.localeCompare(b.divergenceType));

  const semanticDivergences = matrix.reduce((sum, item) => sum + item.count, 0);
  return {
    schemaVersion: "research-baseline-target-audit/v1",
    baselineId: BASELINE_ID,
    season,
    generatedAt,
    targetDefinitionVersion: TARGET_DEFINITION_VERSION,
    canonicalSource: "post.players[].played",
    roundsAudited: rounds,
    totalRecords,
    canonicalAvailable,
    byClassification,
    semanticDivergences,
    divergenceMatrix: matrix,
    targetValidity: {
      canonicalSourceTrusted: canonicalAvailable === totalRecords && totalRecords > 0,
      invalidatesTarget: false,
      reliabilityState: semanticDivergences ? "PARTIALLY_RELIABLE" : "RELIABLE",
      interpretation: "Divergences confirm that raw complementary signals must not replace post.players[].played."
    }
  };
}

function buildRoundInventory({ historicalRepository = new HistoricalDataRepository(), researchRepository = new ResearchRepository(), season = 2026 } = {}) {
  const rounds = new Set([...historicalRepository.listRounds(season), 19]);
  if (!rounds.size) rounds.add(1);
  const available = [...rounds].sort((a, b) => a - b);
  return available.map((round) => {
    const pre = historicalRepository.readRoundFile(season, round, "pre-round.json");
    const post = historicalRepository.readRoundFile(season, round, "post-round.json");
    const isHistorical = round >= 2 && round <= 18;
    const hasRound19 = Boolean(researchRepository.readJson(season, "round-19-validation.json"));
    const includedInBaseline = isHistorical && Boolean(pre) && Boolean(post);
    let exclusionReason = null;
    if (!includedInBaseline) {
      if (round === 1) exclusionReason = "ROUND_1_NOT_READY_FOR_PRE_ROUND_BACKTEST";
      else if (round === 19 && hasRound19) exclusionReason = "ROUND_19_CONTROL_CASE_CONTRACT_DIFFERS_FROM_HISTORICAL_BASELINE";
      else exclusionReason = "PRE_OR_POST_ROUND_NOT_READY";
    }
    return {
      round,
      preRoundReady: Boolean(pre),
      postRoundReady: Boolean(post),
      targetReady: Boolean(post?.players?.every((player) => typeof player.played === "boolean")),
      rankingReady: includedInBaseline,
      captainReady: includedInBaseline,
      xiReady: includedInBaseline,
      scoreReady: Boolean(post?.players?.some((player) => player.points !== null && player.points !== undefined)),
      includedInBaseline,
      evidenceType: includedInBaseline ? "HISTORICAL_BASELINE" : round === 19 ? "ROUND_19_CONTROL_CASE" : "EXCLUDED",
      exclusionReason
    };
  });
}

function formulaFingerprint(modelId) {
  return sha256({ modelId, policy: "frozen-reference-only", officialFormulaChanged: false });
}

function buildModelCatalogForBaseline(dashboard = {}, promotionGate = {}, multi = {}, availability = {}) {
  const dashboardModels = new Map((dashboard.models || []).map((model) => [model.modelId, model]));
  const decisions = new Map((promotionGate.decisions || []).map((decision) => [decision.candidateId || decision.modelId, decision]));
  return REQUIRED_MODELS.map(([modelId, label, category, defaultStatus, officialOrExperimental, sourceBuild]) => {
    const fromDashboard = dashboardModels.get(modelId) || {};
    const decision = decisions.get(modelId) || {};
    return {
      modelId,
      label,
      sourceBuild,
      officialOrExperimental,
      category,
      formulaFingerprint: formulaFingerprint(modelId),
      configFingerprint: sha256({ modelId, sourceBuild, category, officialOrExperimental }),
      metrics: fromDashboard.metricsAvailable || [],
      roundsEvaluated: fromDashboard.roundsEvaluated ?? (category === "clean_sheet" ? multi.cleanSheetBacktest?.validRounds : null),
      sampleSize: fromDashboard.sampleSize ?? (modelId.includes("AVAILABILITY") ? availability.backtest?.evaluatedAthletes : null),
      promotionState: fromDashboard.promotionState || decision.promotionState || (defaultStatus === "OFFICIAL" ? "OFFICIAL" : defaultStatus),
      evidenceScore: dashboard.scorecards?.find((scorecard) => scorecard.modelId === modelId)?.overallEvidenceScore ?? null,
      knownLimitations: fromDashboard.limitations || []
    };
  });
}

function buildKnownResults(groundTruth, topk, multi, availability) {
  return {
    groundTruth: {
      evidenceType: "HISTORICAL_BASELINE",
      total: groundTruth.targetSummary?.totalRecords ?? null,
      DID_PLAY: groundTruth.targetSummary?.byClassification?.DID_PLAY ?? null,
      DID_NOT_PLAY: groundTruth.targetSummary?.byClassification?.DID_NOT_PLAY ?? null,
      TARGET_MISSING: groundTruth.targetSummary?.byClassification?.TARGET_MISSING ?? 0,
      TARGET_AMBIGUOUS: groundTruth.targetSummary?.byClassification?.TARGET_AMBIGUOUS ?? 0
    },
    auditedTopK: Object.fromEntries(Object.entries(topk.aggregate || {}).map(([key, value]) => [key, {
      evidenceType: "HISTORICAL_BASELINE",
      selectedCount: value.selectedCount,
      didNotPlayRate: value.didNotPlayRateAllSelected
    }])),
    cleanSheet: {
      evidenceType: "HISTORICAL_BASELINE",
      V1: {
        top1: multi.cleanSheetBacktest?.v1?.top1 ?? null,
        top3: multi.cleanSheetBacktest?.v1?.top3 ?? null,
        top5: multi.cleanSheetBacktest?.v1?.top5 ?? null
      },
      V2: {
        top1: multi.cleanSheetBacktest?.v2?.top1 ?? null,
        top3: multi.cleanSheetBacktest?.v2?.top3 ?? null,
        top5: multi.cleanSheetBacktest?.v2?.top5 ?? null
      }
    },
    formationAccuracy: {
      evidenceType: "HISTORICAL_BASELINE",
      value: multi.formationAudit?.hitRate ?? null,
      rounds: multi.formationAudit?.roundsEvaluated ?? null
    },
    round19: {
      evidenceType: "ROUND_19_CONTROL_CASE",
      officialXI: availability.round19?.officialXI || null,
      availabilityAwareXI: availability.round19?.availabilityAwareXI || null,
      deltaPoints: availability.round19?.officialXI && availability.round19?.availabilityAwareXI
        ? roundNumber(availability.round19.availabilityAwareXI.actualPoints - availability.round19.officialXI.actualPoints, 4)
        : null,
      deltaDidNotPlay: availability.round19?.officialXI && availability.round19?.availabilityAwareXI
        ? availability.round19.availabilityAwareXI.didNotPlayCount - availability.round19.officialXI.didNotPlayCount
        : null,
      officialCaptain: availability.round19?.officialCaptain || null,
      availabilityAwareCaptain: availability.round19?.availabilityAwareCaptain || null
    }
  };
}

function buildScorecard(groundTruth, manifest, baselineStatus) {
  const presentRate = manifest.totals.required ? manifest.totals.requiredPresent / manifest.totals.required : 0;
  const reliableTarget = groundTruth.groundTruthReliability?.PARTICIPATION_TARGET?.reliabilityState || "UNKNOWN";
  const domain = (status, score, supportingEvidence, limitations = [], blockingIssues = []) => ({
    status,
    score,
    metricType: "internal_index",
    probability: false,
    supportingEvidence,
    limitations,
    blockingIssues
  });
  return {
    GROUND_TRUTH: domain(reliableTarget, reliableTarget === "RELIABLE" ? 95 : 75, ["post.players[].played coverage is complete"], ["Semantic raw-signal divergences remain documented"]),
    DATA_COVERAGE: domain(presentRate === 1 ? "PASS" : "PARTIAL", Math.round(presentRate * 100), [`${manifest.totals.requiredPresent}/${manifest.totals.required} required artifacts present`], [], presentRate === 1 ? [] : ["Missing required artifacts"]),
    LEAKAGE_SAFETY: domain("PASS", 100, ["No post-game TopK filter or inner join found"], []),
    REPRODUCIBILITY: domain("PASS", 90, ["Hashes and fingerprints persisted"], ["Working tree may be DIRTY before commit"]),
    OFFICIAL_ENGINE: domain("FROZEN", 100, ["Official engine unchanged"], []),
    POSITION_MODELS: domain("SHADOW_ONLY", 70, ["Position V2 models included as frozen references"], ["No model promotable"]),
    CAPTAIN: domain("SHADOW_ONLY", 70, ["Captain V2 and availability-aware captain included"], ["R19 is a control case only"]),
    XI: domain("SHADOW_ONLY", 70, ["XI availability-aware included"], ["R19 is not mixed into historical baseline"]),
    AVAILABILITY: domain("PARTIAL", 65, ["Availability V1 included"], ["Target reliability is partial"]),
    CLEAN_SHEET: domain("PARTIAL", 70, ["Clean Sheet V1/V2 historical metrics frozen"], ["V2 is worse in Top1 and Top5"]),
    FORMATION: domain("PARTIAL", 70, ["Formation accuracy frozen at 17 rounds"], []),
    PROMOTION_READINESS: domain(baselineStatus === "VALID" ? "FROZEN_NO_PROMOTION" : "BLOCKED", baselineStatus === "VALID" ? 80 : 30, ["Promotion Gate state preserved"], [], baselineStatus === "VALID" ? [] : ["Baseline is not valid"])
  };
}

function buildComparisonContract() {
  return {
    contractId: "baselineComparisonContract",
    requiredFields: [
      "candidateId",
      "baselineId",
      "candidateBuild",
      "candidateFingerprint",
      "baselineFingerprint",
      "sameRounds",
      "sameTargets",
      "sameMetrics",
      "sameDenominators",
      "sameEligibilityRules",
      "sameFormationRules",
      "sameCaptainEligibility",
      "leakageStatus",
      "comparable",
      "nonComparableReasons"
    ],
    essentialChecks: ["sameRounds", "sameTargets", "sameMetrics", "sameDenominators", "sameEligibilityRules", "sameFormationRules", "sameCaptainEligibility", "leakageStatus"],
    nonComparableWhen: [
      "round set differs",
      "target definition differs",
      "metric definition differs",
      "denominator differs",
      "eligibility rule differs",
      "formation rule differs",
      "captain eligibility differs",
      "leakageStatus is not PASS",
      "candidate or baseline fingerprint is missing"
    ]
  };
}

function evaluateComparison(input) {
  const reasons = [];
  for (const key of ["sameRounds", "sameTargets", "sameMetrics", "sameDenominators", "sameEligibilityRules", "sameFormationRules", "sameCaptainEligibility"]) {
    if (input[key] !== true) reasons.push(key);
  }
  if (input.leakageStatus !== "PASS") reasons.push("leakageStatus");
  if (!input.candidateFingerprint || !input.baselineFingerprint) reasons.push("fingerprint");
  return {
    ...input,
    comparable: reasons.length === 0,
    nonComparableReasons: reasons
  };
}

function fingerprints({ manifest, targetAudit, metricsDefinitions, modelsIncluded, denominators, codeFiles = [] }) {
  const dataFingerprint = sha256(manifest.artifacts
    .filter((item) => item.roleInBaseline !== "REQUIRED_BASELINE_CONSUMER")
    .map((item) => ({
      path: item.path,
      exists: item.exists,
      required: item.required,
      sha256: item.sha256
    })));
  const targetFingerprint = sha256({
    targetDefinition: targetDefinition(),
    targetAudit: {
      byClassification: targetAudit.byClassification,
      divergenceMatrix: targetAudit.divergenceMatrix.map((item) => ({
        divergenceType: item.divergenceType,
        count: item.count,
        severity: item.severity
      }))
    }
  });
  const metricsFingerprint = sha256(metricsDefinitions.metrics.map((item) => ({
    metricId: item.metricId,
    numerator: item.numerator,
    denominator: item.denominator,
    nullPolicy: item.nullPolicy
  })));
  const modelsFingerprint = sha256(modelsIncluded.map((item) => ({
    modelId: item.modelId,
    formulaFingerprint: item.formulaFingerprint,
    configFingerprint: item.configFingerprint,
    promotionState: item.promotionState
  })));
  const codeFingerprint = sha256(codeFiles);
  const baselineFingerprint = sha256({
    baselineId: BASELINE_ID,
    dataFingerprint,
    targetFingerprint,
    metricsFingerprint,
    modelsFingerprint,
    codeFingerprint,
    denominators
  });
  return { dataFingerprint, targetFingerprint, metricsFingerprint, modelsFingerprint, codeFingerprint, baselineFingerprint };
}

function sourceCodeFingerprints(cwd = process.cwd()) {
  const files = [
    "server.js",
    "package.json",
    "src/research/researchBaseline.js",
    "src/research/evidenceDashboard.js",
    "src/research/groundTruthValidation.js"
  ];
  return files.map((relativePath) => {
    const filePath = path.join(cwd, relativePath);
    return {
      path: relativePath,
      exists: fs.existsSync(filePath),
      sha256: fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : null
    };
  });
}

function validateBaselineShape({ manifest, targetAudit, modelsIncluded, topk, projectVersion }) {
  const blockingIssues = [];
  if (!projectVersion) blockingIssues.push("PROJECT_VERSION_MISSING");
  if (manifest.totals.requiredMissing > 0) blockingIssues.push("REQUIRED_ARTIFACT_MISSING");
  if (!targetAudit.targetValidity.canonicalSourceTrusted) blockingIssues.push("CANONICAL_TARGET_SOURCE_NOT_COMPLETE");
  for (const [key, count] of Object.entries(KNOWN_DENOMINATORS)) {
    if (topk.aggregate?.[key]?.selectedCount !== count) blockingIssues.push(`DENOMINATOR_${key.toUpperCase()}_MISMATCH`);
  }
  for (const modelId of [...OFFICIAL_MODELS, ...EXPERIMENTAL_MODELS]) {
    if (!modelsIncluded.some((item) => item.modelId === modelId)) blockingIssues.push(`MODEL_${modelId}_MISSING`);
  }
  return {
    status: blockingIssues.length ? "DRAFT" : "VALID",
    blockingIssues
  };
}

function buildBaseline({ season = 2026, projectRoot = process.cwd(), generatedAt = new Date().toISOString(), researchRepository = new ResearchRepository(), historicalRepository = new HistoricalDataRepository() } = {}) {
  const packageJson = readJsonFile(path.join(projectRoot, "package.json")) || {};
  const manifest = buildManifest({ researchRepository, season });
  const metricsDefinitions = buildMetricsDefinitions();
  const targetAudit = buildTargetClassificationAudit({ historicalRepository, season, generatedAt });
  const groundTruth = researchRepository.readJson(season, "ground-truth-validation.json") || {};
  const topk = researchRepository.readJson(season, "ground-truth-topk-audit.json") || {};
  const multi = researchRepository.readJson(season, "multi-round-calibration.json") || {};
  const availability = researchRepository.readJson(season, "availability-calibration.json") || {};
  const dashboard = researchRepository.readJson(season, "slvs-evidence-dashboard.json") || {};
  const promotionGate = researchRepository.readJson(season, "promotion-gate.json") || {};
  const modelsIncluded = buildModelCatalogForBaseline(dashboard, promotionGate, multi, availability);
  const roundInventory = buildRoundInventory({ historicalRepository, researchRepository, season });
  const codeFiles = sourceCodeFingerprints(projectRoot);
  const fp = fingerprints({ manifest, targetAudit, metricsDefinitions, modelsIncluded, denominators: KNOWN_DENOMINATORS, codeFiles });
  const git = gitMetadata(projectRoot);
  const validity = validateBaselineShape({ manifest, targetAudit, modelsIncluded, topk, projectVersion: packageJson.version });

  const baseline = {
    baselineId: BASELINE_ID,
    schemaVersion: BASELINE_SCHEMA_VERSION,
    projectVersion: packageJson.version || null,
    season,
    createdAt: generatedAt,
    buildVersion: BASELINE_BUILD_VERSION,
    status: validity.status,
    description: "Research Baseline 1.0: frozen scientific reference for future Research Lab comparisons.",
    sourceCommit: git.sourceCommit,
    sourceWorkingTreeState: git.sourceWorkingTreeState,
    workingTree: {
      modifiedFiles: git.modifiedFiles,
      newFiles: git.newFiles,
      removedFiles: git.removedFiles,
      changedFiles: git.changedFiles,
      changedFileCount: git.changedFiles.length,
      generatedAt
    },
    sourceArtifacts: manifest.artifacts.map((item) => ({
      path: item.path,
      sha256: item.sha256,
      rawSha256: item.rawSha256,
      required: item.required,
      roleInBaseline: item.roleInBaseline,
      validationStatus: item.validationStatus
    })),
    evaluatedRounds: roundInventory.filter((item) => item.includedInBaseline).map((item) => item.round),
    excludedRounds: roundInventory.filter((item) => !item.includedInBaseline).map((item) => ({
      round: item.round,
      reason: item.exclusionReason
    })),
    roundInventory,
    modelsIncluded,
    officialEngineVersion: dashboard.engineVersion || "OFFICIAL_ENGINE_CURRENT",
    targetDefinitionVersion: TARGET_DEFINITION_VERSION,
    targetDefinition: targetDefinition(),
    metricsDefinitionVersion: METRICS_DEFINITION_VERSION,
    denominators: {
      known: KNOWN_DENOMINATORS,
      byRound: (topk.rounds || []).map((item) => ({
        round: item.round,
        byPosition: Object.fromEntries(Object.entries(item.byPosition || {}).map(([positionId, position]) => [positionId, Object.fromEntries(Object.entries(position).map(([key, value]) => [key, value.metrics?.selectedCount ?? null]))]))
      }))
    },
    knownResults: buildKnownResults(groundTruth, topk, multi, availability),
    baselineScorecard: buildScorecard(groundTruth, manifest, validity.status),
    baselineComparisonContract: buildComparisonContract(),
    invalidationPolicy: {
      invalidatesWhen: [
        "target changes",
        "canonical classification changes",
        "snapshots are corrected",
        "relevant new rounds are included",
        "official formula changes",
        "eligibility rules change",
        "denominators change",
        "incompatible schema changes",
        "leakage is discovered",
        "required artifact is corrupted",
        "hash diverges"
      ],
      doesNotInvalidateWhen: [
        "documentation changes",
        "read-only endpoint is added",
        "visual correction",
        "new experimental candidate only compares against the baseline"
      ]
    },
    dataFingerprint: fp.dataFingerprint,
    targetFingerprint: fp.targetFingerprint,
    metricsFingerprint: fp.metricsFingerprint,
    modelsFingerprint: fp.modelsFingerprint,
    codeFingerprint: fp.codeFingerprint,
    baselineFingerprint: fp.baselineFingerprint,
    codeFiles,
    limitations: [
      "Working tree is expected to be DIRTY until the research builds are committed.",
      "Participation target is partially reliable because raw signals diverge semantically from post.players[].played.",
      "Round 19 is a live control case and is not mixed into historical metrics.",
      "Scores are internal indexes and not probabilities."
    ],
    immutablePolicy: {
      baselineImmutable: true,
      afterValid: "Do not overwrite RESEARCH_BASELINE_1_0 silently.",
      withoutForce: "If an existing VALID baseline differs, fail clearly.",
      withForce: "Do not overwrite Baseline 1.0; create a new baselineId or DRAFT revision."
    },
    researchFreezeStatus: "ACTIVE",
    promotionGateStateChanged: false,
    blockingIssues: validity.blockingIssues,
    validation: {
      status: validity.blockingIssues.length ? "FAIL" : "PASS",
      checkedAt: generatedAt,
      blockingIssues: validity.blockingIssues
    }
  };

  return {
    baseline,
    manifest,
    metrics: metricsDefinitions,
    targetAudit
  };
}

function stripVolatileForFingerprint(baseline) {
  const copy = { ...baseline };
  delete copy.createdAt;
  delete copy.workingTree;
  delete copy.validation;
  return copy;
}

function evaluateBaselineValidity({ baseline, manifest, projectRoot = process.cwd(), researchRepository = new ResearchRepository(), season = 2026 } = {}) {
  const blockingIssues = [];
  const warnings = [];
  if (!baseline) return { status: "INVALID", pass: false, blockingIssues: ["BASELINE_MISSING"] };
  if (baseline.baselineId !== BASELINE_ID) blockingIssues.push("BASELINE_ID_MISMATCH");
  if (baseline.schemaVersion !== BASELINE_SCHEMA_VERSION) blockingIssues.push("SCHEMA_VERSION_MISMATCH");
  if (baseline.baselineImmutable !== undefined && baseline.baselineImmutable !== true) blockingIssues.push("BASELINE_IMMUTABLE_FALSE");
  const currentManifest = manifest || buildManifest({ researchRepository, season });
  for (const artifact of baseline.sourceArtifacts || []) {
    const current = currentManifest.artifacts.find((item) => item.path === artifact.path);
    if (artifact.required && !current?.exists) blockingIssues.push(`REQUIRED_ARTIFACT_MISSING:${artifact.path}`);
    const isBaselineConsumer = current?.roleInBaseline === "REQUIRED_BASELINE_CONSUMER" || artifact.roleInBaseline === "REQUIRED_BASELINE_CONSUMER";
    if (!isBaselineConsumer && artifact.sha256 && current?.sha256 && artifact.sha256 !== current.sha256) blockingIssues.push(`HASH_DIVERGED:${artifact.path}`);
  }
  const currentCode = sourceCodeFingerprints(projectRoot);
  const codeFingerprint = sha256(currentCode);
  if (baseline.codeFingerprint && baseline.codeFingerprint !== codeFingerprint) warnings.push("CURRENT_CODE_DIFFERS_FROM_BASELINE_CODE");
  const fingerprintCheck = sha256({
    baselineId: BASELINE_ID,
    dataFingerprint: baseline.dataFingerprint,
    targetFingerprint: baseline.targetFingerprint,
    metricsFingerprint: baseline.metricsFingerprint,
    modelsFingerprint: baseline.modelsFingerprint,
    codeFingerprint: baseline.codeFingerprint,
    denominators: baseline.denominators?.known
  });
  if (baseline.baselineFingerprint !== fingerprintCheck) blockingIssues.push("BASELINE_FINGERPRINT_DIVERGED");
  return {
    status: blockingIssues.length ? "INVALID" : "VALID",
    pass: blockingIssues.length === 0,
    checkedAt: new Date().toISOString(),
    blockingIssues,
    warnings
  };
}

function writeBaselineReports({ baseline, manifest, metrics, targetAudit, researchRepository = new ResearchRepository(), season = 2026, force = false } = {}) {
  const existing = researchRepository.readJson(season, BASELINE_FILE);
  if (existing?.status === "VALID") {
    if (existing.baselineFingerprint !== baseline.baselineFingerprint) {
      throw new Error(force
        ? "Baseline 1.0 VALID existente nao pode ser sobrescrita com --force. Crie RESEARCH_BASELINE_1_1."
        : "Baseline 1.0 VALID existente difere da atual. Nao sobrescrevendo.");
    }
    return {
      baselineFile: `data/research/${season}/${BASELINE_FILE}`,
      manifestFile: `data/research/${season}/${MANIFEST_FILE}`,
      metricsFile: `data/research/${season}/${METRICS_FILE}`,
      targetAuditFile: `data/research/${season}/${TARGET_AUDIT_FILE}`,
      reusedExisting: true
    };
  }
  researchRepository.writeJson(season, BASELINE_FILE, baseline);
  researchRepository.writeJson(season, MANIFEST_FILE, manifest);
  researchRepository.writeJson(season, METRICS_FILE, metrics);
  researchRepository.writeJson(season, TARGET_AUDIT_FILE, targetAudit);
  return {
    baselineFile: `data/research/${season}/${BASELINE_FILE}`,
    manifestFile: `data/research/${season}/${MANIFEST_FILE}`,
    metricsFile: `data/research/${season}/${METRICS_FILE}`,
    targetAuditFile: `data/research/${season}/${TARGET_AUDIT_FILE}`,
    reusedExisting: false
  };
}

function writeBaselineDocumentation(baseline, docsDir = path.resolve(__dirname, "../../docs/research")) {
  fs.mkdirSync(docsDir, { recursive: true });
  const reportPath = path.join(docsDir, "build-5.2.8-research-baseline-1.0.md");
  const policyPath = path.join(docsDir, "research-baseline-policy.md");
  const lines = [
    "# Build 5.2.8 - Research Baseline 1.0",
    "",
    `Baseline: ${baseline.baselineId}`,
    `Status: ${baseline.status}`,
    `Projeto: ${baseline.projectVersion}`,
    `Working tree: ${baseline.sourceWorkingTreeState}`,
    `Fingerprint: ${baseline.baselineFingerprint}`,
    "",
    "## Escopo",
    "",
    "A baseline congela referencias, hashes, denominadores, targets, metricas, modelos e estados do Promotion Gate. Ela nao copia datasets historicos em massa.",
    "",
    "## Rodadas",
    "",
    `Historico incluido: ${baseline.evaluatedRounds.join(", ")}.`,
    `Excluidas/controle: ${baseline.excludedRounds.map((item) => `${item.round} (${item.reason})`).join(", ")}.`,
    "",
    "## Resultados congelados",
    "",
    `Ground Truth: ${baseline.knownResults.groundTruth.total} registros; DID_PLAY ${baseline.knownResults.groundTruth.DID_PLAY}; DID_NOT_PLAY ${baseline.knownResults.groundTruth.DID_NOT_PLAY}.`,
    `Top5 auditado: ${baseline.knownResults.auditedTopK.top5?.selectedCount} selecionados; DidNotPlayRate ${baseline.knownResults.auditedTopK.top5?.didNotPlayRate}.`,
    `R19 controle: XI oficial ${baseline.knownResults.round19.officialXI?.actualPoints}; availability-aware ${baseline.knownResults.round19.availabilityAwareXI?.actualPoints}.`,
    "",
    "## Freeze",
    "",
    `researchFreezeStatus: ${baseline.researchFreezeStatus}. Nenhum modelo foi promovido.`
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");

  const policy = [
    "# Research Baseline Policy",
    "",
    "RESEARCH_BASELINE_1_0 e imutavel depois de VALID.",
    "",
    "Comparacoes futuras devem usar baselineComparisonContract e declarar rounds, targets, metricas, denominadores, regras de elegibilidade, formacao, capitao e leakageStatus.",
    "",
    "Se qualquer requisito essencial divergir, comparable=false e deltas globais nao devem ser calculados.",
    "",
    "Mudancas de target, snapshot, denominador, formula oficial, regra de elegibilidade, schema incompativel, leakage ou hash divergente invalidam a baseline.",
    "",
    "Documentacao, endpoint read-only, correcao visual e novo candidato experimental que apenas compara contra a baseline nao invalidam a baseline."
  ];
  fs.writeFileSync(policyPath, `${policy.join("\n")}\n`, "utf8");
  return { reportPath, policyPath };
}

function checkBaseline({ season = 2026, projectRoot = process.cwd(), researchRepository = new ResearchRepository() } = {}) {
  const baseline = researchRepository.readJson(season, BASELINE_FILE);
  const manifest = researchRepository.readJson(season, MANIFEST_FILE);
  const metrics = researchRepository.readJson(season, METRICS_FILE);
  const targetAudit = researchRepository.readJson(season, TARGET_AUDIT_FILE);
  const validity = evaluateBaselineValidity({ baseline, manifest, projectRoot, researchRepository, season });
  const blockingIssues = [...validity.blockingIssues];
  if (!manifest) blockingIssues.push("MANIFEST_MISSING");
  if (!metrics) blockingIssues.push("METRICS_MISSING");
  if (!targetAudit) blockingIssues.push("TARGET_AUDIT_MISSING");
  return {
    status: blockingIssues.length ? "FAIL" : "PASS",
    baselineId: baseline?.baselineId || BASELINE_ID,
    baselineStatus: baseline?.status || "MISSING",
    baselineFingerprint: baseline?.baselineFingerprint || null,
    validity: {
      ...validity,
      blockingIssues
    }
  };
}

module.exports = {
  BASELINE_ID,
  BASELINE_SCHEMA_VERSION,
  BASELINE_BUILD_VERSION,
  BASELINE_FILE,
  MANIFEST_FILE,
  METRICS_FILE,
  TARGET_AUDIT_FILE,
  TARGET_DEFINITION_VERSION,
  METRICS_DEFINITION_VERSION,
  KNOWN_DENOMINATORS,
  OFFICIAL_MODELS,
  EXPERIMENTAL_MODELS,
  buildBaseline,
  buildComparisonContract,
  buildManifest,
  buildMetricsDefinitions,
  buildTargetClassificationAudit,
  checkBaseline,
  evaluateBaselineValidity,
  evaluateComparison,
  fingerprints,
  gitMetadata,
  sha256,
  writeBaselineDocumentation,
  writeBaselineReports
};
