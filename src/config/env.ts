import * as z from "zod";

const DEFAULT_PORT = 4000;
const MAX_PORT = 65_535;

// `PORT=` in .env sets an empty string, which would coerce to 0 (a random
// port); treat it as unset instead.
const emptyAsUnset = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
	MONGODB_CONNECTION_STRING: z.string().min(1),
	PORT: z.preprocess(
		emptyAsUnset,
		z.coerce.number().int().min(0).max(MAX_PORT).default(DEFAULT_PORT)
	),
	// The website's origin: the only one CORS allows, and where logins redirect.
	FRONTEND_URL: z
		.url({ protocol: /^https?$/ })
		.transform((url) => new URL(url).origin)
});

export type Env = z.infer<typeof envSchema>;

// What createApp needs; the rest of Env is for connecting and listening.
export type AppConfig = Omit<Env, "MONGODB_CONNECTION_STRING" | "PORT">;

// Exits listing every invalid variable, so a misconfigured server never starts.
export function loadEnv(): Env {
	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		console.error(
			`Invalid environment variables; see README.md:\n${z.prettifyError(result.error)}`
		);
		process.exit(1);
	}

	return result.data;
}
