import { Injectable, Logger } from "@nestjs/common";
import sharp from "sharp";
import { TelegramService } from "../../telegram/telegram.service";

/**
 * Service responsible for processing images (removing watermarks, etc.)
 */
@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  // Watermark removal settings
  private readonly CROP_BOTTOM_PIXELS = 80; // How many pixels to crop from bottom
  private readonly COVER_METHOD = true; // If true, covers watermark with background color. If false, crops it

  constructor(private readonly telegramService: TelegramService) {}

  /**
   * Process an image to remove watermark
   * @param media - Telegram media object
   * @returns Processed image buffer or null if processing failed
   */
  async removeWatermark(media: any): Promise<Buffer | null> {
    try {
      // Download the image from Telegram
      const imageBuffer = await this.telegramService
        .getClient()
        .downloadMedia(media, { outputFile: undefined });

      if (!imageBuffer || !(imageBuffer instanceof Buffer)) {
        this.logger.warn("Failed to download media or media is not a Buffer");
        return null;
      }

      this.logger.log("Image downloaded, processing to remove watermark...");

      // Get image metadata
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        this.logger.warn("Could not get image dimensions");
        return null;
      }

      this.logger.log(
        `Original image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`
      );

      // Determine output format based on original format
      const outputFormat = metadata.format || "jpeg";
      this.logger.log(`Using output format: ${outputFormat}`);

      let processedBuffer: Buffer;

      if (this.COVER_METHOD) {
        // Method 1: Cover the watermark area with a solid color
        // Extract a sample color from the top-left corner to use as background
        const samplePixel = await sharp(imageBuffer)
          .extract({ left: 10, top: 10, width: 1, height: 1 })
          .raw()
          .toBuffer();

        // Create a rectangle to cover the watermark area
        const coverHeight = Math.min(
          this.CROP_BOTTOM_PIXELS,
          Math.floor(metadata.height * 0.15)
        ); // Max 15% of image height
        const coverSvg = `
          <svg width="${metadata.width}" height="${metadata.height}">
            <rect 
              x="0" 
              y="${metadata.height - coverHeight}" 
              width="${metadata.width}" 
              height="${coverHeight}" 
              fill="rgb(${samplePixel[0]}, ${samplePixel[1]}, ${
          samplePixel[2]
        })"
              opacity="0.95"
            />
          </svg>
        `;

        // Process and convert based on format
        let processedImage = image.composite([
          {
            input: Buffer.from(coverSvg),
            blend: "over",
          },
        ]);

        // Output in the original format
        if (outputFormat === "png") {
          processedBuffer = await processedImage
            .png({ quality: 95 })
            .toBuffer();
        } else if (outputFormat === "webp") {
          processedBuffer = await processedImage
            .webp({ quality: 95 })
            .toBuffer();
        } else {
          // Default to JPEG
          processedBuffer = await processedImage
            .jpeg({ quality: 95 })
            .toBuffer();
        }

        this.logger.log(
          `✂️ Covered watermark area (${coverHeight}px from bottom)`
        );
      } else {
        // Method 2: Crop the bottom portion containing the watermark
        const cropHeight = Math.min(
          this.CROP_BOTTOM_PIXELS,
          Math.floor(metadata.height * 0.15)
        ); // Max 15% of image height
        const newHeight = metadata.height - cropHeight;

        let croppedImage = image.extract({
          left: 0,
          top: 0,
          width: metadata.width,
          height: newHeight,
        });

        // Output in the original format
        if (outputFormat === "png") {
          processedBuffer = await croppedImage.png({ quality: 95 }).toBuffer();
        } else if (outputFormat === "webp") {
          processedBuffer = await croppedImage.webp({ quality: 95 }).toBuffer();
        } else {
          // Default to JPEG
          processedBuffer = await croppedImage.jpeg({ quality: 95 }).toBuffer();
        }

        this.logger.log(
          `✂️ Cropped ${cropHeight}px from bottom (new size: ${metadata.width}x${newHeight})`
        );
      }

      return processedBuffer;
    } catch (error) {
      this.logger.error(
        `Error processing image: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  /**
   * Check if media is a photo that should be processed
   * @param media - Telegram media object
   * @returns true if media should be processed
   */
  shouldProcessMedia(media: any): boolean {
    // Only process photos, not documents or videos
    return media && (media as any).photo !== undefined;
  }
}
