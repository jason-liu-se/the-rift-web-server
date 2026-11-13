// The app as tests drive it, built from fixed configuration instead of .env.
import { createApp } from "../src/app.ts";
import type { AppConfig } from "../src/config/env.ts";

export const testConfig: AppConfig = {
	FRONTEND_URL: "http://localhost:4200"
};

export const app = createApp(testConfig);
