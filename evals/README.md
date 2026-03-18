# Skill Evaluation System

Measures whether Claude Code skills produce better outputs than base Claude on the same tasks.

## Quick start

```bash
# Run one skill (pre-flight → benchmark → grade → report)
npx tsx evals/run-suite.ts skills/slop-test-detector --ids 1,2,7 --runs 1

# Full benchmark for one skill
npx tsx evals/run-suite.ts skills/slop-test-detector --runs 5

# All skills with evals
npx tsx evals/run-suite.ts --all --runs 1
```

## What it measures

Each benchmark answers: **"Does Claude + this skill produce better results than Claude alone?"**

The runner executes the same prompt twice — once with the skill loaded (from project root) and once without (from an isolated temp directory). Outputs are graded against expectations, and pass rates are compared.

## Pipeline

```
run-suite.ts
  │
  ├─ Step 1: test-grader.ts         (21 unit tests for the grader itself)
  ├─ Step 2: check-ground-truth.ts  (per-skill fixture regression check)
  ├─ Step 3: run-benchmark.ts       (claude -p with/without skill, captures tokens + cost)
  ├─ Step 4: grade-output.ts        (scores outputs against expectations)
  └─ Step 5: summary table          (pass rates, delta, cost)
```

## Architecture

```
evals/
├── run-suite.ts           # Orchestrator — runs the full pipeline
├── run-benchmark.ts       # Runner — executes claude -p, saves outputs + timing
├── grade-output.ts        # Prose grader — pattern-matching over freeform output
├── grade-json.ts          # JSON grader — deterministic grading over structured output
├── test-grader.ts         # Grader unit tests — run before every benchmark
├── schema.ts              # Shared types: EvalCase, StructuredOutput, CostBudget
├── prompts.ts             # Prompt wrappers for structured JSON output
├── migrate-evals-json.ts  # Migration script for evals.json format upgrades
├── skill-evaluation-prd.md # Design document
└── results/               # Published benchmark summaries
    └── slop-test-detector.md

skills/<skill>/evals/
├── evals.json             # Eval cases: prompts, expectations, ground truth
├── fixtures/              # Input files the skill operates on
├── trigger-eval-set.json  # 20 queries for triggering accuracy
└── check-ground-truth.ts  # Fixture regression check (per-skill)
```

## Eval case schema

Each eval in `evals.json` has:

| Field | Purpose |
|---|---|
| `split` | `dev` (iteration), `holdout` (final only), `adversarial` (edge cases) |
| `eval_type` | `forced_skill_quality`, `analyzer_regression`, `routing_trigger`, `blind_e2e` |
| `grading_mode` | `json_contains`, `json_exact`, `deterministic`, `prose_heuristic` |
| `expected_json` | Structured expected output: verdict + expected/forbidden findings |
| `expectations` | Legacy prose expectations (fallback) |
| `ground_truth` | Machine-checkable facts for analyzer regression |

## Design decisions

**Baseline isolation**: `without_skill` runs from a temp directory with no access to skill files, repo docs, or eval corpus. Fixture content is inlined in the prompt.

**Validity checking**: The runner inspects `result.subtype`, `stop_reason`, and `permission_denials` from Claude's JSON output. Failed sessions are marked invalid and excluded from grading.

**Holdout enforcement**: Evals marked `split: "holdout"` are excluded by default. Use `--include-holdout` for final benchmarks.

**Tool isolation**: Benchmark runs use `--allowedTools ""` to prevent the model from using Bash/Edit/Write. Skills are still loaded (they're context, not tools). This ensures pure text analysis.

**Cost tracking**: Every run captures `input_tokens`, `output_tokens`, `total_cost_usd` from Claude's response. Aggregated in benchmark.json.

See [skill-evaluation-prd.md](./skill-evaluation-prd.md) for the full design rationale.
