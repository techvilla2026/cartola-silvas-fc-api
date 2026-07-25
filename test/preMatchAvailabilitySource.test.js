const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  POST_MATCH_BLOCKED,
  PRE_MATCH_SOURCE_VERSION,
  PreMatchAvailabilityRepository,
  SAFE_PRE_MATCH,
  UNKNOWN_TIMING,
  assertSignalTemporalSafety,
  autoCapturePreMatchAvailability,
  buildPreMatchAvailabilitySnapshot,
  buildCaptureStatus,
  capturePreMatchAvailability,
  captureWindowForMinutes,
  createManualPreMatchInput,
  evaluatePreMatchAvailability,
  normalizeStatus,
  temporalRelation
} = require("../src/research/preMatchAvailabilitySource");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(app, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      fetch(`http://127.0.0.1:${server.address().port}${pathname}`, { headers })
        .then(async (response) => {
          const body = await response.json();
          server.close(() => resolve({ status: response.status, body, headers: response.headers }));
        })
        .catch((error) => server.close(() => reject(error)));
    });
  });
}

function fakeSources({ deadlineTimestamp = 1784980800 } = {}) {
  return {
    marketStatus: {
      endpoint: "/mercado/status",
      status: 200,
      capturedAt: "2026-07-24T10:00:00.000Z",
      body: {
        temporada: 2026,
        rodada_atual: 20,
        status_mercado: 1,
        fechamento: { timestamp: deadlineTimestamp }
      }
    },
    market: {
      endpoint: "/atletas/mercado",
      status: 200,
      capturedAt: "2026-07-24T10:00:01.000Z",
      body: {
        clubes: { 1: { id: 1, nome: "Clube", nome_fantasia: "Clube", abreviacao: "CLU" } },
        posicoes: { 1: { id: 1, nome: "Goleiro", abreviacao: "GOL" }, 5: { id: 5, nome: "Atacante", abreviacao: "ATA" } },
        status: {
          2: { id: 2, nome: "Dúvida" },
          3: { id: 3, nome: "Suspenso" },
          5: { id: 5, nome: "Contundido" },
          7: { id: 7, nome: "Provável" }
        },
        atletas: [
          { atleta_id: 1, apelido: "Um", nome: "Atleta Um", clube_id: 1, posicao_id: 5, status_id: 7, preco_num: 10, media_num: 5, jogos_num: 5 },
          { atleta_id: 2, apelido: "Dois", nome: "Atleta Dois", clube_id: 1, posicao_id: 1, status_id: 2, preco_num: 8, media_num: 4, jogos_num: 4 }
        ]
      }
    },
    matches: {
      endpoint: "/partidas",
      status: 200,
      capturedAt: "2026-07-24T10:00:02.000Z",
      body: {
        rodada: 20,
        clubes: {},
        partidas: [{ partida_id: 10, clube_casa_id: 1, clube_visitante_id: 2, partida_data: "2026-07-25 16:00:00", timestamp: 1784980800, valida: true }]
      }
    }
  };
}

function prePlayer(id, positionId = 5) {
  return {
    athleteId: id,
    name: `P${id}`,
    clubId: 1,
    positionId,
    predictedPoints: 5,
    averageBeforeRound: 4,
    gamesBeforeRound: 3,
    priceBeforeRound: 7,
    accumulatedPointsBeforeRound: 12,
    eligibleForBacktest: true
  };
}

function seedHistorical(repository) {
  for (let round = 1; round <= 20; round += 1) {
    repository.saveRoundFile(2026, round, "post-round.json", {
      players: [
        { athleteId: 1, name: "Atleta Um", positionId: 5, played: true, points: 5, games: round, scouts: {} },
        { athleteId: 2, name: "Atleta Dois", positionId: 1, played: round % 2 === 0, points: round % 2 === 0 ? 2 : null, games: Math.floor(round / 2), scouts: {} }
      ]
    }, { force: true });
    if (round >= 2 && round <= 18) {
      repository.saveRoundFile(2026, round, "pre-round.json", {
        players: [prePlayer(1, 5), prePlayer(2, 1)]
      }, { force: true });
    }
  }
}

test("contrato PRE_MATCH_AVAILABILITY_SOURCE_V1 e normalizacao de status", () => {
  assert.equal(PRE_MATCH_SOURCE_VERSION, "PRE_MATCH_AVAILABILITY_SOURCE_V1");
  assert.equal(normalizeStatus("Provável").statusNormalized, "PROBABLE");
  assert.equal(normalizeStatus("Dúvida").statusNormalized, "DOUBT");
  assert.equal(normalizeStatus("Contundido").statusNormalized, "INJURED");
  assert.equal(normalizeStatus("Suspenso").statusNormalized, "SUSPENDED");
  assert.equal(normalizeStatus(null).statusNormalized, "UNKNOWN");
});

test("prova temporal bloqueia UNKNOWN_TIMING e POST_MATCH", () => {
  assert.equal(temporalRelation("2026-07-24T10:00:00.000Z", "2026-07-25T10:00:00.000Z").temporalSafety, SAFE_PRE_MATCH);
  assert.equal(temporalRelation("2026-07-26T10:00:00.000Z", "2026-07-25T10:00:00.000Z").temporalSafety, POST_MATCH_BLOCKED);
  assert.equal(temporalRelation("2026-07-24T10:00:00.000Z", null).temporalSafety, UNKNOWN_TIMING);
  assert.throws(() => assertSignalTemporalSafety({ signalType: "manual", temporalSafety: UNKNOWN_TIMING }), /UNKNOWN_TIMING/);
  assert.throws(() => assertSignalTemporalSafety({ signalType: "post", temporalSafety: POST_MATCH_BLOCKED }), /POST_MATCH_BLOCKED/);
});

test("snapshot e deterministico, imutavel e nova captura cria nova versao", async () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("pre-match-hist-") });
  seedHistorical(historical);
  const research = new ResearchRepository({ baseDir: tempDir("pre-match-research-") });
  const repository = new PreMatchAvailabilityRepository({ researchRepository: research });
  const snapshot = buildPreMatchAvailabilitySnapshot({
    sources: fakeSources(),
    capturedAt: "2026-07-24T10:00:00.000Z",
    historicalRepository: historical
  });
  const same = buildPreMatchAvailabilitySnapshot({
    sources: fakeSources(),
    capturedAt: "2026-07-24T10:00:00.000Z",
    historicalRepository: historical
  });
  assert.equal(snapshot.snapshotFingerprint, same.snapshotFingerprint);
  assert.equal(snapshot.captureId, same.captureId);
  repository.saveSnapshot(snapshot);
  assert.throws(() => repository.saveSnapshot(snapshot), /imutavel ja existe/);
  const later = await capturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-24T10:01:00.000Z")
  });
  assert.notEqual(later.snapshot.captureId, snapshot.captureId);
  assert.equal(repository.listSnapshots(2026, 20).length, 2);
});

test("entrada manual curada gera audit trail e bloqueia timestamp inseguro", () => {
  const research = new ResearchRepository({ baseDir: tempDir("manual-pre-match-") });
  const repository = new PreMatchAvailabilityRepository({ researchRepository: research });
  const record = createManualPreMatchInput({
    season: 2026,
    round: 20,
    deadline: "2026-07-25T12:00:00.000Z",
    enteredAt: "2026-07-24T10:00:00.000Z",
    enteredBy: "test",
    repository,
    inputs: [
      { playerId: 1, signalType: "starterFlag", value: true, sourceDescription: "curadoria", sourceReference: "nota", observedAt: "2026-07-24T09:00:00.000Z", confidence: "MEDIUM" },
      { playerId: 2, signalType: "injuryFlag", value: true, sourceDescription: "curadoria", sourceReference: "sem timestamp", confidence: "LOW" }
    ]
  });
  assert.equal(record.auditTrail.length, 1);
  assert.equal(record.temporalSafetySummary.safe, 1);
  assert.equal(record.temporalSafetySummary.unknown, 1);
});

test("captura congela V1, V2 threshold 0.50 e threshold 0.45 experimental", async () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("pre-match-freeze-hist-") });
  seedHistorical(historical);
  const research = new ResearchRepository({ baseDir: tempDir("pre-match-freeze-research-") });
  const repository = new PreMatchAvailabilityRepository({ researchRepository: research });
  const { snapshot } = await capturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-24T10:00:00.000Z")
  });
  assert.equal(snapshot.thresholdPolicy.officialThresholdPreserved, 0.5);
  assert.equal(snapshot.thresholdPolicy.thresholdOfficialChanged, false);
  assert.equal(typeof snapshot.players[0].frozenPredictions.probabilityV1, "number");
  assert.equal(typeof snapshot.players[0].frozenPredictions.probabilityV2, "number");
  assert.equal(typeof snapshot.players[0].frozenPredictions.decisionV2Threshold050, "boolean");
  assert.equal(typeof snapshot.players[0].frozenPredictions.decisionV2Threshold045, "boolean");
  assert.equal(research.readJson(2026, "prospective-availability-controls.json").controls[0].status, "PENDING_OUTCOME");
});

test("avaliacao posterior usa outcome sem alterar snapshot", async () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("pre-match-eval-hist-") });
  seedHistorical(historical);
  const research = new ResearchRepository({ baseDir: tempDir("pre-match-eval-research-") });
  const repository = new PreMatchAvailabilityRepository({ researchRepository: research });
  const { snapshot } = await capturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-24T10:00:00.000Z")
  });
  const before = repository.readSnapshot(2026, 20, snapshot.captureId).snapshotFingerprint;
  const artifact = evaluatePreMatchAvailability({ season: 2026, round: 20, repository, historicalRepository: historical });
  const after = repository.readSnapshot(2026, 20, snapshot.captureId).snapshotFingerprint;
  assert.equal(before, after);
  assert.equal(artifact.targetRows, 2);
  assert.equal(artifact.metrics.availabilityV2Threshold050.threshold, 0.5);
  assert.equal(artifact.metrics.availabilityV2Threshold045.threshold, 0.45);
});

test("avaliacao pendente usa snapshot congelado e nao inventa outcome", async () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("pre-match-pending-hist-") });
  seedHistorical(historical);
  const research = new ResearchRepository({ baseDir: tempDir("pre-match-pending-research-") });
  const repository = new PreMatchAvailabilityRepository({ researchRepository: research });
  const { snapshot } = await capturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-24T10:00:00.000Z")
  });
  fs.rmSync(historical.getRoundDirectory(2026, 20), { recursive: true, force: true });
  const artifact = evaluatePreMatchAvailability({ season: 2026, round: 20, repository, historicalRepository: historical });
  assert.equal(artifact.status, "PENDING_OUTCOME");
  assert.equal(artifact.captureId, snapshot.captureId);
  assert.equal(artifact.metrics, null);
});

test("auto-capture respeita janelas, idempotencia, dry-run e pos-deadline", async () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("pre-match-auto-hist-") });
  seedHistorical(historical);
  const research = new ResearchRepository({ baseDir: tempDir("pre-match-auto-research-") });
  const repository = new PreMatchAvailabilityRepository({ researchRepository: research });
  assert.equal(captureWindowForMinutes(240), "PRIMARY");
  assert.equal(captureWindowForMinutes(60), "FINAL");
  assert.equal(captureWindowForMinutes(-1), "MARKET_CLOSED");

  const dry = await autoCapturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    dryRun: true,
    now: () => new Date("2026-07-25T08:00:00.000Z")
  });
  assert.equal(dry.actionTaken, "DRY_RUN");
  assert.equal(repository.listSnapshots(2026, 20).length, 0);

  const primary = await autoCapturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-25T08:00:00.000Z")
  });
  assert.equal(primary.reasonCode, "CAPTURE_CREATED");
  assert.equal(primary.captureWindow, "PRIMARY");
  const duplicate = await autoCapturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-25T08:30:00.000Z")
  });
  assert.equal(duplicate.reasonCode, "ALREADY_CAPTURED");

  const final = await autoCapturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-25T11:00:00.000Z")
  });
  assert.equal(final.captureWindow, "FINAL");
  assert.equal(repository.selectEvaluationSnapshot(2026, 20).captureType, "FINAL");

  const closed = await autoCapturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-26T10:00:00.000Z")
  });
  assert.equal(closed.reasonCode, "MARKET_CLOSED");
});

test("capture-status sinaliza risco e missed capture", () => {
  const research = new ResearchRepository({ baseDir: tempDir("pre-match-status-research-") });
  const repository = new PreMatchAvailabilityRepository({ researchRepository: research });
  const atRisk = buildCaptureStatus({
    season: 2026,
    round: 21,
    deadline: "2026-07-25T12:00:00.000Z",
    currentTime: "2026-07-25T10:30:00.000Z",
    repository
  });
  assert.equal(atRisk.captureRisk, "CAPTURE_AT_RISK");
  const missed = buildCaptureStatus({
    season: 2026,
    round: 21,
    deadline: "2026-07-25T12:00:00.000Z",
    currentTime: "2026-07-25T12:01:00.000Z",
    repository
  });
  assert.equal(missed.captureRisk, "MISSED_CAPTURE");
});

test("endpoints pre-match availability sao read-only e preservam CORS", async () => {
  const historical = new HistoricalDataRepository({ baseDir: tempDir("pre-match-endpoint-hist-") });
  seedHistorical(historical);
  const research = new ResearchRepository({ baseDir: tempDir("pre-match-endpoint-research-") });
  const repository = new PreMatchAvailabilityRepository({ researchRepository: research });
  await capturePreMatchAvailability({
    sources: fakeSources(),
    repository,
    historicalRepository: historical,
    now: () => new Date("2026-07-24T10:00:00.000Z")
  });
  const app = createApp({ fetchImpl: fetch, researchRepository: research, preMatchAvailabilityRepository: repository });
  const headers = { Origin: "https://meutimeideal.netlify.app" };
  evaluatePreMatchAvailability({ season: 2026, round: 20, repository, historicalRepository: historical });
  for (const pathname of ["/research/pre-match-availability", "/research/pre-match-availability/latest", "/research/pre-match-availability/round/20", "/research/pre-match-availability/coverage", "/research/pre-match-availability/capture-status", "/research/pre-match-availability/evaluation/20", "/research/pre-match-availability/comparison/20", "/research/prospective-controls"]) {
    const response = await request(app, pathname, headers);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://meutimeideal.netlify.app");
  }
});
