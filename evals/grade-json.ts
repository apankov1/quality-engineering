/**
 * Deterministic JSON grader (R4) — grades structured model output against
 * expected_json from eval cases. No regex, no keyword matching, no LLM judge.
 *
 * Grading modes:
 * - json_exact:    all expected findings must match, no extras allowed
 * - json_contains: all expected findings must be present, extras allowed
 * - deterministic: run grading functions directly on parsed JSON
 *
 * Usage: npx tsx evals/grade-json.ts <benchmark-dir>
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractStructuredOutput } from "./prompts.ts";
import type { StructuredOutput, FindingOutput, EvalCase } from "./schema.ts";

// --- Types ---

interface GradeResult {
  check: string;
  passed: boolean;
  evidence: string;
}

interface GradingReport {
  eval_id: number;
  eval_name: string;
  configuration: string;
  run_number: number;
  structured_output_parsed: boolean;
  checks: GradeResult[];
  summary: { passed: number; failed: number; total: number; pass_rate: number };
  duration_ms: number;
  output_chars: number;
}

// --- Grading functions ---

function gradeVerdict(
  actual: StructuredOutput,
  expected: string,
): GradeResult {
  const passed = actual.overall_verdict === expected;
  return {
    check: `overall_verdict == "${expected}"`,
    passed,
    evidence: passed
      ? `Correct: "${actual.overall_verdict}"`
      : `Expected "${expected}", got "${actual.overall_verdict}"`,
  };
}

function gradeExpectedFinding(
  actual: StructuredOutput,
  expected: { rule: string; target?: string; severity?: string },
): GradeResult {
  const match = actual.findings.find((f: FindingOutput) => {
    if (f.rule.toLowerCase().replace(/[_\- ]/g, "") !== expected.rule.toLowerCase().replace(/[_\- ]/g, "")) {
      return false;
    }
    if (expected.target && !f.target.toLowerCase().includes(expected.target.toLowerCase())) {
      return false;
    }
    if (expected.severity && f.severity.toLowerCase() !== expected.severity.toLowerCase()) {
      return false;
    }
    return true;
  });

  const desc = [
    `rule=${expected.rule}`,
    expected.target ? `target~="${expected.target}"` : null,
    expected.severity ? `severity=${expected.severity}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    check: `finding present: {${desc}}`,
    passed: !!match,
    evidence: match
      ? `Found: rule="${match.rule}", target="${match.target}", severity="${match.severity}"`
      : `No matching finding for {${desc}} in ${actual.findings.length} findings`,
  };
}

function gradeForbiddenFinding(
  actual: StructuredOutput,
  forbidden: { rule: string; target?: string },
): GradeResult {
  const match = actual.findings.find((f: FindingOutput) => {
    if (f.rule.toLowerCase().replace(/[_\- ]/g, "") !== forbidden.rule.toLowerCase().replace(/[_\- ]/g, "")) {
      return false;
    }
    if (forbidden.target && !f.target.toLowerCase().includes(forbidden.target.toLowerCase())) {
      return false;
    }
    return true;
  });

  const desc = [
    `rule=${forbidden.rule}`,
    forbidden.target ? `target~="${forbidden.target}"` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    check: `finding absent: {${desc}}`,
    passed: !match,
    evidence: match
      ? `Forbidden finding present: rule="${match.rule}", target="${match.target}"`
      : `Correctly absent: {${desc}}`,
  };
}

function gradeNoExtraFindings(
  actual: StructuredOutput,
  expectedRules: string[],
): GradeResult {
  const expectedNormalized = new Set(expectedRules.map((r) => r.toLowerCase().replace(/[_\- ]/g, "")));
  const extras = actual.findings.filter(
    (f: FindingOutput) => !expectedNormalized.has(f.rule.toLowerCase().replace(/[_\- ]/g, "")),
  );

  return {
    check: "no unexpected findings",
    passed: extras.length === 0,
    evidence:
      extras.length === 0
        ? `All ${actual.findings.length} findings are expected`
        : `${extras.length} unexpected: ${extras.map((f: FindingOutput) => `${f.rule}@${f.target}`).join(", ")}`,
  };
}

// --- Grade a single eval case ---

function gradeEvalCase(
  output: string,
  evalDef: EvalCase,
): { parsed: boolean; checks: GradeResult[] } {
  const structured = extractStructuredOutput(output);

  if (!structured) {
    return {
      parsed: false,
      checks: [
        {
          check: "structured output parseable",
          passed: false,
          evidence: "No valid JSON block found in model output",
        },
      ],
    };
  }

  const checks: GradeResult[] = [
    {
      check: "structured output parseable",
      passed: true,
      evidence: `Parsed: verdict="${structured.overall_verdict}", ${structured.findings.length} findings`,
    },
  ];

  const expectedJson = evalDef.expected_json;
  if (!expectedJson) {
    return { parsed: true, checks };
  }

  // Check overall verdict
  if (expectedJson.overall_verdict) {
    checks.push(gradeVerdict(structured, expectedJson.overall_verdict));
  }

  // Check expected findings present
  if (expectedJson.expected_findings) {
    for (const ef of expectedJson.expected_findings) {
      checks.push(gradeExpectedFinding(structured, ef));
    }
  }

  // Check forbidden findings absent
  if (expectedJson.forbidden_findings) {
    for (const ff of expectedJson.forbidden_findings) {
      checks.push(gradeForbiddenFinding(structured, ff));
    }
  }

  // In json_exact mode, check for unexpected findings
  if (evalDef.grading_mode === "json_exact" && expectedJson.expected_findings) {
    const expectedRules = expectedJson.expected_findings.map((f) => f.rule);
    checks.push(gradeNoExtraFindings(structured, expectedRules));
  }

  return { parsed: true, checks };
}

// --- Main: grade a benchmark directory ---

const benchmarkDir = process.argv[2];
if (!benchmarkDir) {
  console.error("Usage: npx tsx evals/grade-json.ts <benchmark-dir>");
  process.exit(1);
}

const snapshotPath = join(benchmarkDir, "evals-snapshot.json");
if (!existsSync(snapshotPath)) {
  console.error(`No evals-snapshot.json found in ${benchmarkDir}`);
  process.exit(1);
}

const evalsData = JSON.parse(readFileSync(snapshotPath, "utf-8"));
const evalsByName = new Map(evalsData.evals.map((e: EvalCase) => [e.name, e]));

const evalDirs = readdirSync(benchmarkDir).filter((d) => d.startsWith("eval-"));
const allGradings: GradingReport[] = [];
let skippedInvalid = 0;

for (const evalDirName of evalDirs.sort()) {
  const evalName = evalDirName.replace(/^eval-\d+-/, "");
  const evalDef = evalsByName.get(evalName) as EvalCase | undefined;
  if (!evalDef) {
    console.warn(`Skipping ${evalDirName}: no matching eval in evals.json`);
    continue;
  }

  // Only grade evals that have expected_json
  if (!evalDef.expected_json) {
    continue;
  }

  const evalDir = join(benchmarkDir, evalDirName);
  const configDirs = readdirSync(evalDir).filter((d) => d.startsWith("with") || d.startsWith("without"));

  for (const configDir of configDirs) {
    const configPath = join(evalDir, configDir);
    const runDirs = readdirSync(configPath).filter((d) => d.startsWith("run-"));

    for (const runDir of runDirs.sort()) {
      const runPath = join(configPath, runDir);
      const outputPath = join(runPath, "output.md");
      const timingPath = join(runPath, "timing.json");

      if (!existsSync(outputPath)) continue;

      const timing = existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, "utf-8")) : {};
      if (timing.valid === false) {
        skippedInvalid++;
        continue;
      }

      const output = readFileSync(outputPath, "utf-8");
      const { parsed, checks } = gradeEvalCase(output, evalDef);

      const passedCount = checks.filter((c) => c.passed).length;
      const report: GradingReport = {
        eval_id: evalDef.id,
        eval_name: evalDef.name,
        configuration: configDir,
        run_number: Number.parseInt(runDir.replace("run-", "")),
        structured_output_parsed: parsed,
        checks,
        summary: {
          passed: passedCount,
          failed: checks.length - passedCount,
          total: checks.length,
          pass_rate: checks.length > 0 ? passedCount / checks.length : 0,
        },
        duration_ms: timing.duration_ms ?? 0,
        output_chars: output.length,
      };

      writeFileSync(join(runPath, "grading-json.json"), JSON.stringify(report, null, 2));
      allGradings.push(report);

      const pct = Math.round(report.summary.pass_rate * 100);
      const parseTag = parsed ? "" : " [NO JSON]";
      console.log(
        `${evalDirName} | ${configDir} | ${runDir} — ${pct}% (${report.summary.passed}/${report.summary.total})${parseTag}`,
      );
    }
  }
}

if (skippedInvalid > 0) {
  console.log(`\nSkipped ${skippedInvalid} invalid runs.`);
}

if (allGradings.length === 0) {
  console.log("\nNo evals with expected_json found. Use grade-output.ts for prose-mode evals.");
  process.exit(0);
}

// --- Aggregate ---
const parseRate = allGradings.filter((g) => g.structured_output_parsed).length / allGradings.length;
const overallPassRate =
  allGradings.reduce((sum, g) => sum + g.summary.pass_rate, 0) / allGradings.length;

console.log(`\n${"=".repeat(70)}`);
console.log("JSON GRADING SUMMARY");
console.log("=".repeat(70));
console.log(`Total graded: ${allGradings.length}`);
console.log(`JSON parse rate: ${(parseRate * 100).toFixed(1)}%`);
console.log(`Overall pass rate: ${(overallPassRate * 100).toFixed(1)}%`);

writeFileSync(
  join(benchmarkDir, "grading-json-summary.json"),
  JSON.stringify(
    {
      total_graded: allGradings.length,
      skipped_invalid: skippedInvalid,
      json_parse_rate: parseRate,
      overall_pass_rate: overallPassRate,
      per_eval: allGradings,
    },
    null,
    2,
  ),
);
