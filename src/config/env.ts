import * as z from "zod";

const DEFAULT_PORT = 4000;
const MAX_PORT = 65_535;

const envSchema = z.object({
	MONGODB_CONNECTION_STRING: z.string().min(1),
	PORT: z.coerce.number().int().min(0).max(MAX_PORT).default(DEFAULT_PORT)
});

export type Env = z.infer<typeof envSchema>;

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
