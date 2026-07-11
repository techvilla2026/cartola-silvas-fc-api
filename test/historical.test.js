const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { HistoricalRoundCollector } = require("../src/historical/collectors/roundCollector");
const { SCHEMA_VERSION, createPreRoundData, normalizeMatch, normalizePlayer, normalizeScouts } = require("../src/historical/domain/schema");
const { buildAuditSummary } = require("../src/historical/audit");
const { fetchWithRetry } = require("../src/historical/sources/http");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { parseCsv } = require("../src/historical/sources/csv");
const { validateRound } = require("../src/historical/validators/roundValidator");

function sampleRow(overrides = {}) {
  return {
    "atletas.apelido": "Atleta",
    "atletas.apelido_abreviado": "A.",
    "atletas.atleta_id": "10",
    "atletas.clube.id.full.name": "FLA",
    "atletas.clube_id": "262",
    "atletas.entrou_em_campo": "True",
    "atletas.foto": "foto",
    "atletas.jogos_num": "1",
    "atletas.media_num": "5.5",
    "atletas.nome": "Atleta Real",
    "atletas.pontos_num": "7.2",
    "atletas.posicao_id": "5",
    "atletas.preco_num": "12.34",
    "atletas.rodada_id": "1",
    "atletas.slug": "atleta",
    "atletas.status_id": "7",
    "atletas.variacao_num": "-1.2",
    G: "1",
    DS: "2",
    ...overrides
  };
}

test("normaliza jogador", () => {
  const player = normalizePlayer(sampleRow(), { source: "unit" });

  assert.equal(player.athleteId, 10);
  assert.equal(player.name, "Atleta Real");
  assert.equal(player.clubId, 262);
  assert.equal(player.positionId, 5);
  assert.equal(player.statusId, 7);
  assert.equal(player.price, 12.34);
  assert.equal(player.points, 7.2);
  assert.equal(player.played, true);
});

test("normaliza scouts", () => {
  assert.deepEqual(normalizeScouts(sampleRow()), { G: 1, DS: 2 });
});

test("normaliza partida", () => {
  const match = normalizeMatch({
    partida_id: 99,
    clube_casa_id: 1,
    clube_visitante_id: 2,
    partida_data: "2026-01-01 20:00:00",
    local: "Estadio",
    placar_oficial_mandante: 2,
    placar_oficial_visitante: 1,
    valida: true
  });

  assert.equal(match.matchId, 99);
  assert.equal(match.homeClubId, 1);
  assert.equal(match.awayClubId, 2);
  assert.equal(match.homeScore, 2);
});

test("ausencia de campo nao vira zero", () => {
  const player = normalizePlayer(sampleRow({ "atletas.preco_num": "", "atletas.pontos_num": "", DS: "" }), {});

  assert.equal(player.price, null);
  assert.equal(player.points, null);
  assert.deepEqual(player.scouts, { G: 1 });
});

test("schema versionado e serializavel", () => {
  const pre = createPreRoundData({
    season: 2026,
    round: 1,
    source: "unit",
    sourceVersion: "sha",
    collectedAt: "2026-07-11T00:00:00.000Z",
    matches: []
  });
  const parsed = JSON.parse(JSON.stringify(pre));

  assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
  assert.equal(parsed.marketContext.dataType, "PRE_ROUND_DATA");
});

test("parseCsv desserializa campos com virgula", () => {
  const rows = parseCsv('nome,pontos\n"Atleta, Um",1.2\n');

  assert.deepEqual(rows, [{ nome: "Atleta, Um", pontos: "1.2" }]);
});

test("detecta jogador ausente", () => {
  const report = validateRound({ season: 2026, round: 1, source: "unit", players: [], matches: [] }, {
    atletas: { 10: { pontuacao: 1, scout: {}, clube_id: 1, posicao_id: 5 } }
  });

  assert.deepEqual(report.missingPlayers, [10]);
});

test("detecta divergencia de pontuacao", () => {
  const report = validateRound({
    season: 2026,
    round: 1,
    source: "unit",
    players: [{ athleteId: 10, points: 1, played: true, scouts: {} }],
    matches: []
  }, { atletas: { 10: { pontuacao: 2, scout: {} } } });

  assert.equal(report.pointsDifferences.length, 1);
});

test("detecta divergencia de scout", () => {
  const report = validateRound({
    season: 2026,
    round: 1,
    source: "unit",
    players: [{ athleteId: 10, points: 1, played: true, scouts: { G: 1 } }],
    matches: []
  }, { atletas: { 10: { pontuacao: 1, scout: { G: 2 } } } });

  assert.equal(report.scoutDifferences.length, 1);
});

test("detecta divergencia de preco por estrutura do relatorio", () => {
  const report = validateRound({
    season: 2026,
    round: 1,
    source: "unit",
    players: [{ athleteId: 10, points: 1, played: true, scouts: {} }],
    matches: []
  }, { atletas: { 10: { pontuacao: 1, scout: {} } } });

  assert.deepEqual(report.priceDifferences, []);
});

test("separa pre e post e marca indisponivel para backtest sem vazamento", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "historical-"));
  const repository = new HistoricalDataRepository({ baseDir: dir });
  const source = {
    async getSourceMetadata() {
      return { primaryRevision: "sha", primaryLicense: "MIT" };
    },
    async fetchRoundCsv() {
      return {
        url: "https://example.test/rodada-1.csv",
        text: `atletas.apelido,atletas.atleta_id,atletas.clube_id,atletas.entrou_em_campo,atletas.jogos_num,atletas.media_num,atletas.nome,atletas.pontos_num,atletas.posicao_id,atletas.preco_num,atletas.status_id,atletas.variacao_num,G\nAtleta,10,262,True,1,5,Atleta Real,7,5,12,7,1,1\n`
      };
    },
    async fetchMatches() {
      return { partidas: [] };
    },
    async fetchOfficialScoredAthletes() {
      return { atletas: { 10: { pontuacao: 7, scout: { G: 1 } } } };
    }
  };
  const collector = new HistoricalRoundCollector({ source, repository });

  await collector.collectRound({ season: 2026, round: 1, force: true });
  const pre = repository.readRoundFile(2026, 1, "pre-round.json");
  const post = repository.readRoundFile(2026, 1, "post-round.json");

  assert.equal(pre.players.length, 0);
  assert.equal(post.players.length, 1);
  assert.ok(pre.marketContext.notAvailableForLeakFreeBacktest.includes("priceBeforeRound"));
});

test("persistencia nao sobrescreve sem force e sobrescreve com force", () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  const files = {
    "pre-round.json": { ok: true },
    "post-round.json": { players: [], matches: [], clubs: {} },
    "validation.json": { validationStatus: "VALID" }
  };

  repository.saveRound(2026, 1, files);
  assert.throws(() => repository.saveRound(2026, 1, files), /Use --force/);
  assert.doesNotThrow(() => repository.saveRound(2026, 1, files, { force: true }));
});

test("coverage correto e auditoria de rodadas ausentes", () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  repository.saveRound(2026, 1, {
    "pre-round.json": {},
    "post-round.json": {
      source: "unit",
      collectedAt: "now",
      players: [
        { price: 1, points: 2, average: 3, statusId: 7, played: true, scouts: { G: 1 } },
        { price: 1, points: 0, average: 3, statusId: 7, played: false, scouts: {} }
      ],
      matches: [{ homeScore: 1, awayScore: 0 }],
      clubs: { 1: {} }
    },
    "validation.json": { validationStatus: "VALID" }
  });
  const audit = buildAuditSummary(repository, 2026, { to: 2 });

  assert.equal(audit.rounds[0].hasPrices, true);
  assert.equal(audit.rounds[0].scoredAthletesCount, 1);
  assert.deepEqual(audit.missingRounds, [2]);
});

test("erro isolado nao destroi coleta completa", async () => {
  const repository = new HistoricalDataRepository({ baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "historical-")) });
  let calls = 0;
  const source = {
    async getSourceMetadata() {
      return { primaryRevision: "sha", primaryLicense: "MIT" };
    },
    async fetchRoundCsv() {
      calls += 1;
      if (calls === 1) throw new Error("falha isolada");
      return {
        url: "u",
        text: "atletas.apelido,atletas.atleta_id,atletas.pontos_num\nAtleta,10,1\n"
      };
    },
    async fetchMatches() {
      return { partidas: [] };
    },
    async fetchOfficialScoredAthletes() {
      return { atletas: {} };
    }
  };
  const collector = new HistoricalRoundCollector({ source, repository });
  const results = [];

  for (const round of [1, 2]) {
    try {
      results.push(await collector.collectRound({ season: 2026, round, force: true }));
    } catch (error) {
      results.push({ round, status: "FAILED" });
    }
  }

  assert.deepEqual(results.map((item) => item.status), ["FAILED", "COLLECTED"]);
});

test("timeout e retry limitado sem chamada externa", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    throw new Error("network");
  };

  await assert.rejects(() => fetchWithRetry("https://example.test", {
    fetchImpl,
    retries: 2,
    backoffMs: 1,
    timeoutMs: 10
  }));
  assert.equal(attempts, 3);
});
