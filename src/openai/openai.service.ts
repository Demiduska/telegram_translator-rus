import { Injectable, Logger } from "@nestjs/common";
import OpenAI, { toFile } from "openai";

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private readonly openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("Missing OpenAI API key in environment variables");
    }

    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Translate Russian slang / casual text into natural, polite South Korean.
   */
  async translateToKorean(text: string): Promise<string> {
    try {
      if (!text?.trim()) return "";

      this.logger.log(
        `Translating text (first 50 chars): ${text.substring(0, 50)}...`
      );

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `
            You are a professional translator fluent in Russian and Korean.
Translate the given Russian text into natural, smooth, and fluent South Korean (Korean language).
The text may include slang, profanity, or casual speech.

Guidelines:

* Interpret slang, internet jargon, and swear words naturally in Korean — do not translate them literally.
* Keep the tone and meaning, but use smooth, polite Korean (존댓말) unless the context is clearly informal.
* Make the text sound natural for Korean readers.
* Keep punctuation, structure, emojis, and links intact.
* Do not add explanations, notes, or commentary — only output the translated text.
* Translate slang, jokes, and crypto terms naturally — not literally.
* Remove the "@pass1fybot" tag at the end of a post (if present) and add the channel signature:
  🔐 @ddarkl0rdd_private
* Translation of slang and terms — consider this dictionary and translate meaningfully for Korean readers; if a term is hard to translate, keep it in English:

мекс = MEXC exchange
декс = dex decentralized exchange
бу = break-even
диор = DYOR
ММ = Market Maker
рефнуть = refund / return money
гейт = Gate io exchange
бинанс = Binance exchange
байбит = Bybit exchange
апбит = Upbit
бингх = BingX
твх = entry point
поза = position
ракетка = very fast-moving chart

* Avoid using literary or overly formal terms — make it sound like something Korean traders would actually say.
* If the post mentions a time without a timezone, assume it’s Moscow time (UTC+3) and explicitly indicate that in the translation.
            `,
          },
          {
            role: "user",
            content: text,
          },
        ],
      });

      const translatedText =
        response.choices[0]?.message?.content?.trim() || text;

      this.logger.log("✅ Translation completed successfully.");
      return translatedText;
    } catch (error) {
      this.logger.error(`❌ Translation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Translate all text inside an image (Russian → Korean) using gpt-image-1,
   * replace referral code 1WPqN → 1YuEE,
   * and replace any QR code with /public/my_qr.png.
   */
  async translateImageToKorean(imageBuffer: Buffer): Promise<Buffer> {
    try {
      this.logger.log("🖼️ Translating image to Korean using gpt-image-1...");

      const prompt = `
Translate all Russian text in this image to natural, fluent Korean.
Replace the referral code "1WPqN" with "1YuEE" wherever it appears.
Maintain the exact same layout, design, colors, and visual style.
Keep all other elements (images, icons, graphics) identical.
Ensure the Korean text is clear and properly positioned.
      `.trim();

      this.logger.log("Sending image to gpt-image-1 for translation...");

      // Convert buffer to File using OpenAI's toFile utility
      const imageFile = await toFile(imageBuffer, "image.png", {
        type: "image/png",
      });

      // Use the Image API's edit endpoint with gpt-image-1
      const response = await this.openai.images.edit({
        model: "gpt-image-1",
        image: imageFile,
        prompt: prompt,
        size: "1024x1024",
        quality: "high",
        input_fidelity: "high", // Preserve details, faces, logos
      });

      // Extract the base64 image from response
      const imageBase64 = response.data[0]?.b64_json;
      if (!imageBase64) {
        throw new Error("No image data returned from gpt-image-1");
      }

      // Convert base64 to buffer
      const translatedImageBuffer = Buffer.from(imageBase64, "base64");

      this.logger.log(
        `✅ Image translation completed successfully. Size: ${translatedImageBuffer.length} bytes`
      );
      return translatedImageBuffer;
    } catch (error) {
      this.logger.error(
        `❌ Image translation failed: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
