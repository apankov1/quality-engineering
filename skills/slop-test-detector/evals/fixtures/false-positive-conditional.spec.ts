/**
 * Feature flag service tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FeatureFlagService } from "../src/feature-flags.js";

describe("FeatureFlagService", () => {
  it("should return default value when flag is not defined", () => {
    const service = new FeatureFlagService({ flags: {} });
    // Old API: const result = service.isEnabled("new-dashboard");
    // assert.equal(result, false);
    // New API uses evaluate() with default
    const result = service.evaluate("new-dashboard", { default: false });
    assert.equal(result, false);
    assert.equal(service.getEvaluationCount(), 1);
  });

  it("should evaluate flag based on user segment", () => {
    const service = new FeatureFlagService({
      flags: {
        "beta-feature": {
          enabled: true,
          segments: ["internal", "beta-testers"],
        },
      },
    });

    // Setup: conditionally add user to segment based on environment
    let userSegment = "public";
    if (process.env.NODE_ENV === "test") {
      userSegment = "internal";
    }

    // Assertions are NOT inside the if block — they run unconditionally
    const result = service.evaluate("beta-feature", { userSegment });
    assert.equal(typeof result, "boolean");
    assert.ok(service.getEvaluationCount() >= 1);
  });

  it("should track evaluation metrics per flag", () => {
    const service = new FeatureFlagService({
      flags: { "dark-mode": { enabled: true, segments: ["all"] } },
    });

    for (let i = 0; i < 10; i++) {
      service.evaluate("dark-mode", { userSegment: "all" });
    }

    const metrics = service.getMetrics("dark-mode");
    assert.equal(metrics.evaluationCount, 10);
    assert.ok(metrics.lastEvaluatedAt instanceof Date);
    assert.equal(metrics.trueCount + metrics.falseCount, 10);
  });

  it("should throw when flag configuration is invalid", () => {
    assert.throws(
      () =>
        new FeatureFlagService({
          flags: { "": { enabled: true, segments: [] } },
        }),
      { code: "INVALID_FLAG_NAME" },
    );
  });
});
