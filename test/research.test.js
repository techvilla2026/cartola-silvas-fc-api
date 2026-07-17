const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const test = require("node:test");

const { createApp } = require("../server");
const { ResearchRepository } = require("../src/research/repository");
const {
  buildExperiments,
  buildPromotionGate,
  errorMetrics,
  readSource,
  runResearch
} = require("../src/research/lab");

async function request(app, url) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${url}`);
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

function tempResearchRepository() {
  return new ResearchRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "research-")) });
}

function generateResearch() {
  const repository = tempResearchRepository();
  const result = runResearch({ season: 2026, mode: "all", researchRepository: repository });
  return { repository, result };
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hasInvalidNumber(value) {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasInvalidNumber);
  if (value && typeof value === "object") return Object.values(value).some(hasInvalidNumber);
  return false;
}

test("research:audit gera cobertura historica PASS sem vazamento", () => {
  const repository = tempResearchRepository();
  runResearch({ season: 2026, mode: "audit", researchRepository: repository });
  const audit = repository.readJson(2026, "audit.json");

  assert.equal(audit.schemaVersion, "historical-engine-audit/v1");
  assert.equal(audit.auditStatus, "PASS");
  assert.equal(audit.temporalValidation.leakageStatus, "PASS");
  assert.equal(audit.temporalValidation.decisionsFrozenBeforePostRoundComparison, true);
  assert.equal(audit.coverage.evaluatedRounds.length, 17);
  assert.deepEqual(audit.critical, []);
});

test("diagnostico de erro inclui metricas ampliadas e segmentos reais", () => {
  const { repository } = generateResearch();
  const diagnostics = repository.readJson(2026, "engine-diagnostics.json");

  assert.equal(diagnostics.schemaVersion, "engine-error-diagnostics/v1");
  assert.equal(diagnostics.overall.count, 5126);
  assert.equal(typeof diagnostics.overall.p90AbsoluteError, "number");
  assert.equal(typeof diagnostics.overall.above5ErrorRate, "number");
  assert.ok(diagnostics.byPosition.MEI);
  assert.ok(diagnostics.byHomeAway.HOME);
  assert.ok(diagnostics.byPriceBand["5-10"]);
  assert.ok(diagnostics.discoveredEngineFeatures.includes("homeAway"));
});

test("diagnostico preserva null e zero sem NaN ou Infinity", () => {
  const { repository } = generateResearch();
  const diagnostics = repository.readJson(2026, "engine-diagnostics.json");

  assert.equal(diagnostics.nullZeroPolicy.nullStatusPreserved, true);
  assert.equal(diagnostics.nullZeroPolicy.numericZeroPreserved, true);
  assert.equal(hasInvalidNumber(diagnostics), false);
});

test("ranking calcula Spearman, Kendall quando viavel e Precision@K", () => {
  const { repository } = generateResearch();
  const ranking = repository.readJson(2026, "ranking-diagnostics.json");

  assert.equal(ranking.schemaVersion, "engine-ranking-diagnostics/v1");
  assert.equal(typeof ranking.overall.spearman, "number");
  assert.ok(["EVALUATED", "SKIPPED_TOO_MANY_PAIRS", "INSUFFICIENT_SAMPLE"].includes(ranking.overall.kendallStatus));
  assert.equal(typeof ranking.overall.at10.precision, "number");
  assert.ok(ranking.byRound["02"]);
  assert.ok(ranking.byPosition.ATA);
});

test("time ideal usa oracle somente para avaliacao de regret", () => {
  const { repository } = generateResearch();
  const diagnostics = repository.readJson(2026, "ideal-team-diagnostics.json");

  assert.equal(diagnostics.schemaVersion, "ideal-team-diagnostics/v1");
  assert.equal(diagnostics.oraclePolicy, "EVALUATION_ONLY_NOT_AVAILABLE_TO_ENGINE");
  assert.equal(diagnostics.formation, "4-3-3");
  assert.equal(diagnostics.rounds.length, 17);
  assert.equal(typeof diagnostics.totals.regret, "number");
  assert.notDeepEqual(diagnostics.rounds[0].chosenLineup, diagnostics.rounds[0].oracleOptimalTeam);
});

test("diagnostico de capitao separa politicas pre-rodada do oracle", () => {
  const { repository } = generateResearch();
  const captain = repository.readJson(2026, "captain-diagnostics.json");

  assert.equal(captain.schemaVersion, "captain-policy-diagnostics/v1");
  assert.equal(captain.policies.official.temporalStatus, "PRE_ROUND_SAFE");
  assert.equal(captain.policies.oracleBestActual.temporalStatus, "ORACLE_EVALUATION_ONLY");
  assert.equal(captain.rounds.length, 17);
});

test("ablation study e offline e nao muda formula oficial", () => {
  const { repository } = generateResearch();
  const ablation = repository.readJson(2026, "ablation-study.json");

  assert.equal(ablation.schemaVersion, "engine-ablation-study/v1");
  assert.equal(ablation.status, "OFFLINE_ONLY");
  assert.equal(ablation.officialFormulaChanged, false);
  assert.ok(ablation.factors.official);
  assert.ok(ablation.factors.noHomeBonus);
});

test("experimentos walk-forward pulam primeira rodada e treinam apenas com passado", () => {
  const { repository } = generateResearch();
  const experiment = repository.readJson(2026, "experiments/bias-correction-walk-forward.json");

  assert.equal(experiment.schemaVersion, "walk-forward-experiment/v1");
  assert.equal(experiment.trainPolicy, "Somente rodadas anteriores a rodada avaliada.");
  assert.equal(experiment.leakageStatus, "PASS");
  assert.equal(experiment.rounds[0].status, "SKIPPED_INSUFFICIENT_PREVIOUS_ROUNDS");
  assert.equal(experiment.rounds[1].status, "EVALUATED");
});

test("experimentos individuais incluem metadata obrigatoria", () => {
  const { repository } = generateResearch();
  const experiment = repository.readJson(2026, "experiments/home-away-bias-walk-forward.json");

  for (const key of ["generatedAt", "season", "engineVersion", "dataFingerprint", "configFingerprint", "codeVersion", "inputRounds", "evaluatedRounds", "warnings", "limitations"]) {
    assert.equal(Object.hasOwn(experiment, key), true);
  }
});

test("promotion gate nunca promove candidato na Build 4.7.0", () => {
  const { repository } = generateResearch();
  const gate = repository.readJson(2026, "promotion-gate.json");

  assert.equal(gate.schemaVersion, "engine-promotion-gate/v1");
  assert.equal(gate.productionEngineChanged, false);
  assert.equal(gate.forbiddenStates.includes("PROMOTED"), true);
  assert.equal(gate.decisions.some((item) => item.promoted), false);
  assert.equal(gate.finalStatus, "NO_PROMOTION");
});

test("research-health confirma endpoints read-only e sem computacao pesada por request", () => {
  const { repository } = generateResearch();
  const health = repository.readJson(2026, "research-health.json");

  assert.equal(health.schemaVersion, "engine-research-health/v1");
  assert.equal(health.status, "PASS");
  assert.equal(health.readOnlyEndpointsPrepared, true);
  assert.equal(health.heavyComputationOnRequest, false);
  assert.equal(health.productionSnapshotMutation, false);
});

test("endpoints /research leem artefatos persistidos", async () => {
  const { repository } = generateResearch();
  const app = createApp({ fetchImpl: fetch, researchRepository: repository });

  assert.equal((await request(app, "/research/engine-audit")).status, 200);
  assert.equal((await request(app, "/research/engine-diagnostics")).status, 200);
  assert.equal((await request(app, "/research/ranking-diagnostics")).status, 200);
  assert.equal((await request(app, "/research/ideal-team-diagnostics")).status, 200);
  assert.equal((await request(app, "/research/captain-diagnostics")).status, 200);
  assert.equal((await request(app, "/research/ablation-study")).status, 200);
  assert.equal((await request(app, "/research/experiments")).status, 200);
  assert.equal((await request(app, "/research/experiments/bias-correction-walk-forward")).status, 200);
  assert.equal((await request(app, "/research/promotion-gate")).status, 200);
  assert.equal((await request(app, "/research/research-health")).status, 200);
});

test("endpoint de experimento rejeita candidateId invalido", async () => {
  const { repository } = generateResearch();
  const app = createApp({ fetchImpl: fetch, researchRepository: repository });
  const response = await request(app, "/research/experiments/BAD_ID");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_CANDIDATE_ID");
});

test("endpoint de pesquisa retorna 404 claro quando artefato nao existe", async () => {
  const app = createApp({ fetchImpl: fetch, researchRepository: tempResearchRepository() });
  const response = await request(app, "/research/engine-audit");

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "NOT_FOUND");
});

test("fingerprint dos dados e deterministico entre execucoes", () => {
  const first = generateResearch().repository.readJson(2026, "engine-diagnostics.json");
  const second = generateResearch().repository.readJson(2026, "engine-diagnostics.json");

  assert.equal(first.dataFingerprint, second.dataFingerprint);
  assert.equal(first.overall.mae, second.overall.mae);
});

test("bootstrap de robustez e deterministico", () => {
  const source = readSource({ season: 2026 });
  const first = buildExperiments(source)[0].robustness;
  const second = buildExperiments(source)[0].robustness;

  assert.deepEqual(first, second);
});

test("promotion gate respeita estados permitidos", () => {
  const source = readSource({ season: 2026 });
  const gate = buildPromotionGate(source, buildExperiments(source));
  const allowed = new Set(gate.allowedStates);

  assert.equal(gate.decisions.every((item) => allowed.has(item.state)), true);
  assert.equal(gate.decisions.some((item) => item.state === "PROMOTED"), false);
});

test("metricas ignoram pares invalidos sem transformar null em zero", () => {
  const metrics = errorMetrics([
    { predictedPoints: null, actualPoints: 10 },
    { predictedPoints: 0, actualPoints: 1 },
    { predictedPoints: 3, actualPoints: 1 }
  ]);

  assert.equal(metrics.count, 2);
  assert.equal(metrics.mae, 1.5);
  assert.equal(metrics.bias, 0.5);
});

test("laboratorio nao altera snapshot real persistido", () => {
  const snapshotPath = path.join(__dirname, "../data/live-snapshots/2026/round-19/snapshots/live-2026-r19-20260712120630-b5422fbb.json");
  const before = fileHash(snapshotPath);
  generateResearch();
  const after = fileHash(snapshotPath);

  assert.equal(after, before);
});

test("configuracao de producao READY permanece preservada", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/live-snapshot-production.json"), "utf8"));

  assert.equal(config.workflowActivationStatus, "ACTIVE");
  assert.equal(config.officialPersistenceMode, "GIT_AUTOMATED_COMMITS");
  assert.equal(config.renderAutoDeployMode, "ON_COMMIT");
});

test("endpoint antigo de proxy continua preservado", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const app = createApp({ fetchImpl });
  const response = await request(app, "/cartola/status");

  assert.equal(response.status, 200);
  assert.equal(requestedUrl, "https://api.cartolafc.globo.com/mercado/status");
});
