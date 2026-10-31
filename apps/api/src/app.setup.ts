import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

// Réglages communs à l'appli réelle et aux tests, pour qu'ils se comportent pareil.
export function configureApp(app: INestApplication, webOrigin?: string): void {
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: webOrigin ?? 'http://localhost:5173', credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // supprime les champs non déclarés dans les DTO
      forbidNonWhitelisted: true, // et refuse la requête s'il y en a
      transform: true,
    }),
  );
}
