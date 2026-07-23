const express = require("express");
const { HistoricalDataRepository } = require("./src/historical/repositories/fileRepository");
const { buildAuditSummary } = require("./src/historical/audit");
const { parseRound, parseSeason } = require("./src/historical/domain/validation");
const { analyzeScoutDivergences } = require("./src/historical/reconstruction/scoutDivergence");
const { BacktestRepository } = require("./src/backtest/repository");
const { EnrichedHistoricalRepository } = require("./src/historical/enrichment/enrichedRepository");
const { buildEnrichedAudit } = require("./src/historical/enrichment/audit");
const { LiveSnapshotRepository } = require("./src/liveSnapshot/repositories/fileRepository");
const { auditLiveSnapshots, coverage: liveSnapshotCoverage, findSnapshot } = require("./src/liveSnapshot/services/audit");
const { parseLiveRound, parseSnapshotId } = require("./src/liveSnapshot/domain/validation");
const { storageHealth } = require("./src/liveSnapshot/services/storageHealth");
const { buildProductionHealth } = require("./src/liveSnapshot/services/productionHealth");
const { ResearchRepository } = require("./src/research/repository");
const {
  buildCalendarContext,
  buildContextFeatureDiagnostics,
  buildPlayerContextContract,
  buildRealRoundEvaluation,
  buildResults,
  buildRoundContext,
  buildTeamContext,
  buildTeamContextDiagnostic,
  buildReserveRulesContract,
  buildFormationContract
} = require("./src/realRoundContext/service");

const SERVICE_NAME = "cartola-silvas-fc-api";
const BACKEND_VERSION = "5.2.0";
const DEFAULT_PORT = 3000;
const CARTOLA_API_BASE_URL = "https://api.cartolafc.globo.com";
const DEFAULT_TIMEOUT_MS = 8000;
const PUBLIC_APP_ORIGIN = "https://meutimeideal.netlify.app";
const LEGACY_PUBLIC_APP_ORIGIN = "https://utimeideal.netlify.app";
const CORS_ALLOWED_METHODS = "GET,OPTIONS";
const CORS_ALLOWED_HEADERS = "Accept,Content-Type,Authorization,X-Requested-With";
const CORS_MAX_AGE_SECONDS = "86400";

const DEFAULT_ALLOWED_ORIGINS = [
  PUBLIC_APP_ORIGIN,
  LEGACY_PUBLIC_APP_ORIGIN
];

function parseAllowedOrigins(value) {
  const extraOrigins = (value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins])];
}

function isLocalhostOrigin(origin) {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.has(origin) || isLocalhostOrigin(origin);
}

function createCorsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins);

  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    if (isAllowedCorsOrigin(origin, allowed)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
      res.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
      res.setHeader("Access-Control-Max-Age", CORS_MAX_AGE_SECONDS);
    }

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    return next();
  };
}

function buildUpstreamUrl(path, searchParams) {
  const url = new URL(path, CARTOLA_API_BASE_URL);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function parseContentType(headers) {
  return headers.get("content-type") || "";
}

async function readUpstreamBody(response) {
  const contentType = parseContentType(response.headers);
  const text = await response.text();

  if (!text) {
    return { body: null, isJson: true };
  }

  if (contentType.includes("application/json")) {
    try {
      return { body: JSON.parse(text), isJson: true };
    } catch {
      return { body: text, isJson: false, invalidJson: true };
    }
  }

  try {
    return { body: JSON.parse(text), isJson: true };
  } catch {
    return { body: text, isJson: false };
  }
}

function sendProxyError(res, status, code, message, details) {
  return res.status(status).json({
    error: {
      code,
      message,
      upstream: "Cartola FC",
      ...(details ? { details } : {})
    }
  });
}

function sendValidationError(res, code, message) {
  return res.status(400).json({
    error: {
      code,
      message
    }
  });
}

function isPositiveInteger(value) {
  return /^[1-9]\d*$/.test(value);
}

function sendNotFound(res, message) {
  return res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message
    }
  });
}

function sendBadRequest(res, code, message) {
  return res.status(400).json({
    error: {
      code,
      message
    }
  });
}

function firstValidSnapshotId(manifest) {
  return manifest?.firstValidSnapshotId
    || manifest?.snapshots?.find((item) => item.isValidPreRoundSnapshot)?.snapshotId
    || null;
}

function finalPreCloseSnapshotId(manifest) {
  return manifest?.finalPreCloseSnapshotId || manifest?.lastValidPreRoundSnapshotId || null;
}

function finalCaptureQuality(manifest) {
  if (manifest?.finalCaptureQuality) return manifest.finalCaptureQuality;
  return finalPreCloseSnapshotId(manifest) ? "EARLIER_VALID_FALLBACK" : "UNAVAILABLE";
}

async function proxyCartola(req, res, options) {
  const timeoutMs = req.app.locals.timeoutMs;
  const fetchImpl = req.app.locals.fetchImpl;
  const url = buildUpstreamUrl(options.path, options.searchParams);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": `${SERVICE_NAME}/${BACKEND_VERSION}`
      },
      signal: controller.signal
    });

    const { body, isJson, invalidJson } = await readUpstreamBody(response);

    if (isJson) {
      return res.status(response.status).json(body);
    }

    if (invalidJson) {
      return sendProxyError(
        res,
        response.ok ? 502 : response.status,
        "UPSTREAM_INVALID_JSON_RESPONSE",
        "A API oficial do Cartola retornou um JSON invalido.",
        { status: response.status }
      );
    }

    return sendProxyError(
      res,
      response.ok ? 502 : response.status,
      "UPSTREAM_NON_JSON_RESPONSE",
      "A API oficial do Cartola retornou uma resposta que nao e JSON.",
      { status: response.status }
    );
  } catch (error) {
    const isTimeout = error.name === "AbortError";
    const status = isTimeout ? 504 : 502;
    const code = isTimeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_REQUEST_FAILED";
    const message = isTimeout
      ? "Tempo limite excedido ao consultar a API oficial do Cartola."
      : "Falha ao consultar a API oficial do Cartola.";

    console.error("[proxy-cartola]", {
      path: options.path,
      code,
      message: error.message
    });

    return sendProxyError(res, status, code, message);
  } finally {
    clearTimeout(timeout);
  }
}

function createApp(options = {}) {
  const app = express();
  const allowedOrigins = parseAllowedOrigins(options.allowedOriginsEnv ?? process.env.ALLOWED_ORIGINS);
  const timeoutMs = Number(options.timeoutMs ?? process.env.CARTOLA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  app.locals.fetchImpl = options.fetchImpl || globalThis.fetch;
  app.locals.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  app.locals.allowedOrigins = allowedOrigins;
  app.locals.historicalRepository = options.historicalRepository || new HistoricalDataRepository();
  app.locals.enrichedHistoricalRepository = options.enrichedHistoricalRepository || new EnrichedHistoricalRepository();
  app.locals.backtestRepository = options.backtestRepository || new BacktestRepository();
  app.locals.liveSnapshotRepository = options.liveSnapshotRepository || new LiveSnapshotRepository();
  app.locals.researchRepository = options.researchRepository || new ResearchRepository();

  if (typeof app.locals.fetchImpl !== "function") {
    throw new Error("fetch nativo nao esta disponivel nesta versao do Node.");
  }

  app.use(createCorsMiddleware(allowedOrigins));

  app.get("/", (req, res) => {
    res.json({
      service: SERVICE_NAME,
      status: "online",
      version: BACKEND_VERSION,
      focus: "Brasileirao/Cartola FC"
    });
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.get("/cartola/mercado", (req, res) => {
    return proxyCartola(req, res, { path: "/atletas/mercado" });
  });

  app.get("/cartola/status", (req, res) => {
    return proxyCartola(req, res, { path: "/mercado/status" });
  });

  app.get("/cartola/partidas", (req, res) => {
    return proxyCartola(req, res, { path: "/partidas" });
  });

  app.get("/cartola/times", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query) {
      return res.status(400).json({
        error: {
          code: "INVALID_QUERY",
          message: "Informe o parametro q com o nome do time."
        }
      });
    }

    return proxyCartola(req, res, {
      path: `/times?q=${encodeURIComponent(query)}`
    });
  });

  app.get("/cartola/time", (req, res) => {
    return sendValidationError(
      res,
      "INVALID_TIME_ID",
      "Informe um timeId numerico inteiro positivo no caminho da URL."
    );
  });

  app.get("/cartola/time/:timeId", (req, res) => {
    const timeId = typeof req.params.timeId === "string" ? req.params.timeId.trim() : "";

    if (!isPositiveInteger(timeId)) {
      return sendValidationError(
        res,
        "INVALID_TIME_ID",
        "O timeId deve ser um numero inteiro positivo."
      );
    }

    return proxyCartola(req, res, { path: `/time/id/${timeId}` });
  });

  app.get("/historical/:season/coverage", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    return res.json(buildAuditSummary(app.locals.historicalRepository, season));
  });

  app.get("/historical/:season/rounds", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    return res.json({
      season,
      rounds: app.locals.historicalRepository.listRounds(season)
    });
  });

  app.get("/historical/:season/backtest-readiness", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    const rounds = app.locals.historicalRepository.listRounds(season);
    const readiness = rounds
      .map((round) => app.locals.historicalRepository.readRoundFile(season, round, "pre-round.json"))
      .filter(Boolean)
      .map((preRound) => ({
        round: preRound.round,
        schemaVersion: preRound.schemaVersion,
        status: preRound.readiness?.status || "NOT_READY",
        totalPlayers: preRound.readiness?.totalPlayers || 0,
        eligiblePlayers: preRound.readiness?.eligiblePlayers || 0,
        ineligiblePlayers: preRound.readiness?.ineligiblePlayers || 0,
        leakageStatus: preRound.leakageStatus || "UNKNOWN"
      }));

    return res.json({
      season,
      status: readiness.some((item) => item.status === "READY") ? "PARTIALLY_READY" : "NOT_READY",
      rounds: readiness,
      totals: {
        ready: readiness.filter((item) => item.status === "READY").length,
        partiallyReady: readiness.filter((item) => item.status === "PARTIALLY_READY").length,
        notReady: readiness.filter((item) => item.status === "NOT_READY").length,
        eligiblePlayers: readiness.reduce((total, item) => total + item.eligiblePlayers, 0),
        ineligiblePlayers: readiness.reduce((total, item) => total + item.ineligiblePlayers, 0)
      }
    });
  });

  app.get("/historical/:season/leakage-report", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    const reports = app.locals.historicalRepository.listRounds(season)
      .map((round) => app.locals.historicalRepository.readRoundFile(season, round, "leakage.json"))
      .filter(Boolean);

    return res.json({
      season,
      pass: reports.filter((item) => item.status === "PASS").length,
      warning: reports.filter((item) => item.status === "WARNING").length,
      fail: reports.filter((item) => item.status === "FAIL").length,
      reports
    });
  });

  app.get("/historical/:season/scout-divergences", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    const reports = app.locals.historicalRepository.listRounds(season)
      .map((round) => app.locals.historicalRepository.readRoundFile(season, round, "validation.json"))
      .filter(Boolean);

    return res.json(analyzeScoutDivergences(reports));
  });

  app.get("/historical/:season/round/:round", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseRound(req.params.round);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!round) {
      return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    }

    const post = app.locals.historicalRepository.readRoundFile(season, round, "post-round.json");

    if (!post) {
      return sendNotFound(res, "Rodada historica nao encontrada.");
    }

    return res.json(post);
  });

  app.get("/historical/:season/round/:round/pre", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseRound(req.params.round);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!round) {
      return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    }

    const pre = app.locals.historicalRepository.readRoundFile(season, round, "pre-round.json");

    if (!pre) {
      return sendNotFound(res, "Dados pre-rodada nao encontrados.");
    }

    return res.json(pre);
  });

  app.get("/historical/:season/round/:round/post", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseRound(req.params.round);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!round) {
      return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    }

    const post = app.locals.historicalRepository.readRoundFile(season, round, "post-round.json");

    if (!post) {
      return sendNotFound(res, "Dados pos-rodada nao encontrados.");
    }

    return res.json(post);
  });

  app.get("/historical/:season/round/:round/validation", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseRound(req.params.round);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!round) {
      return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    }

    const validation = app.locals.historicalRepository.readRoundFile(season, round, "validation.json");

    if (!validation) {
      return sendNotFound(res, "Validacao historica nao encontrada.");
    }

    return res.json(validation);
  });

  app.get("/historical/:season/enriched/coverage", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    return res.json(buildEnrichedAudit(app.locals.enrichedHistoricalRepository, season));
  });

  app.get("/historical/:season/enriched/round/:round", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseRound(req.params.round);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!round) {
      return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    }

    const data = app.locals.enrichedHistoricalRepository.readRoundFile(season, round, "pre-round-enriched.json");

    if (!data) {
      return sendNotFound(res, "Pre-rodada enriquecido nao encontrado.");
    }

    return res.json(data);
  });

  app.get("/historical/:season/enriched/leakage-report", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    const reports = app.locals.enrichedHistoricalRepository.listRounds(season)
      .map((round) => app.locals.enrichedHistoricalRepository.readRoundFile(season, round, "leakage.json"))
      .filter(Boolean);

    return res.json({
      season,
      pass: reports.filter((item) => item.status === "PASS").length,
      warning: reports.filter((item) => item.status === "WARNING").length,
      fail: reports.filter((item) => item.status === "FAIL").length,
      reports
    });
  });

  function sendBacktestFile(req, res, relativePath, notFoundMessage) {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    const data = app.locals.backtestRepository.readJson(season, relativePath);

    if (!data) {
      return sendNotFound(res, notFoundMessage);
    }

    return res.json(data);
  }

  function isValidBuild(value) {
    return /^\d+\.\d+\.\d+$/.test(String(value || ""));
  }

  function backtestRepositoryForBuild(build) {
    return new BacktestRepository({ buildId: `build-${build}` });
  }

  function sendBuildBacktestFile(req, res, relativePath, notFoundMessage) {
    const season = parseSeason(req.params.season);
    const build = req.params.build;

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!isValidBuild(build)) {
      return sendBadRequest(res, "INVALID_BUILD", "A build deve usar o formato x.y.z.");
    }

    const data = backtestRepositoryForBuild(build).readJson(season, relativePath);

    if (!data) {
      return sendNotFound(res, notFoundMessage);
    }

    return res.json(data);
  }

  app.get("/backtests/:season/builds", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    const fs = require("node:fs");
    const path = require("node:path");
    const { DEFAULT_BACKTEST_DIR } = require("./src/backtest/repository");
    const seasonDir = path.join(DEFAULT_BACKTEST_DIR, String(season));
    const builds = fs.existsSync(seasonDir)
      ? fs.readdirSync(seasonDir)
        .filter((name) => /^build-\d+\.\d+\.\d+$/.test(name))
        .sort()
        .map((name) => name.replace(/^build-/, ""))
      : [];

    return res.json({ season, builds });
  });

  app.get("/backtests/:season/latest", (req, res) => {
    return sendBacktestFile(req, res, "run-summary.json", "Backtest nao encontrado.");
  });

  app.get("/backtests/:season/summary", (req, res) => {
    return sendBacktestFile(req, res, "run-summary.json", "Resumo de backtest nao encontrado.");
  });

  app.get("/backtests/:season/rounds", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    const rounds = app.locals.backtestRepository.listRoundResults(season);

    if (!rounds.length) {
      return sendNotFound(res, "Rodadas de backtest nao encontradas.");
    }

    return res.json({ season, rounds: rounds.map((round) => ({ round: round.round, actualTotal: round.metrics.team.actualTotal })) });
  });

  app.get("/backtests/:season/round/:round", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseRound(req.params.round);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!round) {
      return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    }

    const data = app.locals.backtestRepository.readJson(season, `rounds/round-${String(round).padStart(2, "0")}.json`);

    if (!data) {
      return sendNotFound(res, "Resultado da rodada nao encontrado.");
    }

    return res.json(data);
  });

  app.get("/backtests/:season/metrics/prediction", (req, res) => {
    return sendBacktestFile(req, res, "metrics/prediction.json", "Metricas de previsao nao encontradas.");
  });

  app.get("/backtests/:season/metrics/team", (req, res) => {
    return sendBacktestFile(req, res, "metrics/team.json", "Metricas de time nao encontradas.");
  });

  app.get("/backtests/:season/metrics/captain", (req, res) => {
    return sendBacktestFile(req, res, "metrics/captain.json", "Metricas de capitao nao encontradas.");
  });

  app.get("/backtests/:season/metrics/score-bands", (req, res) => {
    return sendBacktestFile(req, res, "metrics/score-bands.json", "Metricas de faixas nao encontradas.");
  });

  app.get("/backtests/:season/comparison/baseline-average", (req, res) => {
    return sendBacktestFile(req, res, "comparison/baseline-average.json", "Comparacao com baseline nao encontrada.");
  });

  app.get("/backtests/:season/build/:build/summary", (req, res) => {
    return sendBuildBacktestFile(req, res, "run-summary.json", "Resumo de backtest nao encontrado.");
  });

  app.get("/backtests/:season/build/:build/round/:round", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseRound(req.params.round);
    const build = req.params.build;

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!round) {
      return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    }

    if (!isValidBuild(build)) {
      return sendBadRequest(res, "INVALID_BUILD", "A build deve usar o formato x.y.z.");
    }

    const data = backtestRepositoryForBuild(build).readJson(season, `rounds/round-${String(round).padStart(2, "0")}.json`);

    if (!data) {
      return sendNotFound(res, "Resultado da rodada nao encontrado.");
    }

    return res.json(data);
  });

  app.get("/backtests/:season/build/:build/metrics/prediction", (req, res) => {
    return sendBuildBacktestFile(req, res, "metrics/prediction.json", "Metricas de previsao nao encontradas.");
  });

  app.get("/backtests/:season/build/:build/metrics/team", (req, res) => {
    return sendBuildBacktestFile(req, res, "metrics/team.json", "Metricas de time nao encontradas.");
  });

  app.get("/backtests/:season/build/:build/metrics/captain", (req, res) => {
    return sendBuildBacktestFile(req, res, "metrics/captain.json", "Metricas de capitao nao encontradas.");
  });

  app.get("/backtests/:season/build/:build/metrics/score-bands", (req, res) => {
    return sendBuildBacktestFile(req, res, "metrics/score-bands.json", "Metricas de faixas nao encontradas.");
  });

  app.get("/backtests/:season/build/:build/metrics/central-intelligence", (req, res) => {
    return sendBuildBacktestFile(req, res, "metrics/central-intelligence.json", "Metricas da Central Inteligente nao encontradas.");
  });

  app.get("/backtests/:season/compare/:left/:right", (req, res) => {
    const season = parseSeason(req.params.season);
    const left = req.params.left;
    const right = req.params.right;

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    if (!isValidBuild(left) || !isValidBuild(right)) {
      return sendBadRequest(res, "INVALID_BUILD", "As builds devem usar o formato x.y.z.");
    }

    const comparison = backtestRepositoryForBuild(right).readJson(season, `comparison/build-${left}.json`);

    if (!comparison) {
      return sendNotFound(res, "Comparacao entre builds nao encontrada.");
    }

    return res.json(comparison);
  });

  app.get("/backtests/:season/compare/all", (req, res) => {
    const season = parseSeason(req.params.season);

    if (!season) {
      return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    }

    const comparison = backtestRepositoryForBuild("4.3.2").readJson(season, "comparison/all.json");

    if (!comparison) {
      return sendNotFound(res, "Comparacao geral de backtests nao encontrada.");
    }

    return res.json(comparison);
  });

  app.get("/live-snapshots/:season/coverage", (req, res) => {
    const season = parseSeason(req.params.season);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    return res.json(liveSnapshotCoverage(app.locals.liveSnapshotRepository, season));
  });

  app.get("/live-snapshots/:season/rounds", (req, res) => {
    const season = parseSeason(req.params.season);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    return res.json({ season, rounds: app.locals.liveSnapshotRepository.listRounds(season) });
  });

  app.get("/live-snapshots/:season/round/:round/latest", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseLiveRound(req.params.round);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    if (!round) return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    const manifest = app.locals.liveSnapshotRepository.readManifest(season, round);
    if (!manifest?.lastSnapshotId) return sendNotFound(res, "Snapshot nao encontrado.");
    return res.json(app.locals.liveSnapshotRepository.readSnapshot(season, round, manifest.lastSnapshotId));
  });

  app.get("/live-snapshots/:season/round/:round/latest-valid-pre-round", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseLiveRound(req.params.round);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    if (!round) return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    const manifest = app.locals.liveSnapshotRepository.readManifest(season, round);
    if (!manifest?.lastValidPreRoundSnapshotId) return sendNotFound(res, "Snapshot pre-rodada valido nao encontrado.");
    return res.json(app.locals.liveSnapshotRepository.readSnapshot(season, round, manifest.lastValidPreRoundSnapshotId));
  });

  app.get("/live-snapshots/:season/round/:round/change-history", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseLiveRound(req.params.round);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    if (!round) return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    const history = app.locals.liveSnapshotRepository.readChangeHistory(season, round);
    if (!history) return sendNotFound(res, "Historico de mudancas nao encontrado.");
    return res.json(history);
  });

  app.get("/live-snapshots/:season/round/:round/final-pre-close", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseLiveRound(req.params.round);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    if (!round) return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    const manifest = app.locals.liveSnapshotRepository.readManifest(season, round);
    const snapshotId = finalPreCloseSnapshotId(manifest);
    if (!snapshotId) return sendNotFound(res, "Snapshot final pre-fechamento nao encontrado.");
    return res.json({
      finalCaptureQuality: finalCaptureQuality(manifest),
      snapshot: app.locals.liveSnapshotRepository.readSnapshot(season, round, snapshotId)
    });
  });

  app.get("/live-snapshots/:season/round/:round/schedule-status", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseLiveRound(req.params.round);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    if (!round) return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    const manifest = app.locals.liveSnapshotRepository.readManifest(season, round);
    if (!manifest) return sendNotFound(res, "Manifest de snapshots nao encontrado.");
    const automationStatus = app.locals.liveSnapshotRepository.readAutomationStatus(season);
    return res.json({
      season,
      round,
      manifest: {
        totalSnapshots: manifest.totalSnapshots,
        validPreRoundSnapshots: manifest.validPreRoundSnapshots,
        firstValidSnapshotId: firstValidSnapshotId(manifest),
        latestSnapshotId: manifest.lastSnapshotId || null,
        latestValidPreRoundSnapshotId: manifest.lastValidPreRoundSnapshotId || null,
        finalPreCloseSnapshotId: finalPreCloseSnapshotId(manifest),
        finalCaptureQuality: finalCaptureQuality(manifest)
      },
      automationStatus: automationStatus || null
    });
  });

  app.get("/live-snapshots/:season/round/:round", (req, res) => {
    const season = parseSeason(req.params.season);
    const round = parseLiveRound(req.params.round);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    if (!round) return sendBadRequest(res, "INVALID_ROUND", "A rodada deve ser um inteiro entre 1 e 38.");
    const manifest = app.locals.liveSnapshotRepository.readManifest(season, round);
    if (!manifest) return sendNotFound(res, "Manifest de snapshots nao encontrado.");
    return res.json(manifest);
  });

  app.get("/live-snapshots/:season/snapshot/:snapshotId", (req, res) => {
    const season = parseSeason(req.params.season);
    const snapshotId = parseSnapshotId(req.params.snapshotId);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    if (!snapshotId) return sendBadRequest(res, "INVALID_SNAPSHOT_ID", "snapshotId invalido.");
    const snapshot = findSnapshot(app.locals.liveSnapshotRepository, season, snapshotId);
    if (!snapshot) return sendNotFound(res, "Snapshot nao encontrado.");
    return res.json(snapshot);
  });

  app.get("/live-snapshots/:season/integrity", (req, res) => {
    const season = parseSeason(req.params.season);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    return res.json(auditLiveSnapshots(app.locals.liveSnapshotRepository, season));
  });

  app.get("/live-snapshots/:season/production-health", (req, res) => {
    const season = parseSeason(req.params.season);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    return res.json(buildProductionHealth(app.locals.liveSnapshotRepository, season, { backendVersion: BACKEND_VERSION }));
  });

  app.get("/live-snapshots/:season/storage-health", (req, res) => {
    const season = parseSeason(req.params.season);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    return res.json(storageHealth(app.locals.liveSnapshotRepository, season));
  });

  app.get("/live-snapshots/:season/automation-lock", (req, res) => {
    const season = parseSeason(req.params.season);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    const lock = app.locals.liveSnapshotRepository.readAutomationLock(season);
    if (!lock) return res.json({ active: false });
    return res.json({
      active: true,
      executionId: lock.executionId || null,
      createdAt: lock.createdAt || null,
      expiresAt: lock.expiresAt || null,
      season: lock.season || null,
      round: lock.round || null
    });
  });

  app.get("/live-snapshots/:season/automation-status", (req, res) => {
    const season = parseSeason(req.params.season);
    if (!season) return sendBadRequest(res, "INVALID_SEASON", "A temporada deve ser um ano valido.");
    const status = app.locals.liveSnapshotRepository.readAutomationStatus(season);
    if (!status) return sendNotFound(res, "Status de automacao nao encontrado.");
    return res.json(status);
  });

  function sendResearchFile(req, res, relativePath, notFoundMessage) {
    const season = 2026;
    const data = app.locals.researchRepository.readJson(season, relativePath);

    if (!data) {
      return sendNotFound(res, notFoundMessage);
    }

    return res.json(data);
  }

  app.get("/research/engine-audit", (req, res) => {
    return sendResearchFile(req, res, "audit.json", "Auditoria de pesquisa nao encontrada. Execute npm run research:audit.");
  });

  app.get("/research/engine-diagnostics", (req, res) => {
    return sendResearchFile(req, res, "engine-diagnostics.json", "Diagnostico do motor nao encontrado. Execute npm run research:diagnostics.");
  });

  app.get("/research/ranking-diagnostics", (req, res) => {
    return sendResearchFile(req, res, "ranking-diagnostics.json", "Diagnostico de ranking nao encontrado. Execute npm run research:ranking.");
  });

  app.get("/research/ideal-team-diagnostics", (req, res) => {
    return sendResearchFile(req, res, "ideal-team-diagnostics.json", "Diagnostico do time ideal nao encontrado. Execute npm run research:ideal-team.");
  });

  app.get("/research/captain-diagnostics", (req, res) => {
    return sendResearchFile(req, res, "captain-diagnostics.json", "Diagnostico de capitao nao encontrado. Execute npm run research:captain.");
  });

  app.get("/research/ablation-study", (req, res) => {
    return sendResearchFile(req, res, "ablation-study.json", "Estudo de ablation nao encontrado. Execute npm run research:ablation.");
  });

  app.get("/research/experiments", (req, res) => {
    return sendResearchFile(req, res, "experiments-summary.json", "Resumo de experimentos nao encontrado. Execute npm run research:experiments.");
  });

  app.get("/research/experiments/:candidateId", (req, res) => {
    const candidateId = String(req.params.candidateId || "").trim();
    if (!/^[a-z0-9-]+$/.test(candidateId)) {
      return sendBadRequest(res, "INVALID_CANDIDATE_ID", "candidateId invalido.");
    }
    return sendResearchFile(req, res, `experiments/${candidateId}.json`, "Experimento nao encontrado.");
  });

  app.get("/research/promotion-gate", (req, res) => {
    return sendResearchFile(req, res, "promotion-gate.json", "Promotion gate nao encontrado. Execute npm run research:promotion-gate.");
  });

  app.get("/research/research-health", (req, res) => {
    return sendResearchFile(req, res, "research-health.json", "Health do laboratorio de pesquisa nao encontrado. Execute npm run research:check.");
  });

  function parseTeamIdParam(value) {
    return isPositiveInteger(String(value || "").trim()) ? Number(value) : null;
  }

  function realContextOptions(req) {
    return {
      fetchImpl: req.app.locals.fetchImpl,
      timeoutMs: req.app.locals.timeoutMs,
      liveSnapshotRepository: req.app.locals.liveSnapshotRepository,
      historicalRepository: req.app.locals.historicalRepository,
      backtestRepository: req.app.locals.backtestRepository,
      season: 2026
    };
  }

  app.get("/brasileirao/round-context", async (req, res, next) => {
    try {
      return res.json(await buildRoundContext(realContextOptions(req)));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/brasileirao/results", async (req, res, next) => {
    try {
      return res.json(await buildResults(realContextOptions(req)));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/brasileirao/team-context/:teamId", async (req, res, next) => {
    const teamId = parseTeamIdParam(req.params.teamId);
    if (!teamId) return sendBadRequest(res, "INVALID_TEAM_ID", "teamId deve ser um inteiro positivo.");

    try {
      return res.json(await buildTeamContext({ ...realContextOptions(req), teamId }));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/brasileirao/calendar-context/:teamId", async (req, res, next) => {
    const teamId = parseTeamIdParam(req.params.teamId);
    if (!teamId) return sendBadRequest(res, "INVALID_TEAM_ID", "teamId deve ser um inteiro positivo.");

    try {
      return res.json(await buildCalendarContext({ ...realContextOptions(req), teamId }));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/brasileirao/player-context-contract", (req, res) => {
    return res.json(buildPlayerContextContract());
  });

  app.get("/brasileirao/formation-contract", (req, res) => {
    return res.json(buildFormationContract());
  });

  app.get("/cartola/reserve-rules-contract", (req, res) => {
    return res.json(buildReserveRulesContract());
  });

  app.get("/diagnostics/team-context", async (req, res, next) => {
    const rawMatchId = typeof req.query.matchId === "string" ? req.query.matchId.trim() : "";
    const rawHomeClubId = typeof (req.query.homeClubId || req.query.homeTeamId) === "string" ? String(req.query.homeClubId || req.query.homeTeamId).trim() : "";
    const rawAwayClubId = typeof (req.query.awayClubId || req.query.awayTeamId) === "string" ? String(req.query.awayClubId || req.query.awayTeamId).trim() : "";
    if (rawMatchId && !isPositiveInteger(rawMatchId)) return sendBadRequest(res, "INVALID_MATCH_ID", "matchId deve ser um inteiro positivo.");
    if ((rawHomeClubId && !isPositiveInteger(rawHomeClubId)) || (rawAwayClubId && !isPositiveInteger(rawAwayClubId))) {
      return sendBadRequest(res, "INVALID_CLUB_ID", "homeClubId e awayClubId devem ser inteiros positivos.");
    }
    if (Boolean(rawHomeClubId) !== Boolean(rawAwayClubId)) {
      return sendBadRequest(res, "INCOMPLETE_FIXTURE_QUERY", "Informe homeClubId e awayClubId juntos.");
    }
    try {
      return res.json(await buildTeamContextDiagnostic({
        ...realContextOptions(req),
        matchId: rawMatchId ? Number(rawMatchId) : null,
        homeClubId: rawHomeClubId ? Number(rawHomeClubId) : null,
        awayClubId: rawAwayClubId ? Number(rawAwayClubId) : null
      }));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/research/real-round-evaluation", (req, res) => {
    return res.json(buildRealRoundEvaluation({ season: 2026, backtestRepository: backtestRepositoryForBuild("4.3.2") }));
  });

  app.get("/research/context-feature-diagnostics", (req, res) => {
    return res.json(buildContextFeatureDiagnostics({ season: 2026, backtestRepository: backtestRepositoryForBuild("4.3.2") }));
  });

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Endpoint nao encontrado."
      }
    });
  });

  app.use((error, req, res, next) => {
    console.error("[server-error]", {
      message: error.message,
      path: req.path
    });

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Erro interno do servidor."
      }
    });
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || DEFAULT_PORT;
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`${SERVICE_NAME} ${BACKEND_VERSION} rodando na porta ${PORT}`);
  });
}

module.exports = {
  createApp,
  parseAllowedOrigins,
  isAllowedCorsOrigin,
  DEFAULT_ALLOWED_ORIGINS,
  BACKEND_VERSION
};
