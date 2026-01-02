import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { TelegramService } from "./telegram/telegram.service";
import { TranslatorService } from "./translator/translator.service";
import { ChannelConfigParserService } from "./translator/config";
import { MessageQueueService } from "./translator/queue";
import { MessageMappingService } from "./translator/mapping";
import { MessageSenderService } from "./translator/senders";
import {
  TextProcessorService,
  ButtonProcessorService,
  ImageProcessorService,
} from "./translator/processors";
import { WebhookService } from "./translator/webhook";

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    TelegramService,
    TranslatorService,
    ChannelConfigParserService,
    MessageQueueService,
    MessageMappingService,
    MessageSenderService,
    TextProcessorService,
    ButtonProcessorService,
    ImageProcessorService,
    WebhookService,
  ],
})
export class AppModule {}
