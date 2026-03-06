# Fault Catalog — 16 Patterns

Code patterns and their associated defect classes, with before/after test examples.

---

## 1. comparison-boundary

**Detects**: `<`, `>`, `<=`, `>=` with numeric values or `.length`
**Defect classes**: `off-by-one`, `boundary-zero`

```typescript
// Production code
if (i < arr.length) { process(arr[i]); }

// BAD test (API exercise)
it('processes items', () => {
  assert.ok(processAll([1, 2, 3]));
});

// GOOD test (defect hypothesis)
// Defect: off-by-one — using <= instead of < reads past array end
it('does not access index at arr.length', () => {
  const arr = [1, 2, 3];
  const result = processAll(arr);
  assert.equal(result.length, 3); // not 4
});
```

---

## 2. array-index

**Detects**: `arr[i]`, `arr[i + 1]`, `arr[i - 1]`
**Defect classes**: `off-by-one`, `empty-collection`

```typescript
// Production code
const prev = items[i - 1];

// GOOD test
// Defect: empty-collection — accessing items[-1] when i=0 returns undefined
it('handles first element with no predecessor', () => {
  assert.equal(getNeighbor([10], 0, 'prev'), undefined);
});
```

---

## 3. string-split

**Detects**: `.split()`
**Defect classes**: `empty-string`, `empty-collection`

```typescript
// Production code
const parts = input.split(',');

// GOOD test
// Defect: empty-string — ''.split(',') returns [''], not []
it('split of empty string returns single empty element', () => {
  const result = parseCSV('');
  assert.equal(result.length, 1);
  assert.equal(result[0], '');
});
```

---

## 4. string-slice

**Detects**: `.substring()`, `.slice()`, `.substr()`
**Defect classes**: `off-by-one`, `empty-string`, `negative-input`

```typescript
// Production code
const ext = filename.slice(filename.lastIndexOf('.'));

// GOOD test
// Defect: negative-input — lastIndexOf returns -1 for no dot, slice(-1) returns last char
it('handles filename without extension', () => {
  assert.equal(getExtension('README'), '');
});
```

---

## 5. optional-chain

**Detects**: `?.`
**Defect classes**: `null-undefined`

```typescript
// Production code
const name = user?.profile?.name;

// GOOD test
// Defect: null-undefined — user is null, name should be undefined not throw
it('returns undefined for null user', () => {
  assert.equal(getUserName(null), undefined);
});
```

---

## 6. nullish-coalesce

**Detects**: `??`
**Defect classes**: `null-undefined`

```typescript
// Production code
const timeout = config.timeout ?? 3000;

// GOOD test
// Defect: null-undefined — empty string and 0 should NOT trigger fallback
it('preserves falsy non-null values', () => {
  assert.equal(getTimeout({ timeout: 0 }), 0);
});
```

---

## 7. explicit-null-check

**Detects**: `=== null`, `!== undefined`, `== null`
**Defect classes**: `null-undefined`, `missing-branch`

```typescript
// Production code
if (value !== null) { process(value); }

// GOOD test
// Defect: missing-branch — undefined also bypasses the check with !==
it('handles undefined same as null', () => {
  assert.throws(() => process(undefined));
});
```

---

## 8. try-catch

**Detects**: `try {`
**Defect classes**: `missing-error-path`, `swallowed-error`, `wrong-error-type`

```typescript
// Production code
try { await saveRecord(data); }
catch (e) { logger.warn(e); }

// GOOD test
// Defect: swallowed-error — catch logs but doesn't rethrow, caller thinks save succeeded
it('propagates save failure to caller', () => {
  await assert.rejects(
    () => saveRecord(invalidData),
    { message: /save failed/i },
  );
});
```

---

## 9. promise-catch

**Detects**: `.catch()`
**Defect classes**: `unhandled-rejection`, `swallowed-error`

```typescript
// Production code
fetchData().catch(err => console.error(err));

// GOOD test
// Defect: swallowed-error — .catch only logs, fetch failure is silently swallowed
it('surfaces fetch error to caller', () => {
  const result = await loadData('bad-url');
  assert.equal(result.error, 'fetch failed');
});
```

---

## 10. throw-statement

**Detects**: `throw new Error(...)`, `throw err`
**Defect classes**: `missing-error-path`, `wrong-error-type`

```typescript
// Production code
if (!isValid(input)) throw new ValidationError('invalid');

// GOOD test
// Defect: wrong-error-type — throw Error instead of ValidationError breaks catch discriminator
it('throws ValidationError not generic Error', () => {
  assert.throws(
    () => validate(''),
    (err) => err instanceof ValidationError,
  );
});
```

---

## 11. division-op

**Detects**: `x / y` (division with spaces)
**Defect classes**: `division-by-zero`, `nan-propagation`

```typescript
// Production code
const average = sum / count;

// GOOD test
// Defect: division-by-zero — count=0 produces Infinity, corrupts downstream calculations
it('returns 0 average for empty dataset', () => {
  assert.equal(calculateAverage([]), 0);
});
```

---

## 12. type-conversion

**Detects**: `parseInt()`, `parseFloat()`, `Number()`
**Defect classes**: `nan-propagation`, `type-coercion`

```typescript
// Production code
const port = parseInt(env.PORT, 10);

// GOOD test
// Defect: nan-propagation — undefined PORT produces NaN, server binds to random port
it('defaults to 3000 when PORT is undefined', () => {
  assert.equal(getPort({}), 3000);
});
```

---

## 13. array-mutation

**Detects**: `.push()`, `.pop()`, `.splice()`, `.sort()`, `.reverse()`
**Defect classes**: `shared-mutation`

```typescript
// Production code
items.sort((a, b) => a.score - b.score);

// GOOD test
// Defect: shared-mutation — sort() mutates in place, caller's array order changed
it('does not mutate input array', () => {
  const original = [3, 1, 2];
  const copy = [...original];
  getSorted(original);
  assert.deepEqual(original, copy);
});
```

---

## 14. promise-all

**Detects**: `Promise.all()`, `Promise.race()`, `Promise.any()`
**Defect classes**: `unhandled-rejection`

```typescript
// Production code
const results = await Promise.all(urls.map(fetch));

// GOOD test
// Defect: unhandled-rejection — one failing URL rejects all, no partial results
it('returns partial results when one fetch fails', () => {
  const results = await fetchAll(['ok.com', 'bad.com']);
  assert.equal(results.filter(r => r.ok).length, 1);
});
```

---

## 15. switch-statement

**Detects**: `switch (expr)`
**Defect classes**: `missing-branch`

```typescript
// Production code
switch (status) {
  case 'active': return handleActive();
  case 'paused': return handlePaused();
}

// GOOD test
// Defect: missing-branch — unknown status returns undefined, caller crashes
it('throws on unknown status', () => {
  assert.throws(() => handleStatus('deleted'));
});
```

---

## 16. math-domain

**Detects**: `Math.sqrt()`, `Math.log()`, `Math.asin()`, `Math.acos()`
**Defect classes**: `negative-input`, `nan-propagation`

```typescript
// Production code
const distance = Math.sqrt(dx * dx + dy * dy);

// GOOD test
// Defect: nan-propagation — if dx or dy is NaN, distance silently becomes NaN
it('rejects NaN coordinates', () => {
  assert.throws(() => getDistance(NaN, 0, 0, 0));
});
```
