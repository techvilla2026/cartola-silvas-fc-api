function parseSeason(value) {
  const season = Number(value);

  if (!Number.isInteger(season) || season < 2014 || season > 2100) {
    return null;
  }

  return season;
}

function parseRound(value) {
  const round = Number(value);

  if (!Number.isInteger(round) || round < 1 || round > 38) {
    return null;
  }

  return round;
}

module.exports = {
  parseSeason,
  parseRound
};
