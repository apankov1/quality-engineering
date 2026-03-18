# Testing

> Author's `.claude/rules/testing.md` — the testing philosophy that survived evaluating 14 QA skills.
> Used as a Claude Code rule file (path-scoped to `**/*.spec.ts`).

## Test real systems, not simulations

No mocks. Integration tests with real bindings (Miniflare for D1/KV/R2). `vi.fn()` only for platform APIs unavailable in test (WebSocket, ExecutionContext, DOLogger stubs).

Why: mocked tests pass while prod breaks. The mock diverges from the real system silently. If you can test against the real thing, do it.

## Test the boundary, not the internals

Call the exported function. If deleting the call site doesn't break the test, you're testing the wrong layer. Never write inline "simulators" that copy production logic — import and call the actual code.

If the function is private, extract the pure logic into its own module. Test that module. Production code delegates to it.

## Bugs get tests first

Write the failing test. Verify it fails for the right reason. Then fix. Then full suite. This order is non-negotiable — it proves the test actually catches the bug.

## What to test

- **Defect-first**: look at the production code, find the fault-prone patterns, write tests that target those — not tests that exercise the API shape
- **State machines**: test all N×N transitions, not just happy path. Invalid transitions must throw.
- **Combinatorial inputs**: pairwise coverage for multi-factor scenarios. Cover all factor pairs in near-minimal cases.
- **Boundaries**: Zod parse at every trust boundary. Valid input, invalid input, edge values.

## Naming

`module.spec.ts` (unit), `module.workers.spec.ts` (Miniflare), `module.contract.spec.ts` (schema), `module.pairwise.spec.ts` (combinatorial).

Test names describe behavior: `'returns X when Y is Z'`. Never: `'works correctly'`, `'should work'`.

Assertions use specific values: `expect(result.code).toBe('game_not_found')` not `expect(result).toBeDefined()`.
