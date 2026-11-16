// Tunable rate limits. Two separate limiters (src/middleware/rate-limits.ts)
// keep separate counts, so neither uses up the other's budget.

/** Auth limiter: the window it counts over, in ms. */
export const AUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Auth limiter: /auth/* and logged-out private requests per client IP per window. */
export const AUTH_RATE_LIMIT = 60;

/** Write limiter: the window it counts over, in ms. */
export const WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Write limiter: writes per editor (or client IP, logged out) per window. */
export const WRITE_RATE_LIMIT = 30;
