// Tests de bout en bout : vraie API, vraie base PostgreSQL (DATABASE_URL doit pointer vers une base de test).
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Database, DB } from '../src/db/db.module';
import { runMigrations } from '../src/db/migrate';
import { auditLogs, Role, users } from '../src/db/schema';

describe('Authentification et rôles', () => {
  let app: INestApplication;
  let db: Database;
  let adminToken: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL doit pointer vers une base de test');
    process.env.JWT_SECRET ??= 'secret-de-test-suffisamment-long';
    await runMigrations(process.env.DATABASE_URL);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(DB);

    // Repart d'une base vide à chaque lancement des tests
    await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);

    await db.insert(users).values({
      email: 'admin@test.local',
      passwordHash: await bcrypt.hash('AdminPass123', 4),
      role: Role.ADMIN,
      firstName: 'Admin',
      lastName: 'Test',
    });
    const res = await http().post('/api/auth/login').send({ email: 'admin@test.local', password: 'AdminPass123' });
    adminToken = res.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('la route de santé est publique', async () => {
    await http().get('/api/health').expect(200, { status: 'ok' });
  });

  it("refuse l'accès sans jeton", async () => {
    await http().get('/api/auth/me').expect(401);
  });

  it("inscrit une famille et ne renvoie jamais le hash du mot de passe", async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({ email: 'Aminata@Exemple.fr', password: 'MotDePasse1', firstName: 'Aminata', lastName: 'K.' })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('FAMILY');
    expect(res.body.user.email).toBe('aminata@exemple.fr');
    expect(res.body.user.passwordHash).toBeUndefined();

    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body.firstName).toBe('Aminata');
  });

  it("refuse une deuxième inscription avec la même adresse", async () => {
    await http()
      .post('/api/auth/register')
      .send({ email: 'aminata@exemple.fr', password: 'MotDePasse1', firstName: 'A', lastName: 'K' })
      .expect(409);
  });

  it("refuse les champs inconnus (impossible de s'inscrire en se donnant le rôle admin)", async () => {
    await http()
      .post('/api/auth/register')
      .send({ email: 'pirate@exemple.fr', password: 'MotDePasse1', firstName: 'P', lastName: 'X', role: 'ADMIN' })
      .expect(400);
  });

  it('refuse un mauvais mot de passe', async () => {
    await http().post('/api/auth/login').send({ email: 'aminata@exemple.fr', password: 'mauvais' }).expect(401);
  });

  it("interdit l'espace admin à une famille", async () => {
    const login = await http().post('/api/auth/login').send({ email: 'aminata@exemple.fr', password: 'MotDePasse1' });
    await http().get('/api/admin/users').set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
  });

  it("l'admin crée un médecin, qui peut ensuite se connecter", async () => {
    const res = await http()
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'dr.mbarga@exemple.cm',
        password: 'Medecin123',
        role: 'DOCTOR',
        firstName: 'Paul',
        lastName: 'Mbarga',
        city: 'DOUALA',
        licenseNumber: 'ONMC-0000',
      })
      .expect(201);
    expect(res.body.partnerProfile.city).toBe('DOUALA');
    expect(res.body.partnerProfile.verifiedAt).toBeNull();

    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'dr.mbarga@exemple.cm', password: 'Medecin123' })
      .expect(200);
    expect(login.body.user.role).toBe('DOCTOR');
  });

  it('exige une ville pour un partenaire', async () => {
    await http()
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'pharma@exemple.cm', password: 'Pharma1234', role: 'PHARMACY', firstName: 'P', lastName: 'Q' })
      .expect(400);
  });

  it("l'admin ne peut pas créer un compte famille", async () => {
    await http()
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'f@exemple.fr', password: 'Famille123', role: 'FAMILY', firstName: 'F', lastName: 'G' })
      .expect(400);
  });

  it("un compte désactivé perd l'accès immédiatement, même avec un jeton encore valide", async () => {
    const login = await http().post('/api/auth/login').send({ email: 'dr.mbarga@exemple.cm', password: 'Medecin123' });
    const token = login.body.accessToken;
    const doctorId = login.body.user.id;

    await http()
      .patch(`/api/admin/users/${doctorId}/active`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    await http().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    await http().post('/api/auth/login').send({ email: 'dr.mbarga@exemple.cm', password: 'Medecin123' }).expect(401);
  });

  it('enregistre les actions dans le journal des accès', async () => {
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, 'user.create'));
    expect(rows).toHaveLength(1);
  });
});
