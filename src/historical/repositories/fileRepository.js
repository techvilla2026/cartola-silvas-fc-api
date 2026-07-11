const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../../data/historical");

function roundDirectory(baseDir, season, round) {
  return path.join(baseDir, String(season), `round-${String(round).padStart(2, "0")}`);
}

function checksumJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

class HistoricalDataRepository {
  constructor(options = {}) {
    this.baseDir = options.baseDir || DEFAULT_DATA_DIR;
  }

  getRoundDirectory(season, round) {
    return roundDirectory(this.baseDir, season, round);
  }

  saveRound(season, round, files, options = {}) {
    const dir = this.getRoundDirectory(season, round);
    fs.mkdirSync(dir, { recursive: true });

    for (const [fileName, data] of Object.entries(files)) {
      const filePath = path.join(dir, fileName);

      if (fs.existsSync(filePath) && !options.force) {
        throw new Error(`Arquivo ja existe: ${filePath}. Use --force para sobrescrever.`);
      }

      fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }

    const manifest = {
      season,
      round,
      files: Object.fromEntries(
        Object.entries(files).map(([fileName, data]) => [
          fileName,
          {
            checksum: checksumJson(data),
            bytes: Buffer.byteLength(JSON.stringify(data, null, 2), "utf8")
          }
        ])
      )
    };

    fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { dir, manifest };
  }

  saveRoundFile(season, round, fileName, data, options = {}) {
    const dir = this.getRoundDirectory(season, round);
    const filePath = path.join(dir, fileName);
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(filePath) && !options.force) {
      throw new Error(`Arquivo ja existe: ${filePath}. Use --force para sobrescrever.`);
    }

    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return { filePath, checksum: checksumJson(data) };
  }

  readRoundFile(season, round, fileName) {
    const filePath = path.join(this.getRoundDirectory(season, round), fileName);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  listRounds(season) {
    const seasonDir = path.join(this.baseDir, String(season));

    if (!fs.existsSync(seasonDir)) {
      return [];
    }

    return fs.readdirSync(seasonDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^round-\d+$/.test(entry.name))
      .map((entry) => Number(entry.name.replace("round-", "")))
      .sort((a, b) => a - b);
  }

  getCoverage(season) {
    return this.listRounds(season).map((round) => {
      const post = this.readRoundFile(season, round, "post-round.json");
      const validation = this.readRoundFile(season, round, "validation.json");

      return {
        round,
        source: post?.source || null,
        athletesCount: post?.players?.length || 0,
        scoredAthletesCount: post?.players?.filter((player) => player.played === true).length || 0,
        matchesCount: post?.matches?.length || 0,
        clubsCount: post?.clubs ? Object.keys(post.clubs).length : 0,
        hasPrices: Boolean(post?.players?.some((player) => player.price !== null)),
        hasPoints: Boolean(post?.players?.some((player) => player.points !== null)),
        hasScouts: Boolean(post?.players?.some((player) => Object.keys(player.scouts || {}).length > 0)),
        hasAverage: Boolean(post?.players?.some((player) => player.average !== null)),
        hasStatus: Boolean(post?.players?.some((player) => player.statusId !== null)),
        hasMatches: Boolean(post?.matches?.length),
        hasResults: Boolean(post?.matches?.some((match) => match.homeScore !== null && match.awayScore !== null)),
        collectedAt: post?.collectedAt || null,
        validationStatus: validation?.validationStatus || post?.validationStatus || null
      };
    });
  }
}

module.exports = {
  DEFAULT_DATA_DIR,
  HistoricalDataRepository,
  checksumJson
};
