const { validateChanges } = require("../src/liveSnapshot/services/changeValidator");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function main() {
  const result = validateChanges({
    cwd: argValue("cwd", process.cwd()),
    restoreVolatile: hasFlag("restore-volatile")
  });

  if (hasFlag("json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`allowed=${result.counts.allowed} disallowed=${result.counts.disallowed} commitRecommended=${result.commitRecommended}`);
    for (const item of result.disallowed) {
      console.log(`DISALLOWED ${item.status} ${item.path} ${item.reason}`);
    }
  }

  if (!result.ok) process.exitCode = 1;
}

main();
