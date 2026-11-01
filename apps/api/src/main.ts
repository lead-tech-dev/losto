import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { checkProductionEnv } from './common/env-check';
import { initMonitoring } from './common/monitoring';

async function bootstrap() {
  // rawBody : le corps brut est nécessaire pour vérifier la signature des notifications Stripe
  initMonitoring();
  const { errors, warnings } = checkProductionEnv();
  warnings.forEach((w) => console.warn(`⚠ ${w}`));
  if (errors.length) {
    errors.forEach((e) => console.error(`✗ ${e}`));
    process.exit(1);
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Derrière l'hébergeur (Render, Caddy…) : l'adresse IP réelle sert à la limite de débit
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  configureApp(app, process.env.WEB_ORIGIN);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API Proche Santé démarrée (port ${port})`);
}

bootstrap();
