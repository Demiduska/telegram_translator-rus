/**
 * Telegram API and connection constants
 */

// Connection settings
export const TELEGRAM_CONNECTION = {
  /** Number of connection retry attempts (Infinity = never stop) */
  CONNECTION_RETRIES: Infinity,

  /** Enable automatic reconnection */
  AUTO_RECONNECT: true,

  /** Delay between reconnection attempts in milliseconds */
  RETRY_DELAY: 1000,

  /** Socket timeout in seconds */
  TIMEOUT: 10,

  /** Number of times to retry failed requests */
  REQUEST_RETRIES: 5,
} as const;

// Monitoring intervals
export const TELEGRAM_MONITORING = {
  /** Interval for keepalive ping in milliseconds (60 seconds) */
  KEEPALIVE_INTERVAL_MS: 60000,

  /** Interval for connection check in milliseconds (30 seconds) */
  CONNECTION_CHECK_INTERVAL_MS: 30000,

  /** Wait time before attempting reconnection in milliseconds */
  RECONNECT_WAIT_MS: 2000,

  /** Timeout for waiting for client to be ready in milliseconds */
  READY_TIMEOUT_MS: 30000,

  /** Interval for checking if client is ready in milliseconds */
  READY_CHECK_INTERVAL_MS: 100,
} as const;

// Message processing
export const MESSAGE_PROCESSING = {
  /** Default delay between messages in milliseconds */
  DEFAULT_MESSAGE_DELAY_MS: 2000,

  /** Maximum retry attempts for failed messages */
  MAX_RETRY_ATTEMPTS: 3,

  /** Timeout for grouping album messages in milliseconds */
  ALBUM_GROUPING_TIMEOUT_MS: 1000,

  /** Default wait time for FloodWaitError in seconds */
  DEFAULT_FLOOD_WAIT_SECONDS: 60,
} as const;

// Text replacements
export const TEXT_REPLACEMENTS = {
  /** Text patterns to replace */
  PATTERNS: {
    /** Old bot username to replace */
    OLD_BOT: /@pass1fybot/gi,
    /** New bot username */
    NEW_BOT: "@cheapmirror",
  },
} as const;
