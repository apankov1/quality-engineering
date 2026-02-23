# Breaking Change Categories

Detailed detection patterns, code examples, and safe alternatives for each of the 6 breaking change categories.

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
