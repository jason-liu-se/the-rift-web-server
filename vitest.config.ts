import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Starting MongoDB can be slow, especially when its binary is first downloaded.
		hookTimeout: 60_000
	}
});
