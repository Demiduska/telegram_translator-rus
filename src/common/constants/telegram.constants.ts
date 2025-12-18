/**
 * Default delay between messages to avoid rate limiting (in milliseconds)
 */
export const DEFAULT_MESSAGE_DELAY_MS = 2000;

/**
 * Maximum number of retry attempts for failed messages
 */
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Default wait time when FloodWaitError parsing fails (in seconds)
 */
export const DEFAULT_FLOOD_WAIT_SECONDS = 60;

/**
 * Timeout for collecting grouped messages (in milliseconds)
 */
export const GROUPED_MESSAGE_TIMEOUT_MS = 1000;
