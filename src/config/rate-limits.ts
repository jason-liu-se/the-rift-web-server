// Tunable rate limits. Two separate limiters (src/middleware/rate-limits.ts)
// count different traffic, so neither uses up the other's budget.

/** Auth limiter: the window it counts over, in ms. */
export const AUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Auth limiter: requests to /auth/* each client IP may make per window. */
export const AUTH_RATE_LIMIT = 60;

/** Write limiter: the window it counts over, in ms. */
export const WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Write limiter: writes each logged-in editor may make per window. */
export const WRITE_RATE_LIMIT = 30;
