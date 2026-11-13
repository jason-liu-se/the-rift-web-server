import * as z from "zod";

const DEFAULT_PORT = 4000;
const DEFAULT_TRUST_PROXY_HOPS = 0;
const MAX_PORT = 65_535;
const MIN_JWT_SECRET_LENGTH = 64;

// Discord IDs ("snowflakes") are 64-bit integers written as decimal strings.
const discordId = z.string().regex(/^\d{1,20}$/, "must be a Discord ID");

// `PORT=` in .env sets an empty string, which would coerce to 0 (a random
// port); treat it as unset instead.
const emptyAsUnset = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
	MONGODB_CONNECTION_STRING: z.string().min(1),
	// Where refresh tokens are stored (README "Sessions and access").
	REDIS_URL: z.url({ protocol: /^rediss?$/ }),
	PORT: z.preprocess(
		emptyAsUnset,
		z.coerce.number().int().min(0).max(MAX_PORT).default(DEFAULT_PORT)
	),
	// The website's origin: the only one CORS allows, and where logins redirect.
	FRONTEND_URL: z
		.url({ protocol: /^https?$/ })
		.transform((url) => new URL(url).origin),
	// Signs session tokens; rotating it logs everyone out (README "Sessions
	// and access").
	JWT_SECRET: z.string().min(MIN_JWT_SECRET_LENGTH),
	// From the Discord application's OAuth2 page (README "Sessions and access").
	DISCORD_CLIENT_ID: discordId,
	DISCORD_CLIENT_SECRET: z.string().min(1),
	// This API's /auth/discord/callback, as registered with Discord.
	DISCORD_REDIRECT_URI: z.url({ protocol: /^https?$/ }),
	// The Rift's Discord server, whose roles access grants can name.
	DISCORD_GUILD_ID: discordId,
	// How many proxies (e.g. the host's load balancer) sit in front of the
	// server, so req.ip, and so rate limiting, sees the client's address.
	TRUST_PROXY_HOPS: z.preprocess(
		emptyAsUnset,
		z.coerce.number().int().min(0).default(DEFAULT_TRUST_PROXY_HOPS)
	)
});

export type Env = z.infer<typeof envSchema>;

// What createApp needs; the rest of Env is for connecting and listening.
export type AppConfig = Omit<
	Env,
	"MONGODB_CONNECTION_STRING" | "REDIS_URL" | "PORT"
>;

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
