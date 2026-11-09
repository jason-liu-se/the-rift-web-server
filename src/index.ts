import { app } from "./app.ts";
import * as mongoManager from "./helpers/mongo-manager.ts";

const DEFAULT_PORT = 4000;

const port = process.env["PORT"] || DEFAULT_PORT;
const connectionString = process.env["MONGODB_CONNECTION_STRING"];

async function start() {
	if (!connectionString) {
		console.error("MONGODB_CONNECTION_STRING is not set; see README.md");
		process.exit(1);
	}

	try {
		await mongoManager.connect(connectionString);
	} catch (error) {
		const reason = error instanceof Error ? error.message : error;
		console.error(`Could not connect to MongoDB: ${reason}`);
		process.exit(1);
	}

	app.listen(port, (error) => {
		// Express 5 passes startup errors (e.g. port in use) here instead of throwing.
		if (error) {
			throw error;
		}

		console.log(`Listening on port ${port}`);
	});
}

await start();
