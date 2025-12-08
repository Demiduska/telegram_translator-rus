import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { TelegramService } from "../telegram/telegram.service";
import { NewMessageEvent } from "telegram/events";

interface ChannelConfig {
  sourceId: number;
  targetChannelId: number;
  targetTopicId?: number; // Optional: for posting to topics in a group
}

@Injectable()
export class TranslatorService implements OnModuleInit {
  private readonly logger = new Logger(TranslatorService.name);
  private channels: ChannelConfig[] = [];
  private groupedMessages: Map<
    string,
    { messages: any[]; timeout: NodeJS.Timeout; channelConfig: ChannelConfig }
  > = new Map();
  // Map to store source message ID -> (target channel ID -> target message ID)
  private messageMapping: Map<number, Map<number, number>> = new Map();

  // Legacy mode support
  private sourceChannelId: number;
  private targetChannelId: number;
  private useDirectIds: boolean = false;
  private useLegacyMode: boolean = false;

  constructor(private readonly telegramService: TelegramService) {
    this.parseChannelConfiguration();
  }

  /**
   * Simple text replacement function
   * Replaces @pass1fybot with @cheapmirror
   */
  private replaceText(text: string): string {
    if (!text) return text;
    return text.replace(/@pass1fybot/gi, "@cheapmirror");
  }

  private parseChannelConfiguration() {
    const channelsConfig = process.env.CHANNELS_CONFIG;

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

        let targetChannelId: string;
        let targetTopicId: string | undefined;

        if (parts.length === 4) {
          // 4-part format: sourceId:sourceTopicId:targetChannelId:targetTopicId
          // Note: sourceTopicId (parts[1]) is currently not used for filtering source messages
          targetChannelId = parts[2]?.trim();
          targetTopicId = parts[3]?.trim();
          this.logger.log(
            `Parsing 4-part config: source=${sourceId}, target channel=${targetChannelId}, target topic=${targetTopicId}`
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
          targetChannelId: parseInt(targetChannelId),
          targetTopicId: targetTopicId ? parseInt(targetTopicId) : undefined,
        };

        this.channels.push(config);

        if (config.targetTopicId) {
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
      `Starting to watch ${this.channels.length} channels for messages...`
    );

    for (const channelConfig of this.channels) {
      this.telegramService.addNewMessageHandler(
        channelConfig.sourceId,
        (event) => this.handleNewMessageMulti(event, channelConfig)
      );

      this.telegramService.addEditedMessageHandler(
        channelConfig.sourceId,
        (event) => this.handleEditedMessageMulti(event, channelConfig)
      );

      if (channelConfig.targetTopicId) {
        this.logger.log(
          `📢 Listening to channel ${channelConfig.sourceId} -> posting to channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
        );
      } else {
        this.logger.log(
          `📢 Listening to channel ${channelConfig.sourceId} -> posting to channel ${channelConfig.targetChannelId}`
        );
      }
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

  private async handleNewMessageMulti(
    event: NewMessageEvent,
    channelConfig: ChannelConfig
  ) {
    try {
      const message = event.message;
      const groupedId = (message as any).groupedId?.toString();

      if (groupedId) {
        // This is part of an album - collect all messages before processing
        if (!this.groupedMessages.has(groupedId)) {
          this.groupedMessages.set(groupedId, {
            messages: [],
            timeout: null as any,
            channelConfig,
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
          await this.processGroupedMessagesMulti(
            groupedId,
            groupData.messages,
            channelConfig
          );
          this.groupedMessages.delete(groupedId);
        }, 1000);

        this.logger.log(
          `Collected message ${groupData.messages.length} for group ${groupedId}`
        );
        return;
      }

      // Not part of a group - process immediately
      await this.processSingleMessageMulti(message, channelConfig);
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

      // Get the text from the first message that has text
      const messageWithText = messages.find((msg) => msg.message);
      const messageText = messageWithText?.message || "";

      // Replace text if present
      let processedText = "";
      if (messageText) {
        processedText = this.replaceText(messageText);
        this.logger.log(
          "Text processed (replaced @pass1fybot with @cheapmirror)"
        );
      }

      // Collect all media from the messages
      const mediaFiles = messages
        .filter((msg) => msg.media)
        .map((msg) => msg.media);

      if (mediaFiles.length > 0) {
        // Send all media together as an album
        const sendOptions: any = {
          message: processedText || "",
          file: mediaFiles,
        };
        if (channelConfig.targetTopicId) {
          sendOptions.replyTo = channelConfig.targetTopicId;
        }

        await this.telegramService
          .getClient()
          .sendMessage(channelConfig.targetChannelId, sendOptions);

        if (channelConfig.targetTopicId) {
          this.logger.log(
            `✅ Album with ${mediaFiles.length} items posted to channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
          );
        } else {
          this.logger.log(
            `✅ Album with ${mediaFiles.length} items posted to channel ${channelConfig.targetChannelId}`
          );
        }
      } else {
        // No media, just send text
        const sendOptions: any = {
          message: processedText,
        };
        if (channelConfig.targetTopicId) {
          sendOptions.replyTo = channelConfig.targetTopicId;
        }

        await this.telegramService
          .getClient()
          .sendMessage(channelConfig.targetChannelId, sendOptions);

        if (channelConfig.targetTopicId) {
          this.logger.log(
            `Message posted to channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
          );
        } else {
          this.logger.log(
            `Message posted to channel ${channelConfig.targetChannelId}`
          );
        }
      }
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

      // Get the text from the first message that has text
      const messageWithText = messages.find((msg) => msg.message);
      const messageText = messageWithText?.message || "";

      // Replace text if present
      let processedText = "";
      if (messageText) {
        processedText = this.replaceText(messageText);
        this.logger.log(
          "Text processed (replaced @pass1fybot with @cheapmirror)"
        );
      }

      // Collect all media from the messages
      const mediaFiles = messages
        .filter((msg) => msg.media)
        .map((msg) => msg.media);

      if (mediaFiles.length > 0) {
        // Send all media together as an album
        await this.telegramService
          .getClient()
          .sendMessage(this.targetChannelId, {
            message: processedText || "",
            file: mediaFiles,
          });

        this.logger.log(
          `✅ Album with ${mediaFiles.length} items posted successfully`
        );
      } else {
        // No media, just send text
        await this.telegramService.sendMessage(
          this.targetChannelId,
          processedText
        );
        this.logger.log("Message posted successfully");
      }
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
      const sourceMessageId = message.id;
      const replyToMsgId = message.replyTo?.replyToMsgId;

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

      // Check if this is a reply to another message
      let targetReplyToMsgId: number | undefined;
      if (replyToMsgId) {
        const channelMap = this.messageMapping.get(replyToMsgId);
        targetReplyToMsgId = channelMap?.get(channelConfig.targetChannelId);
        if (targetReplyToMsgId) {
          this.logger.log(
            `This is a reply to message ${replyToMsgId}, will reply to target message ${targetReplyToMsgId}`
          );
        } else {
          this.logger.warn(
            `This is a reply to message ${replyToMsgId}, but no mapping found in target channel ${channelConfig.targetChannelId}`
          );
        }
      }

      // Replace text if present
      let processedText = "";
      if (messageText) {
        processedText = this.replaceText(messageText);
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
      } else if (channelConfig.targetTopicId) {
        sendOptions.replyTo = channelConfig.targetTopicId;
      }

      // If message contains media
      if (hasMedia) {
        sendOptions.file = message.media;

        sentMessage = await this.telegramService
          .getClient()
          .sendMessage(channelConfig.targetChannelId, sendOptions);

        if (channelConfig.targetTopicId) {
          this.logger.log(
            `Message with media posted to channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
          );
        } else {
          this.logger.log(
            `Message with media posted to channel ${channelConfig.targetChannelId}`
          );
        }
      } else {
        // Text-only message
        sentMessage = await this.telegramService
          .getClient()
          .sendMessage(channelConfig.targetChannelId, sendOptions);

        if (channelConfig.targetTopicId) {
          this.logger.log(
            `Message posted to channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
          );
        } else {
          this.logger.log(
            `Message posted to channel ${channelConfig.targetChannelId}`
          );
        }
      }

      // Store the message ID mapping per channel
      if (sentMessage && sentMessage.id) {
        if (!this.messageMapping.has(sourceMessageId)) {
          this.messageMapping.set(sourceMessageId, new Map());
        }
        this.messageMapping
          .get(sourceMessageId)!
          .set(channelConfig.targetChannelId, sentMessage.id);
        this.logger.log(
          `Stored mapping: source ${sourceMessageId} -> target ${sentMessage.id} (channel ${channelConfig.targetChannelId})`
        );
      }
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
        targetReplyToMsgId = channelMap?.get(this.targetChannelId);
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

      // Replace text if present
      let processedText = "";
      if (messageText) {
        processedText = this.replaceText(messageText);
        this.logger.log(
          "Text processed (replaced @pass1fybot with @cheapmirror)"
        );
      }

      let sentMessage: any;

      // If message contains media
      if (hasMedia) {
        sentMessage = await this.telegramService.sendMessageWithMedia(
          this.targetChannelId,
          processedText,
          message,
          targetReplyToMsgId
        );
        this.logger.log("Message with media posted successfully");
      } else {
        // Text-only message
        sentMessage = await this.telegramService.sendMessage(
          this.targetChannelId,
          processedText,
          targetReplyToMsgId
        );
        this.logger.log("Message posted successfully");
      }

      // Store the message ID mapping per channel
      if (sentMessage && sentMessage.id) {
        if (!this.messageMapping.has(sourceMessageId)) {
          this.messageMapping.set(sourceMessageId, new Map());
        }
        this.messageMapping
          .get(sourceMessageId)!
          .set(this.targetChannelId, sentMessage.id);
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

  private async handleEditedMessageMulti(
    event: any,
    channelConfig: ChannelConfig
  ) {
    try {
      const message = event.message;
      const sourceMessageId = message.id;
      const messageText = message.message;

      this.logger.log(
        `Message ${sourceMessageId} was edited in channel ${channelConfig.sourceId}`
      );

      // Check if we have a mapping for this message in this specific channel
      const channelMap = this.messageMapping.get(sourceMessageId);
      const targetMessageId = channelMap?.get(channelConfig.targetChannelId);

      if (!targetMessageId) {
        this.logger.warn(
          `No mapping found for edited message ${sourceMessageId} in channel ${channelConfig.targetChannelId}, skipping edit`
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
        channelConfig.targetChannelId,
        targetMessageId,
        processedText
      );

      if (channelConfig.targetTopicId) {
        this.logger.log(
          `✅ Message ${targetMessageId} edited successfully in channel ${channelConfig.targetChannelId}, topic ${channelConfig.targetTopicId}`
        );
      } else {
        this.logger.log(
          `✅ Message ${targetMessageId} edited successfully in channel ${channelConfig.targetChannelId}`
        );
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

      // Check if we have a mapping for this message in the target channel
      const channelMap = this.messageMapping.get(sourceMessageId);
      const targetMessageId = channelMap?.get(this.targetChannelId);

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
}
