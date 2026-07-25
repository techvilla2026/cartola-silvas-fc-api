const { ResearchRepository } = require("../src/research/repository");
const { buildRoundValidation, fetchOfficialMatches, writeRoundReport } = require("../src/research/roundValidation");

function parseArgs(argv) {
  return Object.fromEntries(argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const season = Number(args.season || 2026);
  const round = Number(args.round || 19);
  let officialMatchesPayload = null;
  let officialSourceStatus = "LIVE_UPSTREAM";

  try {
    officialMatchesPayload = await fetchOfficialMatches();
  } catch (error) {
    officialSourceStatus = `LIVE_UPSTREAM_FAILED:${error.message}`;
  }

  const repository = new ResearchRepository();
  const artifact = buildRoundValidation({ season, round, researchRepository: repository, officialMatchesPayload });
  artifact.officialMatchesSourceStatus = officialSourceStatus;
  repository.writeJson(season, `round-${round}-validation.json`, artifact);
  writeRoundReport(artifact);

  console.log(JSON.stringify({
    status: "OK",
    season,
    round,
    officialMatchesSourceStatus: officialSourceStatus,
    artifact: `data/research/${season}/round-${round}-validation.json`,
    report: `docs/research/round-${round}-learning-report.md`,
    promotion: artifact.contracts.promotionGate.state
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
