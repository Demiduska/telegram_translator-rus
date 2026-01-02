import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

/**
 * Service responsible for sending webhook notifications
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly webhookUrl: string;
  private readonly apiKey: string;
  private readonly targetChannels: Set<string>;

  constructor() {
    this.webhookUrl = process.env.WEBHOOK_URL || "";
    this.apiKey = process.env.WEBHOOK_API_KEY || "";

    // Parse the target channels from environment variable
    // Format: channelId_topicId,channelId_topicId,...
    const channelsConfig = process.env.WEBHOOK_CHANNELS || "";
    this.targetChannels = new Set(
      channelsConfig
        .split(",")
        .map((ch) => ch.trim())
        .filter((ch) => ch.length > 0)
    );

    if (this.webhookUrl && this.targetChannels.size > 0) {
      this.logger.log(
        `Webhook service initialized for ${this.targetChannels.size} channels`
      );
      this.logger.log(
        `Target channels: ${Array.from(this.targetChannels).join(", ")}`
      );
    }
  }

  /**
   * Check if webhook should be sent for a given channel and topic
   */
  shouldSendWebhook(channelId: number, topicId?: number): boolean {
    if (!this.webhookUrl || this.targetChannels.size === 0) {
      return false;
    }

    const channelKey = topicId ? `${channelId}_${topicId}` : `${channelId}`;

    return this.targetChannels.has(channelKey);
  }

  /**
   * Send a webhook notification (fire and forget)
   */
  async sendWebhook(
    message: string,
    channelId: number,
    topicId?: number
  ): Promise<void> {
    if (!this.shouldSendWebhook(channelId, topicId)) {
      return;
    }

    const channelKey = topicId ? `${channelId}_${topicId}` : `${channelId}`;

    const payload = {
      message,
      channelId: channelKey,
    };

    // Fire and forget - don't wait for response
    this.sendWebhookRequest(payload, channelKey).catch((error) => {
      this.logger.error(
        `Failed to send webhook for channel ${channelKey}: ${error.message}`,
        error.stack
      );
    });

    this.logger.log(`📤 Webhook queued for channel ${channelKey}`);
  }

  /**
   * Internal method to send the actual HTTP request
   */
  private async sendWebhookRequest(
    payload: any,
    channelKey: string
  ): Promise<void> {
    try {
      const headers: any = {
        "Content-Type": "application/json",
      };

      // Add API key to headers if configured
      if (this.apiKey) {
        headers["X-API-Key"] = this.apiKey;
      }

      await axios.post(this.webhookUrl, payload, {
        headers,
        timeout: 5000, // 5 second timeout
      });

      this.logger.log(`✅ Webhook sent successfully for channel ${channelKey}`);
    } catch (error) {
      // Error is already logged by caller, just rethrow
      throw error;
    }
  }
}
