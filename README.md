# Quality Engineering — Skill Evaluation Findings

An experiment in building and evaluating QA skills for AI coding agents.

**Result:** After building 10 specialized QA skills and a full evaluation system to measure them, we found that Claude Sonnet 4.6 already knows these testing techniques. The skills add marginal uplift that doesn't justify the maintenance cost.

## What happened

We built 10 QA skills (test quality detection, breaking change analysis, pairwise matrix generation, concurrency testing, fault injection, state machine testing, and more) — each with bundled TypeScript utilities and detailed instructions.

Then we built an evaluation system to answer: **"Does Claude + this skill produce better results than Claude alone?"**

The answer, across every skill we tested, was: barely.

- **Best result** (slop-test-detector): +12.5% pass rate improvement
- **Typical result** (breaking-change-detector): +3.2% (within noise)
- **Pairwise matrix generation**: the baseline *outperformed* the skill — producing a tighter 16-case matrix vs the skill's 18-case matrix

The model already generates pairwise covering arrays, identifies weak test patterns, writes defect-first tests, and spots breaking changes — without any skill loaded.

## What we learned

1. **Skills that encode knowledge the model already has show marginal uplift.** QA testing techniques are well-represented in training data.

2. **Skills that bundle algorithms get outperformed.** The model derives equivalent or better algorithms on the spot.

3. **The valuable skill would be behavioral, not technical** — changing *when* Claude talks about testing (proactively on code review) rather than *what* it knows. But that's a CLAUDE.md instruction, not a skill.

4. **Evaluation infrastructure is expensive to build correctly.** Fixtures, graders, baselines, and validity checking all had bugs that produced misleading results until fixed.

See [FINDINGS.md](FINDINGS.md) for the full analysis with data.

## What's left in the repo

### Evaluation system (`evals/`)

The evaluation infrastructure works and is reusable for testing any skill:

```bash
# Full pipeline: pre-flight checks → benchmark → grade → report
npx tsx evals/run-suite.ts skills/<name> --runs 3

# Verify the grader itself is correct (21 unit tests)
npx tsx evals/test-grader.ts
```

See [evals/README.md](evals/README.md) for documentation.

### Historical skills (git history)

All 10 skills are preserved in git history. The commit `ecea85f` has the full skill set with eval fixtures. The commit `ddc59f1` removes them with the explanation.

## Recommendations for skill authors

Before building a QA/testing skill, try the same prompt without any skill. If the model already produces good output, your skill needs to add something the model can't derive:

- **Team-specific conventions** (e.g., a `// Defect:` comment requirement)
- **Proprietary workflows** (e.g., "always run X before Y in our CI")
- **Access to tools/APIs** the model can't use natively
- **Behavioral shifts** (e.g., "challenge test quality proactively on every code review")

If the skill just teaches techniques the model already knows, it adds context tokens without adding value.

## Author's testing.md

After retiring the skills, the testing guidance that remains is a 35-line philosophy file used as a Claude Code rule (`.claude/rules/testing.md`). It encodes the principles that survived the evaluation — the stuff that actually matters for test quality:

See [testing-rules/testing.md](testing-rules/testing.md) for the full file.

```markdown
# Testing

## Test real systems, not simulations

No mocks. Integration tests with real bindings (Miniflare for D1/KV/R2).
vi.fn() only for platform APIs unavailable in test (WebSocket, ExecutionContext).

Why: mocked tests pass while prod breaks. The mock diverges from the real
system silently. If you can test against the real thing, do it.

## Test the boundary, not the internals

Call the exported function. If deleting the call site doesn't break the test,
you're testing the wrong layer. Never write inline "simulators" that copy
production logic — import and call the actual code.

## Bugs get tests first

Write the failing test. Verify it fails for the right reason. Then fix.
This order is non-negotiable — it proves the test actually catches the bug.

## What to test

- **Defect-first**: find fault-prone patterns, target those
- **State machines**: all N×N transitions, not just happy path
- **Combinatorial inputs**: pairwise coverage for multi-factor scenarios
- **Boundaries**: Zod parse at every trust boundary
```

This is the behavioral instruction that 14 skills couldn't improve on.

## License

[MIT](LICENSE)
