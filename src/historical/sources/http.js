const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 250;
const DEFAULT_USER_AGENT = "cartola-silvas-fc-api-historical/4.2.0";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs || DEFAULT_BACKOFF_MS;
  let lastError;

  if (typeof fetchImpl !== "function") {
    throw new Error("fetch nativo nao esta disponivel nesta versao do Node.");
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: options.accept || "application/json,text/csv,text/plain",
          "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
          ...(options.headers || {})
        },
        signal: controller.signal
      });

      if (!response.ok && response.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(backoffMs * (attempt + 1));
  }

  throw lastError;
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRIES,
  fetchWithRetry,
  readJson
};
