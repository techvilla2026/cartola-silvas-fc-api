const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { auditLiveSnapshots } = require("../src/liveSnapshot/services/audit");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function main() {
  const season = Number(argValue("season", "2026"));
  const result = auditLiveSnapshots(new LiveSnapshotRepository(), season);
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
