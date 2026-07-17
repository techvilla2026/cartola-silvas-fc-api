const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_RESEARCH_DIR = path.resolve(__dirname, "../../data/research");

class ResearchRepository {
  constructor(options = {}) {
    this.baseDir = options.baseDir || DEFAULT_RESEARCH_DIR;
  }

  seasonDir(season) {
    return path.join(this.baseDir, String(season));
  }

  writeJson(season, relativePath, data) {
    const filePath = path.join(this.seasonDir(season), relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return filePath;
  }

  readJson(season, relativePath) {
    const filePath = path.join(this.seasonDir(season), relativePath);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  listExperimentIds(season) {
    const dir = path.join(this.seasonDir(season), "experiments");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => /^[a-z0-9-]+\.json$/.test(name))
      .sort()
      .map((name) => name.replace(/\.json$/, ""));
  }
}

module.exports = {
  DEFAULT_RESEARCH_DIR,
  ResearchRepository
};
