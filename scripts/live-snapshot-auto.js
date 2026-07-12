const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { runLiveSnapshotAutomation } = require("../src/liveSnapshot/services/automation");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const season = argValue("season", null);
  const round = argValue("round", null);
  const result = await runLiveSnapshotAutomation({
    season: season ? Number(season) : undefined,
    round: round ? Number(round) : undefined,
    dryRun: hasFlag("dry-run"),
    force: hasFlag("force"),
    strict: hasFlag("strict"),
    reason: argValue("reason", null),
    now: argValue("now", null),
    repository: new LiveSnapshotRepository(),
    timeoutMs: Number(process.env.CARTOLA_TIMEOUT_MS || 8000)
  });

  console.log(JSON.stringify(result.status, null, 2));
  if (result.status.result === "FAILED") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
