import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { TelegramService } from "../telegram/telegram.service";
import { NewMessageEvent } from "telegram/events";

interface ChannelConfig {
  sourceId: number;
  sourceTopicId?: number; // Optional: filter messages from this specific source topic
  targetChannelId: number;
  targetTopicId?: number; // Optional: for posting to topics in a group
  searchKeyword?: string; // Optional: only forward messages containing this keyword (case-insensitive)
}

interface QueuedMessage {
  type: "single" | "grouped";
  message?: any;
  messages?: any[];
  groupedId?: string;
  channelConfig: ChannelConfig;
  retryCount?: number;
}

@Injectable()
export class TranslatorService implements OnModuleInit {
  private readonly logger = new Logger(TranslatorService.name);
  private channels: ChannelConfig[] = [];
  private groupedMessages: Map<
    string,
    { messages: any[]; timeout: NodeJS.Timeout; channelConfig: ChannelConfig }
  > = new Map();
  // Map to store source message ID -> (target channel ID + target topic ID -> target message ID)
  // Key format: "channelId:topicId" or "channelId" if no topic
  private messageMapping: Map<number, Map<string, number>> = new Map();

  // Message queue and rate limiting
  private messageQueue: QueuedMessage[] = [];
  private isProcessingQueue: boolean = false;
  private readonly MESSAGE_DELAY_MS: number;
  private readonly MAX_RETRY_ATTEMPTS = 3;

  // Legacy mode support
  private sourceChannelId: number;
  private targetChannelId: number;
  private useDirectIds: boolean = false;
  private useLegacyMode: boolean = false;

  constructor(private readonly telegramService: TelegramService) {
    this.parseChannelConfiguration();
    // Get message delay from env or use default (2 seconds)
    this.MESSAGE_DELAY_MS = parseInt(
      process.env.MESSAGE_DELAY_MS || "2000",
      10
    );
    this.logger.log(`Message delay set to ${this.MESSAGE_DELAY_MS}ms`);
  }

  /**
   * Generate a unique key for message mapping
   * Format: "channelId:topicId" or "channelId" if no topic
   */
  private getMappingKey(channelId: number, topicId?: number): string {
    return topicId ? `${channelId}:${topicId}` : `${channelId}`;
  }

  /**
   * Simple text replacement function
   * Replaces @pass1fybot with @cheapmirror
   */
  private replaceText(text: string): string {
    if (!text) return text;
    return text.replace(/@pass1fybot/gi, "@cheapmirror");
  }

  /**
   * Adjust message entities after text replacement
   * Updates entity offsets and lengths if text was modified
   */
  private adjustEntities(
    originalText: string,
    newText: string,
    entities: any[]
  ): any[] {
    if (!entities || entities.length === 0) return entities;

    // If text length didn't change, entities should be fine as-is
    if (originalText.length === newText.length) {
      return entities;
    }

    // For more complex replacements, we'd need to track each replacement
    // For now, we'll just return the entities as-is since our replacement
    // (@pass1fybot -> @cheapmirror) maintains the same length
    return entities;
  }

  private parseChannelConfiguration() {
    const channelsConfig = process.env.CHANNELS_CONFIG;
    const searchConfig = process.env.SEARCH_CONFIG;

    // Parse search-based configurations first
    if (searchConfig) {
      this.logger.log("Parsing SEARCH_CONFIG for keyword-based forwarding");

      const searchEntries = searchConfig.split(",");

      for (const entry of searchEntries) {
        // Format: s-keyword:sourceId:sourceTopicId:targetChannelId
        // Example: s-Gate:-1003316223699:6:-1003540006367
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

        this.channels.push(config);

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
    }

    if (channelsConfig) {
      // Multi-channel mode
      this.logger.log("Using multi-channel configuration mode");

      // Parse format:
      // 3-part: sourceId:targetChannelId:topicId
      // 4-part: sourceId:sourceTopicId:targetChannelId:targetTopicId
      // topicId is optional (0 or omitted means post to main channel, not a topic)
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

        this.channels.push(config);

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

      if (this.channels.length === 0) {
        throw new Error("No valid channels configured in CHANNELS_CONFIG");
      }
    } else {
      // Legacy single-channel mode
      this.logger.log("Using legacy single-channel mode");
      this.useLegacyMode = true;

      const sourceId = process.env.SOURCE_CHANNEL_ID;
      const targetId = process.env.TARGET_CHANNEL_ID;

      if (sourceId && targetId) {
        this.sourceChannelId = parseInt(sourceId);
        this.targetChannelId = parseInt(targetId);
        this.useDirectIds = true;
        this.logger.log(
          `Using direct channel IDs - Source: ${this.sourceChannelId}, Target: ${this.targetChannelId}`
        );
      }
    }
  }

  async onModuleInit() {
    // Wait for TelegramService to be ready
    await this.telegramService.waitForReady();

    if (this.useLegacyMode) {
      // Only resolve if we don't have direct IDs
      if (!this.useDirectIds) {
        await this.resolveChannelIds();
      }
      this.startWatchingLegacy();
    } else {
      this.startWatchingMultiChannel();
    }
  }

  private async resolveChannelIds() {
    const sourceUrl = process.env.SOURCE_CHANNEL_URL;
    const targetUrl = process.env.TARGET_CHANNEL_URL;

    if (!sourceUrl || !targetUrl) {
      throw new Error(
        "Missing channel configuration. Provide either SOURCE_CHANNEL_ID + TARGET_CHANNEL_ID or SOURCE_CHANNEL_URL + TARGET_CHANNEL_URL in .env"
      );
    }

    this.logger.log("Resolving Telegram channel IDs from URLs...");

    try {
      const sourceEntity: any = await this.telegramService.getEntity(sourceUrl);
      const targetEntity: any = await this.telegramService.getEntity(targetUrl);

      // Extract the actual ID from the entity
      // The entity object structure may vary, so we handle different cases
      this.sourceChannelId = sourceEntity.id?.value
        ? Number(sourceEntity.id.value)
        : Number(sourceEntity.id);

      this.targetChannelId = targetEntity.id?.value
        ? Number(targetEntity.id.value)
        : Number(targetEntity.id);

      this.logger.log(
        `Resolved source channel ID: ${this.sourceChannelId}, target channel ID: ${this.targetChannelId}`
      );
    } catch (error) {
      this.logger.error("Failed to resolve channel IDs", error.stack);
      throw error;
    }
  }

  private startWatchingMultiChannel() {
    this.logger.log(
      `Starting to watch ${this.channels.length} channel configurations...`
    );

    // Group channel configs by source ID to avoid duplicate handlers
    const sourceChannelMap = new Map<number, ChannelConfig[]>();

    for (const channelConfig of this.channels) {
      if (!sourceChannelMap.has(channelConfig.sourceId)) {
        sourceChannelMap.set(channelConfig.sourceId, []);
      }
      sourceChannelMap.get(channelConfig.sourceId)!.push(channelConfig);

      if (channelConfig.targetTopicId) {
        this.logger.log(
          `📢 Configured: channel ${channelConfig.sourceId} -> channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
        );
      } else {
        this.logger.log(
          `📢 Configured: channel ${channelConfig.sourceId} -> channel ${channelConfig.targetChannelId}`
        );
      }
    }

    // Add one handler per unique source channel
    this.logger.log(
      `Adding handlers for ${sourceChannelMap.size} unique source channels`
    );

    for (const [sourceId, configs] of sourceChannelMap.entries()) {
      this.telegramService.addNewMessageHandler(sourceId, (event) =>
        this.handleNewMessageMultiAll(event, configs)
      );

      this.telegramService.addEditedMessageHandler(sourceId, (event) =>
        this.handleEditedMessageMultiAll(event, configs)
      );

      this.logger.log(
        `✅ Listening to source channel ${sourceId} (${configs.length} target configurations)`
      );
    }
  }

  private startWatchingLegacy() {
    this.logger.log(
      `Starting to watch channel ${this.sourceChannelId} for messages...`
    );

    this.telegramService.addNewMessageHandler(
      this.sourceChannelId,
      this.handleNewMessage.bind(this)
    );

    this.telegramService.addEditedMessageHandler(
      this.sourceChannelId,
      this.handleEditedMessage.bind(this)
    );
  }

  private async handleNewMessageMultiAll(
    event: NewMessageEvent,
    channelConfigs: ChannelConfig[]
  ) {
    try {
      const message = event.message;
      const groupedId = (message as any).groupedId?.toString();

      // Get the source topic ID from the message (if it's posted to a topic)
      // In Telegram forums, messages in topics have replyTo.replyToMsgId pointing to the topic's root message ID
      const messageTopicId = (message as any).replyTo?.replyToMsgId;

      // Filter configs based on source topic ID
      const applicableConfigs = channelConfigs.filter((config) => {
        // If config has a source topic filter, check if message matches
        if (config.sourceTopicId !== undefined) {
          return messageTopicId === config.sourceTopicId;
        }
        // If no source topic filter, accept all messages from this channel
        return true;
      });

      if (applicableConfigs.length === 0) {
        this.logger.debug(
          `Message from topic ${messageTopicId} doesn't match any configured source topics, skipping`
        );
        return;
      }

      this.logger.log(
        `Processing message from topic ${messageTopicId}, matched ${applicableConfigs.length} configuration(s)`
      );

      // Process message for each applicable channel config
      for (const channelConfig of applicableConfigs) {
        if (groupedId) {
          // This is part of an album - collect all messages before processing
          const groupKey = `${groupedId}_${channelConfig.targetChannelId}_${
            channelConfig.targetTopicId || 0
          }`;

          if (!this.groupedMessages.has(groupKey)) {
            this.groupedMessages.set(groupKey, {
              messages: [],
              timeout: null as any,
              channelConfig,
            });
          }

          const groupData = this.groupedMessages.get(groupKey)!;
          groupData.messages.push(message);

          // Clear existing timeout
          if (groupData.timeout) {
            clearTimeout(groupData.timeout);
          }

          // Set a new timeout to process the group after 1 second of no new messages
          groupData.timeout = setTimeout(async () => {
            await this.processGroupedMessagesMulti(
              groupKey,
              groupData.messages,
              channelConfig
            );
            this.groupedMessages.delete(groupKey);
          }, 1000);

          this.logger.log(
            `Collected message ${groupData.messages.length} for group ${groupKey}`
          );
        } else {
          // Not part of a group - process immediately
          await this.processSingleMessageMulti(message, channelConfig);
        }
      }
    } catch (error) {
      this.logger.error(
        `Error processing message: ${error.message}`,
        error.stack
      );
    }
  }

  private async handleNewMessageMulti(
    event: NewMessageEvent,
    channelConfig: ChannelConfig
  ) {
    // Legacy method - kept for compatibility
    await this.handleNewMessageMultiAll(event, [channelConfig]);
  }

  private async handleNewMessage(event: NewMessageEvent) {
    try {
      const message = event.message;
      const messageText = message.message;
      const hasMedia = message.media;

      // Check if this message is part of a grouped media (album)
      const groupedId = (message as any).groupedId?.toString();

      if (groupedId) {
        // This is part of an album - collect all messages before processing
        if (!this.groupedMessages.has(groupedId)) {
          this.groupedMessages.set(groupedId, {
            messages: [],
            timeout: null as any,
            channelConfig: null as any,
          });
        }

        const groupData = this.groupedMessages.get(groupedId)!;
        groupData.messages.push(message);

        // Clear existing timeout
        if (groupData.timeout) {
          clearTimeout(groupData.timeout);
        }

        // Set a new timeout to process the group after 1 second of no new messages
        groupData.timeout = setTimeout(async () => {
          await this.processGroupedMessages(groupedId, groupData.messages);
          this.groupedMessages.delete(groupedId);
        }, 1000);

        this.logger.log(
          `Collected message ${groupData.messages.length} for group ${groupedId}`
        );
        return;
      }

      // Not part of a group - process immediately
      await this.processSingleMessage(message);
    } catch (error) {
      this.logger.error(
        `Error processing message: ${error.message}`,
        error.stack
      );
    }
  }

  private async processGroupedMessagesMulti(
    groupedId: string,
    messages: any[],
    channelConfig: ChannelConfig
  ) {
    try {
      this.logger.log(
        `Processing grouped messages (${messages.length} items) for group ${groupedId} from channel ${channelConfig.sourceId}`
      );

      // Add grouped message to queue for rate-limited processing
      this.addToQueue({
        type: "grouped",
        messages: messages,
        groupedId: groupedId,
        channelConfig: channelConfig,
      });
    } catch (error) {
      this.logger.error(
        `Error processing grouped messages: ${error.message}`,
        error.stack
      );
    }
  }

  private async processGroupedMessages(groupedId: string, messages: any[]) {
    try {
      this.logger.log(
        `Processing grouped messages (${messages.length} items) for group ${groupedId}`
      );

      // Add grouped message to queue for rate-limited processing
      // For legacy mode, we need to create a channel config
      const legacyChannelConfig: ChannelConfig = {
        sourceId: this.sourceChannelId,
        targetChannelId: this.targetChannelId,
      };

      this.addToQueue({
        type: "grouped",
        messages: messages,
        groupedId: groupedId,
        channelConfig: legacyChannelConfig,
      });
    } catch (error) {
      this.logger.error(
        `Error processing grouped messages: ${error.message}`,
        error.stack
      );
    }
  }

  private async processSingleMessageMulti(
    message: any,
    channelConfig: ChannelConfig
  ) {
    try {
      const messageText = message.message;
      const hasMedia = message.media;
      const isPhoto = hasMedia && (message.media as any).photo !== undefined;

      // If this config has a search keyword, check if the message contains it
      if (channelConfig.searchKeyword) {
        const messageTextLower = messageText ? messageText.toLowerCase() : "";

        if (!messageTextLower.includes(channelConfig.searchKeyword)) {
          this.logger.debug(
            `Message doesn't contain keyword "${channelConfig.searchKeyword}", skipping`
          );
          return;
        }

        this.logger.log(
          `✅ Keyword "${channelConfig.searchKeyword}" found in message!`
        );
      }

      // Log message info
      if (hasMedia) {
        this.logger.log(
          `New message with ${isPhoto ? "photo" : "media"} from channel ${
            channelConfig.sourceId
          }. Text: ${
            messageText ? messageText.substring(0, 50) : "(no text)"
          }...`
        );
      } else if (messageText) {
        this.logger.log(
          `New message from channel ${
            channelConfig.sourceId
          }: ${messageText.substring(0, 100)}...`
        );
      } else {
        this.logger.log("Received message without text or media, skipping...");
        return;
      }

      // Add message to queue for rate-limited processing
      this.addToQueue({
        type: "single",
        message: message,
        channelConfig: channelConfig,
      });
    } catch (error) {
      this.logger.error(
        `Error processing single message: ${error.message}`,
        error.stack
      );
    }
  }

  private async processSingleMessage(message: any) {
    try {
      const messageText = message.message;
      const hasMedia = message.media;
      const isPhoto = hasMedia && (message.media as any).photo !== undefined;
      const sourceMessageId = message.id;
      const replyToMsgId = message.replyTo?.replyToMsgId;

      // Log message info
      if (hasMedia) {
        this.logger.log(
          `New message with ${isPhoto ? "photo" : "media"} received. Text: ${
            messageText ? messageText.substring(0, 50) : "(no text)"
          }...`
        );
      } else if (messageText) {
        this.logger.log(
          `New message received: ${messageText.substring(0, 100)}...`
        );
      } else {
        this.logger.log("Received message without text or media, skipping...");
        return;
      }

      // Check if this is a reply to another message
      let targetReplyToMsgId: number | undefined;
      if (replyToMsgId) {
        const channelMap = this.messageMapping.get(replyToMsgId);
        const mappingKey = this.getMappingKey(this.targetChannelId);
        targetReplyToMsgId = channelMap?.get(mappingKey);
        if (targetReplyToMsgId) {
          this.logger.log(
            `This is a reply to message ${replyToMsgId}, will reply to target message ${targetReplyToMsgId}`
          );
        } else {
          this.logger.warn(
            `This is a reply to message ${replyToMsgId}, but no mapping found in target channel`
          );
        }
      }

      // Replace text if present and get entities
      let processedText = "";
      const messageEntities = message.entities || [];
      let adjustedEntities = messageEntities;

      if (messageText) {
        processedText = this.replaceText(messageText);
        adjustedEntities = this.adjustEntities(
          messageText,
          processedText,
          messageEntities
        );
        this.logger.log(
          "Text processed (replaced @pass1fybot with @cheapmirror)"
        );
      }

      let sentMessage: any;

      // Prepare send options
      const sendOptions: any = {
        message: processedText,
      };

      // Add reply-to if needed
      if (targetReplyToMsgId) {
        sendOptions.replyTo = targetReplyToMsgId;
      }

      // Preserve message entities (links, mentions, etc.)
      if (adjustedEntities && adjustedEntities.length > 0) {
        sendOptions.formattingEntities = adjustedEntities;
      }

      // Preserve inline keyboard buttons (reply markup)
      if (message.replyMarkup) {
        sendOptions.buttons = message.replyMarkup;
        this.logger.log(
          "Including inline keyboard buttons from original message"
        );
      }

      // If message contains media
      if (hasMedia) {
        sendOptions.file = message.media;

        sentMessage = await this.telegramService
          .getClient()
          .sendMessage(this.targetChannelId, sendOptions);
        this.logger.log("Message with media posted successfully");
      } else {
        // Text-only message
        sentMessage = await this.telegramService
          .getClient()
          .sendMessage(this.targetChannelId, sendOptions);
        this.logger.log("Message posted successfully");
      }

      // Store the message ID mapping per channel
      if (sentMessage && sentMessage.id) {
        if (!this.messageMapping.has(sourceMessageId)) {
          this.messageMapping.set(sourceMessageId, new Map());
        }
        const mappingKey = this.getMappingKey(this.targetChannelId);
        this.messageMapping
          .get(sourceMessageId)!
          .set(mappingKey, sentMessage.id);
        this.logger.log(
          `Stored mapping: source ${sourceMessageId} -> target ${sentMessage.id}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Error processing single message: ${error.message}`,
        error.stack
      );
    }
  }

  private async handleEditedMessageMultiAll(
    event: any,
    channelConfigs: ChannelConfig[]
  ) {
    try {
      const message = event.message;
      const sourceMessageId = message.id;
      const messageText = message.message;

      this.logger.log(
        `Message ${sourceMessageId} was edited, processing ${channelConfigs.length} target configurations`
      );

      // Get the source topic ID from the message to match the exact config
      const messageTopicId = (message as any).replyTo?.replyToMsgId;

      // Keep track of edited messages to avoid duplicates
      const editedTargets = new Set<string>();

      // Process edit for each channel config that has this message
      for (const channelConfig of channelConfigs) {
        // Match the config that was used to send this message originally
        // If the config has a source topic filter, check if it matches
        if (
          channelConfig.sourceTopicId !== undefined &&
          messageTopicId !== channelConfig.sourceTopicId
        ) {
          continue;
        }

        // Check if we have a mapping for this message in this specific channel+topic combination
        const channelMap = this.messageMapping.get(sourceMessageId);
        const mappingKey = this.getMappingKey(
          channelConfig.targetChannelId,
          channelConfig.targetTopicId
        );
        const targetMessageId = channelMap?.get(mappingKey);

        if (!targetMessageId) {
          this.logger.debug(
            `No mapping found for edited message ${sourceMessageId} with key ${mappingKey}, skipping`
          );
          continue;
        }

        // Check if we already edited this target message (prevent duplicates)
        const targetKey = `${channelConfig.targetChannelId}:${targetMessageId}`;
        if (editedTargets.has(targetKey)) {
          this.logger.debug(
            `Already edited message ${targetMessageId} in channel ${channelConfig.targetChannelId}, skipping duplicate`
          );
          continue;
        }
        editedTargets.add(targetKey);

        // Replace the new text
        let processedText = "";
        if (messageText) {
          processedText = this.replaceText(messageText);
        }

        // Edit the message in the target channel
        await this.telegramService.editMessage(
          channelConfig.targetChannelId,
          targetMessageId,
          processedText
        );

        if (channelConfig.targetTopicId) {
          this.logger.log(
            `✅ Message ${targetMessageId} edited in channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
          );
        } else {
          this.logger.log(
            `✅ Message ${targetMessageId} edited in channel ${channelConfig.targetChannelId}`
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error handling edited message: ${error.message}`,
        error.stack
      );
    }
  }

  private async handleEditedMessageMulti(
    event: any,
    channelConfig: ChannelConfig
  ) {
    // Legacy method - kept for compatibility
    await this.handleEditedMessageMultiAll(event, [channelConfig]);
  }

  private async handleEditedMessage(event: any) {
    try {
      const message = event.message;
      const sourceMessageId = message.id;
      const messageText = message.message;

      this.logger.log(`Message ${sourceMessageId} was edited`);

      // Check if we have a mapping for this message in the target channel
      const channelMap = this.messageMapping.get(sourceMessageId);
      const mappingKey = this.getMappingKey(this.targetChannelId);
      const targetMessageId = channelMap?.get(mappingKey);

      if (!targetMessageId) {
        this.logger.warn(
          `No mapping found for edited message ${sourceMessageId}, skipping edit`
        );
        return;
      }

      // Replace the new text
      let processedText = "";
      if (messageText) {
        processedText = this.replaceText(messageText);
        this.logger.log("Edited text processed");
      }

      // Edit the message in the target channel
      await this.telegramService.editMessage(
        this.targetChannelId,
        targetMessageId,
        processedText
      );

      this.logger.log(
        `✅ Message ${targetMessageId} edited successfully in target channel`
      );
    } catch (error) {
      this.logger.error(
        `Error handling edited message: ${error.message}`,
        error.stack
      );
    }
  }

  /**
   * Add message to the queue for rate-limited processing
   */
  private addToQueue(queuedMessage: QueuedMessage) {
    this.messageQueue.push(queuedMessage);
    this.logger.log(
      `Message added to queue. Queue size: ${this.messageQueue.length}`
    );

    // Start processing queue if not already running
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  /**
   * Process messages from the queue with rate limiting
   */
  private async processQueue() {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;
    this.logger.log("Started processing message queue");

    while (this.messageQueue.length > 0) {
      const queuedMessage = this.messageQueue.shift()!;

      try {
        if (queuedMessage.type === "single") {
          await this.sendSingleMessage(queuedMessage);
        } else {
          await this.sendGroupedMessage(queuedMessage);
        }

        // Wait before processing next message
        if (this.messageQueue.length > 0) {
          this.logger.log(
            `Waiting ${this.MESSAGE_DELAY_MS}ms before next message...`
          );
          await this.sleep(this.MESSAGE_DELAY_MS);
        }
      } catch (error) {
        await this.handleSendError(error, queuedMessage);
      }
    }

    this.isProcessingQueue = false;
    this.logger.log("Finished processing message queue");
  }

  /**
   * Handle errors when sending messages, including FloodWaitError
   */
  private async handleSendError(error: any, queuedMessage: QueuedMessage) {
    const isFloodWait = this.isFloodWaitError(error);

    if (isFloodWait) {
      const waitSeconds = this.extractWaitTime(error);
      this.logger.warn(
        `FloodWaitError: Need to wait ${waitSeconds} seconds. Adding message back to queue.`
      );

      // Increment retry count
      queuedMessage.retryCount = (queuedMessage.retryCount || 0) + 1;

      if (queuedMessage.retryCount <= this.MAX_RETRY_ATTEMPTS) {
        // Add back to the front of the queue
        this.messageQueue.unshift(queuedMessage);

        // Wait for the specified time
        this.logger.log(`Waiting ${waitSeconds} seconds before retry...`);
        await this.sleep(waitSeconds * 1000);
      } else {
        this.logger.error(
          `Message exceeded max retry attempts (${this.MAX_RETRY_ATTEMPTS}). Dropping message.`
        );
      }
    } else {
      this.logger.error(`Error sending message: ${error.message}`, error.stack);
    }
  }

  /**
   * Check if error is a FloodWaitError
   */
  private isFloodWaitError(error: any): boolean {
    return (
      error.constructor.name === "FloodWaitError" ||
      error.message?.includes("A wait of") ||
      error.message?.includes("seconds is required")
    );
  }

  /**
   * Extract wait time from FloodWaitError message
   */
  private extractWaitTime(error: any): number {
    const match = error.message?.match(/wait of (\d+) seconds/);
    return match ? parseInt(match[1], 10) : 60; // Default to 60 seconds if can't parse
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send a single message from the queue
   */
  private async sendSingleMessage(queuedMessage: QueuedMessage) {
    const message = queuedMessage.message!;
    const channelConfig = queuedMessage.channelConfig;
    const messageText = message.message;
    const hasMedia = message.media;
    const isPhoto = hasMedia && (message.media as any).photo !== undefined;
    const sourceMessageId = message.id;
    const replyToMsgId = message.replyTo?.replyToMsgId;

    // Log message info
    if (hasMedia) {
      this.logger.log(
        `Sending message with ${isPhoto ? "photo" : "media"} from queue...`
      );
    } else if (messageText) {
      this.logger.log(
        `Sending text message from queue: ${messageText.substring(0, 50)}...`
      );
    }

    // Check if this is a reply to another message
    let targetReplyToMsgId: number | undefined;
    if (replyToMsgId) {
      const channelMap = this.messageMapping.get(replyToMsgId);
      const replyMappingKey = this.getMappingKey(
        channelConfig.targetChannelId,
        channelConfig.targetTopicId
      );
      targetReplyToMsgId = channelMap?.get(replyMappingKey);
    }

    // Replace text if present and get entities
    let processedText = "";
    const messageEntities = message.entities || [];
    let adjustedEntities = messageEntities;

    if (messageText) {
      processedText = this.replaceText(messageText);
      adjustedEntities = this.adjustEntities(
        messageText,
        processedText,
        messageEntities
      );
    }

    // Prepare send options
    const sendOptions: any = {
      message: processedText,
    };

    // Add reply-to if needed
    if (targetReplyToMsgId) {
      sendOptions.replyTo = targetReplyToMsgId;
    } else if (channelConfig.targetTopicId) {
      sendOptions.replyTo = channelConfig.targetTopicId;
    }

    // Preserve message entities (links, mentions, etc.)
    if (adjustedEntities && adjustedEntities.length > 0) {
      sendOptions.formattingEntities = adjustedEntities;
    }

    // Preserve inline keyboard buttons (reply markup)
    if (message.replyMarkup) {
      this.logger.log(
        `🔘 Detected reply markup in message: ${JSON.stringify(
          message.replyMarkup.className || "unknown"
        )}`
      );

      // Extract button rows from ReplyInlineMarkup or ReplyKeyboardMarkup
      if (message.replyMarkup.rows && message.replyMarkup.rows.length > 0) {
        sendOptions.buttons = message.replyMarkup.rows;
        this.logger.log(
          `Including ${message.replyMarkup.rows.length} row(s) of inline keyboard buttons from original message`
        );
      } else {
        // Fallback: try passing the whole markup object
        sendOptions.buttons = message.replyMarkup;
        this.logger.log(
          "Including inline keyboard buttons from original message (full markup)"
        );
      }
    } else {
      this.logger.debug("No reply markup found in message");
    }

    // If message contains media
    if (hasMedia) {
      sendOptions.file = message.media;
    }

    const sentMessage = await this.telegramService
      .getClient()
      .sendMessage(channelConfig.targetChannelId, sendOptions);

    if (channelConfig.targetTopicId) {
      this.logger.log(
        `✅ Message sent to channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
      );
    } else {
      this.logger.log(
        `✅ Message sent to channel ${channelConfig.targetChannelId}`
      );
    }

    // Store the message ID mapping per channel+topic
    if (sentMessage && sentMessage.id) {
      if (!this.messageMapping.has(sourceMessageId)) {
        this.messageMapping.set(sourceMessageId, new Map());
      }
      const mappingKey = this.getMappingKey(
        channelConfig.targetChannelId,
        channelConfig.targetTopicId
      );
      this.messageMapping.get(sourceMessageId)!.set(mappingKey, sentMessage.id);
    }
  }

  /**
   * Send a grouped message (album) from the queue
   */
  private async sendGroupedMessage(queuedMessage: QueuedMessage) {
    const messages = queuedMessage.messages!;
    const channelConfig = queuedMessage.channelConfig;
    const groupedId = queuedMessage.groupedId;

    this.logger.log(
      `Sending grouped message (${messages.length} items) from queue...`
    );

    // Get the text from the first message that has text
    const messageWithText = messages.find((msg) => msg.message);
    const messageText = messageWithText?.message || "";
    const messageEntities = messageWithText?.entities || [];

    // Replace text if present
    let processedText = "";
    let adjustedEntities = messageEntities;
    if (messageText) {
      processedText = this.replaceText(messageText);
      adjustedEntities = this.adjustEntities(
        messageText,
        processedText,
        messageEntities
      );
    }

    // Collect all media from the messages
    const mediaFiles = messages
      .filter((msg) => msg.media)
      .map((msg) => msg.media);

    const sendOptions: any = {
      message: processedText || "",
    };

    if (channelConfig.targetTopicId) {
      sendOptions.replyTo = channelConfig.targetTopicId;
    }

    if (adjustedEntities && adjustedEntities.length > 0) {
      sendOptions.formattingEntities = adjustedEntities;
    }

    // Preserve inline keyboard buttons from any message in the group that has them
    const messageWithButtons = messages.find((msg) => msg.replyMarkup);
    if (messageWithButtons && messageWithButtons.replyMarkup) {
      sendOptions.buttons = messageWithButtons.replyMarkup;
      this.logger.log("Including inline keyboard buttons from grouped message");
    }

    if (mediaFiles.length > 0) {
      sendOptions.file = mediaFiles;
      await this.telegramService
        .getClient()
        .sendMessage(channelConfig.targetChannelId, sendOptions);

      if (channelConfig.targetTopicId) {
        this.logger.log(
          `✅ Album with ${mediaFiles.length} items sent to channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
        );
      } else {
        this.logger.log(
          `✅ Album with ${mediaFiles.length} items sent to channel ${channelConfig.targetChannelId}`
        );
      }
    } else {
      await this.telegramService
        .getClient()
        .sendMessage(channelConfig.targetChannelId, sendOptions);

      if (channelConfig.targetTopicId) {
        this.logger.log(
          `✅ Message sent to channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
        );
      } else {
        this.logger.log(
          `✅ Message sent to channel ${channelConfig.targetChannelId}`
        );
      }
    }
  }
}
