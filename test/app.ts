// The app as tests drive it, built from fixed configuration instead of .env.
import { createApp } from "../src/app.ts";
import type { AppConfig } from "../src/config/env.ts";
import { DEFAULT_READ_RATE_LIMIT_WITHOUT_TUNNEL } from "../src/config/rate-limits.ts";

export const testConfig: AppConfig = {
	FRONTEND_URL: "http://localhost:4200",
	DISCORD_CLIENT_ID: "1000000000000000001",
	DISCORD_CLIENT_SECRET: "test-client-secret",
	DISCORD_REDIRECT_URI: "http://localhost:4000/auth/discord/callback",
	DISCORD_GUILD_ID: "2000000000000000002",
	TRUST_PROXY_HOPS: 0,
	BEHIND_CLOUDFLARE_TUNNEL: false,
	READ_RATE_LIMIT_WITHOUT_TUNNEL: DEFAULT_READ_RATE_LIMIT_WITHOUT_TUNNEL,
	JWT_SECRET:
		"test-secret-that-is-at-least-sixty-four-characters-long-0123456789"
};

export const app = createApp(testConfig);
