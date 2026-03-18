/**
 * Prompt wrappers for structured output (R2).
 *
 * Wraps eval prompts to request JSON output from the model, then extracts
 * the structured response for deterministic grading.
 */

import type { StructuredOutput } from "./schema.ts";

/**
 * Wraps a skill eval prompt to request structured JSON output.
 * The model should return a JSON block that conforms to StructuredOutput.
 */
export function wrapPromptForStructuredOutput(
  basePrompt: string,
  fixtureFilename: string,
  fixtureContent: string,
): string {
  return `${basePrompt}

File: ${fixtureFilename}
\`\`\`typescript
${fixtureContent}
\`\`\`

IMPORTANT: Return your analysis as a JSON code block with this exact structure:

\`\`\`json
{
  "summary": "one-line summary of findings",
  "overall_verdict": "clean|unsafe|breaking|safe|mixed",
  "findings": [
    {
      "rule": "pattern_name",
      "target": "test or field name where found",
      "severity": "must-fail|should-fail|breaking|safe",
      "line": 0,
      "reason": "why this is an issue"
    }
  ]
}
\`\`\`

If the file is clean (no issues found), return:
\`\`\`json
{
  "summary": "No issues found",
  "overall_verdict": "clean",
  "findings": []
}
\`\`\`

You may include prose explanation AFTER the JSON block, but the JSON block must come first.`;
}

/**
 * Extracts a StructuredOutput JSON block from model response text.
 * Returns null if no valid JSON block found.
 */
export function extractStructuredOutput(text: string): StructuredOutput | null {
  // Try to find a JSON code block
  const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      return parseAndValidate(jsonBlockMatch[1]);
    } catch {
      // fall through to other strategies
    }
  }

  // Try to find a raw JSON object (no code fences)
  const jsonMatch = text.match(/\{[\s\S]*"overall_verdict"[\s\S]*"findings"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return parseAndValidate(jsonMatch[0]);
    } catch {
      // fall through
    }
  }

  return null;
}

function parseAndValidate(raw: string): StructuredOutput {
  const parsed = JSON.parse(raw);

  // Validate required fields
  if (typeof parsed.summary !== "string") throw new Error("missing summary");
  if (typeof parsed.overall_verdict !== "string") throw new Error("missing overall_verdict");
  if (!Array.isArray(parsed.findings)) throw new Error("missing findings array");

  // Validate each finding
  for (const f of parsed.findings) {
    if (typeof f.rule !== "string") throw new Error("finding missing rule");
    if (typeof f.target !== "string") throw new Error("finding missing target");
    if (typeof f.severity !== "string") throw new Error("finding missing severity");
    if (typeof f.reason !== "string") throw new Error("finding missing reason");
  }

  return parsed as StructuredOutput;
}
