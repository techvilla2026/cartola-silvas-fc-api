const fs = require("node:fs");
const path = require("node:path");
const { BUILD_ID } = require("./constants");

const DEFAULT_BACKTEST_DIR = path.resolve(__dirname, "../../data/backtests");

class BacktestRepository {
  constructor(options = {}) {
    this.baseDir = options.baseDir || DEFAULT_BACKTEST_DIR;
    this.buildId = options.buildId || BUILD_ID;
  }

  runDir(season) {
    return path.join(this.baseDir, String(season), this.buildId);
  }

  writeJson(season, relativePath, data) {
    const filePath = path.join(this.runDir(season), relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return filePath;
  }

  readJson(season, relativePath) {
    const filePath = path.join(this.runDir(season), relativePath);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  listRoundResults(season) {
    const dir = path.join(this.runDir(season), "rounds");

    if (!fs.existsSync(dir)) {
      return [];
    }

    return fs.readdirSync(dir)
      .filter((name) => /^round-\d+\.json$/.test(name))
      .sort()
      .map((name) => this.readJson(season, path.join("rounds", name)));
  }
}

module.exports = {
  DEFAULT_BACKTEST_DIR,
  BacktestRepository
};
