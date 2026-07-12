const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { storageHealth } = require("../src/liveSnapshot/services/storageHealth");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function main() {
  const season = Number(argValue("season", 2026));
  const repository = new LiveSnapshotRepository();
  const result = storageHealth(repository, season);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "FAIL") process.exitCode = 1;
}

main();
