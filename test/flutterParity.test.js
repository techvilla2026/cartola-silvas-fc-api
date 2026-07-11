const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const request = require("node:http");
const { createApp } = require("../server");
const {
  analysisBand,
  calculateDataQuality,
  predictPlayers,
  predictScore,
  selectCaptain,
  selectFormation
} = require("../src/backtest/flutterParityPolicy");
const { evaluateParityRound } = require("../src/backtest/flutterParityRunner");

function player(overrides = {}) {
  return {
    athleteId: overrides.athleteId ?? 1,
    name: overrides.name ?? `Atleta ${overrides.athleteId ?? 1}`,
    clubId: overrides.clubId ?? 1,
    positionId: overrides.positionId ?? 5,
    priceBeforeRound: overrides.priceBeforeRound ?? 10,
    averageBeforeRound: overrides.averageBeforeRound ?? 6,
    gamesBeforeRound: overrides.gamesBeforeRound ?? 8,
    accumulatedPointsBeforeRound: overrides.accumulatedPointsBeforeRound ?? 48,
    opponent: overrides.opponent ?? 2,
    homeAway: overrides.homeAway ?? "HOME",
    eligibleForBacktest: overrides.eligibleForBacktest ?? true
  };
}

function preRound(players) {
  return {
    schemaVersion: "historical-pre-round-data/v2",
    readiness: { status: "READY" },
    players
  };
}

function postRound(players) {
  return {
    players: players.map((item) => ({
      athleteId: item.athleteId,
      played: true,
      points: item.points ?? 1
    }))
  };
}

function httpGet(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    request.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null });
      });
    }).on("error", reject);
  });
}

describe("paridade Flutter 4.3.1", () => {
  test("previsao reproduz media alta sem usar qualidade no score", () => {
    const prediction = predictScore({ athleteId: 10, name: "Atleta Teste", average: 8, confidence: 90 });

    assert.equal(prediction.predictedPoints, 6.6);
    assert.equal(prediction.confidence, 90);
  });

  test("previsao aplica mando apenas quando confronto esta disponivel", () => {
    const away = predictScore({ average: 7, confidence: 70, isHome: false, matchupAvailable: true });
    const home = predictScore({ average: 7, confidence: 70, isHome: true, matchupAvailable: true });
    const missing = predictScore({ average: 7, confidence: 70, isHome: true, matchupAvailable: false });

    assert.equal(Number((home.predictedPoints - away.predictedPoints).toFixed(1)), 0.4);
    assert.equal(missing.predictedPoints, away.predictedPoints);
  });

  test("previsao limita entradas e arredonda como Flutter", () => {
    const away = predictScore({ average: 100, confidence: 300, isHome: false, matchupAvailable: true });
    const home = predictScore({ average: 100, confidence: 0, isHome: true, matchupAvailable: true });

    assert.equal(away.predictedPoints, 16.4);
    assert.equal(home.predictedPoints, 16.8);
    assert.equal(away.confidence, 100);
  });

  test("qualidade retorna indisponivel sem dados minimos", () => {
    const quality = calculateDataQuality({ status: "", games: 0, average: 0, roundPoints: 0, variation: 0, matchupAvailable: false });

    assert.equal(quality.isAvailable, false);
    assert.equal(quality.score, 0);
    assert.equal(quality.level, "unavailable");
  });

  test("qualidade completa chega a 100 e scouts vazios nao recebem bonus", () => {
    const complete = calculateDataQuality({
      status: "Provavel",
      games: 12,
      average: 6.4,
      roundPoints: 8,
      variation: 1.2,
      matchupAvailable: true,
      scouts: { G: 1, A: 1 }
    });
    const emptyScouts = calculateDataQuality({
      status: "Provavel",
      games: 8,
      average: 5.5,
      roundPoints: 4,
      variation: 0,
      matchupAvailable: true,
      scouts: { G: 0, A: 0 }
    });
    const realScouts = calculateDataQuality({
      status: "Provavel",
      games: 8,
      average: 5.5,
      roundPoints: 4,
      variation: 0,
      matchupAvailable: true,
      scouts: { G: 1, A: 0 }
    });

    assert.equal(complete.score, 100);
    assert.equal(complete.level, "veryHigh");
    assert.ok(realScouts.score > emptyScouts.score);
  });

  test("faixas da Nota sao as mesmas do Flutter", () => {
    assert.equal(analysisBand(0), "Fraca");
    assert.equal(analysisBand(40), "Regular");
    assert.equal(analysisBand(60), "Boa");
    assert.equal(analysisBand(75), "Forte");
    assert.equal(analysisBand(90), "Excelente");
  });

  test("historico nao transforma status ausente em Provavel", () => {
    const predictions = predictPlayers(preRound([player({ averageBeforeRound: 8 })]));

    assert.equal(predictions[0].historicalStatusMode, "unavailable-neutral");
    assert.equal(predictions[0].statusBeforeRound, null);
    assert.equal(predictions[0].analysisComponents.status, 3);
  });

  test("selecao respeita 4-3-3, desempate por media, mando, preco e id", () => {
    const players = [
      ...Array.from({ length: 2 }, (_, index) => player({ athleteId: 10 + index, positionId: 1, averageBeforeRound: 10 - index })),
      ...Array.from({ length: 3 }, (_, index) => player({ athleteId: 20 + index, positionId: 2, averageBeforeRound: 10 - index })),
      ...Array.from({ length: 3 }, (_, index) => player({ athleteId: 30 + index, positionId: 3, averageBeforeRound: 10 - index })),
      ...Array.from({ length: 4 }, (_, index) => player({ athleteId: 40 + index, positionId: 4, averageBeforeRound: 10 - index })),
      ...Array.from({ length: 4 }, (_, index) => player({ athleteId: 50 + index, positionId: 5, averageBeforeRound: 10 - index }))
    ];
    const selected = selectFormation(predictPlayers(preRound(players)));

    assert.equal(selected.length, 11);
    assert.equal(selected.filter((item) => item.positionId === 1).length, 1);
    assert.equal(selected.filter((item) => item.positionId === 2).length, 2);
    assert.equal(selected.filter((item) => item.positionId === 3).length, 2);
    assert.equal(selected.filter((item) => item.positionId === 4).length, 3);
    assert.equal(selected.filter((item) => item.positionId === 5).length, 3);
  });

  test("capitao usa previsao, Nota, qualidade e media como desempates", () => {
    const team = [
      { athleteId: 1, predictedPoints: 7, analysisGrade: 70, dataQualityScore: 60, averageBeforeRound: 8 },
      { athleteId: 2, predictedPoints: 7, analysisGrade: 75, dataQualityScore: 40, averageBeforeRound: 6 },
      { athleteId: 3, predictedPoints: 6, analysisGrade: 90, dataQualityScore: 100, averageBeforeRound: 10 }
    ];
    const { captain, viceCaptain } = selectCaptain(team);

    assert.equal(captain.athleteId, 2);
    assert.equal(viceCaptain.athleteId, 1);
  });

  test("post-round so entra depois do congelamento das decisoes", () => {
    const players = [
      player({ athleteId: 1, positionId: 1 }),
      player({ athleteId: 2, positionId: 2 }),
      player({ athleteId: 3, positionId: 2 }),
      player({ athleteId: 4, positionId: 3 }),
      player({ athleteId: 5, positionId: 3 }),
      player({ athleteId: 6, positionId: 4 }),
      player({ athleteId: 7, positionId: 4 }),
      player({ athleteId: 8, positionId: 4 }),
      player({ athleteId: 9, positionId: 5 }),
      player({ athleteId: 10, positionId: 5 }),
      player({ athleteId: 11, positionId: 5 })
    ];
    const result = evaluateParityRound({
      season: 2026,
      round: 2,
      pre: preRound(players),
      post: postRound(players),
      leakage: { status: "PASS" }
    });

    assert.equal(result.decisionsFrozenBeforePostRoundComparison, true);
    assert.equal(result.selectedTeam.length, 11);
    assert.equal(result.centralIntelligence.length, 8);
  });

  test("endpoints de build retornam 200, 400 e 404", async () => {
    const fakeRepository = {
      readJson(season, relativePath) {
        if (relativePath === "run-summary.json") return { season, ok: true };
        if (relativePath === "metrics/prediction.json") return { mae: 1 };
        return null;
      },
      listRoundResults() {
        return [];
      }
    };
    const app = createApp({ backtestRepository: fakeRepository });
    const server = app.listen(0);

    try {
      const ok = await httpGet(server, "/backtests/2026/latest");
      const bad = await httpGet(server, "/backtests/abc/latest");
      const missing = await httpGet(server, "/backtests/2026/build/4.3.1/round/38");

      assert.equal(ok.status, 200);
      assert.equal(bad.status, 400);
      assert.equal(missing.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
