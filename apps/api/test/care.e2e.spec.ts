// Portail médecin et infirmier : affectation et planification automatiques, cloisonnement des dossiers,
// consultation (compte rendu, ordonnance, analyses, orientation), visites, relevés et alertes.
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { SchedulingService } from '../src/care/scheduling.service';
import { Database } from '../src/db/db.module';
import {
  consultations,
  coverageZones,
  homeVisits,
  labRequests,
  partnerProfiles,
  patients,
  prescriptions,
  referrals,
  Role,
  subscriptions,
} from '../src/db/schema';
import { MailerService } from '../src/mail/mailer.service';
import { createTestApp, createUser, FakeTranzak, TRANZAK_AUTH_KEY } from './helpers';

type U = { id: string; token: string };
const MIN = 60_000;

// Disponible tous les jours de 6 h à 22 h (heure du Cameroun) : les tests ne dépendent pas du jour où ils tournent
const EVERY_DAY = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 360, endMinute: 1320 }));

describe('Portail soignants', () => {
  let app: INestApplication;
  let db: Database;
  let tranzak: FakeTranzak;
  let mailer: MailerService;
  let family: U, doc: U, doc2: U, unverifiedDoc: U, nurse: U, pharmacy: U, admin: U;
  let marie: string;
  let initialId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });

  async function partner(role: Role, email: string, name: string, verified = true): Promise<U> {
    const u = await createUser(app, db, role, email, name, 'Test');
    await db.insert(partnerProfiles).values({ userId: u.id, city: 'DOUALA', verifiedAt: verified ? new Date() : null });
    return u;
  }

  beforeAll(async () => {
    ({ app, db, tranzak } = await createTestApp());
    mailer = app.get(MailerService);
    await db.insert(coverageZones).values({ city: 'DOUALA', district: 'Akwa', districtKey: 'akwa' });
    family = await createUser(app, db, Role.FAMILY, 'famille@exemple.fr', 'Aminata', 'Ngo');
    admin = await createUser(app, db, Role.ADMIN, 'admin@exemple.cm', 'Admin', 'Test');
    unverifiedDoc = await partner(Role.DOCTOR, 'nonverifie@exemple.cm', 'NonVérifié', false);
    doc = await partner(Role.DOCTOR, 'dr.mbarga@exemple.cm', 'Jean');
    doc2 = await partner(Role.DOCTOR, 'dr.autre@exemple.cm', 'Autre');
    nurse = await partner(Role.NURSE, 'inf@exemple.cm', 'Brigitte');
    pharmacy = await partner(Role.PHARMACY, 'pharma@exemple.cm', 'Pharmacie');
    // Le second médecin suit déjà un patient : l'affectation automatique choisit le moins chargé
    const [other] = await db
      .insert(patients)
      .values({
        familyUserId: admin.id,
        firstName: 'X',
        lastName: 'Y',
        whatsappPhone: '+237600000000',
        city: 'DOUALA',
        district: 'Akwa',
        consentToken: 'tok-x',
        doctorId: doc2.id,
      })
      .returning();
    expect(other).toBeDefined();
  });

  afterAll(() => app.close());

  it('chaque soignant enregistre ses disponibilités ; les chevauchements sont refusés', async () => {
    await http()
      .put('/api/care/availability')
      .set(as(doc))
      .send({ slots: [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 700, endMinute: 800 }] })
      .expect(400);
    for (const u of [doc, doc2, nurse, unverifiedDoc]) {
      await http().put('/api/care/availability').set(as(u)).send({ slots: EVERY_DAY }).expect(200);
    }
    const res = await http().get('/api/care/availability').set(as(doc)).expect(200);
    expect(res.body).toHaveLength(7);
    await http().get('/api/care/availability').set(as(family)).expect(403);
  });

  describe('activation', () => {
    beforeAll(async () => {
      const res = await http()
        .post('/api/patients')
        .set(as(family))
        .send({ firstName: 'Marie', lastName: 'Ngo', whatsappPhone: '677123456', hasSmartphone: true, city: 'DOUALA', district: 'Akwa', conditions: ['DIABETES', 'HYPERTENSION'], plan: 'SERENITE', medicalHistory: 'Opération de la hanche en 2019' })
        .expect(201);
      marie = res.body.id;
      await db.update(patients).set({ consentGivenAt: new Date() }).where(eq(patients.id, marie));
      mailer.outbox.length = 0;
      await http().post(`/api/patients/${marie}/checkout`).set(as(family)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(201);
      tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
      await http().post('/api/webhooks/tranzak').send({ resourceId: tranzak.lastRequestId(), authKey: TRANZAK_AUTH_KEY }).expect(200);
    });

    it("affecte l'équipe : médecin vérifié le moins chargé, infirmière (Sérénité), pharmacie", async () => {
      const [p] = await db.select().from(patients).where(eq(patients.id, marie));
      expect(p.doctorId).toBe(doc.id); // pas doc2 (déjà un patient), pas le médecin non vérifié
      expect(p.nurseId).toBe(nurse.id);
      expect(p.pharmacyId).toBe(pharmacy.id);
    });

    it('planifie le bilan de départ en visio et la visite à domicile, et prévient la famille', async () => {
      const cons = await db.select().from(consultations).where(eq(consultations.patientId, marie));
      expect(cons).toHaveLength(1);
      expect(cons[0]).toMatchObject({ kind: 'INITIAL', mode: 'VIDEO', status: 'SCHEDULED', doctorId: doc.id });
      expect(cons[0].videoUrl).toMatch(/^https:\/\/meet\.jit\.si\/ProcheSante-[0-9a-f]{24}$/);
      initialId = cons[0].id;
      const visits = await db.select().from(homeVisits).where(eq(homeVisits.patientId, marie));
      expect(visits).toHaveLength(1);
      expect(mailer.outbox.map((m) => m.subject)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^Bilan de départ de Marie/), expect.stringMatching(/^Visite à domicile/)]),
      );
    });

    it('la famille voit le lien de visio et la prochaine visite', async () => {
      const res = await http().get(`/api/patients/${marie}/dashboard`).set(as(family)).expect(200);
      expect(res.body.nextConsultation).toMatchObject({ kind: 'INITIAL', mode: 'VIDEO', doctorName: 'Dr Jean Test' });
      expect(res.body.nextConsultation.videoUrl).toContain('meet.jit.si');
      expect(res.body.nextVisit).not.toBeNull();
    });

    it('la planification quotidienne ne double pas les rendez-vous', async () => {
      const r = await app.get(SchedulingService).ensureAll(new Date());
      expect(r).toEqual({ consultations: 0, visits: 0, unassigned: 0 });
    });
  });

  describe('cloisonnement', () => {
    it("un autre médecin ne voit pas le dossier (introuvable)", async () => {
      await http().get(`/api/doctor/patients/${marie}`).set(as(doc2)).expect(404);
      await http().post(`/api/doctor/consultations/${initialId}/complete`).set(as(doc2)).send({ summary: 'Tentative non autorisée' }).expect(404);
      const list = await http().get('/api/doctor/patients').set(as(doc2)).expect(200);
      expect(list.body.map((p: { name: string }) => p.name)).not.toContain('Marie Ngo');
    });

    it("ni l'infirmière ni la famille n'ont accès au portail médecin", async () => {
      await http().get(`/api/doctor/patients/${marie}`).set(as(nurse)).expect(403);
      await http().get('/api/doctor/agenda').set(as(family)).expect(403);
      await http().get('/api/nurse/visits').set(as(doc)).expect(403);
    });

    it('le médecin affecté voit le dossier complet', async () => {
      const res = await http().get(`/api/doctor/patients/${marie}`).set(as(doc)).expect(200);
      expect(res.body.patient.medicalHistory).toBe('Opération de la hanche en 2019');
      expect(res.body.consultations).toHaveLength(1);
      const agenda = await http().get('/api/doctor/agenda').set(as(doc)).expect(200);
      expect(agenda.body[0].patient.name).toBe('Marie Ngo');
    });
  });

  describe('consultation', () => {
    it("ne peut pas être clôturée avant d'avoir eu lieu", async () => {
      await db.update(consultations).set({ scheduledAt: new Date(Date.now() + 3 * 60 * MIN) }).where(eq(consultations.id, initialId));
      await http().post(`/api/doctor/consultations/${initialId}/complete`).set(as(doc)).send({ summary: 'Compte rendu trop tôt' }).expect(400);
    });

    it('refuse un relevé impossible, sans rien enregistrer', async () => {
      await db.update(consultations).set({ scheduledAt: new Date(Date.now() - 5 * MIN) }).where(eq(consultations.id, initialId));
      await http()
        .post(`/api/doctor/consultations/${initialId}/complete`)
        .set(as(doc))
        .send({ summary: 'Bilan de départ complet', readings: [{ type: 'BLOOD_PRESSURE', systolic: 80, diastolic: 120 }] })
        .expect(400);
      const [c] = await db.select().from(consultations).where(eq(consultations.id, initialId));
      expect(c.status).toBe('SCHEDULED');
    });

    it('clôture : compte rendu, relevé, ordonnance à la pharmacie, analyses, orientation, famille prévenue', async () => {
      mailer.outbox.length = 0;
      await http()
        .post(`/api/doctor/consultations/${initialId}/complete`)
        .set(as(doc))
        .send({
          summary: 'Bilan de départ. Tension très élevée ce jour. Traitement ajusté.',
          readings: [{ type: 'BLOOD_PRESSURE', systolic: 185, diastolic: 112 }],
          prescription: [{ name: 'Amlodipine 10 mg', dosage: '1 comprimé le matin', quantity: 30 }],
          labs: { tests: ['HbA1c', 'Créatinine'] },
          referral: { destination: 'Cardiologue', urgency: 'URGENT', reason: 'Tension mal contrôlée' },
        })
        .expect(201);

      const [c] = await db.select().from(consultations).where(eq(consultations.id, initialId));
      expect(c.status).toBe('DONE');
      const [presc] = await db.select().from(prescriptions).where(eq(prescriptions.consultationId, initialId));
      expect(presc).toMatchObject({ status: 'SENT', pharmacyId: pharmacy.id });
      expect(await db.select().from(labRequests).where(eq(labRequests.patientId, marie))).toHaveLength(1);
      expect(await db.select().from(referrals).where(eq(referrals.patientId, marie))).toHaveLength(1);
      expect(mailer.outbox[0].subject).toBe('Important : Marie doit consulter Cardiologue');

      // Mesuré par le médecin lui-même : l'alerte est créée mais déjà marquée vue
      const alerts = await http().get('/api/doctor/alerts').set(as(doc)).expect(200);
      expect(alerts.body).toHaveLength(0);
    });

    it("ne peut pas être clôturée deux fois", async () => {
      await http().post(`/api/doctor/consultations/${initialId}/complete`).set(as(doc)).send({ summary: 'Deuxième compte rendu' }).expect(409);
    });

    it("la famille lit le compte rendu, l'orientation et les analyses", async () => {
      const res = await http().get(`/api/patients/${marie}/consultations`).set(as(family)).expect(200);
      const c = res.body.find((x: { id: string }) => x.id === initialId);
      expect(c.summary).toMatch(/Bilan de départ/);
      expect(c.referrals[0]).toMatchObject({ destination: 'Cardiologue', urgency: 'URGENT' });
      expect(c.labRequests[0].tests).toEqual(['HbA1c', 'Créatinine']);
    });

    it('consultation manquée : replacée automatiquement', async () => {
      const extra = await http().post(`/api/doctor/patients/${marie}/consultations`).set(as(doc)).send({}).expect(201);
      const res = await http().post(`/api/doctor/consultations/${extra.body.id}/missed`).set(as(doc)).send({ reason: 'Ne répond pas' }).expect(201);
      expect(res.body.rescheduledTo).not.toBeNull();
      const [missed] = await db.select().from(consultations).where(eq(consultations.id, extra.body.id));
      expect(missed).toMatchObject({ status: 'MISSED', missedReason: 'Ne répond pas' });
    });

    it('reprogrammation : seulement sur un créneau libre de ses disponibilités', async () => {
      const extra = await http().post(`/api/doctor/patients/${marie}/consultations`).set(as(doc)).send({}).expect(201);
      const slots = await http().get('/api/doctor/slots').set(as(doc)).expect(200);
      const target = slots.body[3];
      const ok = await http().post(`/api/doctor/consultations/${extra.body.id}/reschedule`).set(as(doc)).send({ scheduledAt: target }).expect(201);
      expect(new Date(ok.body.scheduledAt).toISOString()).toBe(new Date(target).toISOString());

      // 3 h du matin au Cameroun (2 h UTC), hors disponibilités
      const night = new Date(Date.now() + 2 * 24 * 60 * MIN);
      night.setUTCHours(2, 0, 0, 0);
      await http().post(`/api/doctor/consultations/${extra.body.id}/reschedule`).set(as(doc)).send({ scheduledAt: night.toISOString() }).expect(409);
    });
  });

  describe('visite à domicile', () => {
    let visitId: string;

    it("l'infirmière voit sa tournée et ce qu'il faut pour la visite, pas les antécédents", async () => {
      const list = await http().get('/api/nurse/visits').set(as(nurse)).query({ to: new Date(Date.now() + 40 * 24 * 60 * MIN).toISOString() }).expect(200);
      expect(list.body).toHaveLength(1);
      visitId = list.body[0].id;
      const detail = await http().get(`/api/nurse/visits/${visitId}`).set(as(nurse)).expect(200);
      expect(detail.body.patient.name).toBe('Marie Ngo');
      expect(detail.body.treatment.items[0].name).toBe('Amlodipine 10 mg');
      expect(detail.body.patient.medicalHistory).toBeUndefined();
    });

    it("une glycémie dangereuse crée une alerte urgente : écran de l'infirmière, e-mail et liste du médecin", async () => {
      mailer.outbox.length = 0;
      const res = await http()
        .post(`/api/nurse/visits/${visitId}/complete`)
        .set(as(nurse))
        .send({
          readings: [
            { type: 'GLUCOSE', value: 0.5 },
            { type: 'BLOOD_PRESSURE', systolic: 138, diastolic: 86 },
          ],
          treatmentChecked: true,
          note: 'Prend bien son traitement. Un peu fatiguée.',
        })
        .expect(201);
      expect(res.body.alerts).toEqual([{ severity: 'URGENT', message: 'Hypoglycémie sévère : 0,5 g/L' }]);
      expect(mailer.outbox[0]).toMatchObject({ to: 'dr.mbarga@exemple.cm' });
      expect(mailer.outbox[0].subject).toMatch(/^URGENT · Marie Ngo/);

      const alerts = await http().get('/api/doctor/alerts').set(as(doc)).expect(200);
      expect(alerts.body).toHaveLength(1);
      await http().post(`/api/doctor/alerts/${alerts.body[0].id}/ack`).set(as(doc2)).send({}).expect(404);
      await http().post(`/api/doctor/alerts/${alerts.body[0].id}/ack`).set(as(doc)).send({ note: 'Appelée, resucrage fait' }).expect(201);
      expect((await http().get('/api/doctor/alerts').set(as(doc)).expect(200)).body).toHaveLength(0);
    });

    it('la famille voit les relevés mesurés à domicile', async () => {
      const res = await http().get(`/api/patients/${marie}/readings`).query({ type: 'GLUCOSE' }).set(as(family)).expect(200);
      expect(res.body[0]).toMatchObject({ value: 0.5, source: 'NURSE' });
    });
  });

  it('le mois suivant, une consultation mensuelle est planifiée', async () => {
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.patientId, marie));
    const next = new Date(s.currentPeriodEnd!);
    next.setUTCMonth(next.getUTCMonth() + 1);
    await db.update(subscriptions).set({ currentPeriodEnd: next }).where(eq(subscriptions.patientId, marie));
    const r = await app.get(SchedulingService).ensureForPatient(marie, new Date(s.currentPeriodEnd!.getTime() + 60 * MIN));
    expect(r.consultation).toBe(true);
    const monthly = await db.select().from(consultations).where(eq(consultations.kind, 'MONTHLY'));
    expect(monthly).toHaveLength(1);
  });

  it("l'admin ne peut pas affecter un compte du mauvais rôle", async () => {
    await http().patch(`/api/admin/patients/${marie}/care-team`).set(as(admin)).send({ doctorId: pharmacy.id }).expect(400);
    const ok = await http().patch(`/api/admin/patients/${marie}/care-team`).set(as(admin)).send({ doctorId: doc2.id }).expect(200);
    expect(ok.body.doctorId).toBe(doc2.id);
    // Le dossier suit le changement de médecin
    await http().get(`/api/doctor/patients/${marie}`).set(as(doc)).expect(404);
    await http().get(`/api/doctor/patients/${marie}`).set(as(doc2)).expect(200);
  });
});
