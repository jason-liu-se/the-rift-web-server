# Async Patterns

## Return Types

Annotate the return type of exported async functions when the inferred type is
complex or leaks implementation details (e.g. library query types), so the
contract is clear to callers:

```typescript
export async function getUser(id: string): Promise<User | undefined> {
	/* ... */
}
```

## Concurrent Execution

### `Promise.all` for independent operations

Run independent awaits together with `Promise.all`, not one after another.

### `Promise.allSettled` when partial failure is acceptable

```typescript
const [userResult, ordersResult] = await Promise.allSettled([
	fetchUser(userId),
	fetchOrders(userId)
]);

const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
```

Only use this when a partial result is genuinely useful; otherwise let the
failure propagate.

### Process large sets in batches

Unbounded `Promise.all` over thousands of items can overwhelm a database or API;
process them in fixed-size batches instead.

## Avoid Unhandled Rejections

Every promise must be awaited, returned, or explicitly handled:

```typescript
// BAD: fire and forget
function initApp(): void {
	loadConfig(); // rejection is unhandled
}

// BAD: forEach doesn't wait for async callbacks
items.forEach(async (item) => {
	await save(item);
});

// GOOD
await Promise.all(items.map(save));

// GOOD: handle failure at the top level
try {
	await loadConfig();
} catch (e) {
	console.error("Failed to initialize:", e);
	process.exit(1);
}
```

Don't mix callbacks and promises in the same API; pick promises.

## Timeouts and Cancellation

Use `AbortSignal` rather than hand-rolled timers:

```typescript
const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
```

For work you start yourself, accept an `AbortSignal` parameter and pass it
through to the libraries that support it.

## Retries

Prefer a library's built-in retry (e.g. the MongoDB driver's) over writing your
own. If you must retry by hand, retry only idempotent operations, only for
transient failures, with exponential backoff and a cap.

## Async Iteration

Use `for await...of` to consume paginated or streamed sources one chunk at a
time instead of loading everything into memory.

## References

- [MDN: `Promise.all`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all)
- [MDN: `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
