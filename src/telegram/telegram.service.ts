import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { EditedMessage } from "telegram/events/EditedMessage";
import { Api } from "telegram/tl";
import * as input from "input";

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private client: TelegramClient;
  private sessionString: string = process.env.SESSION_NAME;
  private isReady: boolean = false;

  constructor() {}

  async onModuleInit() {
    await this.initializeClient();
  }

  private async initializeClient() {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
    const apiHash = process.env.TELEGRAM_API_HASH || "";
    const phoneNumber = process.env.TELEGRAM_PHONE || "";

    if (!apiId || !apiHash || !phoneNumber) {
      throw new Error(
        "Missing Telegram API credentials in environment variables"
      );
    }

    // Create a StringSession (empty for first run, or load existing session)
    const session = new StringSession(this.sessionString);

    this.client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    await this.client.start({
      phoneNumber: async () => phoneNumber,
      password: async () =>
        await input.text("Please enter your 2FA password: "),
      phoneCode: async () =>
        await input.text("Please enter the code you received: "),
      onError: (err) => this.logger.error("Error during authentication:", err),
    });

    this.logger.log("Telegram client connected successfully");

    // Save the session string for future use
    try {
      const savedSession = (this.client.session as any).save();
      if (savedSession && typeof savedSession === "string") {
        this.sessionString = savedSession;
        this.logger.log(
          `Session string saved (length: ${this.sessionString.length})`
        );
        this.logger.log(
          "Save this session string to avoid re-authentication next time"
        );
        this.logger.log(`Session ${this.sessionString}`);
      }
    } catch (error) {
      this.logger.warn("Could not save session string", error);
    }

    this.isReady = true;
  }

  /**
   * Wait for the Telegram client to be ready
   */
  async waitForReady(): Promise<void> {
    if (this.isReady) {
      return;
    }

    // Wait for the client to be ready with timeout
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.isReady) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error("Timeout waiting for Telegram client to be ready"));
      }, 30000);
    });
  }

  /**
   * Add event handler for new messages in a channel
   */
  addNewMessageHandler(
    channelId: number,
    callback: (event: NewMessageEvent) => Promise<void>
  ) {
    this.client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        await callback(event);
      } catch (error) {
        this.logger.error(
          `Error handling message: ${error.message}`,
          error.stack
        );
      }
    }, new NewMessage({ chats: [channelId] }));

    this.logger.log(`Listening to messages from channel: ${channelId}`);
  }

  /**
   * Add event handler for edited messages in a channel
   */
  addEditedMessageHandler(
    channelId: number,
    callback: (event: any) => Promise<void>
  ) {
    this.client.addEventHandler(async (event: any) => {
      try {
        await callback(event);
      } catch (error) {
        this.logger.error(
          `Error handling edited message: ${error.message}`,
          error.stack
        );
      }
    }, new EditedMessage({ chats: [channelId] }));

    this.logger.log(`Listening to edited messages from channel: ${channelId}`);
  }

  /**
   * Send a message to a channel
   */
  async sendMessage(
    channelId: number,
    text: string,
    replyToMsgId?: number
  ): Promise<any> {
    try {
      const result = await this.client.sendMessage(channelId, {
        message: text,
        replyTo: replyToMsgId,
      });
      this.logger.log(`Message sent to channel ${channelId}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send message: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Send a message with media (photo, video, audio, document) to a channel
   */
  async sendMessageWithMedia(
    channelId: number,
    text: string,
    originalMessage: any,
    replyToMsgId?: number
  ): Promise<any> {
    try {
      // Download the media from the original message
      const media = originalMessage.media;

      if (!media) {
        this.logger.warn("No media found in message, sending text only");
        await this.sendMessage(channelId, text, replyToMsgId);
        return;
      }

      // Send the message with the same media
      const result = await this.client.sendMessage(channelId, {
        message: text || "",
        file: media,
        replyTo: replyToMsgId,
      });

      this.logger.log(`Message with media sent to channel ${channelId}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send message with media: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Edit a message in a channel
   */
  async editMessage(
    channelId: number,
    messageId: number,
    newText: string
  ): Promise<void> {
    try {
      await this.client.editMessage(channelId, {
        message: messageId,
        text: newText,
      });
      this.logger.log(`Message ${messageId} edited in channel ${channelId}`);
    } catch (error) {
      this.logger.error(
        `Failed to edit message: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get the Telegram client instance
   */
  getClient(): TelegramClient {
    return this.client;
  }

  /**
   * Disconnect the client
   */
  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.logger.log("Telegram client disconnected");
    }
  }

  /**
   * Resolve a Telegram entity (channel, chat, or user) by username or URL
   * For invite links, attempts to join the channel first
   */
  async getEntity(identifier: string): Promise<any> {
    try {
      // Clean up the identifier - extract username or hash from URL
      let cleanIdentifier = identifier.trim();
      let isInviteLink = false;

      // Handle t.me URLs
      if (cleanIdentifier.includes("t.me/")) {
        // Extract the part after t.me/
        const match = cleanIdentifier.match(/t\.me\/(.+)/);
        if (match) {
          cleanIdentifier = match[1];

          // Check if it's an invite link (starts with +)
          if (cleanIdentifier.startsWith("+")) {
            isInviteLink = true;
            // Try to join using the invite hash
            try {
              this.logger.log(`Attempting to join channel via invite link...`);
              const result: any = await this.client.invoke(
                new Api.messages.ImportChatInvite({
                  hash: cleanIdentifier.substring(1), // Remove the + sign
                })
              );
              this.logger.log(`Successfully joined channel via invite link`);

              // Extract the channel from the result
              if (result.chats && result.chats.length > 0) {
                const chat = result.chats[0];
                this.logger.log(
                  `Resolved entity ${identifier} -> ID: ${chat.id}`
                );
                return chat;
              }
            } catch (inviteError: any) {
              // If already a member, try to get dialogs
              this.logger.warn(
                `Could not join via invite (might already be a member): ${inviteError.message}`
              );
              // Try to find the channel in dialogs
              const dialogs = await this.client.getDialogs({});
              for (const dialog of dialogs) {
                if (dialog.entity && (dialog.entity as any).id) {
                  // Return the most recently added chat (likely the one we're looking for)
                  // Note: This is a workaround - ideally the user should provide the channel ID
                  this.logger.log(
                    `Found potential match in dialogs: ${
                      (dialog.entity as any).id
                    }`
                  );
                }
              }
              throw new Error(
                `Cannot resolve invite link. Please provide the channel ID directly in .env (use SOURCE_CHANNEL_ID and TARGET_CHANNEL_ID instead of URLs)`
              );
            }
          } else {
            // Regular channel username
            cleanIdentifier = "@" + cleanIdentifier;
          }
        }
      }

      if (!isInviteLink) {
        this.logger.log(
          `Resolving entity: ${identifier} -> ${cleanIdentifier}`
        );
        const entity = await this.client.getEntity(cleanIdentifier);
        this.logger.log(`Resolved entity ${identifier} -> ID: ${entity.id}`);
        return entity;
      }
    } catch (error) {
      this.logger.error(
        `Failed to resolve entity for ${identifier}: ${error.message}`
      );
      throw error;
    }
  }
}
