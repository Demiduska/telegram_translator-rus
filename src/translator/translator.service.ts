import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { TelegramService } from "../telegram/telegram.service";
import { OpenAIService } from "../openai/openai.service";
import { NewMessageEvent } from "telegram/events";

@Injectable()
export class TranslatorService implements OnModuleInit {
  private readonly logger = new Logger(TranslatorService.name);
  private sourceChannelId: number;
  private targetChannelId: number;
  private useDirectIds: boolean = false;
  private groupedMessages: Map<
    string,
    { messages: any[]; timeout: NodeJS.Timeout }
  > = new Map();
  // Map to store source message ID -> target message ID
  private messageMapping: Map<number, number> = new Map();

  constructor(
    private readonly telegramService: TelegramService,
    private readonly openaiService: OpenAIService
  ) {
    // Check if IDs are provided directly
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

  async onModuleInit() {
    // Wait for TelegramService to be ready
    await this.telegramService.waitForReady();

    // Only resolve if we don't have direct IDs
    if (!this.useDirectIds) {
      await this.resolveChannelIds();
    }

    this.startWatching();
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

  private startWatching() {
    this.logger.log(
      `Starting to watch channel ${this.sourceChannelId} for messages...`
    );

    // channel for listen: https://t.me/channnnnnnnel1
    // channel for write https://t.me/+6yEKZH1eJG9hMmEx

    this.telegramService.addNewMessageHandler(
      this.sourceChannelId,
      this.handleNewMessage.bind(this)
    );

    this.telegramService.addEditedMessageHandler(
      this.sourceChannelId,
      this.handleEditedMessage.bind(this)
    );
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

  private async processGroupedMessages(groupedId: string, messages: any[]) {
    try {
      this.logger.log(
        `Processing grouped messages (${messages.length} items) for group ${groupedId}`
      );

      // Get the text from the first message that has text
      const messageWithText = messages.find((msg) => msg.message);
      const messageText = messageWithText?.message || "";

      // Translate text if present
      let translatedText = "";
      if (messageText) {
        translatedText = await this.openaiService.translateToKorean(
          messageText
        );
        this.logger.log("Text translated to Korean");
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
            message: translatedText || "",
            file: mediaFiles,
          });

        this.logger.log(
          `✅ Album with ${mediaFiles.length} items posted successfully`
        );
      } else {
        // No media, just send text
        await this.telegramService.sendMessage(
          this.targetChannelId,
          translatedText
        );
        this.logger.log("Message translated and posted successfully");
      }
    } catch (error) {
      this.logger.error(
        `Error processing grouped messages: ${error.message}`,
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
        targetReplyToMsgId = this.messageMapping.get(replyToMsgId);
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

      // Translate text if present
      let translatedText = "";
      if (messageText) {
        translatedText = await this.openaiService.translateToKorean(
          messageText
        );
        this.logger.log("Text translated to Korean");
      }

      let sentMessage: any;

      // If message contains a photo, translate the image
      if (isPhoto) {
        try {
          this.logger.log(
            "📸 Downloading image for translation... Temporary disabled"
          );

          sentMessage = await this.telegramService.sendMessageWithMedia(
            this.targetChannelId,
            translatedText,
            message,
            targetReplyToMsgId
          );
        } catch (imageError) {
          this.logger.error(
            `Failed to send image: ${imageError.message}`,
            imageError.stack
          );
          this.logger.warn("Falling back to sending original media");
          sentMessage = await this.telegramService.sendMessageWithMedia(
            this.targetChannelId,
            translatedText,
            message,
            targetReplyToMsgId
          );
        }
      } else if (hasMedia) {
        // Other media types (video, audio, documents, etc.)
        sentMessage = await this.telegramService.sendMessageWithMedia(
          this.targetChannelId,
          translatedText,
          message,
          targetReplyToMsgId
        );
        this.logger.log(
          "Message with media translated and posted successfully"
        );
      } else {
        // Text-only message
        sentMessage = await this.telegramService.sendMessage(
          this.targetChannelId,
          translatedText,
          targetReplyToMsgId
        );
        this.logger.log("Message translated and posted successfully");
      }

      // Store the message ID mapping
      if (sentMessage && sentMessage.id) {
        this.messageMapping.set(sourceMessageId, sentMessage.id);
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

  private async handleEditedMessage(event: any) {
    try {
      const message = event.message;
      const sourceMessageId = message.id;
      const messageText = message.message;

      this.logger.log(`Message ${sourceMessageId} was edited`);

      // Check if we have a mapping for this message
      const targetMessageId = this.messageMapping.get(sourceMessageId);

      if (!targetMessageId) {
        this.logger.warn(
          `No mapping found for edited message ${sourceMessageId}, skipping edit`
        );
        return;
      }

      // Translate the new text
      let translatedText = "";
      if (messageText) {
        translatedText = await this.openaiService.translateToKorean(
          messageText
        );
        this.logger.log("Edited text translated to Korean");
      }

      // Edit the message in the target channel
      await this.telegramService.editMessage(
        this.targetChannelId,
        targetMessageId,
        translatedText
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
