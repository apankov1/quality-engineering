/**
 * Migration script: adds split, eval_type, grading_mode, expected_json
 * to existing evals.json files. Removes prompt_design (dead field).
 *
 * Usage: npx tsx evals/migrate-evals-json.ts <skill-dir>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const skillDir = resolve(process.argv[2]);
if (!skillDir) {
  console.error("Usage: npx tsx evals/migrate-evals-json.ts <skill-dir>");
  process.exit(1);
}

const evalsPath = join(skillDir, "evals", "evals.json");
const data = JSON.parse(readFileSync(evalsPath, "utf-8"));

// Read holdout list from benchmark_config
const holdoutIds: number[] = data.benchmark_config?.holdout_evals ?? [];

// Remove dead top-level fields
delete data.prompt_design;

for (const eval_ of data.evals) {
  // --- Add split ---
  if (!eval_.split) {
    if (holdoutIds.includes(eval_.id)) {
      eval_.split = "holdout";
    } else {
      eval_.split = "dev";
    }
  }

  // --- Add eval_type ---
  if (!eval_.eval_type) {
    eval_.eval_type = "forced_skill_quality";
  }

  // --- Add grading_mode ---
  if (!eval_.grading_mode) {
    eval_.grading_mode = "json_contains";
  }

  // --- Build expected_json from ground_truth ---
  if (!eval_.expected_json && eval_.ground_truth) {
    const gt = eval_.ground_truth;
    const expectedFindings: Array<{ rule: string; severity?: string }> = [];
    const forbiddenFindings: Array<{ rule: string; target?: string }> = [];

    // Determine verdict
    let verdict: string;
    if (gt.expected_rules && gt.expected_rules.length === 0) {
      verdict = "clean";
    } else if (gt.all_safe === true) {
      verdict = "safe";
    } else if (gt.all_breaking === true) {
      verdict = "breaking";
    } else if (gt.safe === false || (gt.must_fail_count && gt.must_fail_count > 0)) {
      verdict = "unsafe";
    } else {
      verdict = "mixed";
    }

    // Build expected findings from expected_rules
    if (gt.expected_rules) {
      for (const rule of gt.expected_rules) {
        const severity =
          gt.must_fail_count && gt.must_fail_count > 0
            ? undefined  // don't guess severity per rule — let the grader be flexible
            : undefined;
        expectedFindings.push({ rule, ...(severity ? { severity } : {}) });
      }
    }

    // Build forbidden findings from forbidden_rules_on_clean_tests
    if (gt.forbidden_rules_on_clean_tests) {
      for (const target of gt.forbidden_rules_on_clean_tests) {
        // These are test names that should NOT be flagged
        forbiddenFindings.push({ rule: "*", target });
      }
    }

    eval_.expected_json = {
      overall_verdict: verdict,
      ...(expectedFindings.length > 0 ? { expected_findings: expectedFindings } : {}),
      ...(forbiddenFindings.length > 0 ? { forbidden_findings: forbiddenFindings } : {}),
    };
  }

  // --- Remove expected_output (dead field, was documentation-only) ---
  delete eval_.expected_output;
}

writeFileSync(evalsPath, JSON.stringify(data, null, 2) + "\n");
console.log(`Migrated ${data.evals.length} evals in ${evalsPath}`);

// Print summary
for (const eval_ of data.evals) {
  console.log(`  ${eval_.id}: ${eval_.name} — split=${eval_.split}, type=${eval_.eval_type}, grading=${eval_.grading_mode}, verdict=${eval_.expected_json?.overall_verdict ?? "?"}`);
}
