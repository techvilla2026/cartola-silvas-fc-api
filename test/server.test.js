const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");

async function request(app, path, options = {}) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method || "GET",
      headers: options.headers || {}
    });
    const body = await response.json().catch(() => null);

    return {
      status: response.status,
      headers: response.headers,
      body
    };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("GET / retorna informacoes do servico", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/");

  assert.equal(response.status, 200);
  assert.equal(response.body.service, "cartola-silvas-fc-api");
  assert.equal(response.body.status, "online");
  assert.equal(response.body.version, "4.3.0");
  assert.equal(response.body.focus, "Brasileirao/Cartola FC");
  assert.equal(response.body.cartola, undefined);
});

test("GET /health retorna status, timestamp e uptime", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/health");

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
  assert.match(response.body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof response.body.uptime, "number");
});

test("GET /cartola/times sem q retorna 400", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/cartola/times");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_QUERY");
});

test("GET /cartola/times com q vazio retorna 400", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/cartola/times?q=%20%20");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_QUERY");
});

test("CORS permite origem publica configurada", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/", {
    headers: {
      Origin: "https://utimeideal.netlify.app"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://utimeideal.netlify.app");
});

test("proxy retorna erro consistente quando API Cartola falha", async () => {
  const fetchImpl = async () => {
    throw new Error("network unavailable");
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/status");

  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, "UPSTREAM_REQUEST_FAILED");
  assert.equal(response.body.error.upstream, "Cartola FC");
  assert.equal(response.body.atletas, undefined);
});

test("proxy de times usa query trimada e codificada", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ times: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/times?q=%20Silvas%20FC%20");

  assert.equal(response.status, 200);
  assert.equal(requestedUrl, "https://api.cartolafc.globo.com/times?q=Silvas%20FC");
  assert.deepEqual(response.body, { times: [] });
});

test("GET /cartola/time com timeId valido retorna elenco recebido do upstream", async () => {
  const upstreamBody = {
    time: { time_id: 16068219, nome: "Silvas FC" },
    atletas: [{ atleta_id: 1, apelido: "Atleta Real" }],
    reservas: [{ atleta_id: 2, apelido: "Reserva Real" }],
    capitao_id: 1,
    esquema_id: 3,
    patrimonio: 120.33,
    pontos: 88.75,
    rodada_atual: 12,
    tecnico: { nome: "Tecnico Real" }
  };
  const fetchImpl = async () => {
    return new Response(JSON.stringify(upstreamBody), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/time/16068219");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, upstreamBody);
  assert.equal(response.body.mock, undefined);
  assert.equal(response.body.fallback, undefined);
});

test("GET /cartola/time sem timeId retorna 400", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/cartola/time");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_TIME_ID");
});

test("GET /cartola/time com texto retorna 400", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/cartola/time/abc");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_TIME_ID");
});

test("GET /cartola/time com zero retorna 400", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/cartola/time/0");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_TIME_ID");
});

test("GET /cartola/time com numero negativo retorna 400", async () => {
  const app = createApp({ fetchImpl: fetch });
  const response = await request(app, "/cartola/time/-1");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_TIME_ID");
});

test("proxy de time chama endpoint oficial por path", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ time: {}, atletas: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/time/16068219");

  assert.equal(response.status, 200);
  assert.equal(requestedUrl, "https://api.cartolafc.globo.com/time/id/16068219");
});

test("proxy de time ignora query e nao usa timeId por parametro", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ time: { time_id: 16068219 }, atletas: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/time/16068219?timeId=999&q=teste");

  assert.equal(response.status, 200);
  assert.equal(requestedUrl, "https://api.cartolafc.globo.com/time/id/16068219");
});

test("proxy de time preserva erro upstream 404 em JSON", async () => {
  const upstreamBody = {
    error: {
      code: "TIME_NOT_FOUND",
      message: "Time nao encontrado."
    }
  };
  const fetchImpl = async () => {
    return new Response(JSON.stringify(upstreamBody), {
      status: 404,
      headers: { "content-type": "application/json" }
    });
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/time/16068219");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, upstreamBody);
});

test("proxy de time trata falha de rede", async () => {
  const fetchImpl = async () => {
    throw new Error("network unavailable");
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/time/16068219");

  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, "UPSTREAM_REQUEST_FAILED");
  assert.equal(response.body.error.upstream, "Cartola FC");
  assert.equal(response.body.atletas, undefined);
});

test("proxy de time trata JSON invalido do upstream", async () => {
  const fetchImpl = async () => {
    return new Response("{invalid-json", {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/time/16068219");

  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, "UPSTREAM_INVALID_JSON_RESPONSE");
  assert.equal(response.body.error.upstream, "Cartola FC");
});

test("GET /historical/:season/round/:round retorna 404 para rodada inexistente", async () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  const app = createApp({ fetchImpl: fetch, historicalRepository: repository });
  const response = await request(app, "/historical/2026/round/1");

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "NOT_FOUND");
});

test("GET /historical/:season/round/:round retorna 400 para rodada invalida", async () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  const app = createApp({ fetchImpl: fetch, historicalRepository: repository });
  const response = await request(app, "/historical/2026/round/0");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_ROUND");
});

test("GET /historical/:season/coverage retorna 400 para temporada invalida", async () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  const app = createApp({ fetchImpl: fetch, historicalRepository: repository });
  const response = await request(app, "/historical/abc/coverage");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_SEASON");
});

test("GET /historical/:season/coverage retorna cobertura persistida", async () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  repository.saveRound(2026, 1, {
    "pre-round.json": { season: 2026, round: 1, players: [], matches: [] },
    "post-round.json": {
      season: 2026,
      round: 1,
      source: "unit-test",
      collectedAt: "2026-07-11T00:00:00.000Z",
      players: [{ price: 1, points: 2, average: 3, statusId: 7, played: true, scouts: { G: 1 } }],
      matches: [{ homeScore: 1, awayScore: 0 }],
      clubs: { 1: { id: 1 }, 2: { id: 2 } }
    },
    "validation.json": { validationStatus: "VALID" }
  }, { force: true });
  const app = createApp({ fetchImpl: fetch, historicalRepository: repository });
  const response = await request(app, "/historical/2026/coverage");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.availableRounds, [1]);
  assert.equal(response.body.rounds[0].athletesCount, 1);
  assert.equal(response.body.rounds[0].matchesCount, 1);
  assert.equal(response.body.rounds[0].hasPrices, true);
});
