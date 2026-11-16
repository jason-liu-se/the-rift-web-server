// Tunable login and session settings (rate limits: rate-limits.ts). Safe to change; keep
// SESSION_TOKEN_TTL_SECONDS well under SESSION_MAX_AGE_MS, and
// REFRESH_GRACE_MS short (it only needs to cover concurrent or retried
// refreshes).

/** How long one access token (the `session` cookie) is valid, in seconds. */
export const SESSION_TOKEN_TTL_SECONDS = 15 * 60;

/** How long after the Discord login a session ends, in ms. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How long after a rotation the previous refresh token still works, in ms. */
export const REFRESH_GRACE_MS = 30 * 1000;

/** How long a started login can take to come back from Discord, in ms. */
export const LOGIN_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Where Discord sends the browser back after a login, under /auth. Must match
 * the redirect URL registered with Discord (DISCORD_REDIRECT_URI).
 */
export const LOGIN_CALLBACK_PATH = "/discord/callback";
