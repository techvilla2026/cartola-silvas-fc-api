const { parseCsv } = require("../sources/csv");
const {
  VALIDATION_STATUS,
  createHistoricalRoundData,
  createPreRoundData,
  normalizeMatch,
  normalizePlayer,
  nowIso
} = require("../domain/schema");
const { validateRound } = require("../validators/roundValidator");

function buildClubsFromMatches(matches) {
  const clubs = {};

  for (const match of matches || []) {
    for (const club of [match.homeClubId, match.awayClubId]) {
      if (club !== null && club !== undefined) {
        clubs[String(club)] = { id: club };
      }
    }
  }

  return clubs;
}

class HistoricalRoundCollector {
  constructor({ source, repository }) {
    this.source = source;
    this.repository = repository;
  }

  async collectRound({ season, round, validate = true, force = false, dryRun = false, sourceMetadata }) {
    const collectedAt = nowIso();
    const metadata = sourceMetadata || await this.source.getSourceMetadata();
    const csv = await this.source.fetchRoundCsv(season, round);

    if (!csv) {
      return {
        season,
        round,
        status: "MISSING",
        error: "Rodada ausente na fonte primaria."
      };
    }

    const rows = parseCsv(csv.text);
    const matchesPayload = await this.source.fetchMatches(season, round);
    const matches = (matchesPayload?.partidas || []).map((match) => ({
      ...normalizeMatch(match),
      round
    }));
    const rawReference = {
      source: "caRtola",
      url: csv.url,
      license: metadata.primaryLicense,
      revision: metadata.primaryRevision
    };
    const players = rows.map((row) => normalizePlayer(row, rawReference));
    const clubs = {
      ...buildClubsFromMatches(matches),
      ...Object.fromEntries(
        players
          .filter((player) => player.clubId !== null)
          .map((player) => [String(player.clubId), { id: player.clubId, name: player.clubName }])
      )
    };

    const postRound = createHistoricalRoundData({
      season,
      round,
      source: "caRtola",
      sourceVersion: metadata.primaryRevision,
      collectedAt,
      validationStatus: validate ? VALIDATION_STATUS.NOT_VALIDATED : VALIDATION_STATUS.NOT_VALIDATED,
      marketContext: {
        dataType: "POST_ROUND_DATA",
        notAvailableForLeakFreeBacktest: []
      },
      players,
      matches,
      clubs,
      metadata: {
        sourceFile: csv.url,
        rows: rows.length,
        rawPreservedAsReference: true,
        primaryLicense: metadata.primaryLicense
      }
    });

    const preRound = createPreRoundData({
      season,
      round,
      source: "caRtola",
      sourceVersion: metadata.primaryRevision,
      collectedAt,
      matches,
      metadata: {
        sourceFile: csv.url,
        primaryLicense: metadata.primaryLicense
      }
    });

    let validationReport = {
      schemaVersion: "historical-validation-report/v1",
      season,
      round,
      primarySource: "caRtola",
      validationSource: "cartola-official-public-api",
      playersCompared: 0,
      matchesCompared: matches.length,
      missingPlayers: [],
      extraPlayers: [],
      pointsDifferences: [],
      priceDifferences: [],
      scoutDifferences: [],
      matchDifferences: [],
      validationStatus: VALIDATION_STATUS.NOT_VALIDATED
    };

    if (validate) {
      const officialScored = await this.source.fetchOfficialScoredAthletes(season, round);
      validationReport = validateRound(postRound, officialScored);
      postRound.validationStatus = validationReport.validationStatus;
      postRound.validatedAt = nowIso();
      preRound.validatedAt = postRound.validatedAt;
    }

    if (!dryRun) {
      this.repository.saveRound(season, round, {
        "pre-round.json": preRound,
        "post-round.json": postRound,
        "validation.json": validationReport
      }, { force });
    }

    return {
      season,
      round,
      status: "COLLECTED",
      athletesCount: postRound.players.length,
      scoredAthletesCount: postRound.players.filter((player) => player.played === true).length,
      matchesCount: postRound.matches.length,
      clubsCount: Object.keys(postRound.clubs).length,
      validationStatus: validationReport.validationStatus,
      divergences:
        validationReport.missingPlayers.length +
        validationReport.extraPlayers.length +
        validationReport.pointsDifferences.length +
        validationReport.priceDifferences.length +
        validationReport.scoutDifferences.length +
        validationReport.matchDifferences.length
    };
  }
}

module.exports = {
  HistoricalRoundCollector,
  buildClubsFromMatches
};
