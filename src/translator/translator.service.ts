import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { TelegramService } from "../telegram/telegram.service";
import { NewMessageEvent } from "telegram/events";
import { ChannelConfig, ChannelConfigParserService } from "./config";
import { QueuedMessage, MessageQueueService } from "./queue";
import { MessageMappingService } from "./mapping";
import { MessageSenderService } from "./senders";
import { TextProcessorService } from "./processors";
import { GROUPED_MESSAGE_TIMEOUT_MS } from "../common/constants/telegram.constants";

@Injectable()
export class TranslatorService implements OnModuleInit {
  private readonly logger = new Logger(TranslatorService.name);
  private channels: ChannelConfig[] = [];
  private groupedMessages: Map<
    string,
    { messages: any[]; timeout: NodeJS.Timeout; channelConfig: ChannelConfig }
  > = new Map();

  // Legacy mode support
  private sourceChannelId: number;
  private targetChannelId: number;
  private useDirectIds: boolean = false;
  private useLegacyMode: boolean = false;

  constructor(
    private readonly telegramService: TelegramService,
    private readonly configParser: ChannelConfigParserService,
    private readonly queueService: MessageQueueService,
    private readonly mappingService: MessageMappingService,
    private readonly senderService: MessageSenderService,
    private readonly textProcessor: TextProcessorService
  ) {
    this.parseChannelConfiguration();
  }

  private parseChannelConfiguration() {
    // Use the configuration parser service
    const config = this.configParser.parseConfiguration();

    // Apply parsed configuration
    this.channels = config.channels;
    this.useLegacyMode = config.useLegacyMode;

    if (config.useLegacyMode) {
      this.sourceChannelId = config.sourceChannelId!;
      this.targetChannelId = config.targetChannelId!;
      this.useDirectIds = config.useDirectIds || false;
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

      // Get the source topic ID from the message
      const replyToObject = (message as any).replyTo;
      const messageTopicId =
        replyToObject?.replyToTopId ||
        replyToObject?.replyToTopicId ||
        replyToObject?.replyToMsgId;

      // Filter configs based on source topic ID
      const applicableConfigs = channelConfigs.filter((config) => {
        if (config.sourceTopicId !== undefined) {
          return messageTopicId === config.sourceTopicId;
        }
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

          // Set a new timeout to process the group after timeout period
          groupData.timeout = setTimeout(async () => {
            await this.processGroupedMessages(
              groupKey,
              groupData.messages,
              channelConfig
            );
            this.groupedMessages.delete(groupKey);
          }, GROUPED_MESSAGE_TIMEOUT_MS);

          this.logger.log(
            `Collected message ${groupData.messages.length} for group ${groupKey}`
          );
        } else {
          // Not part of a group - process immediately
          await this.processSingleMessage(message, channelConfig);
        }
      }
    } catch (error) {
      this.logger.error(
        `Error processing message: ${error.message}`,
        error.stack
      );
    }
  }

  private async handleNewMessage(event: NewMessageEvent) {
    try {
      const message = event.message;
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

        // Create legacy channel config
        const legacyChannelConfig: ChannelConfig = {
          sourceId: this.sourceChannelId,
          targetChannelId: this.targetChannelId,
        };

        // Set a new timeout to process the group
        groupData.timeout = setTimeout(async () => {
          await this.processGroupedMessages(
            groupedId,
            groupData.messages,
            legacyChannelConfig
          );
          this.groupedMessages.delete(groupedId);
        }, GROUPED_MESSAGE_TIMEOUT_MS);

        this.logger.log(
          `Collected message ${groupData.messages.length} for group ${groupedId}`
        );
        return;
      }

      // Not part of a group - process immediately
      const legacyChannelConfig: ChannelConfig = {
        sourceId: this.sourceChannelId,
        targetChannelId: this.targetChannelId,
      };
      await this.processSingleMessage(message, legacyChannelConfig);
    } catch (error) {
      this.logger.error(
        `Error processing message: ${error.message}`,
        error.stack
      );
    }
  }

  private async processGroupedMessages(
    groupedId: string,
    messages: any[],
    channelConfig: ChannelConfig
  ) {
    try {
      this.logger.log(
        `Processing grouped messages (${messages.length} items) for group ${groupedId}`
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

  private async processSingleMessage(
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

      // Get the source topic ID from the message
      const messageTopicId = (message as any).replyTo?.replyToMsgId;

      // Keep track of edited messages to avoid duplicates
      const editedTargets = new Set<string>();

      // Process edit for each channel config
      for (const channelConfig of channelConfigs) {
        // Match the config that was used to send this message originally
        if (
          channelConfig.sourceTopicId !== undefined &&
          messageTopicId !== channelConfig.sourceTopicId
        ) {
          continue;
        }

        // Check if we have a mapping for this message
        const targetMessageId = this.mappingService.getMapping(
          sourceMessageId,
          channelConfig.targetChannelId,
          channelConfig.targetTopicId
        );

        if (!targetMessageId) {
          this.logger.debug(
            `No mapping found for edited message ${sourceMessageId}, skipping`
          );
          continue;
        }

        // Check if we already edited this target message
        const targetKey = `${channelConfig.targetChannelId}:${targetMessageId}`;
        if (editedTargets.has(targetKey)) {
          this.logger.debug(
            `Already edited message ${targetMessageId}, skipping duplicate`
          );
          continue;
        }
        editedTargets.add(targetKey);

        // Replace the new text
        let processedText = "";
        if (messageText) {
          processedText = this.textProcessor.replaceText(messageText);
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

  private async handleEditedMessage(event: any) {
    try {
      const message = event.message;
      const sourceMessageId = message.id;
      const messageText = message.message;

      this.logger.log(`Message ${sourceMessageId} was edited`);

      // Check if we have a mapping for this message
      const targetMessageId = this.mappingService.getMapping(
        sourceMessageId,
        this.targetChannelId
      );

      if (!targetMessageId) {
        this.logger.warn(
          `No mapping found for edited message ${sourceMessageId}, skipping edit`
        );
        return;
      }

      // Replace the new text
      let processedText = "";
      if (messageText) {
        processedText = this.textProcessor.replaceText(messageText);
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
    this.queueService.addToQueue(queuedMessage);

    // Start processing queue if not already running
    if (!this.queueService.isProcessing()) {
      this.processQueue();
    }
  }

  /**
   * Process messages from the queue with rate limiting
   */
  private async processQueue() {
    await this.queueService.startProcessing(async (queuedMessage) => {
      if (queuedMessage.type === "single") {
        await this.senderService.sendSingleMessage(
          queuedMessage.message!,
          queuedMessage.channelConfig
        );
      } else {
        await this.senderService.sendGroupedMessage(
          queuedMessage.messages!,
          queuedMessage.channelConfig,
          queuedMessage.groupedId!
        );
      }
    });
  }
}
