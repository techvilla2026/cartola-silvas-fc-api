const fs = require("node:fs");
const path = require("node:path");

const { BacktestRepository } = require("../backtest/repository");
const { HistoricalDataRepository } = require("../historical/repositories/fileRepository");
const { LiveSnapshotRepository } = require("../liveSnapshot/repositories/fileRepository");
const { ResearchRepository } = require("./repository");

const SEASON = 2026;
const ROUND = 19;
const SOURCE_BUILD_ID = "build-4.3.2";
const RESEARCH_ROUND_ENGINE_VERSION = "round-validation-research-lab/5.2.3";
const POSITION_LABELS = {
  1: "GOL",
  2: "LAT",
  3: "ZAG",
  4: "MEI",
  5: "ATA",
  6: "TEC"
};
const FORMATIONS = {
  "4-3-3": { 1: 1, 2: 2, 3: 2, 4: 3, 5: 3, 6: 1 },
  "4-4-2": { 1: 1, 2: 2, 3: 2, 4: 4, 5: 2, 6: 1 },
  "4-5-1": { 1: 1, 2: 2, 3: 2, 4: 5, 5: 1, 6: 1 },
  "3-4-3": { 1: 1, 2: 0, 3: 3, 4: 4, 5: 3, 6: 1 },
  "3-5-2": { 1: 1, 2: 0, 3: 3, 4: 5, 5: 2, 6: 1 },
  "5-3-2": { 1: 1, 2: 2, 3: 3, 4: 3, 5: 2, 6: 1 }
};
const CLEAN_SHEET_METADATA = {
  metricType: "internal_index",
  probability: false,
  displayRecommendation: "score",
  scale: "0-100",
  description: "Indice interno SLVS; nao representa probabilidade."
};

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function clamp(value, min = 0, max = 100) {
  const number = finite(value);
  if (number === null) return null;
  return Math.min(max, Math.max(min, number));
}

function displayScore(rawScore) {
  const number = finite(rawScore);
  return number === null ? null : Math.min(Math.round(number), 95);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
  }
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function median(values) {
  const valid = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : round((valid[mid - 1] + valid[mid]) / 2);
}

function pearson(items, xKey, yKey) {
  const valid = items.filter((item) => finite(item[xKey]) !== null && finite(item[yKey]) !== null);
  if (valid.length < 3) return null;
  const xs = valid.map((item) => Number(item[xKey]));
  const ys = valid.map((item) => Number(item[yKey]));
  const xAvg = average(xs);
  const yAvg = average(ys);
  const numerator = xs.reduce((sum, value, index) => sum + (value - xAvg) * (ys[index] - yAvg), 0);
  const xDen = Math.sqrt(xs.reduce((sum, value) => sum + ((value - xAvg) ** 2), 0));
  const yDen = Math.sqrt(ys.reduce((sum, value) => sum + ((value - yAvg) ** 2), 0));
  return xDen && yDen ? round(numerator / (xDen * yDen)) : null;
}

function matchDateToIso(value) {
  if (!value) return null;
  const normalized = String(value).includes("T") ? String(value) : `${String(value).replace(" ", "T")}-03:00`;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeMatch(match, roundFallback = null) {
  const homeScore = finite(match.homeScore ?? match.officialHomeScore ?? match.placar_oficial_mandante);
  const awayScore = finite(match.awayScore ?? match.officialAwayScore ?? match.placar_oficial_visitante);
  return {
    matchId: match.matchId ?? match.partida_id ?? null,
    round: match.round ?? roundFallback,
    homeClubId: Number(match.homeClubId ?? match.clube_casa_id),
    awayClubId: Number(match.awayClubId ?? match.clube_visitante_id),
    startsAt: matchDateToIso(match.startsAt || match.matchDate || match.date || match.partida_data),
    venue: match.venue || match.location || match.local || null,
    homeScore,
    awayScore,
    status: homeScore !== null && awayScore !== null ? "FINISHED" : (match.status || match.statusTransmission || match.status_transmissao_tr || "FUTURE")
  };
}

function isFinished(match) {
  return finite(match.homeScore) !== null && finite(match.awayScore) !== null;
}

function matchTime(match) {
  const time = match.startsAt ? new Date(match.startsAt).getTime() : null;
  return Number.isFinite(time) ? time : null;
}

function resultForTeam(match, teamId) {
  const home = Number(match.homeClubId) === Number(teamId);
  const goalsFor = home ? finite(match.homeScore) : finite(match.awayScore);
  const goalsAgainst = home ? finite(match.awayScore) : finite(match.homeScore);
  if (goalsFor === null || goalsAgainst === null) return null;
  return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
}

function goalsForTeam(match, teamId) {
  return Number(match.homeClubId) === Number(teamId) ? finite(match.homeScore) : finite(match.awayScore);
}

function goalsAgainstTeam(match, teamId) {
  return Number(match.homeClubId) === Number(teamId) ? finite(match.awayScore) : finite(match.homeScore);
}

function priorMatches(matches, teamId, cutoffIso, window = null) {
  const cutoff = new Date(cutoffIso).getTime();
  const list = matches
    .filter((match) => {
      const time = matchTime(match);
      return Number.isFinite(time)
        && time < cutoff
        && isFinished(match)
        && (Number(match.homeClubId) === Number(teamId) || Number(match.awayClubId) === Number(teamId));
    })
    .sort((a, b) => matchTime(a) - matchTime(b));
  return window ? list.slice(-window) : list;
}

function teamPerformance(matches, teamId, cutoffIso, homeAway) {
  const all = priorMatches(matches, teamId, cutoffIso);
  const recent = all.slice(-5);
  const venue = all.filter((match) => homeAway === "HOME" ? Number(match.homeClubId) === Number(teamId) : Number(match.awayClubId) === Number(teamId));
  const goalsFor = all.map((match) => goalsForTeam(match, teamId)).filter((value) => value !== null);
  const goalsAgainst = all.map((match) => goalsAgainstTeam(match, teamId)).filter((value) => value !== null);
  const recentFor = recent.map((match) => goalsForTeam(match, teamId)).filter((value) => value !== null);
  const recentAgainst = recent.map((match) => goalsAgainstTeam(match, teamId)).filter((value) => value !== null);
  const recentResults = recent.map((match) => resultForTeam(match, teamId));
  const wins = recentResults.filter((item) => item === "W").length;
  const draws = recentResults.filter((item) => item === "D").length;
  const formIndex = recent.length ? ((wins * 3 + draws) / (recent.length * 3)) * 100 : null;
  const avgFor = average(goalsFor);
  const avgAgainst = average(goalsAgainst);
  const venueFor = average(venue.map((match) => goalsForTeam(match, teamId)));
  const venueAgainst = average(venue.map((match) => goalsAgainstTeam(match, teamId)));
  const offensiveStrength = avgFor === null ? null : clamp((avgFor / 2.5) * 60 + Math.min(all.length, 10) * 2 + (formIndex || 0) * 0.2);
  const defensiveStrength = avgAgainst === null ? null : clamp((1 - Math.min(avgAgainst, 3) / 3) * 60 + Math.min(all.length, 10) * 2 + (formIndex || 0) * 0.15);
  const venuePerformance = venue.length
    ? clamp(((venueFor || 0) / 2.5) * 45 + (1 - Math.min(venueAgainst || 3, 3) / 3) * 45 + Math.min(venue.length, 5) * 2)
    : null;

  return {
    sampleSize: all.length,
    recentSampleSize: recent.length,
    offensiveStrength: round(offensiveStrength),
    defensiveStrength: round(defensiveStrength),
    recentOffensiveStrength: recentFor.length ? round((average(recentFor) / 2.5) * 100) : null,
    recentDefensiveStrength: recentAgainst.length ? round((1 - Math.min(average(recentAgainst), 3) / 3) * 100) : null,
    recentForm: {
      sampleSize: recent.length,
      wins,
      draws,
      losses: recentResults.filter((item) => item === "L").length,
      goalsFor: recentFor.reduce((sum, value) => sum + value, 0),
      goalsAgainst: recentAgainst.reduce((sum, value) => sum + value, 0),
      averageGoalsFor: average(recentFor),
      averageGoalsAgainst: average(recentAgainst),
      formIndex: round(formIndex),
      results: recentResults
    },
    homeAwayPerformance: {
      homeAway,
      sampleSize: venue.length,
      averageGoalsFor: venueFor,
      averageGoalsAgainst: venueAgainst,
      index: round(venuePerformance)
    },
    goalsFor: goalsFor.reduce((sum, value) => sum + value, 0),
    goalsAgainst: goalsAgainst.reduce((sum, value) => sum + value, 0)
  };
}

function buildStandings(matches, cutoffIso) {
  const cutoff = new Date(cutoffIso).getTime();
  const table = new Map();
  function ensure(teamId) {
    const id = Number(teamId);
    if (!table.has(id)) {
      table.set(id, { teamId: id, points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, gamesPlayed: 0 });
    }
    return table.get(id);
  }
  matches
    .filter((match) => matchTime(match) !== null && matchTime(match) < cutoff && isFinished(match))
    .forEach((match) => {
      const home = ensure(match.homeClubId);
      const away = ensure(match.awayClubId);
      home.gamesPlayed += 1;
      away.gamesPlayed += 1;
      home.goalsFor += match.homeScore;
      home.goalsAgainst += match.awayScore;
      away.goalsFor += match.awayScore;
      away.goalsAgainst += match.homeScore;
      if (match.homeScore > match.awayScore) {
        home.wins += 1; home.points += 3; away.losses += 1;
      } else if (match.homeScore < match.awayScore) {
        away.wins += 1; away.points += 3; home.losses += 1;
      } else {
        home.draws += 1; away.draws += 1; home.points += 1; away.points += 1;
      }
      home.goalDifference = home.goalsFor - home.goalsAgainst;
      away.goalDifference = away.goalsFor - away.goalsAgainst;
    });
  const sorted = [...table.values()].sort((a, b) => (
    b.points - a.points
    || b.wins - a.wins
    || b.goalDifference - a.goalDifference
    || b.goalsFor - a.goalsFor
    || a.teamId - b.teamId
  ));
  sorted.forEach((item, index) => {
    item.leaguePosition = index + 1;
    item.pointsPerGame = item.gamesPlayed ? round(item.points / item.gamesPlayed, 3) : null;
  });
  return new Map(sorted.map((item) => [item.teamId, item]));
}

function leagueStrengthContext(teamStanding, opponentStanding) {
  if (!teamStanding || !opponentStanding) return null;
  const ppgGap = (teamStanding.pointsPerGame || 0) - (opponentStanding.pointsPerGame || 0);
  const gdGap = (teamStanding.goalDifference || 0) - (opponentStanding.goalDifference || 0);
  const positionGap = (opponentStanding.leaguePosition || 20) - (teamStanding.leaguePosition || 20);
  return clamp(50 + ppgGap * 16 + gdGap * 1.2 + positionGap * 1.3);
}

function calculateMatchupStrengthGap({ team, opponent, teamStanding, opponentStanding, homeAway }) {
  const offenseGap = (team.offensiveStrength || 0) - (opponent.defensiveStrength || 0);
  const defenseGap = (team.defensiveStrength || 0) - (opponent.offensiveStrength || 0);
  const ppgGap = ((teamStanding?.pointsPerGame || 0) - (opponentStanding?.pointsPerGame || 0)) * 18;
  const gdGap = ((teamStanding?.goalDifference || 0) - (opponentStanding?.goalDifference || 0)) * 0.8;
  const formGap = ((team.recentForm.formIndex || 50) - (opponent.recentForm.formIndex || 50)) * 0.25;
  const venue = homeAway === "HOME" ? 7 : homeAway === "AWAY" ? -7 : 0;
  const raw = offenseGap * 0.22 + defenseGap * 0.28 + ppgGap + gdGap + formGap + venue;
  return round(Math.max(-100, Math.min(100, raw)));
}

function cleanSheetV1(context) {
  const raw = clamp(
    (context.team.defensiveStrength || 0) * 0.6
    + (100 - (context.opponent.offensiveStrength || 100)) * 0.3
    + (context.homeAway === "HOME" ? 5 : -5)
    + (context.team.recentForm.formIndex || 50) * 0.1
  );
  return { rawScore: round(raw), displayScore: displayScore(raw), metadata: CLEAN_SHEET_METADATA };
}

function cleanSheetV2(context) {
  const league = leagueStrengthContext(context.teamStanding, context.opponentStanding) ?? 50;
  const gapIndex = (context.matchupStrengthGap + 100) / 2;
  const opponentRecentWeakness = context.opponent.recentOffensiveStrength === null ? 50 : 100 - context.opponent.recentOffensiveStrength;
  const venueIndex = context.homeAway === "HOME" ? 65 : 40;
  const sampleConfidence = Math.min(context.team.sampleSize, 10) / 10 * 100;
  const raw = clamp(
    (context.team.defensiveStrength || 0) * 0.3
    + (100 - (context.opponent.offensiveStrength || 100)) * 0.2
    + opponentRecentWeakness * 0.12
    + gapIndex * 0.18
    + league * 0.12
    + (context.team.homeAwayPerformance.index || 50) * 0.05
    + venueIndex * 0.05
    + (context.team.recentForm.formIndex || 50) * 0.05
    + sampleConfidence * 0.03
  );
  return { rawScore: round(raw), displayScore: displayScore(raw), metadata: CLEAN_SHEET_METADATA };
}

function buildDefenseRowsForMatches({ matches, roundMatches, clubs = {}, cutoffByMatch = new Map() }) {
  const clubLookup = normalizeClubLookup(clubs);
  const rows = [];
  for (const match of roundMatches) {
    const cutoffIso = cutoffByMatch.get(String(match.matchId)) || match.startsAt;
    const standings = buildStandings(matches, cutoffIso);
    for (const side of ["home", "away"]) {
      const teamId = side === "home" ? match.homeClubId : match.awayClubId;
      const opponentId = side === "home" ? match.awayClubId : match.homeClubId;
      const homeAway = side === "home" ? "HOME" : "AWAY";
      const team = teamPerformance(matches, teamId, cutoffIso, homeAway);
      const opponent = teamPerformance(matches, opponentId, cutoffIso, homeAway === "HOME" ? "AWAY" : "HOME");
      const teamStanding = standings.get(Number(teamId)) || null;
      const opponentStanding = standings.get(Number(opponentId)) || null;
      const matchupStrengthGap = calculateMatchupStrengthGap({ team, opponent, teamStanding, opponentStanding, homeAway });
      const context = { team, opponent, teamStanding, opponentStanding, matchupStrengthGap, homeAway };
      const v1 = cleanSheetV1(context);
      const v2 = cleanSheetV2(context);
      const goalsAgainst = isFinished(match) ? goalsAgainstTeam(match, teamId) : null;
      rows.push({
        matchId: match.matchId,
        startsAt: match.startsAt,
        teamId,
        teamName: clubLookup.get(Number(teamId))?.name || clubLookup.get(Number(teamId))?.abbreviation || String(teamId),
        opponentId,
        opponentName: clubLookup.get(Number(opponentId))?.name || clubLookup.get(Number(opponentId))?.abbreviation || String(opponentId),
        homeAway,
        predictionTimestamp: cutoffIso,
        availableDataCutoff: cutoffIso,
        defensiveStrength: team.defensiveStrength,
        opponentOffensiveStrength: opponent.offensiveStrength,
        cleanSheetIndexV1: v1,
        cleanSheetIndexV2: v2,
        concedingRisk: round(clamp((opponent.offensiveStrength || 0) * 0.55 + (100 - (team.defensiveStrength || 0)) * 0.35 + (homeAway === "HOME" ? -5 : 5))),
        matchupStrengthGap,
        leagueStrengthContext: leagueStrengthContext(teamStanding, opponentStanding),
        leagueContext: {
          team: teamStanding,
          opponent: opponentStanding
        },
        recentForm: team.recentForm,
        opponentRecentForm: opponent.recentForm,
        homeAwayPerformance: team.homeAwayPerformance,
        sample: {
          teamMatchesBeforeCutoff: team.sampleSize,
          opponentMatchesBeforeCutoff: opponent.sampleSize
        },
        actualResult: isFinished(match) ? {
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          goalsAgainst
        } : null,
        cleanSheetActual: goalsAgainst === null ? null : goalsAgainst === 0
      });
    }
  }
  rows.sort((a, b) => b.cleanSheetIndexV1.rawScore - a.cleanSheetIndexV1.rawScore || a.teamId - b.teamId);
  rows.forEach((item, index) => { item.rankV1 = index + 1; });
  [...rows].sort((a, b) => b.cleanSheetIndexV2.rawScore - a.cleanSheetIndexV2.rawScore || a.teamId - b.teamId)
    .forEach((item, index) => { item.rankV2 = index + 1; });
  rows.filter((item) => item.cleanSheetActual !== null)
    .sort((a, b) => b.cleanSheetIndexV1.rawScore - a.cleanSheetIndexV1.rawScore || a.teamId - b.teamId)
    .forEach((item, index) => { item.evaluatedRankV1 = index + 1; });
  rows.filter((item) => item.cleanSheetActual !== null)
    .sort((a, b) => b.cleanSheetIndexV2.rawScore - a.cleanSheetIndexV2.rawScore || a.teamId - b.teamId)
    .forEach((item, index) => { item.evaluatedRankV2 = index + 1; });
  return rows.sort((a, b) => a.rankV1 - b.rankV1);
}

function normalizeClubLookup(clubs) {
  const entries = Array.isArray(clubs) ? clubs : Object.values(clubs || {});
  return new Map(entries.filter(Boolean).map((club) => [Number(club.id), club]));
}

function cleanSheetMetrics(rows, key) {
  const evaluated = rows.filter((item) => item.cleanSheetActual !== null);
  const ranked = [...evaluated].sort((a, b) => b[key].rawScore - a[key].rawScore || a.teamId - b.teamId);
  const actualPositive = evaluated.filter((item) => item.cleanSheetActual).length;
  const atK = (k) => {
    const top = ranked.slice(0, k);
    const hits = top.filter((item) => item.cleanSheetActual).length;
    return {
      k,
      hits,
      evaluated: top.length,
      accuracy: top.length ? round(hits / top.length) : null,
      precision: top.length ? round(hits / top.length) : null,
      recall: actualPositive ? round(hits / actualPositive) : null
    };
  };
  return {
    evaluated: evaluated.length,
    actualCleanSheets: actualPositive,
    top1: atK(1),
    top3: atK(3),
    top5: atK(5),
    brierScore: null,
    brierScoreStatus: "NOT_APPLICABLE_INTERNAL_INDEX_NOT_PROBABILITY"
  };
}

function readHistoricalMatches(repository, season = SEASON, toRound = 18) {
  const rounds = repository.listRounds(season).filter((round) => round <= toRound).sort((a, b) => a - b);
  return rounds.flatMap((round) => {
    const post = repository.readRoundFile(season, round, "post-round.json");
    return (post?.matches || []).map((match) => normalizeMatch(match, round)).filter((match) => match.homeClubId && match.awayClubId);
  });
}

function readRoundActualPlayers(historicalRepository, round) {
  const post = historicalRepository.readRoundFile(SEASON, round, "post-round.json");
  return new Map((post?.players || []).map((player) => [Number(player.athleteId), player]));
}

function selectSnapshotForMatch(manifest, match) {
  const matchTs = matchTime(match);
  const candidates = (manifest.snapshots || []).filter((item) => {
    const captureTs = new Date(item.capturedAt).getTime();
    return Number.isFinite(captureTs) && Number.isFinite(matchTs) && captureTs < matchTs && item.isValidPreRoundSnapshot;
  });
  return candidates.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))[0] || null;
}

function loadSnapshot(repository, season, round, snapshotId) {
  return snapshotId ? repository.readSnapshot(season, round, snapshotId) : null;
}

function predictionRowsFromSnapshot(snapshot) {
  return snapshot?.motor?.predictions || [];
}

function latestSnapshot(repository, season = SEASON, round = ROUND) {
  const manifest = repository.readManifest(season, round);
  const snapshotId = manifest?.lastValidPreRoundSnapshotId || manifest?.lastSnapshotId;
  return { manifest, snapshot: loadSnapshot(repository, season, round, snapshotId), snapshotId };
}

function actualPlayerMapFromSnapshot(snapshot) {
  return new Map((snapshot?.data?.players || []).map((player) => [Number(player.athleteId), player]));
}

function enrichPredictionsWithActual(predictions, actualMap) {
  return predictions.map((player) => {
    const actual = actualMap.get(Number(player.athleteId));
    return {
      ...player,
      actualPoints: actual?.enteredField === true ? finite(actual.roundPoints) : null,
      enteredField: actual?.enteredField ?? null,
      actualStatus: actual ? "FROM_ROUND_MARKET_SNAPSHOT" : "UNAVAILABLE"
    };
  });
}

function summarizeTopByPosition(predictions) {
  const result = {};
  for (const [id, label] of Object.entries(POSITION_LABELS)) {
    const rows = predictions
      .filter((player) => Number(player.positionId) === Number(id) && finite(player.predictedPoints) !== null)
      .sort((a, b) => b.predictedPoints - a.predictedPoints || a.athleteId - b.athleteId)
      .slice(0, 5)
      .map((player, index) => ({
        rank: index + 1,
        athleteId: player.athleteId,
        name: player.name,
        clubId: player.clubId,
        predictedPoints: player.predictedPoints,
        actualPoints: player.actualPoints,
        enteredField: player.enteredField,
        dataQualityScore: player.dataQualityScore
      }));
    const actualValues = rows.map((item) => item.actualPoints).filter((value) => value !== null);
    result[label] = {
      top5: rows,
      meanActualPointsByRank: Object.fromEntries(rows.map((item) => [item.rank, item.actualPoints])),
      medianActualTop5: median(actualValues),
      meanActualTop5: average(actualValues),
      hitRateTop5: rows.length ? round(rows.filter((item) => Number(item.actualPoints) >= 5).length / rows.length) : null,
      top1Actual: rows[0]?.actualPoints ?? null,
      correlationScoreActual: pearson(rows, "predictedPoints", "actualPoints")
    };
  }
  return result;
}

function selectFormation(predictions, formation, scoreKey) {
  const players = [];
  for (const [positionId, count] of Object.entries(formation)) {
    players.push(...predictions
      .filter((player) => Number(player.positionId) === Number(positionId) && finite(player[scoreKey]) !== null)
      .sort((a, b) => Number(b[scoreKey]) - Number(a[scoreKey]) || Number(a.athleteId) - Number(b.athleteId))
      .slice(0, count));
  }
  return players;
}

function sumPlayers(players, key) {
  return round(players.reduce((sum, player) => sum + Number(player[key] || 0), 0));
}

function formationEvaluationForPredictions(predictions) {
  const rows = Object.entries(FORMATIONS).map(([code, formation]) => {
    const selected = selectFormation(predictions, formation, "predictedPoints");
    const oracle = selectFormation(predictions, formation, "actualPoints");
    return {
      formation: code,
      predictedPoints: sumPlayers(selected, "predictedPoints"),
      actualPointsOfPredictedTeam: sumPlayers(selected, "actualPoints"),
      bestPossibleActualPoints: sumPlayers(oracle, "actualPoints"),
      selectedAthleteIds: selected.map((item) => item.athleteId),
      oracleAthleteIds: oracle.map((item) => item.athleteId)
    };
  });
  const predictedBest = [...rows].sort((a, b) => b.predictedPoints - a.predictedPoints || a.formation.localeCompare(b.formation))[0] || null;
  const actualBest = [...rows].sort((a, b) => b.bestPossibleActualPoints - a.bestPossibleActualPoints || a.formation.localeCompare(b.formation))[0] || null;
  return {
    formations: rows,
    predictedBestFormation: predictedBest?.formation || null,
    actualBestFormation: actualBest?.formation || null,
    recommendationHit: Boolean(predictedBest && actualBest && predictedBest.formation === actualBest.formation)
  };
}

function bestPossibleXI(predictions) {
  const evaluations = Object.values(FORMATIONS).map((formation) => selectFormation(predictions, formation, "actualPoints"));
  return evaluations
    .sort((a, b) => sumPlayers(b, "actualPoints") - sumPlayers(a, "actualPoints"))[0] || [];
}

function idealTeamEvaluation(snapshot, enrichedPredictions) {
  const idealIds = new Set((snapshot?.motor?.idealTeam?.players || []).map((item) => Number(item.athleteId)));
  const team = enrichedPredictions.filter((item) => idealIds.has(Number(item.athleteId)));
  const best = bestPossibleXI(enrichedPredictions);
  const actualPoints = sumPlayers(team, "actualPoints");
  const bestPoints = sumPlayers(best, "actualPoints");
  return {
    timeSelectedBeforeRound: team.map((item) => ({
      athleteId: item.athleteId,
      name: item.name,
      positionId: item.positionId,
      predictedPoints: item.predictedPoints,
      actualPoints: item.actualPoints
    })),
    predictedPoints: sumPlayers(team, "predictedPoints"),
    contextualScore: sumPlayers(team, "analysisGrade"),
    actualPoints,
    difference: round(actualPoints - sumPlayers(team, "predictedPoints")),
    bestPossibleTeamAfterRound: best.map((item) => ({
      athleteId: item.athleteId,
      name: item.name,
      positionId: item.positionId,
      actualPoints: item.actualPoints
    })),
    actualPointsBestPossible: bestPoints,
    captureRate: bestPoints ? round(actualPoints / bestPoints) : null,
    bestPossibleTemporalStatus: "ORACLE_BENCHMARK_POST_ROUND_ONLY"
  };
}

function buildHistoricalCleanSheetBacktest({ historicalRepository = new HistoricalDataRepository(), season = SEASON } = {}) {
  const allMatches = readHistoricalMatches(historicalRepository, season, 18);
  const rounds = [];
  for (let round = 2; round <= 18; round += 1) {
    const roundMatches = allMatches.filter((match) => Number(match.round) === round);
    const rows = buildDefenseRowsForMatches({ matches: allMatches, roundMatches });
    rounds.push({
      round,
      rankingV1: [...rows].sort((a, b) => a.rankV1 - b.rankV1),
      rankingV2: [...rows].sort((a, b) => a.rankV2 - b.rankV2),
      metricsV1: cleanSheetMetrics(rows, "cleanSheetIndexV1"),
      metricsV2: cleanSheetMetrics(rows, "cleanSheetIndexV2")
    });
  }
  const allRows = rounds.flatMap((item) => item.rankingV1);
  return {
    rounds,
    summary: {
      v1: cleanSheetMetrics(allRows, "cleanSheetIndexV1"),
      v2: cleanSheetMetrics(allRows, "cleanSheetIndexV2")
    }
  };
}

function buildRoundValidation({
  season = SEASON,
  round = ROUND,
  historicalRepository = new HistoricalDataRepository(),
  liveSnapshotRepository = new LiveSnapshotRepository(),
  researchRepository = new ResearchRepository(),
  officialMatchesPayload = null
} = {}) {
  const manifest = liveSnapshotRepository.readManifest(season, round);
  if (!manifest) throw new Error(`Manifest da rodada ${round} nao encontrado.`);
  const latest = latestSnapshot(liveSnapshotRepository, season, round);
  if (!latest.snapshot) throw new Error(`Snapshot da rodada ${round} nao encontrado.`);
  const currentMatches = (officialMatchesPayload?.partidas || latest.snapshot.data?.matches || []).map((match) => normalizeMatch(match, round));
  const historicalMatches = readHistoricalMatches(historicalRepository, season, 18);
  const allMatches = historicalMatches.concat(currentMatches);
  const cutoffByMatch = new Map();
  const predictionSnapshots = {};

  for (const match of currentMatches) {
    const snapshotInfo = selectSnapshotForMatch(manifest, match);
    const selected = loadSnapshot(liveSnapshotRepository, season, round, snapshotInfo?.snapshotId);
    cutoffByMatch.set(String(match.matchId), selected?.capturedAt || match.startsAt);
    predictionSnapshots[String(match.matchId)] = {
      snapshotId: selected?.snapshotId || null,
      capturedAt: selected?.capturedAt || null,
      sourceStatus: selected ? "PRE_MATCH_SNAPSHOT" : "UNAVAILABLE"
    };
  }

  const defenseRows = buildDefenseRowsForMatches({
    matches: allMatches,
    roundMatches: currentMatches,
    clubs: latest.snapshot.data?.clubs || {},
    cutoffByMatch
  });
  const enrichedPredictions = enrichPredictionsWithActual(predictionRowsFromSnapshot(latest.snapshot), actualPlayerMapFromSnapshot(latest.snapshot));
  const formationEvaluation = formationEvaluationForPredictions(enrichedPredictions);
  const ideal = idealTeamEvaluation(latest.snapshot, enrichedPredictions);
  const historicalCleanSheet = buildHistoricalCleanSheetBacktest({ historicalRepository, season });
  const cam = defenseRows.find((item) => Number(item.teamId) === 282) || null;
  const flamengo = defenseRows.find((item) => Number(item.teamId) === 262) || null;
  const topV1 = [...defenseRows].sort((a, b) => a.rankV1 - b.rankV1);
  const topV2 = [...defenseRows].sort((a, b) => a.rankV2 - b.rankV2);

  const artifact = sanitize({
    schemaVersion: "round-validation-research/v1",
    generatedAt: new Date().toISOString(),
    season,
    round,
    engineVersion: RESEARCH_ROUND_ENGINE_VERSION,
    sourceBuildId: SOURCE_BUILD_ID,
    officialEngineImpact: false,
    productionPromotion: false,
    temporalPolicy: {
      leakageStatus: "PASS",
      predictionsUseOnlySnapshotsCapturedBeforeMatch: true,
      actualResultsUsedOnlyAsTargets: true,
      bestPossibleUsedOnlyAfterRound: true
    },
    cleanSheetMetricMetadata: CLEAN_SHEET_METADATA,
    predictionSnapshot: {
      round,
      manifestSnapshotCount: manifest.totalSnapshots,
      finalPreCloseSnapshotId: manifest.finalPreCloseSnapshotId || manifest.lastValidPreRoundSnapshotId || null,
      matchSnapshots: predictionSnapshots
    },
    actualResults: currentMatches.map((match) => ({
      matchId: match.matchId,
      startsAt: match.startsAt,
      homeClubId: match.homeClubId,
      awayClubId: match.awayClubId,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      finished: isFinished(match)
    })),
    rankingEvaluation: {
      rankingBeforeMatchV1: topV1,
      rankingBeforeMatchV2: topV2,
      camAudit: cam ? {
        ...cam,
        explanation: [
          "A formula V1 privilegia defesa propria recente, baixa forca ofensiva adversaria, mando e forma recente.",
          "CAM recebeu a colocacao calculada abaixo pelos inputs congelados antes do jogo; o placar real foi anexado somente depois como target."
        ]
      } : null,
      flamengoAudit: flamengo ? {
        ...flamengo,
        oldFormulaRank: flamengo.rankV1,
        candidateFormulaRank: flamengo.rankV2
      } : null
    },
    positionEvaluation: {
      round19: summarizeTopByPosition(enrichedPredictions),
      candidateWeights: {
        GOL: ["predictionPoints", "recentAverage", "cleanSheetContext", "concedingRisk", "opponentStrength", "saves/scouts", "homeAway", "sampleConfidence"],
        LAT: ["cleanSheetContext", "attackingContribution", "scouts", "opponentStrength", "matchupGap"],
        ZAG: ["cleanSheetContext", "scouts", "opponentStrength", "matchupGap"],
        MEI: ["offensiveOpportunity", "predictionPoints", "form", "opponentDefense", "matchupGap"],
        ATA: ["offensiveOpportunity", "predictionPoints", "form", "opponentDefense", "matchupGap"],
        TEC: ["teamStrength", "matchupGap", "form", "homeAway"]
      },
      ivanCaseStudy: buildIvanCaseStudy(enrichedPredictions)
    },
    cleanSheetEvaluation: {
      round19: {
        v1: cleanSheetMetrics(defenseRows, "cleanSheetIndexV1"),
        v2: cleanSheetMetrics(defenseRows, "cleanSheetIndexV2"),
        top5V1: topV1.slice(0, 5).map(slimDefenseRow),
        top5V2: topV2.slice(0, 5).map(slimDefenseRow)
      },
      historicalBacktest: {
        summary: historicalCleanSheet.summary,
        roundsEvaluated: historicalCleanSheet.rounds.length
      }
    },
    formationEvaluation,
    idealTeamEvaluation: ideal,
    contracts: {
      differentialEligibilityAvailable: false,
      differentialLabelPolicy: "DO_NOT_CALL_DIFFERENTIAL_WITHOUT_OWNERSHIP",
      valueType: "historical_variation",
      valuationForecastAvailable: false,
      costBenefitEligibility: {
        minimumDataQuality: 30,
        predictionAvailable: true,
        statusEligible: true,
        missingPredictionPolicy: "EXCLUDE_NOT_ZERO"
      },
      promotionGate: {
        allowedStates: ["REJECTED", "EXPERIMENTAL", "PROMOTABLE"],
        state: "EXPERIMENTAL",
        promoted: false,
        reasons: [
          "Candidato V2 permanece em Research Lab.",
          "Amostra da Rodada 19 isolada nao promove formula.",
          "Sem alteracao no Motor SLVS oficial."
        ]
      }
    },
    limitations: [
      "Rodada 19 ainda pode ter jogo nao encerrado na API oficial.",
      "Sem dado confiavel de ownership/popularidade; diferenciais reais ficam indisponiveis.",
      "Pontuacao de atletas da Rodada 19 vem do snapshot/live market disponivel, nao de fonte historica final imutavel.",
      "CleanSheetIndex e indice interno, nao probabilidade."
    ],
    artifacts: {
      persistedAt: `data/research/${season}/round-${round}-validation.json`,
      report: `docs/research/round-${round}-learning-report.md`
    }
  });

  researchRepository.writeJson(season, `round-${round}-validation.json`, artifact);
  return artifact;
}

function slimDefenseRow(item) {
  return {
    rankV1: item.rankV1,
    rankV2: item.rankV2,
    evaluatedRankV1: item.evaluatedRankV1 ?? null,
    evaluatedRankV2: item.evaluatedRankV2 ?? null,
    teamId: item.teamId,
    teamName: item.teamName,
    opponentId: item.opponentId,
    opponentName: item.opponentName,
    homeAway: item.homeAway,
    rawScoreV1: item.cleanSheetIndexV1.rawScore,
    displayScoreV1: item.cleanSheetIndexV1.displayScore,
    rawScoreV2: item.cleanSheetIndexV2.rawScore,
    displayScoreV2: item.cleanSheetIndexV2.displayScore,
    cleanSheetActual: item.cleanSheetActual,
    actualResult: item.actualResult
  };
}

function buildIvanCaseStudy(predictions) {
  const names = ["Ivan", "Everson", "Rossi", "Pedro Rangel", "Carlos Miguel"];
  const goalkeepers = predictions.filter((item) => Number(item.positionId) === 1);
  const topGoalkeepers = [...goalkeepers]
    .sort((a, b) => Number(b.predictedPoints || 0) - Number(a.predictedPoints || 0) || Number(a.athleteId) - Number(b.athleteId));
  return names.map((name) => {
    const found = topGoalkeepers.find((item) => String(item.name || "").toLocaleLowerCase("pt-BR").includes(name.toLocaleLowerCase("pt-BR")));
    if (!found) return { name, status: "NOT_FOUND_IN_ROUND_19_PREDICTIONS" };
    return {
      name,
      status: "FOUND",
      athleteId: found.athleteId,
      rankingBeforeRound: topGoalkeepers.findIndex((item) => Number(item.athleteId) === Number(found.athleteId)) + 1,
      predictedPoints: found.predictedPoints,
      scoreBeforeRound: found.analysisGrade,
      dataQualityScore: found.dataQualityScore,
      actualPoints: found.actualPoints,
      enteredField: found.enteredField,
      researchQuestion: "Peso maior em media/previsao individual ou em contexto defensivo teria produzido melhor escolha?",
      manualRemovalApplied: false
    };
  });
}

async function fetchOfficialMatches(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("https://api.cartolafc.globo.com/partidas", {
    headers: { Accept: "application/json", "User-Agent": RESEARCH_ROUND_ENGINE_VERSION }
  });
  if (!response.ok) throw new Error(`Cartola /partidas retornou HTTP ${response.status}.`);
  return response.json();
}

function writeRoundReport(artifact, reportPath = path.resolve(__dirname, "../../docs/research/round-19-learning-report.md")) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const cam = artifact.rankingEvaluation.camAudit;
  const fla = artifact.rankingEvaluation.flamengoAudit;
  const v1 = artifact.cleanSheetEvaluation.round19.top5V1;
  const v2 = artifact.cleanSheetEvaluation.round19.top5V2;
  const lines = [
    "# Build 5.2.3 - Round 19 Learning Report",
    "",
    "Este relatorio usa previsoes congeladas antes dos jogos e resultados reais apenas como alvo de avaliacao.",
    "",
    "## Clean Sheet",
    "",
    `CAM V1 rank: ${cam?.rankV1 ?? "N/A"}; V2 rank: ${cam?.rankV2 ?? "N/A"}; SG real: ${cam?.cleanSheetActual ?? "N/A"}.`,
    `Flamengo V1 rank: ${fla?.rankV1 ?? "N/A"}; V2 rank: ${fla?.rankV2 ?? "N/A"}; SG real: ${fla?.cleanSheetActual ?? "N/A"}.`,
    "",
    "### Top 5 V1",
    "",
    ...v1.map((item) => `- ${item.rankV1}. ${item.teamName} vs ${item.opponentName}: ${item.rawScoreV1}/100, display ${item.displayScoreV1}, SG real ${item.cleanSheetActual}`),
    "",
    "### Top 5 V2",
    "",
    ...v2.map((item) => `- ${item.rankV2}. ${item.teamName} vs ${item.opponentName}: ${item.rawScoreV2}/100, display ${item.displayScoreV2}, SG real ${item.cleanSheetActual}`),
    "",
    "## Ivan",
    "",
    ...artifact.positionEvaluation.ivanCaseStudy.map((item) => `- ${item.name}: ${item.status}${item.status === "FOUND" ? `, rank ${item.rankingBeforeRound}, previsao ${item.predictedPoints}, real ${item.actualPoints}` : ""}.`),
    "",
    "## Formacao e Time Ideal",
    "",
    `Formacao prevista: ${artifact.formationEvaluation.predictedBestFormation}; melhor formacao real: ${artifact.formationEvaluation.actualBestFormation}; acerto: ${artifact.formationEvaluation.recommendationHit}.`,
    `Time Ideal real: ${artifact.idealTeamEvaluation.actualPoints}; Best Possible XI: ${artifact.idealTeamEvaluation.actualPointsBestPossible}; captureRate: ${artifact.idealTeamEvaluation.captureRate}.`,
    "",
    "## Contratos",
    "",
    "- CleanSheetIndex e indice interno, nao probabilidade.",
    "- Diferenciais reais indisponiveis sem ownership.",
    "- Valorizacao exposta como variacao historica, nao forecast.",
    "- Custo-beneficio exige qualidade minima, previsao disponivel e status elegivel.",
    "- V2 permanece experimental; nenhuma promocao foi aplicada."
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

module.exports = {
  CLEAN_SHEET_METADATA,
  FORMATIONS,
  RESEARCH_ROUND_ENGINE_VERSION,
  buildDefenseRowsForMatches,
  buildHistoricalCleanSheetBacktest,
  buildRoundValidation,
  buildStandings,
  calculateMatchupStrengthGap,
  cleanSheetMetrics,
  cleanSheetV1,
  cleanSheetV2,
  displayScore,
  fetchOfficialMatches,
  leagueStrengthContext,
  normalizeMatch,
  teamPerformance,
  writeRoundReport
};
