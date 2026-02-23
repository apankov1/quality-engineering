---
name: breaking-change-detector
description: |
  Detect breaking changes across 6 categories: contracts, database schemas,
  RPC endpoints, WebSocket protocols, stateful schemas, and event sourcing.

  WHEN to use:
  - Modifying shared contract/interface packages
  - Changing database schema or migrations
  - RPC/API endpoint signature changes
  - WebSocket message format changes
  - Serialized state schema changes

  WHEN NOT to use:
  - Adding new optional fields (non-breaking)
  - Internal refactoring without API changes
  - Documentation or test-only changes
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Breaking Change Detector

> **Status**: Batch 2 -- coming soon. This is a stub.

Prevents breaking changes that crash active sessions or break client compatibility.

## Categories

1. **Contract Field Removal** -- Runtime errors from removed/renamed interface fields
2. **Database Schema** -- Migration removes columns without data migration
3. **RPC/API Endpoints** -- Changed input/output schemas, removed endpoints
4. **WebSocket Protocol** -- Changed message format for active connections
5. **Stateful Schema Evolution** -- Changed serialized state without backward compat
6. **Event Sourcing Schema** -- Changed event payloads breaking replay

## Key Pattern: Tolerant Reader

```typescript
// Safe schema evolution with fallback defaults
const Schema = z.object({
  version: z.number().int().min(1).catch(1),
  field: z.string().catch('default'),
  newField: z.boolean().catch(false),
});

// safeParse with graceful fallback
static fromJSON(json: unknown): MyObject {
  const result = Schema.safeParse(json);
  if (!result.success) {
    console.warn('Validation failed, returning fresh');
    return new MyObject();
  }
  return reconstruct(result.data);
}
```

*Full skill content coming in Batch 2.*
