/**
 * Local eval suite runner — runs the full pipeline for one or all skills:
 *
 *   1. Pre-flight: grader unit tests
 *   2. Pre-flight: fixture ground truth check
 *   3. Benchmark: run with_skill vs without_skill
 *   4. Grade: structured JSON grading (with prose fallback)
 *   5. Report: summary to stdout
 *
 * Usage:
 *   npx tsx evals/run-suite.ts skills/slop-test-detector          # one skill
 *   npx tsx evals/run-suite.ts skills/slop-test-detector --runs 3  # override runs
 *   npx tsx evals/run-suite.ts skills/slop-test-detector --dev-only # dev split only (skip holdout)
 *   npx tsx evals/run-suite.ts skills/slop-test-detector --ids 1,2,7  # specific evals
 *   npx tsx evals/run-suite.ts --all --runs 1                     # all skills, quick
 *
 * Exit: 0 if all pre-flights pass and benchmark completes, 1 otherwise.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const runAll = args.includes("--all");
const skillDirArg = args.find((a) => !a.startsWith("--"));

if (!runAll && !skillDirArg) {
  console.error("Usage: npx tsx evals/run-suite.ts <skill-dir> [--runs N] [--dev-only] [--ids 1,2,3]");
  console.error("       npx tsx evals/run-suite.ts --all [--runs N]");
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const runsOverride = getArg("runs");
const idsOverride = getArg("ids");
const devOnly = args.includes("--dev-only");

// --- Resolve skill directories ---
function findSkillDirs(): string[] {
  if (!runAll && skillDirArg) {
    return [resolve(skillDirArg)];
  }
  const skillsRoot = resolve("skills");
  if (!existsSync(skillsRoot)) {
    console.error("No skills/ directory found");
    process.exit(1);
  }
  return readdirSync(skillsRoot)
    .map((d) => join(skillsRoot, d))
    .filter((d) => existsSync(join(d, "evals", "evals.json")));
}

const skillDirs = findSkillDirs();
if (skillDirs.length === 0) {
  console.error("No skills with evals.json found");
  process.exit(1);
}

const sep = "=".repeat(70);

function run(cmd: string, label: string): { ok: boolean; output: string } {
  console.log(`\n${label}...`);
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 600_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    const output = (execErr.stdout ?? "") + (execErr.stderr ?? "");
    return { ok: false, output };
  }
}

// ============================================================
// Step 1: Grader pre-flight
// ============================================================
console.log(sep);
console.log("STEP 1: Grader unit tests");
console.log(sep);

const graderResult = run("npx tsx evals/test-grader.ts", "Running grader tests");
const graderLine = graderResult.output.split("\n").find((l) => l.includes("passed"));
console.log(graderLine ?? graderResult.output.slice(-200));

if (!graderResult.ok) {
  console.error("\nGrader tests FAILED. Fix the grader before running benchmarks.");
  process.exit(1);
}

// ============================================================
// Per-skill pipeline
// ============================================================
const results: Array<{
  skill: string;
  preflight: boolean;
  benchmark_dir: string | null;
  valid_runs: number;
  invalid_runs: number;
  with_skill_pass_rate: number;
  without_skill_pass_rate: number;
  delta: number;
  cost_usd: number;
}> = [];

for (const skillDir of skillDirs) {
  const skillName = basename(skillDir);

  console.log(`\n${sep}`);
  console.log(`SKILL: ${skillName}`);
  console.log(sep);

  // ============================================================
  // Step 2: Fixture pre-flight
  // ============================================================
  const checkScript = join(skillDir, "evals", "check-ground-truth.ts");
  if (existsSync(checkScript)) {
    const pfResult = run(`npx tsx ${checkScript}`, `Step 2: Fixture pre-flight (${skillName})`);
    const pfLine = pfResult.output.split("\n").find((l) => l.includes("TOTAL:") || l.includes("SUMMARY:"));
    console.log(pfLine ?? pfResult.output.slice(-200));

    if (!pfResult.ok) {
      console.error(`\nFixture pre-flight FAILED for ${skillName}. Skipping benchmark.`);
      results.push({
        skill: skillName,
        preflight: false,
        benchmark_dir: null,
        valid_runs: 0,
        invalid_runs: 0,
        with_skill_pass_rate: 0,
        without_skill_pass_rate: 0,
        delta: 0,
        cost_usd: 0,
      });
      continue;
    }
  }

  // ============================================================
  // Step 3: Run benchmark
  // ============================================================
  const runArgs = [
    `npx tsx evals/run-benchmark.ts ${skillDir}`,
    runsOverride ? `--runs ${runsOverride}` : "",
    idsOverride ? `--ids ${idsOverride}` : "",
    devOnly ? "" : "--include-holdout",
  ]
    .filter(Boolean)
    .join(" ");

  const bmResult = run(runArgs, `Step 3: Benchmark (${skillName})`);

  // Extract benchmark dir from output
  const dirMatch = bmResult.output.match(/Output: (.+)/);
  const benchmarkDir = dirMatch ? dirMatch[1].trim() : null;

  if (!bmResult.ok || !benchmarkDir) {
    console.error(`\nBenchmark FAILED for ${skillName}.`);
    console.error(bmResult.output.slice(-500));
    results.push({
      skill: skillName,
      preflight: true,
      benchmark_dir: null,
      valid_runs: 0,
      invalid_runs: 0,
      with_skill_pass_rate: 0,
      without_skill_pass_rate: 0,
      delta: 0,
      cost_usd: 0,
    });
    continue;
  }

  // Print run validity summary
  const validLine = bmResult.output.split("\n").find((l) => l.includes("INVALID"));
  if (validLine) console.log(validLine);

  // ============================================================
  // Step 4: Grade (JSON first, prose fallback)
  // ============================================================
  const jsonGradeResult = run(
    `npx tsx evals/grade-json.ts ${benchmarkDir}`,
    `Step 4a: JSON grade (${skillName})`,
  );
  if (jsonGradeResult.ok) {
    const parseLine = jsonGradeResult.output.split("\n").find((l) => l.includes("parse rate"));
    if (parseLine) console.log(parseLine);
  }

  const gradeResult = run(
    `npx tsx evals/grade-output.ts ${benchmarkDir}`,
    `Step 4b: Prose grade (${skillName})`,
  );

  // Extract aggregate results
  const deltaMatch = gradeResult.output.match(/Pass rate: ([+-][\d.]+) percentage/);
  const delta = deltaMatch ? Number.parseFloat(deltaMatch[1]) : 0;

  // Parse benchmark.json for structured results
  let withRate = 0;
  let withoutRate = 0;
  let totalCost = 0;
  let validRuns = 0;
  let invalidRuns = 0;

  try {
    const benchmarkJson = JSON.parse(
      readFileSync(join(benchmarkDir, "benchmark.json"), "utf-8"),
    );
    withRate = benchmarkJson.config_summary?.with_skill?.pass_rate?.mean ?? 0;
    withoutRate = benchmarkJson.config_summary?.without_skill?.pass_rate?.mean ?? 0;
    totalCost =
      (benchmarkJson.config_summary?.with_skill?.cost_usd?.total ?? 0) +
      (benchmarkJson.config_summary?.without_skill?.cost_usd?.total ?? 0);
  } catch {
    // parse the summary instead
  }

  try {
    const summaryJson = JSON.parse(
      readFileSync(join(benchmarkDir, "summary.json"), "utf-8"),
    );
    validRuns = summaryJson.valid_runs ?? summaryJson.total_runs ?? 0;
    invalidRuns = summaryJson.invalid_runs ?? 0;
  } catch {
    // ok
  }

  // Print grade summary (last ~15 lines)
  const gradeLines = gradeResult.output.split("\n");
  const aggStart = gradeLines.findIndex((l) => l.includes("AGGREGATE"));
  if (aggStart >= 0) {
    console.log(gradeLines.slice(aggStart).join("\n"));
  }

  results.push({
    skill: skillName,
    preflight: true,
    benchmark_dir: benchmarkDir,
    valid_runs: validRuns,
    invalid_runs: invalidRuns,
    with_skill_pass_rate: withRate,
    without_skill_pass_rate: withoutRate,
    delta,
    cost_usd: totalCost,
  });
}

// ============================================================
// Step 5: Final report
// ============================================================
console.log(`\n${sep}`);
console.log("SUITE RESULTS");
console.log(sep);

console.log(`\n${"Skill".padEnd(30)} ${"Pre".padEnd(5)} ${"Valid".padEnd(6)} ${"Inv".padEnd(5)} ${"With".padEnd(8)} ${"W/o".padEnd(8)} ${"Delta".padEnd(8)} Cost`);
console.log("-".repeat(90));

for (const r of results) {
  const pf = r.preflight ? "OK" : "FAIL";
  const ws = r.with_skill_pass_rate > 0 ? `${(r.with_skill_pass_rate * 100).toFixed(1)}%` : "-";
  const wo = r.without_skill_pass_rate > 0 ? `${(r.without_skill_pass_rate * 100).toFixed(1)}%` : "-";
  const d = r.delta !== 0 ? `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)}%` : "-";
  const cost = r.cost_usd > 0 ? `$${r.cost_usd.toFixed(2)}` : "-";
  console.log(
    `${r.skill.padEnd(30)} ${pf.padEnd(5)} ${String(r.valid_runs).padEnd(6)} ${String(r.invalid_runs).padEnd(5)} ${ws.padEnd(8)} ${wo.padEnd(8)} ${d.padEnd(8)} ${cost}`,
  );
}

const totalCost = results.reduce((s, r) => s + r.cost_usd, 0);
const anyFailed = results.some((r) => !r.preflight);
console.log(`\nTotal cost: $${totalCost.toFixed(2)}`);

if (anyFailed) {
  console.error("\nSome skills failed pre-flight. See above.");
  process.exit(1);
}
