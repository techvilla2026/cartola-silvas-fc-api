#!/usr/bin/env node
const { runResearch } = require("../src/research/lab");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const mode = process.argv[2] || "all";
const season = Number(argValue("season", "2026"));

try {
  const result = runResearch({ season, mode });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    mode,
    season,
    error: {
      code: "RESEARCH_COMMAND_FAILED",
      message: error.message
    }
  }, null, 2));
  process.exitCode = 1;
}
