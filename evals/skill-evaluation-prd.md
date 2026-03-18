# Skill Evaluation Hardening v1

## Goal

Build a reliable evaluation system for `slop-test-detector` and
`breaking-change-detector` that measures:

- analyzer correctness
- skill lift versus baseline
- routing quality
- regression risk in CI

The system must produce results that are actually trustworthy, not just easy to
run.

## Why This Exists

The current setup is moving in the right direction:

- shared benchmark runner in `evals/run-benchmark.ts`
- shared grader in `evals/grade-output.ts`
- task-specific fixture sets in each skill
- repeated runs, holdout concept, and cost/latency tracking

But it still mixes several different questions:

1. Does the core analyzer/classifier work?
2. Does the model do better when the skill is available?
3. Does the model trigger the skill when it should?
4. Can we trust the grader and baseline condition?

Those need separate evaluation layers.

## Product Outcome

After this project, maintainers should be able to answer:

- Did the analyzer regress?
- Does the skill improve final model output quality?
- Does the model invoke the skill when it should?
- Did this PR worsen cost, latency, or invalid-run rate?
- Does the automated grader still agree with humans?

## Non-Goals

- Building a hosted eval SaaS
- Solving online production monitoring in this first pass
- Refactoring every skill in the repo at once

## Success Metrics

- `0%` invalid benchmark runs included in aggregate benchmark scores
- automated grader versus human pass/fail agreement `>= 85%` on a 30-case
  calibration set
- `without_skill` runs execute in an environment that cannot read local skill
  source or eval corpus beyond the provided fixture input
- each skill has explicit `dev`, `holdout`, and `adversarial` splits
- PR CI runs analyzer regression plus a lightweight eval subset
- nightly CI runs the full benchmark suite
- at least `80%` of benchmark criteria are graded from structured output rather
  than regex over prose

## Core Principles

- Change one variable at a time in A/B benchmarks.
- Prefer structured outputs over freeform prose.
- Prefer deterministic grading over heuristic grading.
- Separate analyzer, routing, and end-to-end evals.
- Treat human calibration as part of the product, not as optional cleanup.

## Evaluation Taxonomy

Every skill should support four eval types.

### 1. Analyzer Regression

Purpose: verify the underlying analyzer/classifier logic directly.

Examples:

- `analyzeTestFile()` for `slop-test-detector`
- `classifyFieldChange()` and related helpers for `breaking-change-detector`

Requirements:

- must read real fixtures where applicable
- must compare actual outputs against expected ground truth
- must exit non-zero on mismatch

### 2. Forced Skill Quality

Purpose: measure conditional lift when the skill is available.

Requirements:

- same prompt, same fixture, same model
- only skill availability differs
- repeated runs to measure variance

### 3. Routing / Trigger Evaluation

Purpose: measure whether the model invokes the correct skill on the correct
queries.

Metrics:

- precision
- recall
- false-trigger rate

### 4. Blind End-to-End Evaluation

Purpose: measure normal user experience with the skill system enabled.

Requirements:

- realistic prompts
- no forcing of the skill
- scored on final outcome quality plus trace quality when needed

## Current Problems To Fix

### P0. Baseline contamination

`without_skill` must not be able to inspect local skill files or eval corpora.
Disabling slash commands alone is not a sufficient isolation boundary if the
repo is still readable.

### P1. Fragile grading

Freeform prose plus heuristic matching is useful as a fallback, but it should
not be the main source of truth for benchmark scoring.

### P2. Missing eval separation

Analyzer checks, trigger checks, and end-to-end quality checks currently blur
together.

### P3. Weak breaking-change regression test

`skills/breaking-change-detector/evals/check-ground-truth.ts` needs to become a
real assertive regression test against actual fixture data and expected results.

### P4. Declarative-only config

Fields like `expected_output` and parts of `benchmark_config` should either be
fully enforced by tooling or removed.

## Functional Requirements

### R1. Shared dataset schema

Add a shared schema file:

- `evals/schema.ts`

Each dataset row must support:

- `id`
- `name`
- `skill_name`
- `split` (`dev`, `holdout`, `adversarial`)
- `eval_type` (`analyzer_regression`, `forced_skill_quality`, `routing_trigger`, `blind_e2e`)
- `tags`
- `prompt`
- `fixtures`
- `expected_json`
- `grading_mode`
- `skill_expected`

### R2. Structured output contract

Prompts for benchmarked skills must request JSON output first.

Suggested shape:

```json
{
  "summary": "string",
  "overall_verdict": "clean|unsafe|breaking|safe|mixed",
  "findings": [
    {
      "rule": "string",
      "target": "string",
      "severity": "must-fail|should-fail|breaking|safe",
      "line": 0,
      "reason": "string"
    }
  ]
}
```

Human-readable prose may still be rendered for artifact review, but grading
should use JSON.

### R3. Isolated baseline

`without_skill` runs must execute from a temporary directory containing only:

- copied fixture files
- generated prompt file
- no `skills/`
- no repo-local docs
- no benchmark corpus

Keep `--disable-slash-commands`, but treat it as an extra guard, not the main
isolation mechanism.

### R4. Deterministic-first grading

Grading order:

1. schema validation
2. exact field checks
3. deterministic helper functions
4. optional LLM judge fallback for ambiguous narrative criteria

### R5. Human calibration set

Maintain a small reviewed set of benchmark outputs under:

- `evals/calibration/`

Use it to measure grader agreement before changing grading logic.

### R6. CI modes

PR CI must run:

- analyzer regression checks
- trigger eval checks
- a small dev-split benchmark subset

Nightly CI must run:

- full forced-skill benchmarks
- full blind end-to-end benchmarks

## Implementation Plan

### Phase 1: Harden the current harness

Target: make the current shared harness trustworthy.

Tasks:

- update `evals/run-benchmark.ts` to isolate `without_skill` in a clean temp
  directory with copied fixtures only
- keep invalid-run exclusion and invalid-run reporting
- make `holdout_evals` behavior explicit and visible in summary artifacts
- remove dead config fields or wire them up
- make `skills/breaking-change-detector/evals/check-ground-truth.ts` assertive
  and fixture-backed

Deliverables:

- trustworthy `with_skill` versus `without_skill` condition
- real pass/fail analyzer regression for both skills

### Phase 2: Move to structured outputs

Target: replace prose-heavy scoring with structured scoring.

Tasks:

- add `evals/schema.ts`
- add `evals/prompts.ts`
- add `evals/grade-json.ts`
- update both skill `evals.json` files to store structured expectations
- keep `evals/grade-output.ts` only as a legacy prose fallback

Deliverables:

- JSON-first output contract
- deterministic grading for most benchmark cases

### Phase 3: Add routing evals

Target: measure skill invocation quality, not just skill usefulness.

Tasks:

- standardize trigger datasets
- add `evals/run-trigger-benchmark.ts`
- report precision, recall, and false-trigger rate per skill

Deliverables:

- routing benchmark artifacts
- routing summary metrics in CI

### Phase 4: Add calibration and CI gates

Target: make evals a release control, not just a manual tool.

Tasks:

- add `evals/calibration/` human-reviewed cases
- add PR and nightly GitHub Actions workflows
- define fail thresholds for invalid runs, analyzer regressions, and benchmark
  regressions

Deliverables:

- eval quality gates in CI
- grader/human agreement tracking

## Acceptance Criteria

- `node --experimental-strip-types skills/slop-test-detector/evals/check-ground-truth.ts`
  exits non-zero on mismatch
- `node --experimental-strip-types skills/breaking-change-detector/evals/check-ground-truth.ts`
  exits non-zero on mismatch
- `without_skill` benchmark runs cannot access local skill definitions
- benchmark summaries include:
  - split
  - eval type
  - valid run count
  - invalid run count
  - pass rate
  - cost
  - latency
- structured-output cases can be graded without regex over prose
- trigger benchmarks produce precision and recall metrics
- CI fails on real regressions automatically

## Recommended File Changes

Create:

- `evals/schema.ts`
- `evals/prompts.ts`
- `evals/grade-json.ts`
- `evals/run-trigger-benchmark.ts`
- `evals/calibration/`

Modify:

- `evals/run-benchmark.ts`
- `evals/grade-output.ts`
- `skills/slop-test-detector/evals/evals.json`
- `skills/breaking-change-detector/evals/evals.json`
- `skills/breaking-change-detector/evals/check-ground-truth.ts`

## Rollout Order

Do not try to ship the whole thing at once.

Recommended order:

1. baseline isolation
2. breaking-change analyzer regression rewrite
3. structured output contract
4. JSON grading
5. trigger benchmark
6. CI gates

## Risks

- overly ambitious schema changes can stall adoption
- structured JSON prompts may reduce model fluency before grading improves
- routing metrics can look worse before the system is genuinely worse, because
  they expose hidden false triggers

## Notes From Best Practices

This plan follows the current pattern described in:

- OpenAI evaluation best practices
- OpenAI graders
- OpenAI trace grading
- OpenAI agent evals
- LangSmith evaluation concepts
- Anthropic Evaluation Tool
- Braintrust eval guidance
- Promptfoo CI/CD guidance

Key takeaways reflected here:

- use small high-quality curated datasets first
- separate offline and online evaluation loops
- evaluate traces and routing, not only final output
- keep evals in CI
- calibrate automated graders against humans
