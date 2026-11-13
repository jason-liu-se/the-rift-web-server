import type { RequestHandler } from "express";

// CORS: only the website may call the API from a browser, with its cookies.
// Other origins get no CORS headers, so browsers block their requests.
// Server-to-server calls (e.g. the website's server rendering) send no Origin
// and aren't affected.
export function allowFrontendOrigin(frontendOrigin: string): RequestHandler {
	return (req, res, next) => {
		// The answer depends on Origin, so caches mustn't share it between origins.
		res.vary("Origin");
		if (req.headers.origin === frontendOrigin) {
			res.header("Access-Control-Allow-Origin", frontendOrigin);
			res.header("Access-Control-Allow-Credentials", "true");
			res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
			res.header("Access-Control-Allow-Headers", "Content-Type");
		}
		if (req.method === "OPTIONS") {
			res.sendStatus(204);
		} else {
			next();
		}
	};
}
