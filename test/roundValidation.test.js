const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const test = require("node:test");

const { createApp } = require("../server");
const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { ResearchRepository } = require("../src/research/repository");
const {
  CLEAN_SHEET_METADATA,
  buildDefenseRowsForMatches,
  buildRoundValidation,
  buildStandings,
  calculateMatchupStrengthGap,
  cleanSheetV1,
  cleanSheetV2,
  displayScore
} = require("../src/research/roundValidation");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function match(matchId, round, date, homeClubId, awayClubId, homeScore, awayScore) {
  return {
    matchId,
    round,
    homeClubId,
    awayClubId,
    date,
    homeScore,
    awayScore
  };
}

function repositories() {
  const historicalRepository = new HistoricalDataRepository({ baseDir: tempDir("historical-round-validation-") });
  const liveSnapshotRepository = new LiveSnapshotRepository({ baseDir: tempDir("live-round-validation-") });
  const researchRepository = new ResearchRepository({ baseDir: tempDir("research-round-validation-") });
  return { historicalRepository, liveSnapshotRepository, researchRepository };
}

function seedHistorical(repository) {
  const clubs = {
    1: { id: 1, name: "AAA" },
    2: { id: 2, name: "BBB" },
    3: { id: 3, name: "CCC" },
    4: { id: 4, name: "DDD" }
  };
  repository.saveRoundFile(2026, 1, "post-round.json", {
    season: 2026,
    round: 1,
    clubs,
    matches: [
      match(101, 1, "2026-05-01 19:00:00", 1, 2, 3, 0),
      match(102, 1, "2026-05-01 21:00:00", 3, 4, 0, 1)
    ],
    players: []
  }, { force: true });
  repository.saveRoundFile(2026, 2, "post-round.json", {
    season: 2026,
    round: 2,
    clubs,
    matches: [
      match(201, 2, "2026-05-08 19:00:00", 1, 3, 2, 0),
      match(202, 2, "2026-05-08 21:00:00", 2, 4, 1, 1)
    ],
    players: []
  }, { force: true });
  repository.saveRoundFile(2026, 18, "post-round.json", {
    season: 2026,
    round: 18,
    clubs,
    matches: [
      match(1801, 18, "2026-07-01 19:00:00", 1, 4, 1, 0),
      match(1802, 18, "2026-07-01 21:00:00", 2, 3, 0, 2)
    ],
    players: []
  }, { force: true });
}

function seedLive(repository) {
  const snapshot = {
    schemaVersion: "live-pre-round-snapshot/v1",
    snapshotId: "test-snapshot",
    season: 2026,
    round: 19,
    capturedAt: "2026-07-10T12:00:00.000Z",
    capturePhase: "PRE_MARKET_CLOSE",
    isValidPreRoundSnapshot: true,
    data: {
      clubs: { 1: { id: 1, name: "AAA" }, 2: { id: 2, name: "BBB" }, 3: { id: 3, name: "CCC" }, 4: { id: 4, name: "DDD" } },
      matches: [
        { matchId: 1901, round: 19, homeClubId: 1, awayClubId: 3, matchDate: "2026-07-20 19:00:00", officialHomeScore: null, officialAwayScore: null },
        { matchId: 1902, round: 19, homeClubId: 2, awayClubId: 4, matchDate: "2026-07-20 21:00:00", officialHomeScore: null, officialAwayScore: null }
      ],
      players: [
        { athleteId: 11, nickname: "Ivan", name: "Ivan", clubId: 1, positionId: 1, roundPoints: 8, enteredField: true },
        { athleteId: 12, nickname: "Lat A", name: "Lat A", clubId: 1, positionId: 2, roundPoints: 5, enteredField: true },
        { athleteId: 13, nickname: "Zag A", name: "Zag A", clubId: 1, positionId: 3, roundPoints: 4, enteredField: true },
        { athleteId: 14, nickname: "Mei A", name: "Mei A", clubId: 1, positionId: 4, roundPoints: 7, enteredField: true },
        { athleteId: 15, nickname: "Ata A", name: "Ata A", clubId: 1, positionId: 5, roundPoints: 9, enteredField: true },
        { athleteId: 16, nickname: "Tec A", name: "Tec A", clubId: 1, positionId: 6, roundPoints: 6, enteredField: true }
      ]
    },
    motor: {
      predictions: [
        { athleteId: 11, name: "Ivan", clubId: 1, positionId: 1, predictedPoints: 7, analysisGrade: 60, dataQualityScore: 40 },
        { athleteId: 12, name: "Lat A", clubId: 1, positionId: 2, predictedPoints: 5, analysisGrade: 50, dataQualityScore: 40 },
        { athleteId: 13, name: "Zag A", clubId: 1, positionId: 3, predictedPoints: 4, analysisGrade: 40, dataQualityScore: 40 },
        { athleteId: 14, name: "Mei A", clubId: 1, positionId: 4, predictedPoints: 6, analysisGrade: 55, dataQualityScore: 40 },
        { athleteId: 15, name: "Ata A", clubId: 1, positionId: 5, predictedPoints: 8, analysisGrade: 70, dataQualityScore: 40 },
        { athleteId: 16, name: "Tec A", clubId: 1, positionId: 6, predictedPoints: 3, analysisGrade: 30, dataQualityScore: 40 }
      ],
      idealTeam: {
        formation: "4-3-3",
        players: [
          { athleteId: 11 }, { athleteId: 12 }, { athleteId: 13 }, { athleteId: 14 }, { athleteId: 15 }, { athleteId: 16 }
        ],
        captainAthleteId: 15
      }
    }
  };
  repository.writeSnapshotImmutable(snapshot);
  repository.writeManifestAtomic(2026, 19, {
    schemaVersion: "live-pre-round-snapshot-manifest/v1",
    season: 2026,
    round: 19,
    totalSnapshots: 1,
    validPreRoundSnapshots: 1,
    firstSnapshotId: "test-snapshot",
    lastSnapshotId: "test-snapshot",
    lastValidPreRoundSnapshotId: "test-snapshot",
    finalPreCloseSnapshotId: "test-snapshot",
    snapshots: [{ snapshotId: "test-snapshot", capturedAt: snapshot.capturedAt, round: 19, capturePhase: "PRE_MARKET_CLOSE", isValidPreRoundSnapshot: true }]
  });
}

async function request(app, url) {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("ranking SG usa apenas partidas anteriores ao cutoff", () => {
  const matches = [
    { matchId: 1, startsAt: "2026-01-01T10:00:00.000Z", homeClubId: 1, awayClubId: 2, homeScore: 2, awayScore: 0 },
    { matchId: 2, startsAt: "2026-01-02T10:00:00.000Z", homeClubId: 1, awayClubId: 2, homeScore: 0, awayScore: 5 },
    { matchId: 3, startsAt: "2026-01-02T09:00:00.000Z", homeClubId: 1, awayClubId: 2, homeScore: null, awayScore: null }
  ];
  const table = buildStandings(matches, "2026-01-02T09:00:00.000Z");
  assert.equal(table.get(1).points, 3);
  assert.equal(table.get(1).goalsAgainst, 0);
});

test("matchupStrengthGap responde a defesa, ataque, tabela, forma e mando", () => {
  const gap = calculateMatchupStrengthGap({
    team: { offensiveStrength: 80, defensiveStrength: 85, recentForm: { formIndex: 90 } },
    opponent: { offensiveStrength: 30, defensiveStrength: 35, recentForm: { formIndex: 20 } },
    teamStanding: { pointsPerGame: 2.1, goalDifference: 10 },
    opponentStanding: { pointsPerGame: 0.5, goalDifference: -10 },
    homeAway: "HOME"
  });
  assert.ok(gap > 0);
  assert.ok(gap <= 100);
});

test("cleanSheet V1 e V2 preservam rawScore e metadata sem probabilidade", () => {
  const context = {
    team: { defensiveStrength: 100, offensiveStrength: 70, recentForm: { formIndex: 100 }, sampleSize: 10, homeAwayPerformance: { index: 90 } },
    opponent: { offensiveStrength: 0, defensiveStrength: 20, recentOffensiveStrength: 0, recentForm: { formIndex: 0 } },
    teamStanding: { leaguePosition: 1, pointsPerGame: 2.5, points: 40, goalDifference: 30 },
    opponentStanding: { leaguePosition: 20, pointsPerGame: 0.3, points: 5, goalDifference: -30 },
    matchupStrengthGap: 100,
    homeAway: "HOME"
  };
  const v1 = cleanSheetV1(context);
  const v2 = cleanSheetV2(context);
  assert.equal(v1.metadata.metricType, "internal_index");
  assert.equal(v1.metadata.probability, false);
  assert.equal(v2.metadata.displayRecommendation, "score");
  assert.equal(displayScore(100), 95);
  assert.equal(v1.rawScore >= v1.displayScore, true);
});

test("backtest SG calcula Top 1/3/5 sem Brier para indice interno", () => {
  const rows = buildDefenseRowsForMatches({
    matches: [
      { matchId: 1, startsAt: "2026-01-01T10:00:00.000Z", homeClubId: 1, awayClubId: 2, homeScore: 2, awayScore: 0 },
      { matchId: 2, startsAt: "2026-01-02T10:00:00.000Z", homeClubId: 1, awayClubId: 2, homeScore: 1, awayScore: 0 }
    ],
    roundMatches: [{ matchId: 2, startsAt: "2026-01-02T10:00:00.000Z", homeClubId: 1, awayClubId: 2, homeScore: 1, awayScore: 0 }]
  });
  assert.equal(rows.length, 2);
  assert.equal(CLEAN_SHEET_METADATA.probability, false);
});

test("validacao da Rodada 19 gera contratos de research sem promocao", () => {
  const repo = repositories();
  seedHistorical(repo.historicalRepository);
  seedLive(repo.liveSnapshotRepository);
  const artifact = buildRoundValidation({
    historicalRepository: repo.historicalRepository,
    liveSnapshotRepository: repo.liveSnapshotRepository,
    researchRepository: repo.researchRepository,
    officialMatchesPayload: {
      partidas: [
        { partida_id: 1901, clube_casa_id: 1, clube_visitante_id: 3, partida_data: "2026-07-20 19:00:00", placar_oficial_mandante: 1, placar_oficial_visitante: 0 },
        { partida_id: 1902, clube_casa_id: 2, clube_visitante_id: 4, partida_data: "2026-07-20 21:00:00", placar_oficial_mandante: 0, placar_oficial_visitante: 0 }
      ]
    }
  });

  assert.equal(artifact.temporalPolicy.leakageStatus, "PASS");
  assert.equal(artifact.cleanSheetMetricMetadata.probability, false);
  assert.equal(artifact.contracts.differentialEligibilityAvailable, false);
  assert.equal(artifact.contracts.valueType, "historical_variation");
  assert.equal(artifact.contracts.costBenefitEligibility.minimumDataQuality, 30);
  assert.equal(artifact.contracts.promotionGate.state, "EXPERIMENTAL");
  assert.equal(artifact.contracts.promotionGate.promoted, false);
  assert.equal(artifact.formationEvaluation.bestPossibleTemporalStatus, undefined);
  assert.equal(artifact.idealTeamEvaluation.bestPossibleTemporalStatus, "ORACLE_BENCHMARK_POST_ROUND_ONLY");
  assert.ok(artifact.positionEvaluation.round19.GOL.top5.length >= 1);
});

test("endpoint /research/round-validation/:round le artefato persistido", async () => {
  const researchRepository = new ResearchRepository({ baseDir: tempDir("research-endpoint-") });
  researchRepository.writeJson(2026, "round-19-validation.json", {
    schemaVersion: "round-validation-research/v1",
    predictionSnapshot: {},
    actualResults: [],
    rankingEvaluation: {},
    positionEvaluation: {},
    cleanSheetEvaluation: {},
    formationEvaluation: {},
    idealTeamEvaluation: {}
  });
  const app = createApp({ fetchImpl: fetch, researchRepository });
  const response = await request(app, "/research/round-validation/19");
  assert.equal(response.status, 200);
  assert.equal(response.body.schemaVersion, "round-validation-research/v1");
});
