const app = require("./app.js");
const mongoManager = require("./helpers/mongo-manager.js");

const port = process.env.PORT || 4000;

async function start() {
	try {
		await mongoManager.connect(process.env.MONGODB_CONNECTION_STRING);
	} catch (error) {
		console.error(`Could not connect to MongoDB: ${error.message}`);
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

start();
