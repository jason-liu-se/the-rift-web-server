// Tunable timeouts and retry delays, all in ms.

/** How long one Discord request may take, response body included. */
export const DISCORD_TIMEOUT_MS = 10_000;

/** How long a graceful shutdown may take before the process is killed. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Redis reconnects back off exponentially from this delay... */
export const RECONNECT_BASE_DELAY_MS = 50;

/** ...up to this one. */
export const MAX_RECONNECT_DELAY_MS = 2000;
