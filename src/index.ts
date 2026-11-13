import type { Server } from "node:http";
import { createApp } from "./app.ts";
import { loadEnv } from "./config/env.ts";
import { SHUTDOWN_TIMEOUT_MS } from "./config/timeouts.ts";
import * as mongoManager from "./helpers/mongo-manager.ts";
import * as redisManager from "./helpers/redis-manager.ts";

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

async function start() {
	const env = loadEnv();
	const { MONGODB_CONNECTION_STRING, REDIS_URL, PORT } = env;

	await connectOrExit("MongoDB", () =>
		mongoManager.connect(MONGODB_CONNECTION_STRING)
	);
	await connectOrExit("Redis", () => redisManager.connect(REDIS_URL));

	const server = createApp(env).listen(PORT, (error) => {
		// Express 5 passes startup errors (e.g. port in use) here instead of throwing.
		if (error) {
			console.error(`Could not listen on port ${PORT}: ${error.message}`);
			process.exit(1);
		}

		console.log(`Listening on port ${PORT}`);
	});

	// `once`: a second Ctrl+C falls back to Node's default and exits immediately.
	for (const signal of SHUTDOWN_SIGNALS) {
		process.once(signal, () => shutDown(server, signal));
	}
}

async function connectOrExit(
	name: string,
	connect: () => Promise<void>
): Promise<void> {
	try {
		await connect();
	} catch (error) {
		const reason = error instanceof Error ? error.message : error;
		console.error(`Could not connect to ${name}: ${reason}`);
		process.exit(1);
	}
}

let isShuttingDown = false;

// Stops accepting connections, lets in-flight requests finish, then closes the
// database connections so the process can exit on its own.
async function shutDown(server: Server, signal: NodeJS.Signals) {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;
	console.log(`${signal} received; shutting down`);

	// Don't let a hung request or connection block the exit forever.
	setTimeout(() => {
		console.error("Shutdown timed out; forcing exit");
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS).unref();

	try {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
		await Promise.all([
			mongoManager.disconnect(),
			redisManager.disconnect()
		]);
	} catch (error) {
		console.error("ERROR: shutdown failed:", error);
		process.exit(1);
	}
}

await start();
