const { LiveSnapshotRepository } = require("../src/liveSnapshot/repositories/fileRepository");
const { captureLivePreRoundSnapshot } = require("../src/liveSnapshot/services/capture");

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
  const result = await captureLivePreRoundSnapshot({
    season: season ? Number(season) : undefined,
    round: round ? Number(round) : undefined,
    dryRun: hasFlag("dry-run"),
    forceInvalidCapture: hasFlag("force-invalid-capture"),
    repository: new LiveSnapshotRepository(),
    timeoutMs: Number(process.env.CARTOLA_TIMEOUT_MS || 8000)
  });

  console.log(JSON.stringify(result.report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
