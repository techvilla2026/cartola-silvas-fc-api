const assert = require("node:assert/strict");
const { once } = require("node:events");
const http = require("node:http");
const test = require("node:test");

const { createApp } = require("../server");

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
  assert.equal(response.body.version, "3.5.0");
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
