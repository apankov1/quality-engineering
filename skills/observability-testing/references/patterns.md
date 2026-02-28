# Observability Testing Patterns

Deep-dive into correlation fields, log level migration, and framework integration.

## Correlation Fields

Every log entry should include fields for dashboard filtering:

```typescript
interface CorrelationContext {
  requestId: string;
  userId?: string;
  component: string;
}

logger.info('Order created', {
  requestId: 'req-12345',
  userId: 'user-789',
  component: 'OrderService',
});
```

## Logger Interface Signature

```typescript
interface StructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}
```

Note: `error()` takes an optional Error instance as the second argument.

## Log Level Decision Tree

```
What happened?
├── Normal flow?
│   ├── Routine ops → DEBUG
│   └── State change → INFO
└── Problem?
    ├── Degraded but works → WARN
    └── Failure error → ERROR
```

## Framework Integration

Adapt the mock logger to Winston, Pino, or console-based loggers by wrapping the interface.

## Alert Mapping

| Log Level | Alert Severity | Response Time |
|-----------|----------------|---------------|
| error | P1/Critical | Immediate |
| warn | P2/High | Same day |
| info | None | N/A |
| debug | None | N/A |
