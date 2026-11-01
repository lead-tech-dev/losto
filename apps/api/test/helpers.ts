import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Database, DB } from '../src/db/db.module';
import { runMigrations } from '../src/db/migrate';
import { Role, users } from '../src/db/schema';

// Démarre l'API complète sur une base de test vidée.
export async function createTestApp(): Promise<{ app: INestApplication; db: Database }> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL doit pointer vers une base de test');
  process.env.JWT_SECRET ??= 'secret-de-test-suffisamment-long';
  await runMigrations(process.env.DATABASE_URL);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const db = app.get<Database>(DB);
  await db.execute(sql`TRUNCATE users, coverage_zones RESTART IDENTITY CASCADE`);
  return { app, db };
}

// Crée un compte directement en base et renvoie son jeton de connexion.
export async function createUser(
  app: INestApplication,
  db: Database,
  role: Role,
  email: string,
  firstName = 'Test',
  lastName = 'User',
): Promise<{ id: string; token: string }> {
  const password = 'MotDePasse123';
  const [u] = await db
    .insert(users)
    .values({ email, passwordHash: await bcrypt.hash(password, 4), role, firstName, lastName })
    .returning();
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
  return { id: u.id, token: res.body.accessToken };
}

export function tokenFromMail(text: string): string {
  const m = text.match(/token=([\w-]+)/);
  if (!m) throw new Error(`Pas de jeton dans l'e-mail : ${text}`);
  return m[1];
}
