import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { TelegramService } from "./telegram/telegram.service";
import { TranslatorService } from "./translator/translator.service";

@Module({
  imports: [],
  controllers: [AppController],
  providers: [TelegramService, TranslatorService],
})
export class AppModule {}
