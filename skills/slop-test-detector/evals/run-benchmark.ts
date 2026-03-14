/**
 * Benchmark runner — executes eval prompts through Claude with and without
 * the skill available, saves raw outputs and timing to disk.
 *
 * with_skill:    runs from the project root (skills installed via .claude/)
 * without_skill: runs from a temp directory (no skills available)
 *
 * Usage:
 *   npx tsx evals/run-benchmark.ts                    # all evals, both configs
 *   npx tsx evals/run-benchmark.ts --ids 1,4,10       # specific evals
 *   npx tsx evals/run-benchmark.ts --config with_skill # one config only
 *   npx tsx evals/run-benchmark.ts --runs 3            # override run count
 *
 * Output: benchmarks/YYYY-MM-DDTHH-MM-SS/
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// --- Parse args ---
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const skillDir = resolve(import.meta.dirname, "..");
const projectRoot = resolve(skillDir, "../..");
const evalsPath = join(import.meta.dirname, "evals.json");
const evalsData = JSON.parse(readFileSync(evalsPath, "utf-8"));

const requestedIds = getArg("ids")?.split(",").map(Number);
const requestedConfig = getArg("config") as "with_skill" | "without_skill" | undefined;
const runsPerConfig = Number(getArg("runs") ?? evalsData.benchmark_config.runs_per_configuration);
const model = getArg("model") ?? evalsData.benchmark_config.model;

const evalsToRun = requestedIds
  ? evalsData.evals.filter((e: { id: number }) => requestedIds.includes(e.id))
  : evalsData.evals;

const configs: Array<"with_skill" | "without_skill"> = requestedConfig
  ? [requestedConfig]
  : ["with_skill", "without_skill"];

// --- Create output directory ---
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const benchmarkDir = join(skillDir, "benchmarks", timestamp);
mkdirSync(benchmarkDir, { recursive: true });

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
  throw new Error("claude CLI not found. Install Claude Code first.");
}
const claudeBin = findClaude();

// --- Temp dir for without_skill runs ---
const tempDir = join("/tmp", `slop-benchmark-${timestamp}`);
mkdirSync(tempDir, { recursive: true });

// --- Run a single eval ---
interface RunResult {
  eval_id: number;
  eval_name: string;
  configuration: string;
  run_number: number;
  prompt: string;
  output: string;
  duration_ms: number;
  exit_code: number;
}

function runEval(
  evalDef: { id: number; name: string; prompt: string; files: string[] },
  config: "with_skill" | "without_skill",
  runNumber: number,
): RunResult {
  // Build prompt with fixture content inline
  const fixtureRelPath = evalDef.files[0];
  const fixturePath = join(skillDir, fixtureRelPath);
  const fixtureContent = readFileSync(fixturePath, "utf-8");
  const fixtureFilename = fixtureRelPath.split("/").pop();

  const fullPrompt = `${evalDef.prompt}\n\nFile: ${fixtureFilename}\n\`\`\`typescript\n${fixtureContent}\n\`\`\``;

  // Write prompt to temp file to avoid shell escaping issues
  const promptFile = join(tempDir, `prompt-${evalDef.id}-${config}-${runNumber}.txt`);
  writeFileSync(promptFile, fullPrompt);

  // Choose working directory
  const cwd = config === "with_skill" ? projectRoot : tempDir;

  const start = Date.now();
  let output = "";
  let exitCode = 0;

  try {
    output = execSync(
      `cat ${JSON.stringify(promptFile)} | ${JSON.stringify(claudeBin)} -p - --model ${JSON.stringify(model)} --output-format text --max-turns 3`,
      {
        cwd,
        encoding: "utf-8",
        timeout: 300_000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string };
    exitCode = execErr.status ?? 1;
    output = execErr.stdout ?? execErr.stderr ?? String(err);
  }

  const duration_ms = Date.now() - start;

  return {
    eval_id: evalDef.id,
    eval_name: evalDef.name,
    configuration: config,
    run_number: runNumber,
    prompt: fullPrompt,
    output,
    duration_ms,
    exit_code: exitCode,
  };
}

// --- Main ---
console.log(`Benchmark: ${evalsData.benchmark_question}`);
console.log(`Model: ${model}`);
console.log(`Evals: ${evalsToRun.length} | Configs: ${configs.join(", ")} | Runs/config: ${runsPerConfig}`);
console.log(`Output: ${benchmarkDir}`);
console.log(`Total runs: ${evalsToRun.length * configs.length * runsPerConfig}\n`);

const allResults: RunResult[] = [];

for (const evalDef of evalsToRun) {
  // Interleave configs per run to avoid order/latency bias.
  // Instead of [with×5, without×5], run [with, without, with, without, ...]
  // with randomized order within each pair.
  for (let run = 1; run <= runsPerConfig; run++) {
    const shuffledConfigs = [...configs].sort(() => Math.random() - 0.5);
    for (const config of shuffledConfigs) {
      const label = `eval-${String(evalDef.id).padStart(2, "0")}-${evalDef.name} | ${config} | run ${run}/${runsPerConfig}`;
      console.log(`Running: ${label}...`);

      const result = runEval(evalDef, config, run);
      allResults.push(result);

      // Save individual run artifacts
      const runDir = join(
        benchmarkDir,
        `eval-${String(evalDef.id).padStart(2, "0")}-${evalDef.name}`,
        config,
        `run-${run}`,
      );
      mkdirSync(runDir, { recursive: true });

      writeFileSync(join(runDir, "output.md"), result.output);
      writeFileSync(join(runDir, "prompt.txt"), result.prompt);
      writeFileSync(
        join(runDir, "eval_metadata.json"),
        JSON.stringify(
          {
            eval_id: evalDef.id,
            eval_name: evalDef.name,
            configuration: config,
            run_number: run,
            prompt: evalDef.prompt,
            files: evalDef.files,
            expectations: evalDef.expectations,
            duration_ms: result.duration_ms,
            exit_code: result.exit_code,
            model,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      const outputChars = result.output.length;
      const status = result.exit_code === 0 ? "OK" : `FAIL(${result.exit_code})`;
      console.log(`  ${status} — ${result.duration_ms}ms, ${outputChars} chars\n`);
    }
  }
}

// Save summary
const summary = {
  benchmark_question: evalsData.benchmark_question,
  model,
  timestamp: new Date().toISOString(),
  runs_per_configuration: runsPerConfig,
  total_runs: allResults.length,
  evals_run: evalsToRun.map((e: { id: number }) => e.id),
  configurations: configs,
  results: allResults.map((r) => ({
    eval_id: r.eval_id,
    eval_name: r.eval_name,
    configuration: r.configuration,
    run_number: r.run_number,
    duration_ms: r.duration_ms,
    exit_code: r.exit_code,
    output_chars: r.output.length,
  })),
};

writeFileSync(join(benchmarkDir, "summary.json"), JSON.stringify(summary, null, 2));

// Snapshot evals.json so regrading uses the same expectations that were used at run time
writeFileSync(join(benchmarkDir, "evals-snapshot.json"), readFileSync(evalsPath, "utf-8"));

console.log(`\nBenchmark complete. ${allResults.length} runs saved to ${benchmarkDir}`);
console.log(`Next: npx tsx evals/grade-output.ts ${benchmarkDir}`);
