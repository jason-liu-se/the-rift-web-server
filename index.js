const app = require("./app.js");
const mongoManger = require("./helpers/mongo-manager.js");

const port = process.env.PORT || 4000;

mongoManger.connect();

app.listen(port, (error) => {
	// Express 5 passes startup errors (e.g. port in use) here instead of throwing.
	if (error) {
		throw error;
	}

	console.log(`Listening on port ${port}`);
});
