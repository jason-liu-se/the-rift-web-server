import type { RequestHandler } from "express";

// CORS: only the website may call the API from a browser, with its cookies.
// Browsers block other origins, since the allowed origin isn't theirs.
// The headers are the same for every request, whatever its Origin, so a cached
// response (e.g. one filled by the website's server rendering, which sends no
// Origin) still works for the browser. Cloudflare ignores Vary, so headers
// that varied by Origin would be cached for the wrong caller.
export function allowFrontendOrigin(frontendOrigin: string): RequestHandler {
	return (req, res, next) => {
		res.header("Access-Control-Allow-Origin", frontendOrigin);
		res.header("Access-Control-Allow-Credentials", "true");
		res.header(
			"Access-Control-Allow-Methods",
			"GET,POST,PATCH,DELETE,OPTIONS"
		);
		res.header("Access-Control-Allow-Headers", "Content-Type");
		if (req.method === "OPTIONS") {
			res.sendStatus(204);
		} else {
			next();
		}
	};
}
