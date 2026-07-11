const { HistoricalDataRepository } = require("../src/historical/repositories/fileRepository");
const { reconstructPreRound } = require("../src/historical/reconstruction/preRoundReconstructor");
const { checkPreRoundLeakage } = require("../src/historical/reconstruction/leakageChecker");

function parseArgs(argv) {
  const args = {
    season: 2026,
    from: 1,
    to: 18,
    force: false,
    dryRun: false,
    strict: false
  };

  for (const arg of argv) {
    if (arg.startsWith("--season=")) args.season = Number(arg.split("=")[1]);
    if (arg.startsWith("--from=")) args.from = Number(arg.split("=")[1]);
    if (arg.startsWith("--to=")) args.to = Number(arg.split("=")[1]);
    if (arg === "--force") args.force = true;
    if (arg === "--dry-run") args.dryRun = true;
    if (arg === "--strict") args.strict = true;
  }

  return args;
}

function loadPostRounds(repository, season, from, to) {
  const posts = [];

  for (let round = from; round <= to; round += 1) {
    posts.push(repository.readRoundFile(season, round, "post-round.json"));
  }

  return posts;
}

function summarize(results) {
  return {
    rounds: results.length,
    ready: results.filter((item) => item.readiness === "READY").length,
    partiallyReady: results.filter((item) => item.readiness === "PARTIALLY_READY").length,
    notReady: results.filter((item) => item.readiness === "NOT_READY").length,
    eligiblePlayers: results.reduce((total, item) => total + item.eligiblePlayers, 0),
    ineligiblePlayers: results.reduce((total, item) => total + item.ineligiblePlayers, 0),
    leakagePass: results.filter((item) => item.leakageStatus === "PASS").length,
    leakageWarning: results.filter((item) => item.leakageStatus === "WARNING").length,
    leakageFail: results.filter((item) => item.leakageStatus === "FAIL").length
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = new HistoricalDataRepository();
  const allPosts = loadPostRounds(repository, args.season, 1, args.to).filter(Boolean);
  const results = [];

  for (let round = args.from; round <= args.to; round += 1) {
    const currentPost = repository.readRoundFile(args.season, round, "post-round.json");
    const previousPost = round > 1 ? repository.readRoundFile(args.season, round - 1, "post-round.json") : null;

    if (!currentPost) {
      const missing = { season: args.season, round, status: "MISSING" };
      results.push(missing);
      console.error(`[historical:reconstruct-pre] rodada ${round}: MISSING`);
      if (args.strict) process.exitCode = 1;
      continue;
    }

    const preRound = reconstructPreRound({
      season: args.season,
      round,
      currentPost,
      previousPost,
      allPosts
    });
    const leakage = checkPreRoundLeakage(preRound);
    preRound.leakageStatus = leakage.status;

    if (!args.dryRun) {
      repository.saveRoundFile(args.season, round, "pre-round.json", preRound, { force: args.force });
      repository.saveRoundFile(args.season, round, "leakage.json", leakage, { force: args.force });
    }

    const result = {
      season: args.season,
      round,
      status: "RECONSTRUCTED",
      readiness: preRound.readiness.status,
      eligiblePlayers: preRound.readiness.eligiblePlayers,
      ineligiblePlayers: preRound.readiness.ineligiblePlayers,
      leakageStatus: leakage.status
    };
    results.push(result);
    console.log(`[historical:reconstruct-pre] rodada ${round}: ${result.readiness}/${result.leakageStatus}`);
  }

  const summary = {
    season: args.season,
    from: args.from,
    to: args.to,
    dryRun: args.dryRun,
    summary: summarize(results.filter((item) => item.status === "RECONSTRUCTED")),
    results
  };

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  summarize
};
