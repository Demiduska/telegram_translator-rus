import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "error", "warn", "debug", "verbose"],
  });

  // The app doesn't need to listen on a port since it's just watching messages
  await app.init();

  console.log("Telegram Translator Service is running...");
  console.log("Watching for new messages in the source channel...");
}

bootstrap();
