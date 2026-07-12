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
const { runLiveSnapshotAutomation } = require("../src/liveSnapshot/services/automation");
const { createExecutionId } = require("../src/liveSnapshot/services/execution");
const { compareSnapshots, logicalFingerprint } = require("../src/liveSnapshot/services/fingerprint");
const { mapPlayers } = require("../src/liveSnapshot/services/mapper");
const { buildProductionHealth, operationalAlerts } = require("../src/liveSnapshot/services/productionHealth");
const { evaluateCapturePolicy, scheduleWindow } = require("../src/liveSnapshot/services/schedulePolicy");
const { storageHealth } = require("../src/liveSnapshot/services/storageHealth");
const { validateLiveSnapshotStorage } = require("../src/liveSnapshot/storage/contract");

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

function editedSources(editFn) {
  const sources = JSON.parse(JSON.stringify(fakeSources()));
  editFn(sources);
  return sources;
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

test("janelas de frequencia sao calculadas por distancia do fechamento", () => {
  assert.equal(scheduleWindow(73 * 60 * 60).name, "MORE_THAN_72_HOURS");
  assert.equal(scheduleWindow(48 * 60 * 60).name, "SEVENTY_TWO_TO_TWENTY_FOUR_HOURS");
  assert.equal(scheduleWindow(12 * 60 * 60).name, "TWENTY_FOUR_TO_SIX_HOURS");
  assert.equal(scheduleWindow(3 * 60 * 60).name, "SIX_TO_ONE_HOURS");
  assert.equal(scheduleWindow(30 * 60).name, "LAST_HOUR");
  assert.equal(scheduleWindow(10 * 60).name, "LAST_15_MINUTES");
});

test("politica decide primeira captura, mercado fechado e muito cedo", () => {
  const first = evaluateCapturePolicy({
    capturedAt: "2026-07-12T10:00:00.000Z",
    marketClosingAt: "2026-07-22T10:00:00.000Z",
    capturePhase: "PRE_MARKET_CLOSE",
    validSnapshots: 0,
    totalSnapshots: 0
  });
  const closed = evaluateCapturePolicy({
    capturedAt: "2026-07-23T10:00:00.000Z",
    marketClosingAt: "2026-07-22T10:00:00.000Z",
    capturePhase: "POST_MARKET_CLOSE",
    validSnapshots: 1,
    totalSnapshots: 1
  });
  const soon = evaluateCapturePolicy({
    capturedAt: "2026-07-12T10:10:00.000Z",
    marketClosingAt: "2026-07-22T10:00:00.000Z",
    capturePhase: "PRE_MARKET_CLOSE",
    lastValidSnapshotAt: "2026-07-12T10:00:00.000Z",
    validSnapshots: 1,
    totalSnapshots: 1
  });

  assert.equal(first.reason, "FIRST_VALID_SNAPSHOT");
  assert.equal(first.shouldCapture, true);
  assert.equal(closed.reason, "MARKET_CLOSED");
  assert.equal(closed.shouldCapture, false);
  assert.equal(soon.reason, "TOO_SOON");
});

test("fingerprint ignora capturedAt e ordem nao significativa", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const first = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, dryRun: true, now: () => new Date("2026-07-12T10:00:00.000Z") });
  const second = await captureLivePreRoundSnapshot({ sources: editedSources((sources) => sources.market.body.atletas.reverse()), repository, dryRun: true, now: () => new Date("2026-07-12T11:00:00.000Z") });

  assert.notEqual(first.snapshot.capturedAt, second.snapshot.capturedAt);
  assert.equal(logicalFingerprint(first.snapshot), logicalFingerprint(second.snapshot));
});

test("fingerprint detecta status, preco e mudanca real", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const first = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, dryRun: true, now: () => new Date("2026-07-12T10:00:00.000Z") });
  const second = await captureLivePreRoundSnapshot({
    sources: editedSources((sources) => {
      sources.market.body.atletas[0].status_id = 2;
      sources.market.body.atletas[1].preco_num = 9.99;
    }),
    repository,
    dryRun: true,
    now: () => new Date("2026-07-12T11:00:00.000Z")
  });
  const comparison = compareSnapshots(first.snapshot, second.snapshot);

  assert.equal(comparison.hasSignificantChange, true);
  assert.equal(comparison.changes.statusChanges, 1);
  assert.equal(comparison.changes.priceChanges, 1);
});

test("mudanca de previsao abaixo da tolerancia nao obriga snapshot", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const first = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, dryRun: true, now: () => new Date("2026-07-12T10:00:00.000Z") });
  const second = JSON.parse(JSON.stringify(first.snapshot));
  second.capturedAt = "2026-07-12T11:00:00.000Z";
  second.motor.predictions[0].predictedPoints += 0.05;

  assert.equal(compareSnapshots(first.snapshot, second).hasSignificantChange, false);
  second.motor.predictions[0].predictedPoints += 0.1;
  assert.equal(compareSnapshots(first.snapshot, second).hasSignificantChange, true);
});

test("automacao captura primeira vez e cria status", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const result = await runLiveSnapshotAutomation({
    sources: fakeSources(),
    repository,
    now: "2026-07-12T10:00:00.000Z"
  });

  assert.equal(result.status.result, "CAPTURED");
  assert.equal(result.status.reason, "FIRST_VALID_SNAPSHOT");
  assert.equal(repository.readAutomationStatus(2026).result, "CAPTURED");
  assert.equal(repository.readManifest(2026, 19).totalSnapshots, 1);
});

test("automacao pula snapshot sem mudanca e muito cedo", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  await runLiveSnapshotAutomation({ sources: fakeSources(), repository, now: "2026-07-12T10:00:00.000Z" });
  const result = await runLiveSnapshotAutomation({ sources: fakeSources(), repository, now: "2026-07-12T10:10:00.000Z" });

  assert.equal(result.status.result, "SKIPPED");
  assert.equal(result.status.reason, "TOO_SOON");
  assert.equal(repository.readManifest(2026, 19).totalSnapshots, 1);
});

test("automacao permite checkpoint obrigatorio por janela", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  await runLiveSnapshotAutomation({ sources: fakeSources(), repository, now: "2026-07-12T10:00:00.000Z" });
  const result = await runLiveSnapshotAutomation({ sources: fakeSources(), repository, now: "2026-07-13T11:00:00.000Z" });

  assert.equal(result.status.result, "CAPTURED");
  assert.equal(result.status.reason, "DAILY_CHECKPOINT");
  assert.equal(repository.readManifest(2026, 19).totalSnapshots, 2);
});

test("automacao captura mudanca relevante e cria change history", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  await runLiveSnapshotAutomation({ sources: fakeSources(), repository, now: "2026-07-12T10:00:00.000Z" });
  const result = await runLiveSnapshotAutomation({
    sources: editedSources((sources) => {
      sources.market.body.atletas[1].preco_num = 11;
    }),
    repository,
    now: "2026-07-12T10:10:00.000Z"
  });
  const history = repository.readChangeHistory(2026, 19);

  assert.equal(result.status.result, "CAPTURED");
  assert.equal(result.status.reason, "SIGNIFICANT_CHANGE");
  assert.equal(history.changes.length, 1);
  assert.equal(history.changes[0].priceChanges, 1);
});

test("final pre-fechamento nunca usa pos-fechamento", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const closingTimestamp = Date.parse("2026-07-12T10:10:00.000Z") / 1000;
  await runLiveSnapshotAutomation({ sources: fakeSources({ closingTimestamp }), repository, now: "2026-07-12T10:00:00.000Z" });
  await runLiveSnapshotAutomation({ sources: fakeSources({ closingTimestamp }), repository, now: "2026-07-12T10:09:00.000Z" });
  const closed = await runLiveSnapshotAutomation({ sources: fakeSources({ closingTimestamp }), repository, now: "2026-07-12T10:11:00.000Z" });
  const manifest = repository.readManifest(2026, 19);

  assert.notEqual(closed.status.result, "CAPTURED");
  assert.equal(manifest.validPreRoundSnapshots, 2);
  assert.equal(manifest.finalPreCloseSnapshotId, manifest.lastValidPreRoundSnapshotId);
});

test("endpoints de automacao retornam status, final e historico", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  await runLiveSnapshotAutomation({ sources: fakeSources(), repository, now: "2026-07-12T10:00:00.000Z" });
  await runLiveSnapshotAutomation({
    sources: editedSources((sources) => {
      sources.market.body.atletas[1].preco_num = 12;
    }),
    repository,
    now: "2026-07-12T10:05:00.000Z"
  });
  const app = createApp({ liveSnapshotRepository: repository });
  const server = app.listen(0);

  try {
    assert.equal((await get(server, "/live-snapshots/2026/automation-status")).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/round/19/change-history")).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/round/19/final-pre-close")).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/round/19/schedule-status")).status, 200);
    assert.equal((await get(server, "/live-snapshots/2026/round/18/change-history")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("storage contract e implementado pelo FileRepository", () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const validation = validateLiveSnapshotStorage(repository);

  assert.equal(validation.ok, true);
  assert.deepEqual(validation.missing, []);
});

test("storage health check nao destroi dados existentes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-"));
  const repository = new LiveSnapshotRepository({ baseDir: dir });
  await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, now: () => new Date("2026-07-12T10:00:00.000Z") });
  const before = fs.readFileSync(repository.manifestPath(2026, 19), "utf8");
  const health = storageHealth(repository, 2026);
  const after = fs.readFileSync(repository.manifestPath(2026, 19), "utf8");

  assert.equal(health.storageMode, "LOCAL_FILESYSTEM");
  assert.equal(health.writable, true);
  assert.equal(health.readable, true);
  assert.equal(health.atomicWriteSupported, true);
  assert.equal(health.immutableWriteSupported, true);
  assert.equal(health.status, "WARNING");
  assert.equal(before, after);
});

test("lock e adquirido, bloqueia segunda execucao e preserva lock ativo", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const first = repository.acquireAutomationLock({
    season: 2026,
    round: 19,
    executionId: "exec-active",
    ttlMs: 60 * 60 * 1000,
    now: new Date()
  });

  assert.equal(first.acquired, true);
  await assert.doesNotReject(async () => {
    const result = await runLiveSnapshotAutomation({
      sources: fakeSources(),
      repository,
      season: 2026,
      now: "2026-07-12T10:01:00.000Z"
    });
    assert.equal(result.status.result, "FAILED");
    assert.equal(result.status.errorCode, "LOCK_ACTIVE");
  });
  assert.equal(repository.readAutomationLock(2026).executionId, "exec-active");
  assert.deepEqual(repository.releaseAutomationLock(2026, "other").released, false);
  assert.equal(repository.readAutomationLock(2026).executionId, "exec-active");
  assert.equal(repository.releaseAutomationLock(2026, "exec-active").released, true);
});

test("stale lock e recuperado", () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  repository.acquireAutomationLock({
    season: 2026,
    round: 19,
    executionId: "exec-old",
    ttlMs: 1000,
    now: new Date("2026-07-12T10:00:00.000Z")
  });
  const recovered = repository.acquireAutomationLock({
    season: 2026,
    round: 19,
    executionId: "exec-new",
    ttlMs: 1000,
    now: new Date("2026-07-12T10:00:02.000Z")
  });

  assert.equal(recovered.acquired, true);
  assert.equal(recovered.staleRecovered, true);
  assert.equal(repository.readAutomationLock(2026).executionId, "exec-new");
});

test("lock e liberado em CAPTURED, SKIPPED e erro controlado", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const captured = await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:00:00.000Z" });
  const skipped = await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:01:00.000Z" });
  const failed = await runLiveSnapshotAutomation({ sources: fakeSources({ closingTimestamp: 1000 }), repository, season: 2026, now: "2026-07-12T10:02:00.000Z" });

  assert.equal(captured.status.lockReleased, true);
  assert.equal(skipped.status.lockReleased, true);
  assert.equal(failed.status.lockReleased, true);
  assert.equal(repository.readAutomationLock(2026), null);
});

test("executionId e unico e nao altera fingerprint logico", async () => {
  const firstId = createExecutionId(new Date("2026-07-12T10:00:00.000Z"));
  const secondId = createExecutionId(new Date("2026-07-12T10:00:00.000Z"));
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const { snapshot } = await captureLivePreRoundSnapshot({ sources: fakeSources(), repository, dryRun: true, now: () => new Date("2026-07-12T10:00:00.000Z") });
  const withExecution = { ...snapshot, executionId: firstId };

  assert.notEqual(firstId, secondId);
  assert.equal(logicalFingerprint(snapshot), logicalFingerprint(withExecution));
});

test("idempotencia impede duplicata em duas execucoes com os mesmos dados", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  const first = await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:00:00.000Z" });
  const second = await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:05:00.000Z" });

  assert.equal(first.status.result, "CAPTURED");
  assert.equal(second.status.result, "SKIPPED");
  assert.equal(repository.readManifest(2026, 19).totalSnapshots, 1);
});

test("falha preserva manifest, ultimo snapshot valido e contadores", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:00:00.000Z" });
  const manifestBefore = JSON.stringify(repository.readManifest(2026, 19));
  repository.acquireAutomationLock({
    season: 2026,
    round: 19,
    executionId: "exec-block",
    ttlMs: 60 * 60 * 1000,
    now: new Date()
  });
  await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:01:00.000Z" });
  const failed = await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:02:00.000Z" });
  repository.releaseAutomationLock(2026, "exec-block");
  const recovered = await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:03:00.000Z" });

  assert.equal(JSON.stringify(repository.readManifest(2026, 19)), manifestBefore);
  assert.equal(repository.readManifest(2026, 19).lastValidPreRoundSnapshotId.includes("live-2026-r19"), true);
  assert.equal(failed.status.failureCount, 2);
  assert.equal(failed.status.consecutiveFailureCount, 2);
  assert.equal(recovered.status.result, "SKIPPED");
  assert.equal(recovered.status.consecutiveFailureCount, 0);
});

test("alertas operacionais cobrem condicoes principais", () => {
  const alerts = operationalAlerts({
    storage: { status: "WARNING", productionPersistenceSafe: false },
    automationStatus: {
      lastRunAt: "2026-07-10T10:00:00.000Z",
      consecutiveFailureCount: 3,
      secondsToClosing: 60,
      staleLockRecovered: true,
      result: "FAILED",
      errorCode: "AUDIT_FAILURE"
    },
    lock: { executionId: "exec-lock" },
    latestValid: null,
    now: new Date("2026-07-12T10:00:00.000Z")
  }).map((alert) => alert.code);

  assert.ok(alerts.includes("NO_VALID_SNAPSHOT"));
  assert.ok(alerts.includes("NO_RECENT_EXECUTION"));
  assert.ok(alerts.includes("CLOSING_SOON_WITHOUT_RECENT_VALID_SNAPSHOT"));
  assert.ok(alerts.includes("CONSECUTIVE_FAILURES"));
  assert.ok(alerts.includes("STORAGE_UNSAFE"));
  assert.ok(alerts.includes("LOCK_STALE_RECOVERED"));
  assert.ok(alerts.includes("AUDIT_FAILURE"));
});

test("production-health, storage-health e automation-lock sao sanitizados", async () => {
  const repository = new LiveSnapshotRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "live-snapshot-")) });
  await runLiveSnapshotAutomation({ sources: fakeSources(), repository, season: 2026, now: "2026-07-12T10:00:00.000Z" });
  const app = createApp({ liveSnapshotRepository: repository });
  const server = app.listen(0);

  try {
    const production = await get(server, "/live-snapshots/2026/production-health");
    const storage = await get(server, "/live-snapshots/2026/storage-health");
    const lock = await get(server, "/live-snapshots/2026/automation-lock");

    assert.equal(production.status, 200);
    assert.equal(production.body.productionAutomationStatus, "READY");
    assert.equal(production.body.backendVersion, "4.5.4");
    assert.equal(JSON.stringify(production.body).includes(repository.baseDir), false);
    assert.equal(storage.status, 200);
    assert.equal(storage.body.assumptions.PRODUCTION_PERSISTENCE_SAFE, true);
    assert.equal(storage.body.officialPersistence.status, "PASS");
    assert.equal(storage.body.overallStatus, "PASS_WITH_RUNTIME_WARNING");
    assert.equal(JSON.stringify(storage.body).includes(repository.baseDir), false);
    assert.equal(lock.status, 200);
    assert.deepEqual(lock.body, { active: false });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("snapshot real 4.5.0 permanece byte a byte e hash canonico preservado", () => {
  const realPath = path.resolve(__dirname, "../data/live-snapshots/2026/round-19/snapshots/live-2026-r19-20260712120630-b5422fbb.json");
  if (!fs.existsSync(realPath)) return;
  const content = fs.readFileSync(realPath);
  const fileHash = require("node:crypto").createHash("sha256").update(content).digest("hex");
  const snapshot = JSON.parse(content.toString("utf8"));

  assert.equal(fileHash, "c5365ad1ff8888a655cdcabd9cf5f2cdae96161cc762ecf21e3a9297fe21110c");
  assert.equal(snapshot.integrity.contentHash, "5ff04fee95763ee1860beb73cf5caed15214c6326d36dea4305434441b5fffc2");
  assert.equal(verifySnapshotIntegrity(snapshot).ok, true);
});
