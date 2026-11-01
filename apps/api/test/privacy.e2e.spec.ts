// Droits des personnes : copie de toutes les données d'un parent, et effacement (factures conservées).
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { Database } from '../src/db/db.module';
import { consultations, coverageZones, partnerProfiles, patients, payments, readings, Role, whatsappMessages } from '../src/db/schema';
import { MailerService } from '../src/mail/mailer.service';
import { createTestApp, createUser, FakeTranzak, TRANZAK_AUTH_KEY } from './helpers';

type U = { id: string; token: string };

describe('Copie et effacement des données', () => {
  let app: INestApplication;
  let db: Database;
  let tranzak: FakeTranzak;
  let mailer: MailerService;
  let family: U, other: U, admin: U, doc: U;
  let marieId: string;
  const http = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    ({ app, db, tranzak } = await createTestApp());
    mailer = app.get(MailerService);
    await db.insert(coverageZones).values({ city: 'DOUALA', district: 'Akwa', districtKey: 'akwa' });
    family = await createUser(app, db, Role.FAMILY, 'famille@exemple.fr', 'Aminata', 'Ngo');
    other = await createUser(app, db, Role.FAMILY, 'autre@exemple.fr', 'Autre', 'Famille');
    admin = await createUser(app, db, Role.ADMIN, 'admin@exemple.cm', 'Admin', 'Test');
    doc = await createUser(app, db, Role.DOCTOR, 'dr@exemple.cm', 'Jean', 'Mbarga');
    await db.insert(partnerProfiles).values({ userId: doc.id, city: 'DOUALA', verifiedAt: new Date() });
    const pharma = await createUser(app, db, Role.PHARMACY, 'pharma@exemple.cm', 'P', 'H');
    await db.insert(partnerProfiles).values({ userId: pharma.id, city: 'DOUALA', verifiedAt: new Date() });
    await http()
      .put('/api/care/availability')
      .set(as(doc))
      .send({ slots: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 360, endMinute: 1320 })) })
      .expect(200);
    const res = await http()
      .post('/api/patients')
      .set(as(family))
      .send({ firstName: 'Marie', lastName: 'Ngo', whatsappPhone: '677123456', hasSmartphone: true, city: 'DOUALA', district: 'Akwa', conditions: ['DIABETES'], plan: 'ESSENTIEL', medicalHistory: 'AVC en 2019' })
      .expect(201);
    marieId = res.body.id;
    await db.update(patients).set({ consentGivenAt: new Date() }).where(eq(patients.id, marieId));
    await http().post(`/api/patients/${marieId}/checkout`).set(as(family)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(201);
    tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
    await http().post('/api/webhooks/tranzak').send({ resourceId: tranzak.lastRequestId(), authKey: TRANZAK_AUTH_KEY }).expect(200);
    const [c] = await db.select().from(consultations).where(eq(consultations.patientId, marieId));
    await db.update(consultations).set({ scheduledAt: new Date(Date.now() - 5 * 60_000) }).where(eq(consultations.id, c.id));
    await http()
      .post(`/api/doctor/consultations/${c.id}/complete`)
      .set(as(doc))
      .send({ summary: 'Glycémie à surveiller.', readings: [{ type: 'GLUCOSE', value: 1.4 }], prescription: [{ name: 'Metformine 500 mg' }] })
      .expect(201);
    await db.insert(whatsappMessages).values({ phone: '237677123456', patientId: marieId, direction: 'IN', kind: 'incoming', body: "J'ai des vertiges", status: 'RECEIVED' });
  });

  afterAll(() => app.close());

  it('la famille titulaire télécharge une copie complète, lisible', async () => {
    const res = await http().get(`/api/patients/${marieId}/privacy/export`).set(as(family)).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="proche-sante-marie-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.body.parent).toMatchObject({ firstName: 'Marie', medicalHistory: 'AVC en 2019' });
    expect(res.body.consultations[0]).toMatchObject({ doctor: 'Dr Mbarga', summary: 'Glycémie à surveiller.' });
    expect(res.body.readings[0]).toMatchObject({ type: 'GLUCOSE', value: 1.4 });
    expect(res.body.prescriptions[0].items).toEqual([{ name: 'Metformine 500 mg' }]);
    expect(res.body.whatsappMessages).toContainEqual(expect.objectContaining({ direction: 'reçu du parent', text: "J'ai des vertiges" }));
    expect(res.body.payments[0]).toMatchObject({ status: 'SUCCEEDED', invoiceNumber: expect.stringMatching(/^PS-/) });
    expect(res.body.consentToken).toBeUndefined();
  });

  it("une autre famille n'y a pas accès", async () => {
    await http().get(`/api/patients/${marieId}/privacy/export`).set(as(other)).expect(404);
    await http().post(`/api/patients/${marieId}/privacy/erase`).set(as(other)).send({ confirmFirstName: 'Marie' }).expect(404);
  });

  it("refuse l'effacement sans le bon prénom", async () => {
    await http().post(`/api/patients/${marieId}/privacy/erase`).set(as(family)).send({ confirmFirstName: 'Paul' }).expect(400);
  });

  it('efface tout le suivi, garde les factures, arrête le suivi et prévient la famille', async () => {
    mailer.outbox.length = 0;
    await http().post(`/api/patients/${marieId}/privacy/erase`).set(as(family)).send({ confirmFirstName: ' marie ' }).expect(201);

    const [p] = await db.select().from(patients).where(eq(patients.id, marieId));
    expect(p).toMatchObject({ firstName: 'Parent', lastName: 'effacé', medicalHistory: null, doctorId: null, consentGivenAt: null, conditions: [] });
    expect(p.erasedAt).not.toBeNull();
    expect(await db.select().from(readings).where(eq(readings.patientId, marieId))).toHaveLength(0);
    expect(await db.select().from(consultations).where(eq(consultations.patientId, marieId))).toHaveLength(0);
    expect(await db.select().from(whatsappMessages).where(eq(whatsappMessages.patientId, marieId))).toHaveLength(0);
    const pays = await db.select().from(payments).where(eq(payments.patientId, marieId));
    expect(pays).toHaveLength(1); // facture conservée
    expect(mailer.outbox[0].subject).toBe('Données de Marie effacées');

    await http().get(`/api/patients/${marieId}`).set(as(family)).expect(404);
    expect((await http().get('/api/patients').set(as(family)).expect(200)).body).toHaveLength(0);
    expect((await http().get('/api/admin/patients').set(as(admin)).expect(200)).body).toHaveLength(0);
    await http().get(`/api/admin/patients/${marieId}/privacy/export`).set(as(admin)).expect(404);
    // La facture reste téléchargeable par la famille
    const list = await http().get('/api/payments').set(as(family)).expect(200);
    expect(list.body).toHaveLength(1);
  });
});
