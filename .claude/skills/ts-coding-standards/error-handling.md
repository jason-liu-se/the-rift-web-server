# Error Handling

`CLAUDE.md` decides how errors reach the caller (throw, let the error handler
respond, never leak internals). This file covers handling errors inside the
code.

## Expected vs Exceptional Failures

- **Exceptional** (database down, bug, invalid request at the HTTP boundary):
  throw an `Error` and let it propagate to the error handler.
- **Expected, and the caller must branch on it** (e.g. "not found" vs "found"
  inside a helper): return a value that makes both outcomes explicit, such as
  `T | undefined` or a discriminated union, rather than throwing for control
  flow.

```typescript
type FindResult<T> = { found: true; value: T } | { found: false };
```

Don't add a `Result`-type library for this; a small union is enough.

## Safe Catch Handling

Caught values are `unknown`. Narrow before use:

```typescript
// BAD - assumes an Error
try {
	await riskyOperation();
} catch (e) {
	console.log(e.message); // Error: 'e' is of type 'unknown'
}

// GOOD - narrow, or use a helper
function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return "Unknown error";
}
```

## Custom Error Classes

Use a subclass when callers need to tell errors apart (e.g. the error handler
mapping an error to a status code). Declare fields explicitly; constructor
parameter properties aren't erasable syntax:

```typescript
class NotFoundError extends Error {
	readonly resource: string;

	constructor(resource: string, options?: ErrorOptions) {
		super(`${resource} not found`, options);
		this.name = "NotFoundError";
		this.resource = resource;
	}
}

// Keep the original error as the cause when wrapping
throw new NotFoundError("gallery collection", { cause: error });
```

Narrow with `instanceof` when handling.

## Discriminated Unions for Error Kinds

When an operation can fail in several distinct ways, model them so the compiler
checks every case:

```typescript
type ImportError =
	| { kind: "network"; retryable: true }
	| { kind: "validation"; fields: string[] }
	| { kind: "notFound"; resource: string };
```

## Anti-Patterns

```typescript
// BAD: swallowing errors
try {
	await operation();
} catch {
	// silent failure
}

// GOOD: handle meaningfully, or log with context and rethrow
try {
	await operation();
} catch (e) {
	console.error("Operation failed:", e);
	throw e;
}

// BAD: vague internal error messages
throw new Error("Something went wrong");

// GOOD: specific messages for logs and developers
throw new Error(`Could not load gallery collection '${name}'`, { cause: e });
```

Specific messages are for the server log. What the caller sees follows
`CLAUDE.md`: enough to fix their request, nothing that exposes internals.

## References

- [MDN: Error `cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
- [TypeScript Handbook - Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
