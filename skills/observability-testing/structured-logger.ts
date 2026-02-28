/**
 * Observability Testing: Structured Logger Utilities
 *
 * Provides reusable patterns for:
 * - Mock logger creation with captured entries
 * - Log entry assertions
 * - Log level policy enforcement
 * - Log level classification
 *
 * Framework-agnostic: Uses standard assertion patterns.
 *
 * @example
 * import { createMockLogger, assertLogEntry, assertNoLogsAbove } from './structured-logger';
 *
 * const logger = createMockLogger();
 * myFunction(logger);
 * assertLogEntry(logger, 'error', 'Failed to process', { component: 'Handler' });
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Log levels in order of severity (lowest to highest).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log level severity order for comparisons.
 */
export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * A structured log entry.
 */
export interface StructuredLogEntry {
  level: LogLevel;
  message: string;
  error?: Error;
  context?: Record<string, unknown>;
}

/**
 * Logger interface with 4 standard levels.
 *
 * Note: `error` has a different signature — it accepts an optional Error as the second argument.
 */
export interface StructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

/**
 * Mock logger that captures all log entries for assertions.
 */
export interface MockLogger extends StructuredLogger {
  readonly entries: StructuredLogEntry[];
  clear(): void;
}

// ============================================================================
// MOCK LOGGER
// ============================================================================

/**
 * Create a mock logger that captures all log entries.
 *
 * Use in tests to verify that code produces correct log output.
 */
export function createMockLogger(): MockLogger {
  const entries: StructuredLogEntry[] = [];

  return {
    entries,

    debug(message: string, context?: Record<string, unknown>): void {
      entries.push({ level: "debug", message, context });
    },

    info(message: string, context?: Record<string, unknown>): void {
      entries.push({ level: "info", message, context });
    },

    warn(message: string, context?: Record<string, unknown>): void {
      entries.push({ level: "warn", message, context });
    },

    error(message: string, error?: Error, context?: Record<string, unknown>): void {
      entries.push({ level: "error", message, error, context });
    },

    clear(): void {
      entries.length = 0;
    },
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Deep structural equality check for context values.
 * Handles primitives, plain objects, and arrays.
 *
 * Not intended for non-plain objects (Date, Map, Set, class instances).
 * Log context should be plain serializable data.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!(key in objB) || !deepEqual(objA[key], objB[key])) return false;
  }
  return true;
}

// ============================================================================
// LOG ASSERTIONS
// ============================================================================

/**
 * Assert that a specific log entry was recorded.
 *
 * @param logger - The mock logger to check
 * @param level - Expected log level
 * @param message - Expected message (exact match or substring)
 * @param contextMatcher - Optional context fields to match (partial match)
 */
export function assertLogEntry(
  logger: MockLogger,
  level: LogLevel,
  message: string,
  contextMatcher?: Record<string, unknown>,
): StructuredLogEntry {
  const matching = logger.entries.filter((e) => {
    if (e.level !== level) return false;
    if (!e.message.includes(message)) return false;

    if (contextMatcher) {
      if (!e.context) return false;
      for (const [key, value] of Object.entries(contextMatcher)) {
        if (!deepEqual(e.context[key], value)) return false;
      }
    }

    return true;
  });

  if (matching.length === 0) {
    const entries = logger.entries.map((e) => `  [${e.level}] ${e.message}`).join("\n");
    const ctxStr = contextMatcher ? ` with context ${JSON.stringify(contextMatcher)}` : "";
    throw new Error(`Expected log entry: [${level}] "${message}"${ctxStr}\nActual entries:\n${entries || "  (none)"}`);
  }

  return matching[0];
}

/**
 * Assert that NO logs above a given level were recorded.
 *
 * Use to verify happy paths don't produce warnings or errors.
 */
export function assertNoLogsAbove(logger: MockLogger, maxLevel: LogLevel): void {
  const maxSeverity = LOG_LEVEL_ORDER[maxLevel];
  const violations = logger.entries.filter((e) => LOG_LEVEL_ORDER[e.level] > maxSeverity);

  if (violations.length > 0) {
    const details = violations.map((e) => `  [${e.level}] ${e.message}`).join("\n");
    throw new Error(`Expected no logs above ${maxLevel}, but found:\n${details}`);
  }
}

/**
 * Assert that at least one log at the given level was recorded.
 */
export function assertHasLogLevel(logger: MockLogger, level: LogLevel): void {
  const matching = logger.entries.filter((e) => e.level === level);
  if (matching.length === 0) {
    throw new Error(`Expected at least one [${level}] log entry, but found none`);
  }
}

/**
 * Assert that an error log includes an Error instance.
 *
 * Always enforces that `entry.error` is present. Use `assertLogEntry`
 * if you only need to check for an error-level message without an Error instance.
 */
export function assertErrorLogged(
  logger: MockLogger,
  message: string,
  errorMatcher?: { name?: string; message?: string },
): StructuredLogEntry {
  const entry = assertLogEntry(logger, "error", message);

  if (!entry.error) {
    throw new Error(`Expected error log "${message}" to include an Error instance, but error was undefined`);
  }

  if (errorMatcher) {
    if (errorMatcher.name && entry.error.name !== errorMatcher.name) {
      throw new Error(`Expected error.name "${errorMatcher.name}", got "${entry.error.name}"`);
    }
    if (errorMatcher.message && !entry.error.message.includes(errorMatcher.message)) {
      throw new Error(`Expected error.message to include "${errorMatcher.message}", got "${entry.error.message}"`);
    }
  }

  return entry;
}

// ============================================================================
// LOG LEVEL POLICY
// ============================================================================

/**
 * Log level policy reference table.
 *
 * Use this to ensure consistent log level classification across your codebase.
 */
export const LOG_LEVEL_POLICY = {
  error: {
    description: "Actionable failures requiring investigation",
    examples: ["Database connection failed", "Authentication error", "Unhandled exception"],
    production: "100% always",
    development: "100%",
  },
  warn: {
    description: "Degraded but recoverable (needs human attention eventually)",
    examples: ["Retry exhausted but fallback worked", "Deprecated API called", "Rate limit approaching"],
    production: "100% always",
    development: "100%",
  },
  info: {
    description: "Significant state changes",
    examples: ["User logged in", "Config loaded", "Session started", "Feature toggled"],
    production: "sampled (1-10%)",
    development: "100%",
  },
  debug: {
    description: "Routine operations and periodic cycles",
    examples: ["Cache hit/miss", "Heartbeat tick", "Background job cycle", "Request timing"],
    production: "off (or LOG_LEVEL=warn)",
    development: "100%",
  },
} as const;

/**
 * Classify what log level a message should use based on its description.
 *
 * This is a heuristic helper for code review and log statement authoring.
 * It analyzes keywords in the description to suggest an appropriate level.
 */
export function classifyLogLevel(description: string): LogLevel {
  const lower = description.toLowerCase();

  // Error indicators
  if (
    lower.includes("fail") ||
    lower.includes("error") ||
    lower.includes("exception") ||
    lower.includes("crash") ||
    lower.includes("fatal") ||
    lower.includes("unhandled")
  ) {
    return "error";
  }

  // Warning indicators
  if (
    lower.includes("warn") ||
    lower.includes("degrad") ||
    lower.includes("retry") ||
    lower.includes("timeout") ||
    lower.includes("deprecated") ||
    lower.includes("limit")
  ) {
    return "warn";
  }

  // Info indicators (state changes)
  if (
    lower.includes("start") ||
    lower.includes("stop") ||
    lower.includes("create") ||
    lower.includes("delete") ||
    lower.includes("login") ||
    lower.includes("logout") ||
    lower.includes("logged") || // "logged in", "logged out"
    lower.includes("loaded") || // "config loaded"
    lower.includes("config") ||
    lower.includes("state change")
  ) {
    return "info";
  }

  // Default to debug for routine operations
  return "debug";
}
