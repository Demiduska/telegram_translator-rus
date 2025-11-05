import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { AppModule } from "../src/app.module";
import * as express from "express";
import * as dotenv from "dotenv";

dotenv.config();

const expressApp = express();
let app: any;

async function createNestApp() {
  if (!app) {
    app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
      logger: ["error", "warn"],
    });
    app.enableCors();
    await app.init();
  }
  return expressApp;
}

export default async (req: any, res: any) => {
  await createNestApp();
  expressApp(req, res);
};
