import { Injectable, Logger } from "@nestjs/common";

/**
 * Service responsible for mapping source message IDs to target message IDs
 */
@Injectable()
export class MessageMappingService {
  private readonly logger = new Logger(MessageMappingService.name);

  // Map to store source message ID -> (target channel ID + target topic ID -> target message ID)
  // Key format: "channelId:topicId" or "channelId" if no topic
  private messageMapping: Map<number, Map<string, number>> = new Map();

  /**
   * Generate a unique key for message mapping
   * Format: "channelId:topicId" or "channelId" if no topic
   */
  getMappingKey(channelId: number, topicId?: number): string {
    return topicId ? `${channelId}:${topicId}` : `${channelId}`;
  }

  /**
   * Store a message ID mapping
   */
  setMapping(
    sourceMessageId: number,
    targetChannelId: number,
    targetMessageId: number,
    targetTopicId?: number
  ): void {
    if (!this.messageMapping.has(sourceMessageId)) {
      this.messageMapping.set(sourceMessageId, new Map());
    }

    const mappingKey = this.getMappingKey(targetChannelId, targetTopicId);
    this.messageMapping.get(sourceMessageId)!.set(mappingKey, targetMessageId);

    this.logger.log(
      `💾 Stored mapping: source ${sourceMessageId} -> target ${targetMessageId} (key: ${mappingKey})`
    );
  }

  /**
   * Get a target message ID from source message ID
   */
  getMapping(
    sourceMessageId: number,
    targetChannelId: number,
    targetTopicId?: number
  ): number | undefined {
    const channelMap = this.messageMapping.get(sourceMessageId);
    if (!channelMap) {
      return undefined;
    }

    const mappingKey = this.getMappingKey(targetChannelId, targetTopicId);
    return channelMap.get(mappingKey);
  }

  /**
   * Check if a mapping exists
   */
  hasMapping(
    sourceMessageId: number,
    targetChannelId: number,
    targetTopicId?: number
  ): boolean {
    const targetId = this.getMapping(
      sourceMessageId,
      targetChannelId,
      targetTopicId
    );
    return targetId !== undefined;
  }

  /**
   * Clear all mappings (useful for testing)
   */
  clearAllMappings(): void {
    this.messageMapping.clear();
    this.logger.log("Cleared all message mappings");
  }
}
