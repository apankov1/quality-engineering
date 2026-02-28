import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOG_LEVEL_ORDER,
  LOG_LEVEL_POLICY,
  assertErrorLogged,
  assertHasLogLevel,
  assertLogEntry,
  assertNoLogsAbove,
  classifyLogLevel,
  createMockLogger,
} from "./structured-logger.ts";

// ============================================================================
// MOCK LOGGER
// ============================================================================

describe("createMockLogger", () => {
  // Defect: Logger must have all 4 levels
  it("creates logger with all 4 levels", () => {
    const logger = createMockLogger();

    assert.equal(typeof logger.debug, "function");
    assert.equal(typeof logger.info, "function");
    assert.equal(typeof logger.warn, "function");
    assert.equal(typeof logger.error, "function");
  });

  // Defect: Each level must capture entries
  it("captures entries for each level", () => {
    const logger = createMockLogger();

    logger.debug("debug message", { key: "value" });
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message", new Error("test"), { component: "Test" });

    assert.equal(logger.entries.length, 4);
    assert.equal(logger.entries[0].level, "debug");
    assert.equal(logger.entries[1].level, "info");
    assert.equal(logger.entries[2].level, "warn");
    assert.equal(logger.entries[3].level, "error");
  });

  // Defect: Error level must capture Error instance
  it("captures Error instance for error level", () => {
    const logger = createMockLogger();
    const err = new Error("test error");

    logger.error("something failed", err, { context: "test" });

    assert.equal(logger.entries[0].error, err);
    assert.deepEqual(logger.entries[0].context, { context: "test" });
  });

  // Defect: Clear must empty entries
  it("clears all entries", () => {
    const logger = createMockLogger();

    logger.info("message 1");
    logger.info("message 2");
    assert.equal(logger.entries.length, 2);

    logger.clear();
    assert.equal(logger.entries.length, 0);
  });
});

// ============================================================================
// LOG ASSERTIONS
// ============================================================================

describe("assertLogEntry", () => {
  // Defect: Must find exact matching entry
  it("finds matching entry by level and message", () => {
    const logger = createMockLogger();
    logger.info("User logged in", { userId: "123" });

    const entry = assertLogEntry(logger, "info", "User logged in");
    assert.equal(entry.message, "User logged in");
  });

  // Defect: Must match substring in message
  it("matches message substring", () => {
    const logger = createMockLogger();
    logger.error("Database connection failed: timeout after 30s");

    const entry = assertLogEntry(logger, "error", "connection failed");
    assert.ok(entry.message.includes("connection failed"));
  });

  // Defect: Must match context fields
  it("matches context fields", () => {
    const logger = createMockLogger();
    logger.warn("Rate limit approaching", { service: "api", usage: 90 });

    const entry = assertLogEntry(logger, "warn", "Rate limit", { service: "api" });
    assert.equal(entry.context?.service, "api");
  });

  // Defect: Must match nested context structurally, not by reference
  it("matches nested context objects", () => {
    const logger = createMockLogger();
    logger.info("Request completed", { meta: { duration: 42, tags: ["fast"] } });

    const entry = assertLogEntry(logger, "info", "Request completed", {
      meta: { duration: 42, tags: ["fast"] },
    });
    assert.ok(entry);
  });

  // Defect: Must throw with details when no match
  it("throws when no matching entry found", () => {
    const logger = createMockLogger();
    logger.info("Some other message");

    assert.throws(
      () => assertLogEntry(logger, "error", "Expected message"),
      /Expected log entry: \[error\] "Expected message".*Actual entries:/s,
    );
  });

  // Defect: Must throw when context doesn't match
  it("throws when context doesn't match", () => {
    const logger = createMockLogger();
    logger.info("Message", { key: "wrong" });

    assert.throws(
      () => assertLogEntry(logger, "info", "Message", { key: "expected" }),
      /Expected log entry.*with context/,
    );
  });
});

describe("assertNoLogsAbove", () => {
  // Defect: Must pass when no logs above level
  it("passes when no logs above max level", () => {
    const logger = createMockLogger();
    logger.debug("debug message");
    logger.info("info message");

    assert.doesNotThrow(() => assertNoLogsAbove(logger, "info"));
  });

  // Defect: Must throw when logs above level exist
  it("throws when warn/error exist above info", () => {
    const logger = createMockLogger();
    logger.info("info message");
    logger.warn("warning message");

    assert.throws(() => assertNoLogsAbove(logger, "info"), /Expected no logs above info.*\[warn\]/s);
  });

  // Defect: Must check all higher levels
  it("catches error level when max is warn", () => {
    const logger = createMockLogger();
    logger.warn("warning");
    logger.error("error");

    assert.throws(() => assertNoLogsAbove(logger, "warn"), /\[error\]/);
  });
});

describe("assertHasLogLevel", () => {
  // Defect: Must pass when level exists
  it("passes when level exists", () => {
    const logger = createMockLogger();
    logger.error("something broke");

    assert.doesNotThrow(() => assertHasLogLevel(logger, "error"));
  });

  // Defect: Must throw when level missing
  it("throws when level not found", () => {
    const logger = createMockLogger();
    logger.info("only info");

    assert.throws(() => assertHasLogLevel(logger, "error"), /Expected at least one \[error\] log entry/);
  });
});

describe("assertErrorLogged", () => {
  // Defect: Must validate error instance properties
  it("validates error name and message", () => {
    const logger = createMockLogger();
    const err = new TypeError("Invalid argument");
    logger.error("Operation failed", err);

    const entry = assertErrorLogged(logger, "Operation failed", {
      name: "TypeError",
      message: "Invalid",
    });

    assert.equal(entry.error?.name, "TypeError");
  });

  // Defect: Must always enforce Error instance, even without matcher
  it("throws when error instance missing (no matcher)", () => {
    const logger = createMockLogger();
    logger.error("Operation failed"); // No error instance

    assert.throws(() => assertErrorLogged(logger, "Operation failed"), /include an Error instance/);
  });

  // Defect: Must throw when error missing (with matcher)
  it("throws when error instance missing (with matcher)", () => {
    const logger = createMockLogger();
    logger.error("Operation failed"); // No error instance

    assert.throws(() => assertErrorLogged(logger, "Operation failed", { name: "Error" }), /include an Error instance/);
  });
});

// ============================================================================
// LOG LEVEL POLICY
// ============================================================================

describe("LOG_LEVEL_ORDER", () => {
  // Defect: Order must be debug < info < warn < error
  it("has correct severity order", () => {
    assert.ok(LOG_LEVEL_ORDER.debug < LOG_LEVEL_ORDER.info);
    assert.ok(LOG_LEVEL_ORDER.info < LOG_LEVEL_ORDER.warn);
    assert.ok(LOG_LEVEL_ORDER.warn < LOG_LEVEL_ORDER.error);
  });
});

describe("LOG_LEVEL_POLICY", () => {
  // Defect: Policy must define all 4 levels
  it("defines all 4 levels", () => {
    assert.ok(LOG_LEVEL_POLICY.debug);
    assert.ok(LOG_LEVEL_POLICY.info);
    assert.ok(LOG_LEVEL_POLICY.warn);
    assert.ok(LOG_LEVEL_POLICY.error);
  });

  // Defect: Each level must have examples
  it("each level has examples", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      assert.ok(LOG_LEVEL_POLICY[level].examples.length > 0, `${level} should have examples`);
    }
  });
});

// ============================================================================
// LOG LEVEL CLASSIFICATION
// ============================================================================

describe("classifyLogLevel", () => {
  // Defect: Error keywords must classify as error
  it("classifies failure/error keywords as error", () => {
    assert.equal(classifyLogLevel("Database connection failed"), "error");
    assert.equal(classifyLogLevel("Unhandled exception in handler"), "error");
    assert.equal(classifyLogLevel("Fatal crash during startup"), "error");
  });

  // Defect: Warning keywords must classify as warn
  it("classifies degraded/retry keywords as warn", () => {
    assert.equal(classifyLogLevel("Service degraded, using fallback"), "warn");
    assert.equal(classifyLogLevel("Retry attempt 3 of 5"), "warn");
    assert.equal(classifyLogLevel("Deprecated API called"), "warn");
    assert.equal(classifyLogLevel("Request timeout, will retry"), "warn");
  });

  // Defect: State change keywords must classify as info
  it("classifies state change keywords as info", () => {
    assert.equal(classifyLogLevel("User logged in"), "info");
    assert.equal(classifyLogLevel("Config loaded successfully"), "info");
    assert.equal(classifyLogLevel("Session started for user"), "info");
    assert.equal(classifyLogLevel("Record deleted from database"), "info");
  });

  // Defect: Routine operations must classify as debug
  it("classifies routine operations as debug", () => {
    assert.equal(classifyLogLevel("Cache hit for key xyz"), "debug");
    assert.equal(classifyLogLevel("Heartbeat received"), "debug");
    assert.equal(classifyLogLevel("Processing batch item 5 of 100"), "debug");
  });
});

// ============================================================================
// INTEGRATION: OBSERVABILITY WORKFLOW
// ============================================================================

describe("integration: handler observability", () => {
  // Simulated handler that logs at various levels
  function handleRequest(logger: ReturnType<typeof createMockLogger>, shouldFail: boolean) {
    logger.debug("Request received", { path: "/api/test" });

    if (shouldFail) {
      const err = new Error("Database unavailable");
      logger.error("Request failed", err, { component: "Handler", path: "/api/test" });
      throw err;
    }

    logger.info("Request completed", { path: "/api/test", duration: 42 });
  }

  // Defect: Happy path must not produce warnings or errors
  it("happy path produces no warnings or errors", () => {
    const logger = createMockLogger();

    handleRequest(logger, false);

    assertNoLogsAbove(logger, "info");
    assertLogEntry(logger, "info", "Request completed", { duration: 42 });
  });

  // Defect: Failure path must log error with context
  it("failure path logs error with full context", () => {
    const logger = createMockLogger();

    assert.throws(() => handleRequest(logger, true));

    assertErrorLogged(logger, "Request failed", { message: "Database unavailable" });
    assertLogEntry(logger, "error", "Request failed", { component: "Handler" });
  });
});
