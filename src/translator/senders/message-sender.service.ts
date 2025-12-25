import { Injectable, Logger } from "@nestjs/common";
import { Api } from "telegram/tl";
import { TelegramService } from "../../telegram/telegram.service";
import { ChannelConfig } from "../config";
import { MessageMappingService } from "../mapping";
import {
  TextProcessorService,
  ButtonProcessorService,
  ImageProcessorService,
} from "../processors";

/**
 * Service responsible for sending messages to Telegram
 */
@Injectable()
export class MessageSenderService {
  private readonly logger = new Logger(MessageSenderService.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly messageMappingService: MessageMappingService,
    private readonly textProcessor: TextProcessorService,
    private readonly buttonProcessor: ButtonProcessorService,
    private readonly imageProcessor: ImageProcessorService
  ) {}

  /**
   * Send a single message
   */
  async sendSingleMessage(
    message: any,
    channelConfig: ChannelConfig
  ): Promise<void> {
    const messageText = message.message;
    const hasMedia = message.media;
    const isPhoto = hasMedia && (message.media as any).photo !== undefined;
    const sourceMessageId = message.id;
    const replyToMsgId = message.replyTo?.replyToMsgId;
    const replyToTopicId = message.replyTo?.replyToTopicId;

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

    // Check if this is a reply to another message (not just to the topic root)
    let targetReplyToMsgId: number | undefined;
    const isReplyToTopic =
      replyToMsgId &&
      channelConfig.sourceTopicId !== undefined &&
      replyToMsgId === channelConfig.sourceTopicId;
    const isActualReply =
      replyToMsgId &&
      !isReplyToTopic &&
      (!replyToTopicId || replyToMsgId !== replyToTopicId);

    if (isActualReply) {
      targetReplyToMsgId = this.messageMappingService.getMapping(
        replyToMsgId,
        channelConfig.targetChannelId,
        channelConfig.targetTopicId
      );

      if (targetReplyToMsgId) {
        this.logger.log(
          `↩️ Replying to message ${replyToMsgId} -> target ${targetReplyToMsgId}`
        );
      } else {
        this.logger.warn(
          `⚠️ Reply to message ${replyToMsgId} not found in mappings`
        );
      }
    }

    // Replace text if present and get entities
    let processedText = "";
    const messageEntities = message.entities || [];
    let adjustedEntities = messageEntities;

    if (messageText) {
      processedText = this.textProcessor.replaceText(messageText);
      adjustedEntities = this.textProcessor.adjustEntities(
        messageText,
        processedText,
        messageEntities
      );
    }

    // Extract button links and append them to message text
    // Special case for channel -1003540006367: don't convert buttons, just add custom text
    if (channelConfig.targetChannelId === -1003540006367) {
      // Remove standalone @cheapmirror mentions to avoid duplication with footer
      processedText = processedText
        .split("\n")
        .filter((line) => line.trim() !== "@cheapmirror")
        .join("\n");

      const customLines = [
        "@cheapmirror — самый дешевый миррор всех приваток СНГ",
        "@freecheapmirrorbot — получить бесплатный доступ ко всем спредам",
        "@gate — вернуть комиссии на Gate",
      ];

      // Calculate the offset for the @gate link
      const textBeforeCustom = processedText;
      const offsetBeforeCustom =
        textBeforeCustom.length + (textBeforeCustom ? 2 : 0); // +2 for \n\n
      const line1Length = customLines[0].length;
      const line2Length = customLines[1].length;
      const gateOffset = offsetBeforeCustom + line1Length + 1 + line2Length + 1; // +1 for each \n

      processedText = this.textProcessor.appendLinesToMessage(
        processedText,
        customLines
      );

      // Add text link entity for @gate
      if (!adjustedEntities) {
        adjustedEntities = [];
      }
      adjustedEntities.push(
        new Api.MessageEntityTextUrl({
          offset: gateOffset,
          length: 5, // "@gate" is 5 characters
          url: "https://www.gate.com/ru/signup?ref_type=103&ref=VVKWUGWKCQ",
        })
      );

      this.logger.log(`📝 Added custom footer for channel -1003540006367`);
    } else {
      const buttonLinks = this.buttonProcessor.extractButtonLinks(message);
      if (buttonLinks.length > 0) {
        this.logger.log(
          `🔗 Converted ${buttonLinks.length} button(s) to links`
        );
        processedText = this.textProcessor.appendLinesToMessage(
          processedText,
          buttonLinks
        );
      }
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

    // If message contains media, process it to remove watermark
    if (hasMedia) {
      if (this.imageProcessor.shouldProcessMedia(message.media)) {
        const processedImage = await this.imageProcessor.removeWatermark(
          message.media
        );
        if (processedImage) {
          // Create a file-like object with filename for Telegram
          const timestamp = Date.now();
          const filename = `photo_${timestamp}${processedImage.extension}`;

          // Create a buffer with filename attribute
          const fileBuffer = processedImage.buffer as any;
          fileBuffer.name = filename;

          sendOptions.file = fileBuffer;
          this.logger.log(
            `🖼️ Using processed image (watermark removed) - ${filename}`
          );
        } else {
          sendOptions.file = message.media;
          this.logger.log(
            "📸 Using original image (processing disabled or failed)"
          );
        }
      } else {
        sendOptions.file = message.media;
      }
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
      this.messageMappingService.setMapping(
        sourceMessageId,
        channelConfig.targetChannelId,
        sentMessage.id,
        channelConfig.targetTopicId
      );
    }
  }

  /**
   * Send a grouped message (album)
   */
  async sendGroupedMessage(
    messages: any[],
    channelConfig: ChannelConfig,
    groupedId: string
  ): Promise<void> {
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
      processedText = this.textProcessor.replaceText(messageText);
      adjustedEntities = this.textProcessor.adjustEntities(
        messageText,
        processedText,
        messageEntities
      );
    }

    // Extract button links from any message in the group that has them
    // Special case for channel -1003540006367: don't convert buttons, just add custom text
    if (channelConfig.targetChannelId === -1003540006367) {
      // Remove standalone @cheapmirror mentions to avoid duplication with footer
      processedText = processedText
        .split("\n")
        .filter((line) => line.trim() !== "@cheapmirror")
        .join("\n");

      const customLines = [
        "@cheapmirror — самый дешевый миррор всех приваток СНГ",
        "@freecheapmirrorbot — получить бесплатный доступ ко всем спредам",
        "@gate — вернуть комиссии на Gate",
      ];

      // Calculate the offset for the @gate link
      const textBeforeCustom = processedText;
      const offsetBeforeCustom =
        textBeforeCustom.length + (textBeforeCustom ? 2 : 0); // +2 for \n\n
      const line1Length = customLines[0].length;
      const line2Length = customLines[1].length;
      const gateOffset = offsetBeforeCustom + line1Length + 1 + line2Length + 1; // +1 for each \n

      processedText = this.textProcessor.appendLinesToMessage(
        processedText,
        customLines
      );

      // Add text link entity for @gate
      if (!adjustedEntities) {
        adjustedEntities = [];
      }
      adjustedEntities.push(
        new Api.MessageEntityTextUrl({
          offset: gateOffset,
          length: 5, // "@gate" is 5 characters
          url: "https://www.gate.com/ru/signup?ref_type=103&ref=VVKWUGWKCQ",
        })
      );

      this.logger.log(
        `📝 Added custom footer for channel -1003540006367 in grouped message`
      );
    } else {
      const messageWithButtons = messages.find((msg) => msg.replyMarkup);
      if (messageWithButtons) {
        const buttonLinks =
          this.buttonProcessor.extractButtonLinks(messageWithButtons);
        if (buttonLinks.length > 0) {
          this.logger.log(
            `🔗 Converted ${buttonLinks.length} button(s) to links in grouped message`
          );
          processedText = this.textProcessor.appendLinesToMessage(
            processedText,
            buttonLinks
          );
        }
      }
    }

    // Collect all media from the messages and process images to remove watermarks
    const mediaFiles = await Promise.all(
      messages
        .filter((msg) => msg.media)
        .map(async (msg, index) => {
          if (this.imageProcessor.shouldProcessMedia(msg.media)) {
            const processedImage = await this.imageProcessor.removeWatermark(
              msg.media
            );
            if (processedImage) {
              // Create a file-like object with filename for Telegram
              const timestamp = Date.now();
              const filename = `photo_${timestamp}_${index}${processedImage.extension}`;

              // Create a buffer with filename attribute
              const fileBuffer = processedImage.buffer as any;
              fileBuffer.name = filename;

              this.logger.log(
                `🖼️ Processed image in album (watermark removed) - ${filename}`
              );
              return fileBuffer;
            } else {
              this.logger.log(
                "📸 Using original image in album (processing disabled or failed)"
              );
              return msg.media;
            }
          }
          return msg.media;
        })
    );

    const sendOptions: any = {
      message: processedText || "",
    };

    if (channelConfig.targetTopicId) {
      sendOptions.replyTo = channelConfig.targetTopicId;
    }

    if (adjustedEntities && adjustedEntities.length > 0) {
      sendOptions.formattingEntities = adjustedEntities;
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
