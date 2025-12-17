import { Injectable, Logger } from "@nestjs/common";
import {
  ChannelConfig,
  ParsedChannelConfiguration,
} from "./channel-config.interface";

/**
 * Service responsible for parsing channel configuration from environment variables
 */
@Injectable()
export class ChannelConfigParserService {
  private readonly logger = new Logger(ChannelConfigParserService.name);

  /**
   * Parse channel configuration from environment variables
   * Supports:
   * - Multi-channel mode (CHANNELS_CONFIG)
   * - Search-based forwarding (SEARCH_CONFIG)
   * - Legacy single-channel mode (SOURCE_CHANNEL_ID + TARGET_CHANNEL_ID or URLs)
   */
  parseConfiguration(): ParsedChannelConfiguration {
    const channels: ChannelConfig[] = [];

    // Parse search-based configurations first
    const searchConfig = process.env.SEARCH_CONFIG;
    if (searchConfig) {
      const searchChannels = this.parseSearchConfig(searchConfig);
      channels.push(...searchChannels);
    }

    // Parse multi-channel configurations
    const channelsConfig = process.env.CHANNELS_CONFIG;
    if (channelsConfig) {
      const multiChannels = this.parseMultiChannelConfig(channelsConfig);
      channels.push(...multiChannels);

      if (channels.length === 0) {
        throw new Error("No valid channels configured in CHANNELS_CONFIG");
      }

      return {
        channels,
        useLegacyMode: false,
      };
    }

    // Legacy single-channel mode
    if (channels.length === 0) {
      return this.parseLegacyConfig();
    }

    return {
      channels,
      useLegacyMode: false,
    };
  }

  /**
   * Parse search-based configuration
   * Format: s-keyword:sourceId:sourceTopicId:targetChannelId
   * Example: s-Gate:-1003316223699:6:-1003540006367
   */
  private parseSearchConfig(searchConfig: string): ChannelConfig[] {
    this.logger.log("Parsing SEARCH_CONFIG for keyword-based forwarding");

    const channels: ChannelConfig[] = [];
    const searchEntries = searchConfig.split(",");

    for (const entry of searchEntries) {
      if (!entry.trim().startsWith("s-")) {
        this.logger.warn(
          `Invalid search config entry (must start with s-): ${entry}`
        );
        continue;
      }

      const parts = entry.split(":");
      if (parts.length < 3) {
        this.logger.warn(`Invalid search config entry: ${entry}`);
        continue;
      }

      // Extract keyword from first part (remove "s-" prefix)
      const keyword = parts[0]?.trim().substring(2);
      const sourceId = parts[1]?.trim();
      const sourceTopicId = parts[2]?.trim();
      const targetChannelId = parts[3]?.trim();

      if (!keyword || !sourceId || !targetChannelId) {
        this.logger.warn(`Invalid search config entry: ${entry}`);
        continue;
      }

      const config: ChannelConfig = {
        sourceId: parseInt(sourceId),
        sourceTopicId: sourceTopicId ? parseInt(sourceTopicId) : undefined,
        targetChannelId: parseInt(targetChannelId),
        searchKeyword: keyword.toLowerCase(), // Store in lowercase for case-insensitive matching
      };

      channels.push(config);

      if (config.sourceTopicId) {
        this.logger.log(
          `🔍 Search configured: keyword="${config.searchKeyword}" in channel ${config.sourceId}, topic ${config.sourceTopicId} -> channel ${config.targetChannelId}`
        );
      } else {
        this.logger.log(
          `🔍 Search configured: keyword="${config.searchKeyword}" in channel ${config.sourceId} -> channel ${config.targetChannelId}`
        );
      }
    }

    return channels;
  }

  /**
   * Parse multi-channel configuration
   * Format:
   * - 3-part: sourceId:targetChannelId:topicId
   * - 4-part: sourceId:sourceTopicId:targetChannelId:targetTopicId
   */
  private parseMultiChannelConfig(channelsConfig: string): ChannelConfig[] {
    this.logger.log("Using multi-channel configuration mode");

    const channels: ChannelConfig[] = [];
    const channelEntries = channelsConfig.split(",");

    for (const entry of channelEntries) {
      const parts = entry.split(":");
      const sourceId = parts[0]?.trim();

      let sourceTopicId: string | undefined;
      let targetChannelId: string;
      let targetTopicId: string | undefined;

      if (parts.length === 4) {
        // 4-part format: sourceId:sourceTopicId:targetChannelId:targetTopicId
        sourceTopicId = parts[1]?.trim();
        targetChannelId = parts[2]?.trim();
        targetTopicId = parts[3]?.trim();
        this.logger.log(
          `Parsing 4-part config: source=${sourceId}, source topic=${sourceTopicId}, target channel=${targetChannelId}, target topic=${targetTopicId}`
        );
      } else {
        // 3-part format: sourceId:targetChannelId:targetTopicId
        targetChannelId = parts[1]?.trim();
        targetTopicId = parts[2]?.trim();
      }

      if (!sourceId || !targetChannelId) {
        this.logger.warn(`Invalid channel config entry: ${entry}`);
        continue;
      }

      const config: ChannelConfig = {
        sourceId: parseInt(sourceId),
        sourceTopicId: sourceTopicId ? parseInt(sourceTopicId) : undefined,
        targetChannelId: parseInt(targetChannelId),
        targetTopicId: targetTopicId ? parseInt(targetTopicId) : undefined,
      };

      channels.push(config);

      if (config.sourceTopicId && config.targetTopicId) {
        this.logger.log(
          `Configured channel ${config.sourceId}, topic ${config.sourceTopicId} -> channel ${config.targetChannelId}, topic ${config.targetTopicId}`
        );
      } else if (config.targetTopicId) {
        this.logger.log(
          `Configured channel ${config.sourceId} -> channel ${config.targetChannelId}, topic ${config.targetTopicId}`
        );
      } else {
        this.logger.log(
          `Configured channel ${config.sourceId} -> channel ${config.targetChannelId}`
        );
      }
    }

    return channels;
  }

  /**
   * Parse legacy single-channel configuration
   * Uses SOURCE_CHANNEL_ID + TARGET_CHANNEL_ID or URLs
   */
  private parseLegacyConfig(): ParsedChannelConfiguration {
    this.logger.log("Using legacy single-channel mode");

    const sourceId = process.env.SOURCE_CHANNEL_ID;
    const targetId = process.env.TARGET_CHANNEL_ID;

    if (sourceId && targetId) {
      const sourceChannelId = parseInt(sourceId);
      const targetChannelId = parseInt(targetId);

      this.logger.log(
        `Using direct channel IDs - Source: ${sourceChannelId}, Target: ${targetChannelId}`
      );

      return {
        channels: [],
        useLegacyMode: true,
        sourceChannelId,
        targetChannelId,
        useDirectIds: true,
      };
    }

    // Will need to resolve from URLs
    return {
      channels: [],
      useLegacyMode: true,
      useDirectIds: false,
    };
  }
}
