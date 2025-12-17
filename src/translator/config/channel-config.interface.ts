/**
 * Configuration for a single channel mapping
 */
export interface ChannelConfig {
  /** Source channel ID to listen for messages */
  sourceId: number;

  /** Optional: filter messages from this specific source topic */
  sourceTopicId?: number;

  /** Target channel ID where messages will be forwarded */
  targetChannelId: number;

  /** Optional: target topic ID for posting to topics in a group */
  targetTopicId?: number;

  /** Optional: only forward messages containing this keyword (case-insensitive) */
  searchKeyword?: string;
}

/**
 * Parsed configuration result
 */
export interface ParsedChannelConfiguration {
  /** Array of channel configurations */
  channels: ChannelConfig[];

  /** Whether legacy single-channel mode is enabled */
  useLegacyMode: boolean;

  /** Legacy mode: source channel ID */
  sourceChannelId?: number;

  /** Legacy mode: target channel ID */
  targetChannelId?: number;

  /** Legacy mode: whether to use direct IDs (skip resolution) */
  useDirectIds?: boolean;
}
