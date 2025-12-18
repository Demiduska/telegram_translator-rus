import { Injectable, Logger } from "@nestjs/common";

/**
 * Service responsible for processing inline buttons in messages
 */
@Injectable()
export class ButtonProcessorService {
  private readonly logger = new Logger(ButtonProcessorService.name);

  /**
   * Extract links from inline buttons in reply markup
   */
  extractButtonLinks(message: any): string[] {
    if (!message.replyMarkup?.rows) return [];

    const links: string[] = [];

    for (const row of message.replyMarkup.rows) {
      for (const button of row.buttons) {
        if (
          button.className === "KeyboardButtonUrl" &&
          button.text &&
          button.url
        ) {
          links.push(`${button.text} → ${button.url}`);
        }
      }
    }

    return links;
  }
}
