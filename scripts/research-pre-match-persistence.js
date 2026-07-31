#!/usr/bin/env node

const {
  exactlyTrue,
  gitChangedFiles,
  validatePersistenceChanges
} = require("../src/research/preMatchScheduler");

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(item);
    if (match) args[match[1]] = match[2];
    else if (item === "--json") args.json = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const season = Number(args.season || 2026);
const result = validatePersistenceChanges({
  filesChanged: gitChangedFiles(),
  season,
  commitEnabled: exactlyTrue(process.env.PRE_MATCH_CAPTURE_COMMIT_ENABLED)
});
console.log(JSON.stringify(result, null, args.json ? 0 : 2));
if (result.persistenceStatus === "UNEXPECTED_FILE_CHANGE") process.exitCode = 5;
