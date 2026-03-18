/**
 * Grader unit tests — verifies the grading functions produce correct pass/fail
 * judgments on known (output, expectation) pairs. Run this before any benchmark
 * to catch grader regressions.
 *
 * Usage: npx tsx evals/test-grader.ts
 * Exit: 0 if all pass, 1 if any fail.
 */

// We need to import the grading function. Since grade-output.ts is a script (not a module),
// we extract the grading logic into a testable function by re-implementing the dispatch here
// and comparing against the actual grader's output.
// TODO: refactor grade-output.ts to export gradeExpectation() as a module.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// --- Test cases: [output, expectation, expected_pass, description] ---
const cases: Array<[string, string, boolean, string]> = [

  // === "Identifies X on Y" ===
  [
    "**empty test body** detected in test `should process refund for valid transaction` (line 12)",
    "Identifies empty test body on 'should process refund for valid transaction'",
    true,
    "Identifies pattern + test name present",
  ],
  [
    "The test file looks clean, no issues found.",
    "Identifies empty test body on 'should process refund for valid transaction'",
    false,
    "Identifies pattern + test name both absent",
  ],
  [
    "Found empty_test_body but on a different test",
    "Identifies empty test body on 'should process refund for valid transaction'",
    false,
    "Pattern present but wrong test name",
  ],

  // === "Does NOT flag 'test name'" (quoted) ===
  [
    "All tests look good. No issues detected.",
    "Does NOT flag 'should reject expired cards' — it has proper assertions and throws",
    true,
    "Test name not mentioned at all — passes",
  ],
  [
    "- **should reject expired cards**: finding — weak assertion (severity: should-fail)",
    "Does NOT flag 'should reject expired cards' — it has proper assertions and throws",
    false,
    "Test name flagged as finding — fails",
  ],
  [
    "should reject expired cards: clean, proper assertions present",
    "Does NOT flag 'should reject expired cards' — it has proper assertions and throws",
    true,
    "Test name mentioned in positive context — passes",
  ],

  // === "Does NOT flag pattern_name on any test" (unquoted) ===
  [
    "| `empty_test_body` | Clean — all tests have active assertions |\n| `tautological_assertion` | Clean |",
    "Does NOT flag empty_test_body on any test",
    true,
    "Pattern in clean verdict table — not a finding",
  ],
  [
    "**empty_test_body** — FOUND on test 'should process refund' (line 12, severity: must-fail)",
    "Does NOT flag empty_test_body on any test",
    false,
    "Pattern flagged as finding — fails",
  ],
  [
    "No issues found in this file. All patterns clean.",
    "Does NOT flag empty_test_body on any test",
    true,
    "Pattern not mentioned at all — passes",
  ],
  [
    "empty test body: not detected in any test",
    "Does NOT flag empty_test_body on any test",
    true,
    "Pattern mentioned as 'not detected' — passes",
  ],

  // === "States the file is clean or has no slop patterns" ===
  [
    "This file is clean. No slop patterns detected.",
    "States the file is clean or has no slop patterns",
    true,
    "Explicit clean statement — passes",
  ],
  [
    "Two issues found:\n1. empty_test_body on test X\n2. tautological_assertion on test Y",
    "States the file is clean or has no slop patterns",
    false,
    "Slop patterns flagged as findings — fails",
  ],
  [
    "The test file has some code style issues but nothing related to the slop patterns.",
    "States the file is clean or has no slop patterns",
    false,
    "No explicit clean statement, even though no patterns — should fail (tighter grading)",
  ],

  // === "Classifies X as breaking/safe" ===
  [
    "**score** field: ❌ BREAKING — removed entirely, consumers relying on it will crash",
    "Classifies removal of 'score' field as breaking",
    true,
    "Field classified as breaking — passes",
  ],
  [
    "**score** field: ✅ safe — still present in v2",
    "Classifies removal of 'score' field as breaking",
    false,
    "Field classified as safe when expected breaking — fails",
  ],
  [
    "**metadata**: safe — optional addition, backward compatible",
    "Does NOT flag 'metadata' as breaking",
    true,
    "Field classified as safe — not flagged as breaking",
  ],

  // === "Explains that X" ===
  [
    "Empty test bodies always pass regardless of the production code behavior, meaning bugs go undetected.",
    "Explains that empty test bodies pass regardless of behavior",
    true,
    "Explanation keywords present",
  ],
  [
    "This test has issues.",
    "Explains that empty test bodies pass regardless of behavior",
    false,
    "No explanation — fails",
  ],

  // === "Provides line numbers" ===
  [
    "- empty_test_body on 'should process refund' (line 12)\n- tautological on 'should hash' (line 45)",
    "Provides line numbers for each finding",
    true,
    "Line numbers present",
  ],
  [
    "- empty_test_body on 'should process refund'\n- tautological on 'should hash'",
    "Provides line numbers for each finding",
    false,
    "No line numbers — fails",
  ],

  // === Keyword fallback ===
  [
    "The test uses assert.ok(true) which is a tautological check that always passes and verifies nothing about the system under test.",
    "Explains that assert.ok(true) always passes and verifies nothing",
    true,
    "Keyword fallback matches enough keywords",
  ],
];

// --- Run each test case through the actual grader ---
// We do this by writing a tiny benchmark dir with one output, grading it,
// and reading the result. This tests the actual grader code path.

const testDir = join("/tmp", `grader-test-${Date.now()}`);
mkdirSync(testDir, { recursive: true });

// Create a minimal evals-snapshot with one eval per test case
const evals = {
  skill_name: "grader-test",
  evals: cases.map((c, i) => ({
    id: i + 1,
    name: `case-${i + 1}`,
    prompt: "test",
    files: [],
    expectations: [c[1]],
  })),
};
writeFileSync(join(testDir, "evals-snapshot.json"), JSON.stringify(evals));

// Create directory structure and output files
for (let i = 0; i < cases.length; i++) {
  const runDir = join(testDir, `eval-${String(i + 1).padStart(2, "0")}-case-${i + 1}`, "with_skill", "run-1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "output.md"), cases[i][0]);
  writeFileSync(join(runDir, "timing.json"), JSON.stringify({ valid: true, duration_ms: 0 }));
}

// Run the grader
try {
  execSync(`npx tsx evals/grade-output.ts ${testDir} 2>&1`, {
    encoding: "utf-8",
    timeout: 30_000,
  });
} catch {
  // grader prints to stdout, may exit non-zero if there are issues
}

// Read and verify results
let passed = 0;
let failed = 0;
const failures: string[] = [];

for (let i = 0; i < cases.length; i++) {
  const [, expectation, expectedPass, description] = cases[i];
  const gradingPath = join(
    testDir,
    `eval-${String(i + 1).padStart(2, "0")}-case-${i + 1}`,
    "with_skill",
    "run-1",
    "grading.json",
  );

  try {
    const grading = JSON.parse(readFileSync(gradingPath, "utf-8"));
    const actualPass = grading.expectations[0].passed;
    const evidence = grading.expectations[0].evidence;

    if (actualPass === expectedPass) {
      passed++;
    } else {
      failed++;
      failures.push(
        `  FAIL case ${i + 1}: ${description}\n` +
        `    expectation: ${expectation}\n` +
        `    expected: ${expectedPass ? "PASS" : "FAIL"}, got: ${actualPass ? "PASS" : "FAIL"}\n` +
        `    evidence: ${evidence}`,
      );
    }
  } catch (err) {
    failed++;
    failures.push(`  ERROR case ${i + 1}: ${description}\n    ${err}`);
  }
}

// Report
console.log(`\nGrader unit tests: ${passed} passed, ${failed} failed out of ${cases.length}\n`);

if (failures.length > 0) {
  console.log("FAILURES:");
  for (const f of failures) {
    console.log(f);
  }
}

// Cleanup
execSync(`rm -rf ${testDir}`);

process.exit(failed > 0 ? 1 : 0);
