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
  - Before merging any contract/schema changes

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

Detects breaking changes that could disrupt active sessions or lose client compatibility across 6 categories.

## Rationalizations (Do Not Skip)

| Rationalization | Why It's Wrong | Required Action |
|-----------------|----------------|-----------------|
| "Nobody uses the old format" | Active sessions and stored data use the old format right now | Check backward compatibility |
| "We'll fix the clients" | Clients update on their own schedule, not yours | Keep old format supported |
| "It's just a rename" | A rename IS a removal + addition -- all consumers need updating | Deprecate, don't rename |
| "The migration handles it" | Migrations run once; replay/recovery may encounter old data indefinitely | Use tolerant reader pattern |

---

## 1. Contract Field Removal

**Impact**: Runtime errors when consumers access removed/renamed fields

**Safe Changes**:
- Adding optional fields: `newField?: string`
- Adding new interfaces
- Widening types: `number | string` -> `number | string | null`

**Breaking Changes**:
- Removing fields: `- score: number`
- Renaming fields: `score` -> `points`
- Narrowing types: `number | string` -> `number`
- Making optional required: `field?:` -> `field:`

**Detect**:
```bash
# Compare current vs previous contract exports
git diff HEAD~1 src/contracts/ | grep "^-.*export"
```

---

## 2. Database Schema

**Impact**: Active services fail to load, data loss

```sql
-- BREAKING: Column removal without migration
ALTER TABLE orders DROP COLUMN metadata;

-- SAFE: Add column with default
ALTER TABLE orders ADD COLUMN new_field TEXT DEFAULT '{}';

-- SAFE: Rename with data migration
ALTER TABLE orders ADD COLUMN new_name TEXT;
UPDATE orders SET new_name = old_name;
ALTER TABLE orders DROP COLUMN old_name;
```

---

## 3. RPC/API Endpoints

**Impact**: Client requests fail, UI becomes unresponsive

**Breaking Changes**:
- Removing endpoint: `delete orders.create`
- Required input added: `input: z.object({ newRequired: z.string() })`
- Output shape changed: `{ score }` -> `{ points }`
- Renaming endpoint: `orders.create` -> `orders.new`

**Safe Changes**:
- Adding optional input: `newField: z.string().optional()`
- Adding fields to output: `{ score, newField }`
- New endpoints
- Deprecation warnings (keep old endpoint, add new)

---

## 4. WebSocket Message Protocol

**Impact**: Active connections stop working, real-time features freeze

**Breaking Changes**:
- Message type changes
- Payload shape changes
- Protocol version changes without backward compat

**Safe Pattern**:
```typescript
// Version-aware protocol
type AppMessage =
  | { version: 1; type: 'update'; data: UpdateV1 }
  | { version: 2; type: 'update'; data: UpdateV2 };
```

---

## 5. Serialized State Schema

**Impact**: Persisted/hibernated instances fail on restore when schema validation rejects old data

**Breaking Changes**:
- Adding required fields without fallback defaults
- Using `z.literal(N)` for version (blocks future versions)
- Removing fields without migration
- Using strict `.parse()` in deserialization methods

**Safe Pattern -- Tolerant Reader**:
```typescript
// Every field has a .catch() default for backward compat
const SerializedStateSchema = z.object({
  version: z.number().int().min(1).catch(1),  // Not z.literal(1)
  counter: z.number().int().nonnegative().catch(0),
  activeId: z.string().nullable().catch(null),
  contexts: z.record(z.string(), ContextSchema).catch({}),
});

// safeParse with graceful fallback in fromJSON
static fromJSON(json: unknown): MyState {
  const result = Schema.safeParse(json);
  if (!result.success) {
    console.warn('Validation failed, returning fresh state');
    return new MyState();  // Graceful fallback
  }
  return reconstruct(result.data);
}
```

**Detect**:
```bash
# Find serialized schemas without .catch()
grep -rn "z\.object\|z\.enum\|z\.boolean\|z\.number" src/schemas/ | grep -v "\.catch("
```

---

## 6. Event Sourcing Schema

**Impact**: Event replay fails, application state becomes inconsistent

**Breaking Changes**:
- Removing event fields
- Changing event type names
- Incompatible payload structure

**Safe Pattern**:
```typescript
// Add new event type, keep old for replay
type AppEvent =
  | { type: 'UPDATE_V1'; payload: OldUpdate }
  | { type: 'UPDATE_V2'; payload: NewUpdate };
```

---

## Backward Compatibility Checklist

When modifying contracts or schemas:
- [ ] All existing fields preserved (or deprecated with fallback)
- [ ] New fields are optional or have `.catch()` defaults
- [ ] Type changes are widening only
- [ ] Database migration handles existing data
- [ ] Old event formats still supported for replay
- [ ] WebSocket protocol versioned
- [ ] API endpoints maintain compatibility
- [ ] Tests validate old data still deserializes correctly
- [ ] Serialized state schemas use `.catch()` for all fields
- [ ] `fromJSON()` methods use `safeParse()` with graceful fallback

---

## Violation Rules

| Slug | Rule | Severity |
|------|------|----------|
| `contract_field_removal` | Removed/renamed fields in shared interfaces | must-fail |
| `schema_without_catch` | Serialized schema fields missing `.catch()` default | must-fail |
| `strict_parse_in_deserialize` | Using `.parse()` instead of `.safeParse()` in fromJSON | must-fail |
| `migration_drops_column` | Column removal without data migration | must-fail |
| `endpoint_removed` | API endpoint removed without deprecation period | must-fail |
| `event_type_renamed` | Event type name changed (incompatible with replay) | must-fail |

---

## Output Format

```markdown
## CRITICAL -- Will Disrupt Active Sessions

### Contract: Removed UserState.score field
**File**: src/contracts/types.ts:42
**Impact**: Active sessions fail on state load
**Fix**: Deprecate instead:
  /** @deprecated Use points instead */
  score?: number;
  points: number;

## WARNING -- Migration Required

### Database: Renamed column without migration
**File**: migrations/0036_rename_field.sql:5
**Impact**: Existing rows have NULL values
**Fix**: Add data migration step

## SAFE Changes

- Added optional field `UserState.metadata`
- New API endpoint `orders.archive`
- Widened type `Status: 'active' | 'paused'` to include `'archived'`
```

## Framework Adaptation

This skill applies to any system with:
- **Shared contracts/interfaces** consumed by multiple services or clients
- **Persistent state** that survives restarts (databases, serialized objects, hibernated processes)
- **Event sourcing** where historical events must remain replayable
- **Real-time protocols** (WebSocket, SSE) with active connections during deploys
- **RPC/API layers** (tRPC, gRPC, REST) with independent client release cycles
