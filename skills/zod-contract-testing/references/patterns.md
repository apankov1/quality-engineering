# Zod Contract Testing Patterns

Deep-dive into boundary testing methodology and compound state analysis.

## Boundary Testing Methodology

Zod validation should happen at system boundaries:
- API handlers (parse incoming requests)
- Database reads (parse query results)
- External API responses (parse JSON)

**Parse, Don't Validate**: Use `Schema.parse()` to get typed data, not `as Type` casts.

## Compound State Analysis

For schemas with N optional fields, analyze all 2^N combinations:

### Step 1: List Fields
```typescript
const CellSchema = z.object({
  value: z.number().optional(),
  candidates: z.array(z.number()).optional(),
  isGiven: z.boolean().optional(),
});
```

### Step 2: Generate Matrix
```
| value | candidates | isGiven | Valid? |
|-------|------------|---------|--------|
| -     | -          | -       | ✅     |
| Y     | -          | -       | ✅     |
| -     | Y          | -       | ✅     |
| Y     | Y          | -       | ✅     |
| -     | -          | Y       | ❌     |
| Y     | -          | Y       | ✅     |
| -     | Y          | Y       | ❌     |
| Y     | Y          | Y       | ✅     |
```

### Step 3: Encode Business Rules
```typescript
.refine(cell => !(cell.isGiven && cell.value === undefined), 'Given cells must have value')
```

## Schema Evolution Strategies

1. **Optional New Fields**: Add `.optional()` for backward compat
2. **Default Values**: Use `.catch(defaultValue)` for missing fields
3. **Transform Old Format**: Use `.transform()` to migrate

## Error Path Testing

Test that errors occur at the expected nested path:

```typescript
testInvalidInput(OrderSchema, invalidData, 'items.0.quantity');
```
