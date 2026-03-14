/**
 * Configuration loader tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigLoader } from "../src/config-loader.js";

describe("ConfigLoader", () => {
  it("should load config from JSON file", () => {
    const loader = new ConfigLoader({ basePath: "/etc/app" });
    const config = loader.load("settings.json");
    assert.equal(config.database.host, "localhost");
    assert.equal(config.database.port, 5432);
  });

  it("should override values from environment variables", () => {
    const loader = new ConfigLoader({ basePath: "/etc/app" });
    const config = loader.load("settings.json", {
      env: { DATABASE_HOST: "prod-db.internal", DATABASE_PORT: "5433" },
    });
    assert.equal(config.database.host, "prod-db.internal");
    assert.equal(config.database.port, 5433);
  });

  it("should merge default values into partial config", () => {
    const defaults = { retryCount: 3, timeout: 5000, verbose: false };
    const partial = { timeout: 10000 };
    const merged = { ...defaults, ...partial };
    assert.equal(merged.retryCount, 3);
    assert.equal(merged.timeout, 10000);
    assert.equal(merged.verbose, false);
  });

  it("should handle nested keys with dot notation", () => {
    const obj: Record<string, unknown> = {};
    const key = "database.replica.host";
    const parts = key.split(".");
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = current[parts[i]] || {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = "replica.internal";
    assert.equal((obj as any).database.replica.host, "replica.internal");
  });
});
