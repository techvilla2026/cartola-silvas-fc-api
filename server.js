const express = require("express");
const { HistoricalDataRepository } = require("./src/historical/repositories/fileRepository");
const { buildAuditSummary } = require("./src/historical/audit");
const { parseRound, parseSeason } = require("./src/historical/domain/validation");
const { analyzeScoutDivergences } = require("./src/historical/reconstruction/scoutDivergence");
const { BacktestRepository } = require("./src/backtest/repository");
const { EnrichedHistoricalRepository } = require("./src/historical/enrichment/enrichedRepository");
const { buildEnrichedAudit } = require("./src/historical/enrichment/audit");

const SERVICE_NAME = "cartola-silvas-fc-api";
const BACKEND_VERSION = "4.3.2";
const DEFAULT_PORT = 3000;
const CARTOLA_API_BASE_URL = "https://api.cartolafc.globo.com";
const DEFAULT_TIMEOUT_MS = 8000;

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost:5000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5000",
  "https://utimeideal.netlify.app"
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
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function createCorsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins);

  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    if (origin && (allowed.has(origin) || isLocalhostOrigin(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
      res.setHeader("Access-Control-Max-Age", "86400");
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
  DEFAULT_ALLOWED_ORIGINS,
  BACKEND_VERSION
};
