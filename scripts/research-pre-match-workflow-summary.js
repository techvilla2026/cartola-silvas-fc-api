#!/usr/bin/env node

const fs = require("node:fs");

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const capture = readJson(process.argv[2]);
const persistence = readJson(process.argv[3]);
const writeEnabled = process.env.PRE_MATCH_CAPTURE_WRITE_ENABLED === "true";
const persistenceEnabled = process.env.PRE_MATCH_CAPTURE_COMMIT_ENABLED === "true";
const rows = {
  projectVersion: "5.2.13",
  currentRound: capture.round ?? null,
  deadline: capture.deadline ?? null,
  currentTime: capture.currentTime ?? null,
  minutesToDeadline: capture.minutesToDeadline ?? null,
  captureWindow: capture.captureWindow ?? null,
  existingPrimary: capture.existingPrimary ?? false,
  existingFinal: capture.existingFinal ?? false,
  actionTaken: capture.actionTaken ?? "NONE",
  reasonCode: capture.reasonCode ?? "UNKNOWN",
  captureType: capture.captureType ?? null,
  captureId: capture.captureId ?? null,
  fingerprint: capture.fingerprint ?? null,
  coverage: capture.coverage ?? null,
  writeEnabled,
  persistenceEnabled,
  persistenceStatus: persistence.persistenceStatus || "PERSISTENCE_DISABLED",
  captureRisk: capture.captureRisk ?? "UNKNOWN",
  nextRecommendedAction: capture.nextRecommendedAction ?? null
};
const lines = ["## Safe Prospective Pre-Match Scheduler", ""];
for (const [key, value] of Object.entries(rows)) {
  lines.push(`- ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
}
const output = `${lines.join("\n")}\n`;
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output, "utf8");
else process.stdout.write(output);
