// Espace famille : inscription d'un parent, droits d'accès, suivi, partage, consentement, messagerie.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Database } from '../src/db/db.module';
import {
  consultations,
  coverageZones,
  deliveries,
  prescriptions,
  readings,
  Role,
  subscriptions,
} from '../src/db/schema';
import { MailerService } from '../src/mail/mailer.service';
import { createTestApp, createUser, tokenFromMail } from './helpers';
import { eq } from 'drizzle-orm';

const DAY = 24 * 60 * 60 * 1000;

const PARENT = {
  firstName: 'Marie',
  lastName: 'Ngo',
  birthYear: 1954,
  whatsappPhone: '6 77 12 34 56',
  hasSmartphone: true,
  city: 'DOUALA',
  district: 'bonapriso',
  conditions: ['DIABETES', 'HYPERTENSION'],
  currentTreatments: 'Metformine 500 mg matin et soir',
  plan: 'ESSENTIEL',
};

describe('Espace famille', () => {
  let app: INestApplication;
  let db: Database;
  let mailer: MailerService;
  let a: { id: string; token: string }; // titulaire
  let b: { id: string; token: string }; // frère invité
  let c: { id: string; token: string }; // autre famille, sans lien
  let doctor: { id: string; token: string };
  let admin: { id: string; token: string };
  let patientId: string;
  let consentUrl: string;

  const http = () => request(app.getHttpServer());
  const as = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    mailer = app.get(MailerService);
    a = await createUser(app, db, Role.FAMILY, 'aminata@exemple.fr', 'Aminata', 'Ngo');
    b = await createUser(app, db, Role.FAMILY, 'paul@exemple.fr', 'Paul', 'Ngo');
    c = await createUser(app, db, Role.FAMILY, 'autre@exemple.fr', 'Autre', 'Famille');
    doctor = await createUser(app, db, Role.DOCTOR, 'dr@exemple.cm', 'Jean', 'Mbarga');
    admin = await createUser(app, db, Role.ADMIN, 'admin@exemple.cm', 'Admin', 'Équipe');
    await db.insert(coverageZones).values({ city: 'DOUALA', district: 'Bonapriso', districtKey: 'bonapriso' });
  });

  afterAll(() => app.close());

  describe('couverture', () => {
    it('reconnaît un quartier quelle que soit la casse ou les accents', async () => {
      const res = await http().get('/api/coverage').query({ city: 'DOUALA', district: '  BONAPRISO ' }).expect(200);
      expect(res.body.covered).toBe(true);
    });

    it('signale un quartier non couvert', async () => {
      const res = await http().get('/api/coverage').query({ city: 'DOUALA', district: 'Japoma' }).expect(200);
      expect(res.body.covered).toBe(false);
    });
  });

  describe('inscription du parent', () => {
    it('refuse un numéro WhatsApp non camerounais', async () => {
      await http().post('/api/patients').set(as(a)).send({ ...PARENT, whatsappPhone: '06 12 34 56 78' }).expect(400);
    });

    it('exige au moins une maladie suivie', async () => {
      await http().post('/api/patients').set(as(a)).send({ ...PARENT, conditions: [] }).expect(400);
    });

    it('inscrit le parent avec sa formule en attente de paiement', async () => {
      const res = await http().post('/api/patients').set(as(a)).send(PARENT).expect(201);
      patientId = res.body.id;
      consentUrl = res.body.consentUrl;
      expect(res.body.whatsappPhone).toBe('+237677123456');
      expect(res.body.role).toBe('OWNER');
      expect(res.body.covered).toBe(true);
      expect(res.body.consentGiven).toBe(false);
      expect(consentUrl).toMatch(/\/consentement\//);
      expect(res.body.subscription).toMatchObject({ plan: 'ESSENTIEL', status: 'PENDING', priceEur: 25 });
    });

    it('le parent apparaît dans la liste de son titulaire', async () => {
      const res = await http().get('/api/patients').set(as(a)).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].firstName).toBe('Marie');
    });
  });

  describe("droits d'accès", () => {
    it("une autre famille ne voit pas le dossier (introuvable, pas 'interdit')", async () => {
      await http().get(`/api/patients/${patientId}`).set(as(c)).expect(404);
      await http().get(`/api/patients/${patientId}/dashboard`).set(as(c)).expect(404);
      await http().get(`/api/patients/${patientId}/readings`).query({ type: 'GLUCOSE' }).set(as(c)).expect(404);
      const list = await http().get('/api/patients').set(as(c)).expect(200);
      expect(list.body).toHaveLength(0);
    });

    it("un médecin n'a pas accès à l'espace famille", async () => {
      await http().get('/api/patients').set(as(doctor)).expect(403);
    });
  });

  describe('consentement du parent', () => {
    it('le parent voit le minimum et confirme sans compte', async () => {
      const token = consentUrl.split('/consentement/')[1];
      const preview = await http().get(`/api/consent/${token}`).expect(200);
      expect(preview.body).toEqual({ patientFirstName: 'Marie', familyName: 'Aminata Ngo', given: false });

      await http().post(`/api/consent/${token}`).expect(200, { given: true });
      const res = await http().get(`/api/patients/${patientId}`).set(as(a)).expect(200);
      expect(res.body.consentGiven).toBe(true);
      expect(res.body.consentUrl).toBeNull();
    });

    it('un faux lien est refusé', async () => {
      await http().get('/api/consent/faux-lien').expect(404);
    });
  });

  describe('formule et dossier', () => {
    it('change la formule tant que le paiement est en attente', async () => {
      const res = await http().patch(`/api/patients/${patientId}/plan`).set(as(a)).send({ plan: 'SERENITE' }).expect(200);
      expect(res.body.subscription).toMatchObject({ plan: 'SERENITE', priceEur: 45 });
    });

    it('bloque le changement direct une fois l’abonnement actif', async () => {
      await db.update(subscriptions).set({ status: 'ACTIVE' }).where(eq(subscriptions.patientId, patientId));
      await http().patch(`/api/patients/${patientId}/plan`).set(as(a)).send({ plan: 'ESSENTIEL' }).expect(409);
    });

    it('le titulaire modifie le dossier', async () => {
      const res = await http()
        .patch(`/api/patients/${patientId}`)
        .set(as(a))
        .send({ addressDetails: 'Rue des Palmiers, portail bleu', hasSmartphone: false })
        .expect(200);
      expect(res.body.addressDetails).toBe('Rue des Palmiers, portail bleu');
      expect(res.body.hasSmartphone).toBe(false);
    });
  });

  describe('tableau de bord et historiques', () => {
    beforeAll(async () => {
      const [consult] = await db
        .insert(consultations)
        .values({ patientId, doctorId: doctor.id, scheduledAt: new Date(Date.now() - 10 * DAY), status: 'DONE', summary: 'Tension stable.' })
        .returning();
      await db
        .insert(consultations)
        .values({ patientId, doctorId: doctor.id, scheduledAt: new Date(Date.now() + 3 * DAY), mode: 'VIDEO' });
      const [presc] = await db
        .insert(prescriptions)
        .values({
          consultationId: consult.id,
          items: [{ name: 'Metformine 500 mg', dosage: '1 matin et soir', quantity: 60 }],
          status: 'DELIVERED',
          priceXaf: 4500,
        })
        .returning();
      await db.insert(deliveries).values({ prescriptionId: presc.id, status: 'DELIVERED', deliveredAt: new Date() });
      await db.insert(readings).values([
        { patientId, type: 'GLUCOSE', value: '1.40', measuredAt: new Date(Date.now() - 200 * DAY), source: 'WHATSAPP' },
        { patientId, type: 'GLUCOSE', value: '1.30', measuredAt: new Date(Date.now() - 20 * DAY), source: 'WHATSAPP' },
        { patientId, type: 'GLUCOSE', value: '1.10', measuredAt: new Date(Date.now() - 2 * DAY), source: 'NURSE' },
        { patientId, type: 'BLOOD_PRESSURE', systolic: 135, diastolic: 85, measuredAt: new Date(Date.now() - DAY), source: 'WHATSAPP' },
      ]);
    });

    it('montre la prochaine consultation, les derniers relevés, le traitement et les livraisons', async () => {
      const res = await http().get(`/api/patients/${patientId}/dashboard`).set(as(a)).expect(200);
      expect(res.body.nextConsultation).toMatchObject({ mode: 'VIDEO', doctorName: 'Dr Jean Mbarga' });
      const glucose = res.body.latestReadings.find((r: { type: string }) => r.type === 'GLUCOSE');
      expect(glucose.value).toBe(1.1);
      const bp = res.body.latestReadings.find((r: { type: string }) => r.type === 'BLOOD_PRESSURE');
      expect(bp).toMatchObject({ systolic: 135, diastolic: 85 });
      expect(res.body.treatment.source).toBe('PRESCRIPTION');
      expect(res.body.treatment.items[0].name).toBe('Metformine 500 mg');
      expect(res.body.deliveries[0].status).toBe('DELIVERED');
    });

    it('donne la courbe sur 90 jours par défaut, plus sur demande', async () => {
      const def = await http().get(`/api/patients/${patientId}/readings`).query({ type: 'GLUCOSE' }).set(as(a)).expect(200);
      expect(def.body.map((r: { value: number }) => r.value)).toEqual([1.3, 1.1]);
      const year = await http().get(`/api/patients/${patientId}/readings`).query({ type: 'GLUCOSE', days: 365 }).set(as(a)).expect(200);
      expect(year.body).toHaveLength(3);
    });

    it('liste les consultations et les ordonnances avec leur prix', async () => {
      const cons = await http().get(`/api/patients/${patientId}/consultations`).set(as(a)).expect(200);
      expect(cons.body).toHaveLength(2);
      const presc = await http().get(`/api/patients/${patientId}/prescriptions`).set(as(a)).expect(200);
      expect(presc.body[0]).toMatchObject({ priceXaf: 4500, deliveryStatus: 'DELIVERED', doctorName: 'Dr Jean Mbarga' });
    });
  });

  describe('partage avec un proche', () => {
    let inviteToken: string;

    it('le titulaire invite son frère par e-mail', async () => {
      mailer.outbox.length = 0;
      await http().post(`/api/patients/${patientId}/invitations`).set(as(a)).send({ email: 'Paul@Exemple.fr' }).expect(201);
      expect(mailer.outbox).toHaveLength(1);
      expect(mailer.outbox[0].to).toBe('paul@exemple.fr');
      inviteToken = tokenFromMail(mailer.outbox[0].text);
    });

    it("le lien seul ne suffit pas : une autre personne ne peut pas l'utiliser", async () => {
      await http().post(`/api/invitations/${inviteToken}/accept`).set(as(c)).expect(400);
      await http().get(`/api/patients/${patientId}`).set(as(c)).expect(404);
    });

    it('le frère accepte et suit le parent en lecture seule', async () => {
      const preview = await http().get(`/api/invitations/${inviteToken}`).set(as(b)).expect(200);
      expect(preview.body).toMatchObject({ patientFirstName: 'Marie', invitedBy: 'Aminata Ngo' });
      await http().post(`/api/invitations/${inviteToken}/accept`).set(as(b)).expect(200);

      const res = await http().get(`/api/patients/${patientId}`).set(as(b)).expect(200);
      expect(res.body.role).toBe('MEMBER');
      await http().get(`/api/patients/${patientId}/dashboard`).set(as(b)).expect(200);
      await http().patch(`/api/patients/${patientId}`).set(as(b)).send({ notes: 'x' }).expect(403);
      await http().patch(`/api/patients/${patientId}/plan`).set(as(b)).send({ plan: 'ESSENTIEL' }).expect(403);
      await http().post(`/api/patients/${patientId}/invitations`).set(as(b)).send({ email: 'x@y.fr' }).expect(403);
    });

    it("une invitation ne sert qu'une fois", async () => {
      await http().post(`/api/invitations/${inviteToken}/accept`).set(as(b)).expect(404);
    });

    it('le proche ne voit pas les e-mails ; le titulaire si', async () => {
      const asMember = await http().get(`/api/patients/${patientId}/members`).set(as(b)).expect(200);
      expect(asMember.body.owner.email).toBeUndefined();
      const asOwner = await http().get(`/api/patients/${patientId}/members`).set(as(a)).expect(200);
      expect(asOwner.body.members[0]).toMatchObject({ name: 'Paul Ngo', email: 'paul@exemple.fr' });
    });

    it("le titulaire retire le proche, qui perd l'accès", async () => {
      await http().delete(`/api/patients/${patientId}/members/${b.id}`).set(as(a)).expect(204);
      await http().get(`/api/patients/${patientId}`).set(as(b)).expect(404);
    });
  });

  describe('compte', () => {
    it('réinitialise le mot de passe par e-mail, une seule fois', async () => {
      mailer.outbox.length = 0;
      await http().post('/api/auth/forgot-password').send({ email: 'aminata@exemple.fr' }).expect(202);
      const token = tokenFromMail(mailer.outbox[0].text);
      await http().post('/api/auth/reset-password').send({ token, password: 'NouveauMdp456' }).expect(204);
      await http().post('/api/auth/login').send({ email: 'aminata@exemple.fr', password: 'NouveauMdp456' }).expect(200);
      await http().post('/api/auth/reset-password').send({ token, password: 'EncoreUnAutre789' }).expect(400);
    });

    it("ne révèle pas si une adresse est inscrite", async () => {
      mailer.outbox.length = 0;
      const res = await http().post('/api/auth/forgot-password').send({ email: 'inconnu@exemple.fr' }).expect(202);
      expect(res.body.message).toMatch(/Si un compte existe/);
      expect(mailer.outbox).toHaveLength(0);
    });

    it('modifie le profil et le mot de passe', async () => {
      const res = await http().patch('/api/auth/me').set(as(c)).send({ phone: '+33 6 11 22 33 44' }).expect(200);
      expect(res.body.phone).toBe('+33 6 11 22 33 44');
      await http().post('/api/auth/change-password').set(as(c)).send({ currentPassword: 'faux', newPassword: 'Nouveau123' }).expect(401);
      await http().post('/api/auth/change-password').set(as(c)).send({ currentPassword: 'MotDePasse123', newPassword: 'Nouveau123' }).expect(204);
    });
  });

  describe('messagerie', () => {
    it("la famille écrit, l'équipe lit et répond", async () => {
      await http().post('/api/messages').set(as(a)).send({ body: 'Bonjour, quand passe l’infirmière ?' }).expect(201);

      const threads = await http().get('/api/admin/messages').set(as(admin)).expect(200);
      expect(threads.body[0]).toMatchObject({ familyUserId: a.id, unread: 1 });

      await http().get(`/api/admin/messages/${a.id}`).set(as(admin)).expect(200);
      const after = await http().get('/api/admin/messages').set(as(admin)).expect(200);
      expect(after.body[0].unread).toBe(0);

      await http().post(`/api/admin/messages/${a.id}`).set(as(admin)).send({ body: 'Jeudi matin.' }).expect(201);
      const unread = await http().get('/api/messages/unread').set(as(a)).expect(200);
      expect(unread.body.unread).toBe(1);

      const thread = await http().get('/api/messages').set(as(a)).expect(200);
      expect(thread.body.map((m: { fromTeam: boolean }) => m.fromTeam)).toEqual([false, true]);
      const unreadAfter = await http().get('/api/messages/unread').set(as(a)).expect(200);
      expect(unreadAfter.body.unread).toBe(0);
    });

    it("une famille ne voit que son propre fil", async () => {
      const res = await http().get('/api/messages').set(as(c)).expect(200);
      expect(res.body).toHaveLength(0);
      await http().get('/api/admin/messages').set(as(a)).expect(403);
    });
  });
});
