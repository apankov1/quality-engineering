# slop-test-detector — Benchmark Results

## Summary

The slop-test-detector skill improves Claude's ability to identify weak test patterns by **+12.5 percentage points** over base Claude on the same prompts.

| Metric | with_skill | without_skill | Delta |
|---|---|---|---|
| Pass rate | **76.7%** | 64.2% | **+12.5%** |
| Avg tokens | 4,078 | 2,554 | +1,524 |
| Avg cost/run | $0.13 | $0.06 | +$0.07 |
| Valid runs | 3/3 | 3/3 | — |
| Invalid runs | 0 | 0 | — |

## Methodology

- **Model**: claude-sonnet-4-6
- **Date**: 2026-03-18
- **Evals**: 3 (empty-and-commented, tautological-circus, clean-contract)
- **Runs per config**: 1 (quick sanity; full n=5 pending)
- **Baseline**: `without_skill` runs from isolated temp directory, no skill access
- **Tool isolation**: `--allowedTools ""` prevents Bash/Edit/Write; skills loaded as context only
- **Validity**: all 6 runs passed validity checks (no permission denials, no max-turns errors)

## Per-eval results

| Eval | Type | with_skill | without_skill | Delta |
|---|---|---|---|---|
| empty-and-commented | True positive detection | 75% | 62% | **+12%** |
| tautological-circus | Semantic assertion analysis | 75% | 50% | **+25%** |
| clean-contract | False positive resistance | 80% | 80% | **0%** |

## Interpretation

- **Pattern detection (+12% to +25%)**: The skill significantly improves detection of empty test bodies, commented-out assertions, and tautological assertions. Base Claude catches some patterns but misses subtler ones (conditional assertions, assertion semantics).
- **False positive resistance (0%)**: Both configs correctly identify a clean test file. The skill doesn't introduce false positives on well-written code.
- **Cost tradeoff**: The skill adds ~$0.07/run (~1,500 extra tokens). Acceptable given the quality uplift.

## Pre-flight checks

| Check | Result |
|---|---|
| Grader unit tests | 21/21 passed |
| Fixture ground truth | 94/94 passed |
| Run validity | 6/6 valid |

## Limitations

- **n=1 per eval**: This is a quick sanity run. Statistical significance requires n≥5. A full benchmark (13 evals × 5 runs = 130 runs) is planned.
- **3 of 13 evals**: Only 3 evals were run. The full eval set covers 18 slop patterns across 13 fixtures including adversarial false-positive traps.
- **Prose grading**: Current grading uses pattern-matching heuristics over freeform model output. Structured JSON grading (grade-json.ts) is implemented but not yet integrated into the benchmark runner.

## How to reproduce

```bash
npx tsx evals/run-suite.ts skills/slop-test-detector --ids 1,2,7 --runs 1
```
