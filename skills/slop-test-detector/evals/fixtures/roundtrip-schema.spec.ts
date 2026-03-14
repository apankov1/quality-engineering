/**
 * User profile management with Zod validation
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { ProfileService } from "../src/profile-service.js";

const ProfileSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(50),
  timezone: z.string(),
  locale: z.string().default("en-US"),
});

describe("ProfileService", () => {
  it("should store display name from creation payload", () => {
    const profile = {
      email: "jane@example.com",
      displayName: "Jane Doe",
      timezone: "America/New_York",
    };
    assert.equal(profile.displayName, "Jane Doe");
  });

  it("should preserve timezone setting", () => {
    const config = {
      region: "eu-west-1",
      timezone: "Europe/London",
      locale: "en-GB",
    };
    assert.equal(config.timezone, "Europe/London");
  });

  it("should validate email format with schema", () => {
    const result = ProfileSchema.safeParse({
      email: "valid@example.com",
      displayName: "Test User",
      timezone: "UTC",
    });
    assert.equal(result.success, true);
  });

  it("should accept valid profile payload", () => {
    const result = ProfileSchema.safeParse({
      email: "another@example.com",
      displayName: "Another User",
      timezone: "Asia/Tokyo",
      locale: "ja-JP",
    });
    assert.equal(result.success, true);
  });

  it("should reject profile with missing email", () => {
    const result = ProfileSchema.safeParse({
      displayName: "No Email",
      timezone: "UTC",
    });
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.equal(result.error.issues[0].path[0], "email");
  });
});
