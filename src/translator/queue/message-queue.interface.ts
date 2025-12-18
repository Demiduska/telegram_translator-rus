import { ChannelConfig } from "../config";

/**
 * Represents a queued message waiting to be sent
 */
export interface QueuedMessage {
  /** Type of message: single or grouped (album) */
  type: "single" | "grouped";

  /** Single message data (for type='single') */
  message?: any;

  /** Array of messages (for type='grouped') */
  messages?: any[];

  /** Grouped ID for albums */
  groupedId?: string;

  /** Channel configuration for this message */
  channelConfig: ChannelConfig;

  /** Number of retry attempts made */
  retryCount?: number;
}
