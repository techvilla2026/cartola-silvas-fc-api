const { fetchWithRetry, readJson } = require("./http");

const CARTOLA_API_BASE_URL = "https://api.cartolafc.globo.com";
const CARTOLA_REPO_API = "https://api.github.com/repos/henriquepgomide/caRtola";
const CARTOLA_RAW_BASE = "https://raw.githubusercontent.com/henriquepgomide/caRtola/master";

class CartolaOpenDataSource {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs;
    this.retries = options.retries;
    this.backoffMs = options.backoffMs;
  }

  async request(url, options = {}) {
    return fetchWithRetry(url, {
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      backoffMs: this.backoffMs,
      ...options
    });
  }

  async getSourceMetadata() {
    const [repoResponse, commitResponse] = await Promise.all([
      this.request(CARTOLA_REPO_API),
      this.request(`${CARTOLA_REPO_API}/commits/master`)
    ]);
    const repo = await readJson(repoResponse);
    const commit = await readJson(commitResponse);

    return {
      primarySource: "caRtola",
      primaryOrigin: "https://github.com/henriquepgomide/caRtola",
      primaryLicense: repo.license?.spdx_id || "MIT",
      primaryRevision: commit.sha,
      primaryPushedAt: repo.pushed_at,
      validationSource: "cartola-official-public-api",
      validationOrigin: CARTOLA_API_BASE_URL
    };
  }

  async listAvailableRounds(season) {
    const response = await this.request(`${CARTOLA_REPO_API}/git/trees/master?recursive=1`);
    const tree = await readJson(response);
    const prefix = `data/01_raw/${season}/rodada-`;

    return tree.tree
      .filter((item) => item.type === "blob" && item.path.startsWith(prefix) && item.path.endsWith(".csv"))
      .map((item) => ({
        round: Number(item.path.replace(prefix, "").replace(".csv", "")),
        path: item.path,
        size: item.size,
        url: `${CARTOLA_RAW_BASE}/${item.path}`,
        sourceVersion: item.sha
      }))
      .filter((item) => Number.isInteger(item.round))
      .sort((a, b) => a.round - b.round);
  }

  async fetchRoundCsv(season, round) {
    const url = `${CARTOLA_RAW_BASE}/data/01_raw/${season}/rodada-${round}.csv`;
    const response = await this.request(url, { accept: "text/csv,text/plain" });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Falha ao baixar rodada ${round} do caRtola: HTTP ${response.status}`);
    }

    return {
      url,
      text: await response.text()
    };
  }

  async fetchMatches(season, round) {
    const response = await this.request(`${CARTOLA_API_BASE_URL}/partidas/${round}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Falha ao baixar partidas da rodada ${round}: HTTP ${response.status}`);
    }

    return readJson(response);
  }

  async fetchOfficialScoredAthletes(season, round) {
    const response = await this.request(`${CARTOLA_API_BASE_URL}/atletas/pontuados/${round}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Falha ao baixar pontuados da rodada ${round}: HTTP ${response.status}`);
    }

    return readJson(response);
  }
}

module.exports = {
  CARTOLA_API_BASE_URL,
  CARTOLA_REPO_API,
  CARTOLA_RAW_BASE,
  CartolaOpenDataSource
};
