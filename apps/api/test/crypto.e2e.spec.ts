// Chiffrement des données de santé : illisibles dans la base, lisibles normalement par l'application.
import { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { decrypt, encrypt, isEncrypted, resetEncryptionKeyCache } from '../src/db/crypto';
import { Database } from '../src/db/db.module';
import { encryptExisting } from '../src/db/encrypt-existing';
import { patients, Role } from '../src/db/schema';
import { createTestApp, createUser, testDatabaseUrl } from './helpers';

describe('Chiffrement des données de santé', () => {
  let app: INestApplication;
  let db: Database;
  let family: { id: string; token: string };
  let patientId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    family = await createUser(app, db, Role.FAMILY, 'famille@exemple.fr', 'Aminata', 'Ngo');
    const res = await request(app.getHttpServer())
      .post('/api/patients')
      .set({ Authorization: `Bearer ${family.token}` })
      .send({
        firstName: 'Marie', lastName: 'Ngo', whatsappPhone: '677123456', hasSmartphone: true, city: 'DOUALA', district: 'Akwa',
        conditions: ['DIABETES'], plan: 'ESSENTIEL', medicalHistory: 'AVC en 2019', currentTreatments: 'Metformine 500 mg',
      })
      .expect(201);
    patientId = res.body.id;
  });

  afterAll(() => app.close());

  it('stocke les antécédents chiffrés, et les rend en clair à la famille', async () => {
    const raw = await db.execute<{ medical_history: string; current_treatments: string }>(
      sql`select medical_history, current_treatments from patients where id = ${patientId}`,
    );
    expect(raw.rows[0].medical_history).toMatch(/^enc:v1:/);
    expect(raw.rows[0].medical_history).not.toContain('AVC');
    const res = await request(app.getHttpServer()).get(`/api/patients/${patientId}`).set({ Authorization: `Bearer ${family.token}` }).expect(200);
    expect(res.body).toMatchObject({ medicalHistory: 'AVC en 2019', currentTreatments: 'Metformine 500 mg' });
  });

  it('chiffre les anciennes valeurs restées en clair, une seule fois', async () => {
    await db.execute(sql`update patients set notes = 'Vit seule, clé chez la voisine' where id = ${patientId}`);
    expect(await encryptExisting(testDatabaseUrl())).toBe(1);
    expect(await encryptExisting(testDatabaseUrl())).toBe(0);
    const raw = await db.execute<{ notes: string }>(sql`select notes from patients where id = ${patientId}`);
    expect(isEncrypted(raw.rows[0].notes)).toBe(true);
    const [p] = await db.select().from(patients).where(eq(patients.id, patientId));
    expect(p.notes).toBe('Vit seule, clé chez la voisine');
  });

  it('deux chiffrements du même texte diffèrent, et une autre clé ne peut pas lire', () => {
    const a = encrypt('Glycémie 1,8');
    expect(a).not.toBe(encrypt('Glycémie 1,8'));
    expect(decrypt(a)).toBe('Glycémie 1,8');
    const saved = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    resetEncryptionKeyCache();
    expect(() => decrypt(a)).toThrow();
    if (saved === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = saved;
    resetEncryptionKeyCache();
  });
});
