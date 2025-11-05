import { Module } from "@nestjs/common";
import { TelegramService } from "./telegram/telegram.service";
import { OpenAIService } from "./openai/openai.service";
import { TranslatorService } from "./translator/translator.service";

@Module({
  imports: [],
  providers: [TelegramService, OpenAIService, TranslatorService],
})
export class AppModule {}
