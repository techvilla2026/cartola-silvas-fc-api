const CARTOLA_API_BASE_URL = "https://api.cartolafc.globo.com";

async function readJsonResponse(response, endpoint) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Endpoint ${endpoint} retornou JSON invalido.`);
  }
}

async function fetchCartolaJson({ fetchImpl, endpoint, timeoutMs = 8000, userAgent = "cartola-silvas-fc-api/5.2.0" }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${CARTOLA_API_BASE_URL}${endpoint}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent
      },
      signal: controller.signal
    });

    const body = await readJsonResponse(response, endpoint);
    if (!response.ok) {
      throw new Error(`Endpoint ${endpoint} retornou HTTP ${response.status}.`);
    }

    return {
      endpoint,
      status: response.status,
      capturedAt: new Date().toISOString(),
      body
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLiveSources(options) {
  const [marketStatus, market, matches] = await Promise.all([
    fetchCartolaJson({ ...options, endpoint: "/mercado/status" }),
    fetchCartolaJson({ ...options, endpoint: "/atletas/mercado" }),
    fetchCartolaJson({ ...options, endpoint: "/partidas" })
  ]);

  return { marketStatus, market, matches };
}

module.exports = {
  CARTOLA_API_BASE_URL,
  fetchCartolaJson,
  fetchLiveSources
};
