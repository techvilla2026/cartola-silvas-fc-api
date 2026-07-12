const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { test } = require("node:test");
const { createApp } = require("../server");
const { CAPTURE_PHASE } = require("../src/liveSnapshot/domain/constants");
const { determineCapturePhase, isValidPreRoundSnapshot } = require("../src/liveSnapshot/domain/time");
const { parseSnapshotId } = require("../src/liveSnapshot/domain/validation");
const { verifySnapshotIntegrity } = require("../src/liveSnapshot/integrity/canonical");
const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { auditLiveSnapshots } = require("../src/liveSnapshot/services/audit");
const { captureLivePreRoundSnapshot } = require("../src/liveSnapshot/services/capture");
const { mapPlayers } = require("../src/liveSnapshot/services/mapper");

function fakeSources({ closingTimestamp = 2000000000 } = {}) {
  return {
    marketStatus: {
      endpoint: "/mercado/status",
      status: 200,
      capturedAt: "2026-07-12T10:00:00.000Z",
      body: {
        rodada_atual: 19,
        status_mercado: 1,
        temporada: 2026,
        fechamento: { timestamp: closingTimestamp }
      }
    },
    market: {
      endpoint: "/atletas/mercado",
      status: 200,
      capturedAt: "2026-07-12T10:00:01.000Z",
      body: {
        clubes: { 1: { id: 1, nome: "Clube", nome_fantasia: "Clube", abreviacao: "CLU", escudos: { "60x60": "x" } } },
        posicoes: { 1: { id: 1, nome: "Goleiro", abreviacao: "GOL" }, 5: { id: 5, nome: "Atacante", abreviacao: "ATA" } },
        status: { 7: { id: 7, nome: "Provavel" } },
        atletas: [
          { atleta_id: 1, apelido: "Um", nome: "Atleta Um", clube_id: 1, posicao_id: 1, status_id: 7, preco_num: 0, media_num: 6, pontos_num: null, variacao_num: 0, jogos_num: 2, entrou_em_campo: false, scout: {}, foto: null },
          ...Array.from({ length: 10 }, (_, index) => ({ atleta_id: index + 2, apelido: `A${index}`, nome: `Atleta ${index}`, clube_id: 1, posicao_id: 5, status_id: 7, preco_num: 5, media_num: 8 - index * 0.1, pontos_num: 0, variacao_num: 0, jogos_num: 3, entrou_em_campo: false, scout: { G: index === 0 ? 1 : 0 }, foto: "" }))
        ]
      }
    },
    matches: {
      endpoint: "/partidas",
      status: 200,
      capturedAt: "2026-07-12T10:00:02.000Z",
      body: {
        rodada: 19,
        clubes: {},
        partidas: [{ partida_id: 10, clube_casa_id: 1, clube_visitante_id: 2, partida_data: "2026-07-21 19:30:00", local: "Estadio", valida: true, timestamp: 2000000000 }]
      }
    }
  };
}

function get(server, urlPath) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    }).on("error", reject);
  });
}

test("calcula PRE_MARKET_CLOSE, POST_MARKET_CLOSE e UNKNOWN", () => {
  assert.equal(determineCapturePhase("2026-01-01T10:00:00.000Z", "2026-01-01T11:00:00.000Z"), CAPTURE_PHASE.PRE_MARKET_CLOSE);
  assert.equal(determineCapturePhase("2026-01-01T12:00:00.000Z", "2026-01-01T11:00:00.000Z"), CAPTURE_PHASE.POST_MARKET_CLOSE);
  assert.equal(determineCapturePhase("2026-01-01T12:00:00.000Z", null), CAPTURE_PHASE.UNKNOWN);
});

test("snapshot valido exige fechamento e PRE_MARKET_CLOSE", () => {
  assert.equal(isValidPreRoundSnapshot({ capturePhase: "PRE_MARKET_CLOSE", marketClosingAt: "2026-01-01T11:00:00.000Z" }), true);
  assert.equal(isValidPreRoundSnapshot({ capturePhase: "UNKNOWN", marketClosingAt: null }), false);
  assert.equal(isValidPreRoundSnapshot({ capturePhase: "POST_MARKET_CLOSE", marketClosingAt: "2026-01-01T11:00:00.000Z" }), false);
});

test("parser preserva null e zero real", () => {
  const players = mapPlayers(fakeSources().market.body);

  assert.equal(players[0].price, 0);
  assert.equal(players[0].roundPoints, null);
  assert.equal(players[0].enteredField, false);
});

test("dry-run monta snapshot e nao grava arquivos", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-"));
  const repository = new LiveSnapshotRepository({ baseDir: dir });
  const { snapshot, report } = await captureLivePreRoundSnapshot({
    sources: fakeSources(),
    repository,
    dryRun: true,
    now: () => new Date("2026-07-12T10:00:00.000Z")
  });

  assert.equal(report.saved, false);
  assert.equal(snapshot.schemaVersion, "live-pre-round-snapshot/v1");
  assert.equal(snapshot.isValidPreRoundSnapshot, true);
  assert.equal(fs.existsSync(dir), true);
  assert.equal(repository.listRounds(2026).length, 0);
});

test("snapshot salvo e imutavel com multiplas capturas por rodada", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-"));
  const repository = new LiveSnapshotRepository({ baseDir: dir });
  const first = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, now: () => new Date("2026-07-12T10:00:00.000Z") });
  const second = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, now: () => new Date("2026-07-12T10:01:00.000Z") });
  const manifest = repository.readManifest(2026, 19);

  assert.notEqual(first.snapshot.snapshotId, second.snapshot.snapshotId);
  assert.equal(manifest.totalSnapshots, 2);
  assert.equal(manifest.validPreRoundSnapshots, 2);
  assert.throws(() => repository.saveSnapshot(first.snapshot), /Arquivo ja existe/);
});

test("SHA-256 detecta arquivo alterado", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-"));
  const repository = new LiveSnapshotRepository({ baseDir: dir });
  const { snapshot } = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, now: () => new Date("2026-07-12T10:00:00.000Z") });
  assert.equal(verifySnapshotIntegrity(snapshot).ok, true);

  snapshot.data.players[0].nickname = "Alterado";
  assert.equal(verifySnapshotIntegrity(snapshot).ok, false);
});

test("force-invalid-capture salva auditoria invalida sem promover validade", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-"));
  const repository = new LiveSnapshotRepository({ baseDir: dir });
  const { snapshot } = await captureLivePreRoundSnapshot({
    sources: fakeSources({ closingTimestamp: 1000 }),
    repository,
    forceInvalidCapture: true,
    now: () => new Date("2026-07-12T10:00:00.000Z")
  });

  assert.equal(snapshot.capturePhase, "POST_MARKET_CLOSE");
  assert.equal(snapshot.isValidPreRoundSnapshot, false);
  assert.equal(repository.readManifest(2026, 19).validPreRoundSnapshots, 0);
});

test("captura invalida sem force falha", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  await assert.rejects(
    () => captureLivePreRoundSnapshot({
      sources: fakeSources({ closingTimestamp: 1000 }),
      repository,
      now: () => new Date("2026-07-12T10:00:00.000Z")
    }),
    /temporalmente invalido/
  );
});

test("motor versionado e campos indisponiveis nao sao inventados", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const { snapshot } = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, dryRun: true, now: () => new Date("2026-07-12T10:00:00.000Z") });

  assert.equal(snapshot.engineVersions.engineVersion, "flutter-parity-engine/4.3.1");
  assert.equal(snapshot.dataAvailability.userLineup, "NOT_APPLICABLE");
  assert.equal(snapshot.motor.comparator.status, "NOT_EVALUATED");
  assert.ok(Array.isArray(snapshot.motor.predictions));
});

test("auditoria detecta manifest e hashes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-"));
  const repository = new LiveSnapshotRepository({ baseDir: dir });
  await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, now: () => new Date("2026-07-12T10:00:00.000Z") });
  const audit = auditLiveSnapshots(repository, 2026);

  assert.equal(audit.status, "PASS");
  assert.equal(audit.totalSnapshots, 1);
  assert.equal(audit.validPreRoundSnapshots, 1);
});

test("snapshotId bloqueia path traversal", () => {
  assert.equal(parseSnapshotId("abc-123_ok.json"), "abc-123_ok.json");
  assert.equal(parseSnapshotId("../secret"), null);
  assert.equal(parseSnapshotId("bad/path"), null);
});

test("endpoints live snapshot retornam 200, 400 e 404", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-"));
  const repository = new LiveSnapshotRepository({ baseDir: dir });
  const { snapshot } = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, now: () => new Date("2026-07-12T10:00:00.000Z") });
  const app = createApp({ liveSnapshotRepository: repository });
  const server = app.listen(0);

  try {
    assert.equal((await get(server, "/live-snapshots/2026/coverage")).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/rounds")).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/round/19")).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/round/19/latest")).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/round/19/latest-valid-pre-round")).status, 200);
    assert.equal((await get(server, `/live-snapshots/2026/snapshot/${snapshot.snapshotId}`)).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/integrity")).status, 200);
    assert.equal((await get(server, "/live-snapshots/abc/coverage")).status, 400);
    assert.equal((await get(server, "/live-snapshots/2026/snapshot/..%2Fsecret")).status, 400);
    assert.equal((await get(server, "/live-snapshots/2026/round/18")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
