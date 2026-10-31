import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app, process.env.WEB_ORIGIN);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API Proche Santé sur http://localhost:${port}/api`);
}

bootstrap();
