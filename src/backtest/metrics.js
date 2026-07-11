const { POSITION_LABELS } = require("./constants");
const { average, errorMetrics, median, round } = require("./math");

function actualIndex(postRound) {
  const index = new Map();
  for (const player of postRound.players || []) {
    index.set(String(player.athleteId), player);
  }
  return index;
}

function attachActuals(predictions, postRound) {
  const index = actualIndex(postRound);
  return predictions
    .map((prediction) => {
      const actual = index.get(String(prediction.athleteId));
      if (!actual || actual.played !== true || actual.points === null) {
        return null;
      }

      return {
        ...prediction,
        actualPoints: actual.points
      };
    })
    .filter(Boolean);
}

function groupBy(items, keyFn) {
  const groups = {};
  for (const item of items) {
    const key = keyFn(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
  }
  return groups;
}

function metricsByPosition(predictions) {
  const groups = groupBy(predictions, (item) => POSITION_LABELS[item.positionId] || String(item.positionId));
  const result = {};

  for (const [position, items] of Object.entries(groups)) {
    result[position] = errorMetrics(items.map((item) => ({ predicted: item.predictedPoints, actual: item.actualPoints })));
  }

  return result;
}

function scoreBandMetrics(predictions) {
  const groups = groupBy(predictions, (item) => item.analysisBand || "NOT_EVALUATED");
  const result = {};

  for (const [band, items] of Object.entries(groups)) {
    const actuals = items.map((item) => item.actualPoints).filter(Number.isFinite);
    result[band] = {
      count: items.length,
      averageActual: average(actuals),
      medianActual: round(median(actuals)),
      negativeRate: items.length ? round(items.filter((item) => item.actualPoints < 0).length / items.length) : null,
      rate5Plus: items.length ? round(items.filter((item) => item.actualPoints >= 5).length / items.length) : null,
      rate8Plus: items.length ? round(items.filter((item) => item.actualPoints >= 8).length / items.length) : null,
      rate10Plus: items.length ? round(items.filter((item) => item.actualPoints >= 10).length / items.length) : null
    };
  }

  return result;
}

function homeAwayMetrics(predictions) {
  const groups = groupBy(predictions, (item) => item.homeAway || "UNKNOWN");
  const result = {};

  for (const [homeAway, items] of Object.entries(groups)) {
    result[homeAway] = {
      count: items.length,
      averagePrediction: average(items.map((item) => item.predictedPoints)),
      averageActual: average(items.map((item) => item.actualPoints)),
      ...errorMetrics(items.map((item) => ({ predicted: item.predictedPoints, actual: item.actualPoints })))
    };
  }

  return result;
}

function priceBand(price) {
  if (!Number.isFinite(Number(price))) return "UNKNOWN";
  if (price <= 5) return "0-5";
  if (price <= 10) return "5-10";
  if (price <= 15) return "10-15";
  if (price <= 20) return "15-20";
  return "20+";
}

function costBenefitMetrics(predictions) {
  const groups = groupBy(predictions, (item) => priceBand(item.priceBeforeRound));
  const result = {};

  for (const [band, items] of Object.entries(groups)) {
    result[band] = {
      count: items.length,
      averagePrice: average(items.map((item) => item.priceBeforeRound)),
      averagePrediction: average(items.map((item) => item.predictedPoints)),
      averageActual: average(items.map((item) => item.actualPoints)),
      actualPointsPerCartola: round(
        items.reduce((sum, item) => sum + Number(item.actualPoints || 0), 0) /
        items.reduce((sum, item) => sum + Number(item.priceBeforeRound || 0), 0)
      ),
      ...errorMetrics(items.map((item) => ({ predicted: item.predictedPoints, actual: item.actualPoints })))
    };
  }

  return result;
}

function teamMetrics(team) {
  const actuals = team.map((item) => item.actualPoints).filter(Number.isFinite);
  const predictedTotal = team.reduce((sum, item) => sum + Number(item.predictedPoints || 0), 0);
  const actualTotal = actuals.reduce((sum, value) => sum + value, 0);

  return {
    predictedTotal: round(predictedTotal),
    actualTotal: round(actualTotal),
    absoluteTotalError: round(Math.abs(predictedTotal - actualTotal)),
    averageActualPerPlayer: average(actuals),
    negativePlayers: team.filter((item) => item.actualPoints < 0).length,
    count0Plus: team.filter((item) => item.actualPoints >= 0).length,
    count3Plus: team.filter((item) => item.actualPoints >= 3).length,
    count5Plus: team.filter((item) => item.actualPoints >= 5).length,
    count8Plus: team.filter((item) => item.actualPoints >= 8).length,
    count10Plus: team.filter((item) => item.actualPoints >= 10).length
  };
}

function captainMetrics(team, captain, viceCaptain) {
  const sortedByActual = [...team].sort((a, b) => Number(b.actualPoints ?? -Infinity) - Number(a.actualPoints ?? -Infinity));
  const captainActual = team.find((item) => item.athleteId === captain?.athleteId);
  const viceActual = team.find((item) => item.athleteId === viceCaptain?.athleteId);
  const bestActual = sortedByActual[0] || null;
  const top3 = new Set(sortedByActual.slice(0, 3).map((item) => item.athleteId));

  return {
    captainAthleteId: captain?.athleteId || null,
    captainPrediction: captain?.predictedPoints ?? null,
    captainActual: captainActual?.actualPoints ?? null,
    viceAthleteId: viceCaptain?.athleteId || null,
    vicePrediction: viceCaptain?.predictedPoints ?? null,
    viceActual: viceActual?.actualPoints ?? null,
    bestTeamAthleteId: bestActual?.athleteId || null,
    bestTeamActual: bestActual?.actualPoints ?? null,
    captainGapToBest: captainActual && bestActual ? round(bestActual.actualPoints - captainActual.actualPoints) : null,
    captainWasBest: Boolean(captainActual && bestActual && captainActual.athleteId === bestActual.athleteId),
    captainWasTop3: Boolean(captainActual && top3.has(captainActual.athleteId)),
    captainNegative: Boolean(captainActual && captainActual.actualPoints < 0)
  };
}

module.exports = {
  actualIndex,
  attachActuals,
  metricsByPosition,
  scoreBandMetrics,
  homeAwayMetrics,
  costBenefitMetrics,
  teamMetrics,
  captainMetrics
};
