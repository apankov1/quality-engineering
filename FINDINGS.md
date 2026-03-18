# QA Skills Evaluation — Findings

## TL;DR

After building a full evaluation system and benchmarking 10 QA skills for Claude Code, we found that **modern Claude models (Sonnet 4.6+) already know these QA techniques**. The skills add marginal uplift that doesn't justify the maintenance cost.

## What we built

10 specialized QA skills covering:
- Test quality detection (slop-test-detector)
- Breaking change analysis (breaking-change-detector)
- Pairwise test matrix generation (pairwise-test-coverage)
- Deterministic concurrency testing (barrier-concurrency-testing)
- Fault injection patterns (fault-injection-testing)
- State machine testing (model-based-testing)
- Defect-first test authoring (defect-first-testing)
- Structured log assertions (observability-testing)
- Zod schema boundary testing (zod-contract-testing)
- WebSocket resilience patterns (websocket-client-resilience)

Each skill bundled TypeScript utilities (analyzers, matrix generators, barrier primitives) and detailed instructions.

## What we measured

We built a shared evaluation system (`evals/`) that:
- Runs the same prompt with and without the skill loaded
- Isolates the baseline in a temp directory (no skill file access)
- Validates run completion (checks for permission denials, max-turns errors)
- Grades outputs against expectations
- Captures tokens, cost, and timing per run

### Quantitative results

**slop-test-detector** (most mature skill, 13 eval fixtures):
- with_skill: 76.7% pass rate
- without_skill: 64.2% pass rate
- Delta: **+12.5 percentage points**
- Cost overhead: +$0.07/run (~2x tokens)

**breaking-change-detector** (11 eval fixtures):
- with_skill: 65.1% pass rate
- without_skill: 61.9% pass rate
- Delta: **+3.2 percentage points** (within noise)

### Qualitative results (side-by-side comparison)

We ran head-to-head comparisons on 4 tasks. The model **without any skill**:

| Task | Without skill | With skill | Winner |
|---|---|---|---|
| Write retry tests | 10 targeted bug scenarios with fake timers | 10 scenarios + jitter observation | Tie |
| Generate pairwise matrix | 16 cases, 100% pair coverage, mathematical proof | 18 cases, verified coverage | **Baseline** (tighter matrix) |
| Review test quality | Found all 4 slop patterns | Same findings + file-level analysis | Marginal skill |
| Review payment code | 10-point review with priority table and fixes | 4 risks framed as test gaps, asked before acting | **Baseline** (more thorough) |

## What we learned

### 1. The model already knows QA techniques

Claude Sonnet 4.6 produces pairwise covering arrays, identifies slop patterns, writes defect-first tests, and spots breaking changes — without any skill loaded. These are not obscure techniques; they're well-represented in training data.

### 2. Skills that encode knowledge the model already has show marginal uplift

The +12.5% on slop-test-detector was the best result across all skills. Most of that came from structured vocabulary (naming patterns by their formal names) rather than catching bugs the baseline missed.

### 3. Skills that bundle algorithms get outperformed by the model

The pairwise matrix generator (a greedy covering algorithm bundled as `pairwise.ts`) produced 18 test cases. The model without the skill produced 16 cases with a complete mathematical coverage proof. The model derived a better algorithm on the spot.

### 4. The valuable skill is behavioral, not technical

The one difference that mattered: the consolidated skill changed *how* Claude responds (ask about test gaps before suggesting fixes) rather than *what* it knows. But this behavioral shift can be achieved with a single CLAUDE.md instruction rather than a full skill.

### 5. Evaluation infrastructure is expensive to build correctly

We spent significant effort building and debugging the eval system itself:
- Fixtures that were labeled "clean" had real issues the model correctly flagged
- The grader had bugs (substring matching, context-unaware pattern detection)
- Baseline isolation was confounded (same working directory, skill files readable)
- Invalid runs (permission denials, max-turns errors) were scored as valid data

Each of these produced misleading results until fixed. The infrastructure is now solid, but the cost of building it exceeded the value of the skills it evaluated.

## Recommendations

### For this repo

The 10 individual skills should be archived. The evaluation infrastructure (`evals/`) has value as a reusable framework for testing any skill.

### For skill authors generally

Before building a QA/testing skill, try the same prompt without any skill. If the model already produces good output, your skill needs to add something the model can't derive:
- **Team-specific conventions** (e.g., a `// Defect:` comment requirement)
- **Proprietary workflows** (e.g., "always run X before Y in our CI")
- **Access to tools/APIs** the model can't use natively

If the skill just teaches the model techniques it already knows, it adds context tokens without adding value.

### For the "when to test" problem

The most promising direction was a skill that triggers on code review and asks "what could go wrong here that you haven't tested?" — shifting Claude from reactive test generator to proactive risk identifier. But even this can be achieved with:

```markdown
# CLAUDE.md
When reviewing code or before commits, identify the 3-5 most likely
defects and ask whether tests exist for them before suggesting fixes.
```

A single line in CLAUDE.md, not a skill.

## Eval system overview

The evaluation infrastructure works and can be reused:

```bash
# Run full pipeline for a skill
npx tsx evals/run-suite.ts skills/<name> --runs 3

# Run just the benchmark
npx tsx evals/run-benchmark.ts skills/<name> --ids 1,2,3 --runs 1

# Grade results
npx tsx evals/grade-output.ts skills/<name>/benchmarks/<timestamp>

# Run trigger precision/recall
npx tsx evals/run-trigger-benchmark.ts skills/<name>

# Verify grader correctness
npx tsx evals/test-grader.ts
```

See `evals/README.md` for full documentation.
