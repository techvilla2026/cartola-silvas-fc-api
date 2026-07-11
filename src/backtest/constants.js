const BACKTEST_SCHEMA_VERSION = "backtest-run/v1";
const BACKTEST_ROUND_SCHEMA_VERSION = "backtest-round-result/v1";
const ENGINE_VERSION = "historical-evaluation-engine/4.3.0";
const PREDICTION_POLICY_VERSION = "pre-round-average-homeaway-v1";
const SELECTION_POLICY_VERSION = "formation-4-3-3-top-predicted-v1";
const BASELINE_POLICY_VERSION = "baseline-average-4-3-3-v1";
const BUILD_ID = "build-4.3.0";

const FORMATION_433 = {
  1: 1,
  2: 2,
  3: 2,
  4: 3,
  5: 3
};

const POSITION_LABELS = {
  1: "GOL",
  2: "LAT",
  3: "ZAG",
  4: "MEI",
  5: "ATA",
  6: "TEC"
};

module.exports = {
  BACKTEST_SCHEMA_VERSION,
  BACKTEST_ROUND_SCHEMA_VERSION,
  ENGINE_VERSION,
  PREDICTION_POLICY_VERSION,
  SELECTION_POLICY_VERSION,
  BASELINE_POLICY_VERSION,
  BUILD_ID,
  FORMATION_433,
  POSITION_LABELS
};
