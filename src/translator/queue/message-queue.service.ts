import { Injectable, Logger } from "@nestjs/common";
import { QueuedMessage } from "./message-queue.interface";
import { sleep } from "../../common/utils/sleep.util";
import {
  MAX_RETRY_ATTEMPTS,
  DEFAULT_FLOOD_WAIT_SECONDS,
} from "../../common/constants/telegram.constants";

/**
 * Service responsible for managing message queue and rate limiting
 */
@Injectable()
export class MessageQueueService {
  private readonly logger = new Logger(MessageQueueService.name);
  private messageQueue: QueuedMessage[] = [];
  private isProcessingQueue: boolean = false;
  private readonly messageDelayMs: number;
  private readonly maxRetryAttempts: number;

  constructor() {
    // Get message delay from env or use default (2000ms)
    this.messageDelayMs = parseInt(process.env.MESSAGE_DELAY_MS || "2000", 10);
    this.maxRetryAttempts = MAX_RETRY_ATTEMPTS;
    this.logger.log(`Message delay set to ${this.messageDelayMs}ms`);
  }

  /**
   * Add message to the queue for rate-limited processing
   */
  addToQueue(queuedMessage: QueuedMessage): void {
    this.messageQueue.push(queuedMessage);
    this.logger.log(
      `Message added to queue. Queue size: ${this.messageQueue.length}`
    );
  }

  /**
   * Start processing the queue
   * @param processorFn - Function to process each message
   */
  async startProcessing(
    processorFn: (message: QueuedMessage) => Promise<void>
  ): Promise<void> {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;
    this.logger.log("Started processing message queue");

    while (this.messageQueue.length > 0) {
      const queuedMessage = this.messageQueue.shift()!;

      try {
        await processorFn(queuedMessage);

        // Wait before processing next message
        if (this.messageQueue.length > 0) {
          this.logger.log(
            `Waiting ${this.messageDelayMs}ms before next message...`
          );
          await sleep(this.messageDelayMs);
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
  private async handleSendError(
    error: any,
    queuedMessage: QueuedMessage
  ): Promise<void> {
    const isFloodWait = this.isFloodWaitError(error);

    if (isFloodWait) {
      const waitSeconds = this.extractWaitTime(error);
      this.logger.warn(
        `FloodWaitError: Need to wait ${waitSeconds} seconds. Adding message back to queue.`
      );

      // Increment retry count
      queuedMessage.retryCount = (queuedMessage.retryCount || 0) + 1;

      if (queuedMessage.retryCount <= this.maxRetryAttempts) {
        // Add back to the front of the queue
        this.messageQueue.unshift(queuedMessage);

        // Wait for the specified time
        this.logger.log(`Waiting ${waitSeconds} seconds before retry...`);
        await sleep(waitSeconds * 1000);
      } else {
        this.logger.error(
          `Message exceeded max retry attempts (${this.maxRetryAttempts}). Dropping message.`
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
    return match ? parseInt(match[1], 10) : DEFAULT_FLOOD_WAIT_SECONDS;
  }

  /**
   * Check if queue is currently being processed
   */
  isProcessing(): boolean {
    return this.isProcessingQueue;
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.messageQueue.length;
  }
}
