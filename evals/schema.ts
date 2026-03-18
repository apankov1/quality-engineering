/**
 * Shared eval dataset schema — defines the structure for all eval cases
 * across all skills. Every eval case must conform to this schema.
 *
 * This replaces the ad-hoc evals.json format with typed, enforceable structure.
 */

// --- Eval splits ---
// dev:          used during skill iteration — ok to overfit
// holdout:      excluded from iteration, run only during final benchmark
// adversarial:  edge cases designed to break the skill (false positive traps, ambiguous inputs)
export type EvalSplit = "dev" | "holdout" | "adversarial";

// --- Eval types (P2 separation) ---
// analyzer_regression:   tests the underlying function directly (no model involved)
// forced_skill_quality:  same prompt ± skill, measures conditional lift
// routing_trigger:       does the model invoke the right skill?
// blind_e2e:             realistic prompt, no forcing, full system
export type EvalType =
  | "analyzer_regression"
  | "forced_skill_quality"
  | "routing_trigger"
  | "blind_e2e";

// --- Grading mode ---
// json_exact:     parse structured JSON output, exact field matching
// json_contains:  parse structured JSON output, check subset of fields
// deterministic:  run a grading function (no model, no regex)
// prose_heuristic: legacy regex/keyword matching over freeform text (fallback only)
export type GradingMode =
  | "json_exact"
  | "json_contains"
  | "deterministic"
  | "prose_heuristic";

// --- Structured output contract (R2) ---
// Skills that support structured output return this shape.
// The prompt wrapper requests JSON; grading operates on parsed fields.

export interface FindingOutput {
  rule: string;
  target: string;
  severity: string;
  line?: number;
  reason: string;
}

export interface StructuredOutput {
  summary: string;
  overall_verdict: "clean" | "unsafe" | "breaking" | "safe" | "mixed";
  findings: FindingOutput[];
}

// --- Eval case schema (R1) ---

export interface EvalCase {
  id: number;
  name: string;
  skill_name: string;
  split: EvalSplit;
  eval_type: EvalType;
  tags: string[];
  prompt: string;
  fixtures: string[];             // relative paths from skill dir
  grading_mode: GradingMode;

  // For forced_skill_quality and blind_e2e:
  // What the correct structured output looks like
  expected_json?: {
    overall_verdict: string;
    expected_findings?: Array<{
      rule: string;
      target?: string;
      severity?: string;
    }>;
    forbidden_findings?: Array<{
      rule: string;
      target?: string;
    }>;
  };

  // For routing_trigger:
  skill_expected?: boolean;       // should this skill trigger?

  // Legacy prose expectations (kept for backward compat, used when grading_mode = prose_heuristic)
  expectations?: string[];

  // Human-readable description of what correct output looks like (documentation only, never machine-checked)
  expected_output?: string;

  // Machine-checkable ground truth for analyzer regression
  ground_truth?: Record<string, unknown>;
}

// --- Benchmark config ---

export interface BenchmarkConfig {
  runs_per_configuration: number;
  configurations: Array<"with_skill" | "without_skill">;
  holdout_evals: number[];
  model: string;
}

// --- Full eval dataset ---

export interface EvalDataset {
  skill_name: string;
  benchmark_question: string;
  evals: EvalCase[];
  benchmark_config: BenchmarkConfig;
}

// --- Eval version hash (R10) ---

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function computeEvalVersion(skillDir: string, dataset: EvalDataset): string {
  const hash = createHash("sha256");

  // Hash the evals.json content
  const evalsPath = join(skillDir, "evals", "evals.json");
  hash.update(readFileSync(evalsPath, "utf-8"));

  // Hash each fixture file
  const fixtureFiles = new Set<string>();
  for (const eval_ of dataset.evals) {
    for (const f of eval_.fixtures) {
      fixtureFiles.add(f);
    }
  }
  for (const f of [...fixtureFiles].sort()) {
    const fullPath = join(skillDir, f);
    try {
      hash.update(readFileSync(fullPath, "utf-8"));
    } catch {
      hash.update(`MISSING:${f}`);
    }
  }

  return hash.digest("hex").slice(0, 16);
}

// --- Cost budget (R9) ---

export interface CostBudget {
  max_per_run_usd: number;
  max_per_skill_usd: number;
  max_total_usd: number;
}

export const DEFAULT_COST_BUDGET: CostBudget = {
  max_per_run_usd: 0.50,
  max_per_skill_usd: 15.00,
  max_total_usd: 50.00,
};

export const CI_PR_COST_BUDGET: CostBudget = {
  max_per_run_usd: 0.50,
  max_per_skill_usd: 3.00,
  max_total_usd: 5.00,
};
