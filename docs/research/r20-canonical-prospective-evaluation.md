# R20 canonical prospective evaluation

## Canonical outcome

- Round: 20/2026
- Prospective snapshot capture: `pre-match-2026-r20-20260724233025-648962cc`
- Snapshot fingerprint: `7353f12b56045a94eb2b6e2544e6de691e5639045b44c5e454d06f63c19a58c9`
- Outcome: `data/historical/2026/round-20/post-round.json`
- Source: revisioned caRtola dataset at revision `5cc895ab524d549d8344f9ed81e6ce5b3a825e43`, partially cross-validated against the official Cartola API
- Completeness: 773 of 773 outcome players have a boolean `post.players[].played`
- Evaluation matching: 767 rows, `TARGET_MISSING=0`, `TARGET_AMBIGUOUS=0`
- Registry status: `EVALUATED`

The original pre-match snapshot remains immutable and its fingerprint is unchanged. The evaluation consumes only `post.players[].played` as its participation truth source.

## Aggregate metrics

| Model / threshold | n | TP | TN | FP | FN | Accuracy | Precision | Recall | Specificity | F1 | Balanced accuracy | Brier | Log loss | ROC-AUC | PR-AUC | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AVAILABILITY_V1 / 0.50 | 767 | 282 | 266 | 166 | 53 | 0.7145 | 0.6295 | 0.8418 | 0.6157 | 0.7203 | 0.7288 | 0.193600 | 0.825211 | 0.8178 | 0.7738 | 0.156837 |
| AVAILABILITY_V2_CALIBRATED / 0.50 | 767 | 244 | 340 | 92 | 91 | 0.7614 | 0.7262 | 0.7284 | 0.7870 | 0.7273 | 0.7577 | 0.172089 | 0.521199 | 0.8281 | 0.7789 | 0.052595 |
| AVAILABILITY_V2_CALIBRATED / 0.45 experimental | 767 | 284 | 277 | 155 | 51 | 0.7314 | 0.6469 | 0.8478 | 0.6412 | 0.7339 | 0.7445 | 0.172089 | 0.521199 | 0.8281 | 0.7789 | 0.052595 |

Relative to the official 0.50 threshold, the experimental 0.45 threshold recovers 40 false negatives and introduces 63 new false positives, for a net trade-off of -23. Its classification is `NEUTRAL`.

## Status-signal slices (V2 calibrated)

| Slice / threshold | n | TP | TN | FP | FN | Accuracy | Precision | Recall | Specificity | F1 | Balanced accuracy | Brier | Log loss | ROC-AUC | PR-AUC | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WITH_STATUS_SIGNAL / 0.50 | 335 | 199 | 52 | 44 | 40 | 0.7493 | 0.8189 | 0.8326 | 0.5417 | 0.8257 | 0.6872 | 0.175854 | 0.536824 | 0.7475 | 0.8654 | 0.080476 |
| WITH_STATUS_SIGNAL / 0.45 | 335 | 218 | 40 | 56 | 21 | 0.7701 | 0.7956 | 0.9121 | 0.4167 | 0.8499 | 0.6644 | 0.175854 | 0.536824 | 0.7475 | 0.8654 | 0.080476 |
| WITHOUT_STATUS_SIGNAL / 0.50 | 432 | 45 | 288 | 48 | 51 | 0.7708 | 0.4839 | 0.4688 | 0.8571 | 0.4762 | 0.6629 | 0.169170 | 0.509082 | 0.7588 | 0.4807 | 0.131918 |
| WITHOUT_STATUS_SIGNAL / 0.45 | 432 | 66 | 237 | 99 | 30 | 0.7014 | 0.4000 | 0.6875 | 0.7054 | 0.5057 | 0.6964 | 0.169170 | 0.509082 | 0.7588 | 0.4807 | 0.131918 |

## Position slices (V2 calibrated)

| Position | n | Threshold | TP | TN | FP | FN | Accuracy | Precision | Recall | Specificity | F1 | Balanced accuracy | Brier | Log loss | ROC-AUC | PR-AUC | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ATA | 192 | 0.50 | 66 | 79 | 23 | 24 | 0.7552 | 0.7416 | 0.7333 | 0.7745 | 0.7374 | 0.7539 | 0.179017 | 0.541553 | 0.8204 | 0.8003 | 0.075978 |
| ATA | 192 | 0.45 | 80 | 62 | 40 | 10 | 0.7396 | 0.6667 | 0.8889 | 0.6078 | 0.7619 | 0.7484 | 0.179017 | 0.541553 | 0.8204 | 0.8003 | 0.075978 |
| GOL | 87 | 0.50 | 17 | 63 | 4 | 3 | 0.9195 | 0.8095 | 0.8500 | 0.9403 | 0.8293 | 0.8951 | 0.097110 | 0.329403 | 0.9291 | 0.8819 | 0.139095 |
| GOL | 87 | 0.45 | 18 | 54 | 13 | 2 | 0.8276 | 0.5806 | 0.9000 | 0.8060 | 0.7059 | 0.8530 | 0.097110 | 0.329403 | 0.9291 | 0.8819 | 0.139095 |
| LAT | 123 | 0.50 | 40 | 48 | 17 | 18 | 0.7154 | 0.7018 | 0.6897 | 0.7385 | 0.6957 | 0.7141 | 0.184901 | 0.547236 | 0.8000 | 0.7702 | 0.085931 |
| LAT | 123 | 0.45 | 45 | 42 | 23 | 13 | 0.7073 | 0.6618 | 0.7759 | 0.6462 | 0.7143 | 0.7110 | 0.184901 | 0.547236 | 0.8000 | 0.7702 | 0.085931 |
| MEI | 227 | 0.50 | 72 | 92 | 36 | 27 | 0.7225 | 0.6667 | 0.7273 | 0.7188 | 0.6957 | 0.7230 | 0.191398 | 0.571743 | 0.7879 | 0.7238 | 0.101074 |
| MEI | 227 | 0.45 | 81 | 75 | 53 | 18 | 0.6872 | 0.6045 | 0.8182 | 0.5859 | 0.6953 | 0.7021 | 0.191398 | 0.571743 | 0.7879 | 0.7238 | 0.101074 |
| TEC | 20 | 0.50 | 18 | 0 | 0 | 2 | 0.9000 | 1.0000 | 0.9000 | n/a | 0.9474 | n/a | 0.040343 | 0.192612 | n/a | 1.0000 | 0.164434 |
| TEC | 20 | 0.45 | 20 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | n/a | 1.0000 | n/a | 0.040343 | 0.192612 | n/a | 1.0000 | 0.164434 |
| ZAG | 118 | 0.50 | 31 | 58 | 12 | 17 | 0.7542 | 0.7209 | 0.6458 | 0.8286 | 0.6813 | 0.7372 | 0.187930 | 0.560805 | 0.7905 | 0.6528 | 0.118904 |
| ZAG | 118 | 0.45 | 40 | 44 | 26 | 8 | 0.7119 | 0.6061 | 0.8333 | 0.6286 | 0.7018 | 0.7310 | 0.187930 | 0.560805 | 0.7905 | 0.6528 | 0.118904 |

## Normalized status outcomes

| Status | n | Played | Did not play | Participation rate |
| --- | ---: | ---: | ---: | ---: |
| DOUBT | 48 | 36 | 12 | 0.750000 |
| INJURED | 55 | 1 | 54 | 0.018182 |
| PROBABLE | 216 | 202 | 14 | 0.935185 |
| SUSPENDED | 16 | 0 | 16 | 0.000000 |
| UNKNOWN | 432 | 96 | 336 | 0.222222 |

## Warnings and limitations

- The official API cross-check returned 338 scored athletes. Two of them (`121823` and `122897`) are not marked `played=true` in the revisioned caRtola outcome.
- The complementary validation reports 659 scout divergences, but zero points differences and zero match differences. These warnings are retained and were not used to rewrite `played`.
- The evaluation contains 767 matched snapshot rows from an outcome universe of 773 athletes; no evaluated row has a missing or ambiguous target.
- This is the first completed prospective round in the controlled series. A single round is insufficient for promotion decisions.

## Recommendation

Keep AVAILABILITY_V2_CALIBRATED at the official threshold of 0.50. Keep 0.45 experimental and classified as `NEUTRAL`; do not promote it. Preserve the R20 evidence unchanged and collect additional genuinely prospective rounds before reconsidering calibration or thresholds.
