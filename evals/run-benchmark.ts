/**
 * Shared benchmark runner — executes eval prompts through Claude with and without
 * the skill available, saves raw outputs and timing to disk.
 *
 * with_skill:    runs from the project root (skills installed via .claude/)
 * without_skill: runs from a temp directory (no skills available)
 *
 * Usage:
 *   npx tsx evals/run-benchmark.ts <skill-dir>                     # all evals, both configs
 *   npx tsx evals/run-benchmark.ts <skill-dir> --ids 1,4,10        # specific evals
 *   npx tsx evals/run-benchmark.ts <skill-dir> --config with_skill # one config only
 *   npx tsx evals/run-benchmark.ts <skill-dir> --runs 3            # override run count
 *   npx tsx evals/run-benchmark.ts <skill-dir> --model claude-sonnet-4-6
 *
 * Output: <skill-dir>/benchmarks/YYYY-MM-DDTHH-MM-SS/
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { wrapPromptForStructuredOutput } from "./prompts.ts";

// --- Parse args ---
const args = process.argv.slice(2);

const skillDirArg = args.find((a) => !a.startsWith("--"));
if (!skillDirArg) {
  console.error(
    "Usage: npx tsx evals/run-benchmark.ts <skill-dir> [--ids 1,4] [--config with_skill] [--runs 3] [--model ...]",
  );
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const skillDir = resolve(skillDirArg);
const skillName = basename(skillDir);
const projectRoot = resolve(skillDir, "../..");
const evalsDir = join(skillDir, "evals");
const evalsPath = join(evalsDir, "evals.json");

if (!existsSync(evalsPath)) {
  console.error(`No evals.json found at ${evalsPath}`);
  process.exit(1);
}

const evalsData = JSON.parse(readFileSync(evalsPath, "utf-8"));

const requestedIds = getArg("ids")?.split(",").map(Number);
const requestedConfig = getArg("config") as "with_skill" | "without_skill" | undefined;
const runsPerConfig = Number(getArg("runs") ?? evalsData.benchmark_config?.runs_per_configuration ?? 5);
const model = getArg("model") ?? evalsData.benchmark_config?.model ?? "claude-sonnet-4-6";
const includeHoldout = args.includes("--include-holdout");

const holdoutIds: number[] = evalsData.benchmark_config?.holdout_evals ?? [];

let evalsToRun: Array<{ id: number; name: string; prompt: string; files: string[] }>;
if (requestedIds) {
  // Explicit --ids always honored, even if they're holdout
  evalsToRun = evalsData.evals.filter((e: { id: number }) => requestedIds.includes(e.id));
} else if (includeHoldout || holdoutIds.length === 0) {
  evalsToRun = evalsData.evals;
} else {
  evalsToRun = evalsData.evals.filter((e: { id: number }) => !holdoutIds.includes(e.id));
  console.log(`Excluding ${holdoutIds.length} holdout evals: ${holdoutIds.join(", ")} (use --include-holdout to include)\n`);
}

const defaultConfigs: Array<"with_skill" | "without_skill"> =
  (evalsData.benchmark_config?.configurations as Array<"with_skill" | "without_skill">) ??
  ["with_skill", "without_skill"];
const configs: Array<"with_skill" | "without_skill"> = requestedConfig
  ? [requestedConfig]
  : defaultConfigs;

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
const tempDir = join("/tmp", `${skillName}-benchmark-${timestamp}`);
mkdirSync(tempDir, { recursive: true });

// --- Types ---
interface RunResult {
  eval_id: number;
  eval_name: string;
  configuration: string;
  run_number: number;
  prompt: string;
  output: string;
  valid: boolean;
  invalid_reason: string | null;
  duration_ms: number;
  duration_api_ms: number;
  exit_code: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    total_cost_usd: number;
  };
}

interface ClaudeResultEvent {
  type: "result";
  subtype: string;
  duration_ms: number;
  duration_api_ms: number;
  result: string;
  stop_reason: string;
  total_cost_usd: number;
  permission_denials: Array<{ tool_name: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

// --- Parse JSON output from claude -p --output-format json ---
function extractAssistantText(events: Array<Record<string, unknown>>): string {
  // When the result field is empty (e.g. error_max_turns), extract text
  // from assistant message content blocks in the conversation trace.
  const textParts: string[] = [];
  for (const event of events) {
    if (event.type !== "assistant") continue;
    const message = event.message as Record<string, unknown> | undefined;
    if (!message?.content) continue;
    const content = message.content as Array<Record<string, unknown>>;
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      }
    }
  }
  return textParts.join("\n\n");
}

interface ParsedOutput {
  text: string;
  result: ClaudeResultEvent | null;
  valid: boolean;
  invalid_reason: string | null;
}

function parseClaudeJsonOutput(raw: string): ParsedOutput {
  try {
    const events = JSON.parse(raw) as Array<Record<string, unknown>>;
    const resultEvent = events.find((e) => e.type === "result") as ClaudeResultEvent | undefined;
    const resultText = resultEvent?.result;

    // If result has text, use it. Otherwise, extract from assistant messages.
    const text = resultText || extractAssistantText(events) || "";

    // Validate the session completed successfully
    if (!resultEvent) {
      return { text, result: null, valid: false, invalid_reason: "no result event in response" };
    }
    if (resultEvent.subtype !== "success") {
      return { text, result: resultEvent, valid: false, invalid_reason: `result.subtype=${resultEvent.subtype}` };
    }
    if (resultEvent.permission_denials?.length > 0) {
      const tools = resultEvent.permission_denials.map((d) => d.tool_name).join(", ");
      return { text, result: resultEvent, valid: false, invalid_reason: `permission_denials: ${tools}` };
    }
    if (!text) {
      return { text: "", result: resultEvent, valid: false, invalid_reason: "no text output produced" };
    }

    return { text, result: resultEvent, valid: true, invalid_reason: null };
  } catch {
    // If JSON parsing fails, treat raw output as text
    return { text: raw, result: null, valid: false, invalid_reason: "failed to parse JSON output" };
  }
}

// --- Run a single eval ---
function runEval(
  evalDef: { id: number; name: string; prompt: string; files: string[]; grading_mode?: string },
  config: "with_skill" | "without_skill",
  runNumber: number,
): RunResult {
  // Build prompt with fixture content inline
  const fixtureRelPath = evalDef.files[0];
  const fixturePath = join(skillDir, fixtureRelPath);
  const fixtureContent = readFileSync(fixturePath, "utf-8");
  const fixtureFilename = fixtureRelPath.split("/").pop() ?? fixtureRelPath;

  // Use structured output wrapper unless grading_mode is prose_heuristic
  const useStructured = evalDef.grading_mode !== "prose_heuristic";
  const fullPrompt = useStructured
    ? wrapPromptForStructuredOutput(evalDef.prompt, fixtureFilename, fixtureContent)
    : `${evalDef.prompt}\n\nFile: ${fixtureFilename}\n\`\`\`typescript\n${fixtureContent}\n\`\`\``;

  // Write prompt to temp file to avoid shell escaping issues
  const promptFile = join(tempDir, `prompt-${evalDef.id}-${config}-${runNumber}.txt`);
  writeFileSync(promptFile, fullPrompt);

  // with_skill:    runs from the project root where .claude/skills/ is available
  // without_skill: runs from an isolated temp directory with no skill files, no repo access.
  //                Fixture content is already inlined in the prompt, so the agent has
  //                everything it needs. This prevents skill instructions from leaking
  //                via Glob/Read of SKILL.md or evals/ files.
  const cwd = config === "with_skill" ? projectRoot : tempDir;

  const start = Date.now();
  let rawOutput = "";
  let exitCode = 0;

  try {
    rawOutput = execSync(
      `cat ${JSON.stringify(promptFile)} | ${JSON.stringify(claudeBin)} -p - --model ${JSON.stringify(model)} --output-format json --max-turns 10 --permission-mode bypassPermissions --allowedTools ""`,
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
    rawOutput = execErr.stdout ?? execErr.stderr ?? String(err);
  }

  const wallDuration = Date.now() - start;

  // Parse JSON output for text + usage metrics
  const parsed = parseClaudeJsonOutput(rawOutput);
  const resultEvent = parsed.result;

  return {
    eval_id: evalDef.id,
    eval_name: evalDef.name,
    configuration: config,
    run_number: runNumber,
    prompt: fullPrompt,
    output: parsed.text,
    valid: parsed.valid,
    invalid_reason: parsed.invalid_reason,
    duration_ms: resultEvent?.duration_ms ?? wallDuration,
    duration_api_ms: resultEvent?.duration_api_ms ?? wallDuration,
    exit_code: exitCode,
    usage: {
      input_tokens: resultEvent?.usage?.input_tokens ?? 0,
      output_tokens: resultEvent?.usage?.output_tokens ?? 0,
      cache_read_input_tokens: resultEvent?.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: resultEvent?.usage?.cache_creation_input_tokens ?? 0,
      total_cost_usd: resultEvent?.total_cost_usd ?? 0,
    },
  };
}

// --- Main ---
console.log(`Benchmark: ${evalsData.benchmark_question ?? `Evaluating ${skillName}`}`);
console.log(`Skill: ${skillName}`);
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
        join(runDir, "timing.json"),
        JSON.stringify(
          {
            valid: result.valid,
            invalid_reason: result.invalid_reason,
            duration_ms: result.duration_ms,
            duration_api_ms: result.duration_api_ms,
            exit_code: result.exit_code,
            usage: result.usage,
            model,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
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
            duration_api_ms: result.duration_api_ms,
            exit_code: result.exit_code,
            usage: result.usage,
            model,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      const validity = result.valid ? "VALID" : `INVALID(${result.invalid_reason})`;
      const tokens = result.usage.input_tokens + result.usage.output_tokens;
      const cost = result.usage.total_cost_usd > 0 ? ` $${result.usage.total_cost_usd.toFixed(4)}` : "";
      console.log(`  ${validity} — ${result.duration_ms}ms, ${tokens} tokens${cost}\n`);
    }
  }
}

// Save summary
const validCount = allResults.filter((r) => r.valid).length;
const invalidCount = allResults.length - validCount;
if (invalidCount > 0) {
  console.log(`\nWARNING: ${invalidCount}/${allResults.length} runs were INVALID and will be excluded from grading.`);
  for (const r of allResults.filter((r) => !r.valid)) {
    console.log(`  eval-${r.eval_id}-${r.eval_name} | ${r.configuration} | run ${r.run_number}: ${r.invalid_reason}`);
  }
}

const summary = {
  skill_name: skillName,
  benchmark_question: evalsData.benchmark_question,
  model,
  timestamp: new Date().toISOString(),
  runs_per_configuration: runsPerConfig,
  total_runs: allResults.length,
  valid_runs: validCount,
  invalid_runs: invalidCount,
  evals_run: evalsToRun.map((e: { id: number }) => e.id),
  configurations: configs,
  results: allResults.map((r) => ({
    eval_id: r.eval_id,
    eval_name: r.eval_name,
    configuration: r.configuration,
    run_number: r.run_number,
    valid: r.valid,
    invalid_reason: r.invalid_reason,
    duration_ms: r.duration_ms,
    duration_api_ms: r.duration_api_ms,
    exit_code: r.exit_code,
    usage: r.usage,
    output_chars: r.output.length,
  })),
};

writeFileSync(join(benchmarkDir, "summary.json"), JSON.stringify(summary, null, 2));

// Snapshot evals.json so regrading uses the same expectations that were used at run time
writeFileSync(join(benchmarkDir, "evals-snapshot.json"), readFileSync(evalsPath, "utf-8"));

console.log(`\nBenchmark complete. ${allResults.length} runs saved to ${benchmarkDir}`);
console.log(`Next: npx tsx evals/grade-output.ts ${benchmarkDir}`);
