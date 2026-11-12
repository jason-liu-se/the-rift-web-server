# Type Safety

Patterns that work with this repo's strict compiler settings (see
`tsconfig.json` for the exact flags).

## Strict-Mode Patterns

### `noUncheckedIndexedAccess`

Indexed access may return `undefined`:

```typescript
const items = ["a", "b", "c"];

// BAD - assumes the index exists
const first = items[0]; // string | undefined
console.log(first.toUpperCase()); // Error: possibly undefined

// GOOD - check before use
if (first !== undefined) {
	console.log(first.toUpperCase());
}

// GOOD - fall back explicitly
const firstOrDefault = items.at(0) ?? "default";
```

### `noPropertyAccessFromIndexSignature`

Index signatures need bracket notation, which makes dynamic access visible:

```typescript
interface Dictionary {
	[key: string]: string;
	knownKey: string;
}

const dict: Dictionary = { knownKey: "value" };

dict.knownKey; // OK, declared property
dict["unknownKey"]; // OK, clearly dynamic
dict.unknownKey; // Error
```

## Fixed Value Domains

Model a closed set of values as a union of string literals, not a plain
`string`. Derive the type from an `as const` array when the values are also
needed at runtime (validation, iteration), so there is one source of truth:

```typescript
// BAD - any string is accepted
interface EventSourceConfig {
	readonly kind: string;
}

// GOOD - one list drives both the type and runtime checks
const EVENT_SOURCE_KINDS = ["cron", "webhook", "matrix"] as const;
type EventSourceKind = (typeof EVENT_SOURCE_KINDS)[number];

interface EventSourceConfig {
	readonly kind: EventSourceKind;
}

// With Zod, validate external input against the same list
const eventSourceKind = z.enum(EVENT_SOURCE_KINDS);
```

Don't use TypeScript `enum`s; they aren't erasable syntax.

## Branded Types

Prevent mixing up primitives that mean different things:

```typescript
type Brand<T, B extends string> = T & { readonly __brand: B };

type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;

function getUser(id: UserId): User {
	/* ... */
}

getUser(orderId); // Error: OrderId is not assignable to UserId
```

Create branded values only after validating them (e.g. in a Zod schema with
`.brand()`), never by casting arbitrary input.

## Readonly and Immutability

```typescript
interface User {
	readonly id: string;
	readonly createdAt: Date;
	name: string;
}

function processItems(items: readonly string[]): void {
	items.push("new"); // Error: push does not exist on readonly string[]
}

const config = {
	api: { baseUrl: "https://api.example.com", timeout: 5000 }
} as const;
```

Don't mutate function parameters; return new values instead.

## Discriminated Unions

Model states and variants so invalid combinations can't be represented, and
check exhaustiveness:

```typescript
type RequestState<T> =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "success"; data: T }
	| { status: "error"; error: Error };

function describe<T>(state: RequestState<T>): string {
	switch (state.status) {
		case "idle":
			return "Ready";
		case "loading":
			return "Loading...";
		case "success":
			return "Done";
		case "error":
			return state.error.message;
		default: {
			const exhaustive: never = state;
			throw new Error(`Unhandled state: ${String(exhaustive)}`);
		}
	}
}
```

## Derived Types

Derive types (utility types, `z.infer<typeof schema>`) instead of redeclaring
them by hand. The exception is `src/contract/api-responses.ts`: the website
keeps a verbatim copy, so its types stay hand-written and dependency-free, and
the schemas are checked against them instead.

## Anti-Patterns

```typescript
// BAD: any
function process(data: any): void {
	data.foo.bar.baz();
}

// GOOD: unknown, then narrow
function process(data: unknown): void {
	if (typeof data === "object" && data !== null && "foo" in data) {
		// narrowed
	}
}

// BAD: asserting the shape of external data
const user = JSON.parse(json) as User;

// GOOD: validate at runtime
const user = userSchema.parse(JSON.parse(json));
```

## References

- [TypeScript Handbook - Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript Handbook - Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [Total TypeScript](https://www.totaltypescript.com/)
