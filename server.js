const express = require("express");

const SERVICE_NAME = "cartola-silvas-fc-api";
const BACKEND_VERSION = "3.5.0";
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
    return { body: JSON.parse(text), isJson: true };
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

    const { body, isJson } = await readUpstreamBody(response);

    if (isJson) {
      return res.status(response.status).json(body);
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
