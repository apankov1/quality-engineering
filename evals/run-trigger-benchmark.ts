/**
 * Trigger benchmark — measures whether the model invokes the right skill
 * on the right prompts (precision/recall/false-trigger rate).
 *
 * Sends each query from trigger-eval-set.json through claude -p from the
 * project root (all skills loaded) and checks if the target skill was invoked.
 *
 * Usage:
 *   npx tsx evals/run-trigger-benchmark.ts <skill-dir>
 *   npx tsx evals/run-trigger-benchmark.ts <skill-dir> --runs 3
 *   npx tsx evals/run-trigger-benchmark.ts <skill-dir> --model claude-sonnet-4-6
 *
 * Output: <skill-dir>/benchmarks/trigger-<timestamp>/
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const skillDirArg = args.find((a) => !a.startsWith("--"));

if (!skillDirArg) {
  console.error("Usage: npx tsx evals/run-trigger-benchmark.ts <skill-dir> [--runs N] [--model ...]");
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const skillDir = resolve(skillDirArg);
const skillName = basename(skillDir);
const projectRoot = resolve(skillDir, "../..");
const triggerPath = join(skillDir, "evals", "trigger-eval-set.json");

if (!existsSync(triggerPath)) {
  console.error(`No trigger-eval-set.json found at ${triggerPath}`);
  process.exit(1);
}

const queries: Array<{ query: string; should_trigger: boolean }> = JSON.parse(
  readFileSync(triggerPath, "utf-8"),
);

const runsPerQuery = Number(getArg("runs") ?? 1);
const model = getArg("model") ?? "claude-sonnet-4-6";

// --- Resolve claude binary ---
function findClaude(): string {
  try {
    const which = execSync("which claude 2>/dev/null || echo ''", { encoding: "utf-8" }).trim();
    if (which) return which;
  } catch {
    // fall through
  }
  const localPath = join(process.env.HOME ?? "", ".claude/local/claude");
  if (existsSync(localPath)) return localPath;
  throw new Error("claude CLI not found.");
}
const claudeBin = findClaude();

// --- Output dir ---
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outputDir = join(skillDir, "benchmarks", `trigger-${timestamp}`);
mkdirSync(outputDir, { recursive: true });

// --- Check if skill was invoked ---
function checkSkillInvoked(jsonOutput: string, targetSkill: string): boolean {
  try {
    const events = JSON.parse(jsonOutput) as Array<Record<string, unknown>>;
    for (const event of events) {
      if (event.type !== "assistant") continue;
      const message = event.message as Record<string, unknown> | undefined;
      if (!message?.content) continue;
      const content = message.content as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown> | undefined;
          // Check if Skill tool was called with our skill name
          if (
            block.name === "Skill" &&
            typeof input?.skill === "string" &&
            input.skill.toLowerCase().includes(targetSkill.toLowerCase())
          ) {
            return true;
          }
        }
      }
    }
    // Also check if the skill appeared in a system/user synthetic message (skill loading)
    for (const event of events) {
      if (event.type !== "user") continue;
      const message = event.message as Record<string, unknown> | undefined;
      if (!message?.content) continue;
      const content = message.content as Array<Record<string, unknown>>;
      for (const block of content) {
        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.includes(`Launching skill: ${targetSkill}`)
        ) {
          return true;
        }
      }
    }
  } catch {
    // parse failure
  }
  return false;
}

// --- Run ---
console.log(`Trigger benchmark: ${skillName}`);
console.log(`Model: ${model}`);
console.log(`Queries: ${queries.length} | Runs/query: ${runsPerQuery}`);
console.log(`Output: ${outputDir}\n`);

interface TriggerResult {
  query: string;
  should_trigger: boolean;
  triggered: boolean;
  correct: boolean;
  run: number;
  duration_ms: number;
}

const allResults: TriggerResult[] = [];
const tempDir = join("/tmp", `trigger-${skillName}-${timestamp}`);
mkdirSync(tempDir, { recursive: true });

for (let qi = 0; qi < queries.length; qi++) {
  const q = queries[qi];
  for (let run = 1; run <= runsPerQuery; run++) {
    const label = `[${qi + 1}/${queries.length}] run ${run} | should=${q.should_trigger} | ${q.query.slice(0, 60)}...`;
    process.stdout.write(`${label} `);

    const promptFile = join(tempDir, `query-${qi}-${run}.txt`);
    writeFileSync(promptFile, q.query);

    const start = Date.now();
    let rawOutput = "";
    try {
      rawOutput = execSync(
        `cat ${JSON.stringify(promptFile)} | ${JSON.stringify(claudeBin)} -p - --model ${JSON.stringify(model)} --output-format json --max-turns 3`,
        {
          cwd: projectRoot,
          encoding: "utf-8",
          timeout: 120_000,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (err: unknown) {
      const execErr = err as { stdout?: string };
      rawOutput = execErr.stdout ?? "";
    }
    const duration = Date.now() - start;

    const triggered = checkSkillInvoked(rawOutput, skillName);
    const correct = triggered === q.should_trigger;

    const result: TriggerResult = {
      query: q.query,
      should_trigger: q.should_trigger,
      triggered,
      correct,
      run,
      duration_ms: duration,
    };
    allResults.push(result);

    const symbol = correct ? "CORRECT" : "WRONG";
    const trigLabel = triggered ? "triggered" : "no-trigger";
    console.log(`→ ${trigLabel} ${symbol} (${duration}ms)`);
  }
}

// --- Metrics ---
const shouldTrigger = allResults.filter((r) => r.should_trigger);
const shouldNotTrigger = allResults.filter((r) => !r.should_trigger);

const truePositives = shouldTrigger.filter((r) => r.triggered).length;
const falseNegatives = shouldTrigger.filter((r) => !r.triggered).length;
const trueNegatives = shouldNotTrigger.filter((r) => !r.triggered).length;
const falsePositives = shouldNotTrigger.filter((r) => r.triggered).length;

const precision = truePositives + falsePositives > 0
  ? truePositives / (truePositives + falsePositives)
  : 0;
const recall = truePositives + falseNegatives > 0
  ? truePositives / (truePositives + falseNegatives)
  : 0;
const f1 = precision + recall > 0
  ? (2 * precision * recall) / (precision + recall)
  : 0;
const accuracy = allResults.filter((r) => r.correct).length / allResults.length;
const falseTriggerRate = shouldNotTrigger.length > 0
  ? falsePositives / shouldNotTrigger.length
  : 0;

const sep = "=".repeat(60);
console.log(`\n${sep}`);
console.log("TRIGGER BENCHMARK RESULTS");
console.log(sep);
console.log(`Skill: ${skillName}`);
console.log(`Total queries: ${allResults.length}`);
console.log(`\nConfusion matrix:`);
console.log(`  True positives:  ${truePositives}`);
console.log(`  False negatives: ${falseNegatives}`);
console.log(`  True negatives:  ${trueNegatives}`);
console.log(`  False positives: ${falsePositives}`);
console.log(`\nMetrics:`);
console.log(`  Precision:         ${(precision * 100).toFixed(1)}%`);
console.log(`  Recall:            ${(recall * 100).toFixed(1)}%`);
console.log(`  F1:                ${(f1 * 100).toFixed(1)}%`);
console.log(`  Accuracy:          ${(accuracy * 100).toFixed(1)}%`);
console.log(`  False trigger rate: ${(falseTriggerRate * 100).toFixed(1)}%`);

// --- Save results ---
const summary = {
  skill_name: skillName,
  model,
  timestamp: new Date().toISOString(),
  queries_total: allResults.length,
  runs_per_query: runsPerQuery,
  confusion_matrix: { truePositives, falseNegatives, trueNegatives, falsePositives },
  metrics: { precision, recall, f1, accuracy, falseTriggerRate },
  results: allResults,
};

writeFileSync(join(outputDir, "trigger-results.json"), JSON.stringify(summary, null, 2));
console.log(`\nResults saved to ${outputDir}/trigger-results.json`);

// --- Per-query breakdown for failures ---
const failures = allResults.filter((r) => !r.correct);
if (failures.length > 0) {
  console.log(`\nFailed queries (${failures.length}):`);
  for (const f of failures) {
    const expected = f.should_trigger ? "should trigger" : "should NOT trigger";
    const actual = f.triggered ? "triggered" : "did not trigger";
    console.log(`  ${expected} but ${actual}: "${f.query.slice(0, 80)}"`);
  }
}
