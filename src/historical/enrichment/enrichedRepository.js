const fs = require("node:fs");
const path = require("node:path");
const { checksumJson } = require("../repositories/fileRepository");

const ENRICHED_SCHEMA_VERSION = "historical-pre-round-enriched-data/v1";
const ENRICHED_LEAKAGE_SCHEMA_VERSION = "historical-enriched-leakage-report/v1";
const DEFAULT_ENRICHED_DIR = path.resolve(__dirname, "../../../data/historical");

function enrichedSeasonDir(baseDir, season) {
  return path.join(baseDir, `${season}-enriched`);
}

function enrichedRoundDir(baseDir, season, round) {
  return path.join(enrichedSeasonDir(baseDir, season), `round-${String(round).padStart(2, "0")}`);
}

class EnrichedHistoricalRepository {
  constructor(options = {}) {
    this.baseDir = options.baseDir || DEFAULT_ENRICHED_DIR;
  }

  getRoundDirectory(season, round) {
    return enrichedRoundDir(this.baseDir, season, round);
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
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  listRounds(season) {
    const dir = enrichedSeasonDir(this.baseDir, season);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^round-\d+$/.test(entry.name))
      .map((entry) => Number(entry.name.replace("round-", "")))
      .sort((a, b) => a - b);
  }
}

module.exports = {
  DEFAULT_ENRICHED_DIR,
  ENRICHED_LEAKAGE_SCHEMA_VERSION,
  ENRICHED_SCHEMA_VERSION,
  EnrichedHistoricalRepository
};
