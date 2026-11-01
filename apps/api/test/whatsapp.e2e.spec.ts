// WhatsApp : messages reçus (relevés, urgence, questions), rappels, code de livraison, comptes rendus mensuels.
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { Database } from '../src/db/db.module';
import {
  alerts,
  consultations,
  coverageZones,
  monthlyReports,
  partnerProfiles,
  patients,
  prescriptions,
  readings,
  Role,
  users,
  whatsappMessages,
} from '../src/db/schema';
import { MailerService } from '../src/mail/mailer.service';
import { EMERGENCY_REPLY } from '../src/whatsapp/inbound.service';
import { RemindersService } from '../src/whatsapp/reminders.service';
import {
  createTestApp,
  createUser,
  FakeAssistant,
  FakeTranzak,
  FakeWhatsApp,
  TRANZAK_AUTH_KEY,
  WHATSAPP_APP_SECRET,
  WHATSAPP_VERIFY_TOKEN,
} from './helpers';

type U = { id: string; token: string };

const MARIE = '237677123456';
const FAMILY_PHONE = '33612345678';
const UNKNOWN = '237699999999';

describe('WhatsApp', () => {
  let app: INestApplication;
  let db: Database;
  let tranzak: FakeTranzak;
  let wa: FakeWhatsApp;
  let assistant: FakeAssistant;
  let mailer: MailerService;
  let reminders: RemindersService;
  let family: U, doc: U, otherDoc: U, pharmacy: U, admin: U;
  let marieId: string;
  let paulId: string;
  let n = 0;
  let welcomeSent: FakeWhatsApp['sent'] = [];

  const http = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });

  function signed(payload: unknown, secret = WHATSAPP_APP_SECRET) {
    const raw = JSON.stringify(payload);
    const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return http().post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw);
  }
  const incoming = (from: string, text: string, id = `wamid.in.${++n}`, type = 'text') =>
    signed({
      entry: [{ changes: [{ value: { messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type, ...(type === 'text' ? { text: { body: text } } : {}) }] } }] }],
    }).expect(200);
  const lastText = (phone: string) => wa.last(phone)?.text ?? '';
  const mailsTo = (email: string) => mailer.outbox.filter((m) => m.to === email);

  async function partner(role: Role, email: string, first: string, last = 'Test'): Promise<U> {
    const u = await createUser(app, db, role, email, first, last);
    await db.insert(partnerProfiles).values({ userId: u.id, city: 'DOUALA', verifiedAt: new Date() });
    return u;
  }

  // Ferme la fenêtre de 24 h : les messages reçus sont « vieux »
  const closeWindow = () => db.update(whatsappMessages).set({ createdAt: new Date(Date.now() - 2 * 86400_000) }).where(eq(whatsappMessages.direction, 'IN'));

  beforeAll(async () => {
    ({ app, db, tranzak, whatsapp: wa, assistant } = await createTestApp());
    mailer = app.get(MailerService);
    reminders = app.get(RemindersService);
    await db.insert(coverageZones).values({ city: 'DOUALA', district: 'Akwa', districtKey: 'akwa' });
    family = await createUser(app, db, Role.FAMILY, 'famille@exemple.fr', 'Aminata', 'Ngo');
    await db.update(users).set({ phone: '+33 6 12 34 56 78' }).where(eq(users.id, family.id));
    admin = await createUser(app, db, Role.ADMIN, 'admin@exemple.cm', 'Admin', 'Test');
    doc = await partner(Role.DOCTOR, 'dr@exemple.cm', 'Jean', 'Mbarga');
    otherDoc = await partner(Role.DOCTOR, 'dr2@exemple.cm', 'Paul', 'Autre');
    pharmacy = await partner(Role.PHARMACY, 'pharma@exemple.cm', 'Pharmacie');
    await partner(Role.COURIER, 'livreur@exemple.cm', 'Moussa');
    await http()
      .put('/api/care/availability')
      .set(as(doc))
      .send({ slots: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 360, endMinute: 1320 })) })
      .expect(200);

    const res = await http()
      .post('/api/patients')
      .set(as(family))
      .send({ firstName: 'Marie', lastName: 'Ngo', whatsappPhone: '6 77 12 34 56', hasSmartphone: true, city: 'DOUALA', district: 'Akwa', conditions: ['HYPERTENSION'], plan: 'ESSENTIEL' })
      .expect(201);
    marieId = res.body.id;
    // L'autre médecin a lui aussi un patient : il ne doit pas voir les messages de Marie
    await db.update(partnerProfiles).set({ verifiedAt: null }).where(eq(partnerProfiles.userId, otherDoc.id));
    // Le parent accepte en répondant au message de bienvenue (le paiement n'est possible qu'après)
    welcomeSent = [...wa.to(MARIE)];
    await incoming(MARIE, 'Oui');
    await http().post(`/api/patients/${marieId}/checkout`).set(as(family)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(201);
    tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
    await http().post('/api/webhooks/tranzak').send({ resourceId: tranzak.lastRequestId(), authKey: TRANZAK_AUTH_KEY }).expect(200);
  });

  afterAll(() => app.close());

  describe('branchement Meta', () => {
    it("répond au défi de vérification seulement avec le bon jeton", async () => {
      const ok = await http().get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': WHATSAPP_VERIFY_TOKEN, 'hub.challenge': '12345' }).expect(200);
      expect(ok.text).toBe('12345');
      await http().get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'faux', 'hub.challenge': '1' }).expect(403);
    });

    it('refuse une notification mal signée', async () => {
      await signed({ entry: [] }, 'mauvais-secret').expect(401);
      await http().post('/api/webhooks/whatsapp').send({ entry: [] }).expect(401);
    });
  });

  describe('bienvenue et consentement', () => {
    it("envoie le message de bienvenue (modèle) au parent dès l'inscription", () => {
      expect(welcomeSent).toEqual([{ to: MARIE, template: 'ps_bienvenue', params: ['Marie', 'Aminata Ngo'] }]);
    });

    it('le parent a accepté en répondant OUI ; la famille est prévenue par e-mail et WhatsApp', async () => {
      const [p] = await db.select().from(patients).where(eq(patients.id, marieId));
      expect(p.consentGivenAt).not.toBeNull();
      expect(wa.to(MARIE)[1].text).toContain('Merci Marie');
      expect(mailer.outbox.some((m) => m.to === 'famille@exemple.fr' && m.subject === 'Marie a accepté le suivi')).toBe(true);
      expect(wa.to(FAMILY_PHONE)[0]).toMatchObject({ template: 'ps_info_famille', params: ['Marie a accepté le suivi'] });
    });

    it('la famille ne peut plus renvoyer la bienvenue une fois le consentement donné', async () => {
      await http().post(`/api/patients/${marieId}/whatsapp/welcome`).set(as(family)).expect(409);
    });

    it('répond à un numéro inconnu et le signale à l’équipe', async () => {
      await incoming(UNKNOWN, 'Bonjour');
      expect(lastText(UNKNOWN)).toContain('ne correspond à aucun parent suivi');
      const [m] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.phone, UNKNOWN), eq(whatsappMessages.direction, 'IN')));
      expect(m.needsHuman).toBe(true);
    });
  });

  describe('relevés envoyés par message', () => {
    it('enregistre « 13/8 » comme 130/80 mmHg et confirme', async () => {
      await incoming(MARIE, '13/8');
      const rows = await db.select().from(readings).where(eq(readings.patientId, marieId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: 'BLOOD_PRESSURE', systolic: 130, diastolic: 80, source: 'WHATSAPP', recordedById: null });
      expect(lastText(MARIE)).toContain('Bien reçu, tension 130/80 mmHg.');
    });

    it("ne traite pas deux fois le même message renvoyé par Meta", async () => {
      await incoming(MARIE, '12/7', 'wamid.double');
      await incoming(MARIE, '12/7', 'wamid.double');
      const rows = await db.select().from(readings).where(and(eq(readings.patientId, marieId), eq(readings.systolic, 120)));
      expect(rows).toHaveLength(1);
    });

    it('valeur urgente : alerte au médecin, e-mails au médecin et à la famille, consigne du 119', async () => {
      mailer.outbox.length = 0;
      await incoming(MARIE, 'tension 19/11');
      const [a] = await db.select().from(alerts).where(eq(alerts.patientId, marieId));
      expect(a).toMatchObject({ severity: 'URGENT', doctorId: doc.id, message: 'Tension très élevée : 190/110 mmHg' });
      expect(lastText(MARIE)).toContain('appelez le 119');
      expect(mailsTo('dr@exemple.cm')[0].subject).toContain('URGENT');
      expect(mailsTo('famille@exemple.fr')[0].subject).toBe('Relevé à surveiller pour Marie');
    });

    it("refuse une valeur impossible et demande de la renvoyer", async () => {
      const before = (await db.select().from(readings)).length;
      await incoming(MARIE, 'tension 8/12');
      expect((await db.select().from(readings)).length).toBe(before);
      expect(lastText(MARIE)).toContain('la valeur semble incorrecte');
    });

    it('transmet aussi au médecin un symptôme glissé avec la mesure', async () => {
      mailer.outbox.length = 0;
      await incoming(MARIE, '13/8 mais j’ai des vertiges');
      expect(lastText(MARIE)).toContain('transmis votre message à votre médecin');
      expect(mailsTo('dr@exemple.cm')[0].subject).toBe('Question de Marie Ngo sur WhatsApp');
    });
  });

  describe('urgence et questions', () => {
    it("message d'urgence : consigne immédiate, alerte urgente, famille et médecin prévenus", async () => {
      mailer.outbox.length = 0;
      await incoming(MARIE, "J'ai fait un malaise, je me sens très mal");
      expect(lastText(MARIE)).toBe(EMERGENCY_REPLY);
      const urgent = await db.select().from(alerts).where(and(eq(alerts.patientId, marieId), eq(alerts.severity, 'URGENT')));
      expect(urgent.some((a) => a.message.startsWith("Message d'urgence sur WhatsApp"))).toBe(true);
      expect(mailsTo('famille@exemple.fr')[0].subject).toBe('URGENT : message inquiétant de Marie');
      expect(mailsTo('dr@exemple.cm').length).toBe(1);
      expect(mailsTo('admin@exemple.cm').length).toBe(1);
    });

    it('question médicale : jamais de réponse automatique, transmise au médecin', async () => {
      mailer.outbox.length = 0;
      await incoming(MARIE, "J'ai oublié mon comprimé hier, je double la dose ?");
      expect(lastText(MARIE)).toContain('transmise à votre médecin, le Dr Mbarga,');
      expect(mailsTo('dr@exemple.cm')[0].text).toContain('je double la dose');
      expect(assistant.questions).toHaveLength(0);
    });

    it('question pratique : réponse directe (prochain rendez-vous)', async () => {
      await incoming(MARIE, 'Mon prochain rendez-vous ?');
      expect(lastText(MARIE)).toMatch(/Votre prochain rendez-vous : consultation avec le Dr Mbarga/);
    });

    it("autre question : l'équipe reprend la main tant que l'assistant n'est pas activé", async () => {
      mailer.outbox.length = 0;
      await incoming(MARIE, 'Est-ce que vous travaillez le dimanche ?');
      expect(lastText(MARIE)).toContain('Un membre de l’équipe Proche Santé vous répond');
      expect(mailsTo('admin@exemple.cm')[0].subject).toBe('WhatsApp : question de Marie Ngo');
    });

    it("l'assistant répond aux questions pratiques, et transfère celles qu'il juge médicales", async () => {
      assistant.enabled = true;
      assistant.next = { medical: false, answer: 'Oui, l’équipe répond aussi le dimanche.' };
      await incoming(MARIE, 'Vous êtes ouverts le dimanche ?');
      expect(lastText(MARIE)).toBe('Oui, l’équipe répond aussi le dimanche.');
      assistant.next = { medical: true, answer: null };
      await incoming(MARIE, 'Le gingembre est bon pour moi ?');
      expect(lastText(MARIE)).toContain('transmise à votre médecin');
      assistant.enabled = false;
    });

    it('message vocal : transmis à un humain', async () => {
      await incoming(MARIE, '', `wamid.audio.${++n}`, 'audio');
      expect(lastText(MARIE)).toContain('Je ne sais lire que les messages écrits');
    });
  });

  describe('fil de discussion', () => {
    it('le médecin voit les messages de son patient et répond ; un autre médecin ne voit rien', async () => {
      const t = await http().get(`/api/doctor/patients/${marieId}/whatsapp`).set(as(doc)).expect(200);
      expect(t.body.windowOpen).toBe(true);
      expect(t.body.messages.some((m: { needsHuman: boolean; handledAt: string | null }) => m.needsHuman && !m.handledAt)).toBe(true);
      await http().post(`/api/doctor/patients/${marieId}/whatsapp/reply`).set(as(doc)).send({ text: 'Ne doublez pas, reprenez demain matin.' }).expect(201);
      expect(lastText(MARIE)).toBe('Dr Mbarga : Ne doublez pas, reprenez demain matin.');
      const pending = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.phone, MARIE), eq(whatsappMessages.needsHuman, true)));
      expect(pending.every((m) => m.handledAt)).toBe(true);
      await http().get(`/api/doctor/patients/${marieId}/whatsapp`).set(as(otherDoc)).expect(404);
    });

    it("l'équipe voit la liste des conversations et le numéro inconnu en attente", async () => {
      const list = await http().get('/api/admin/whatsapp/threads').set(as(admin)).expect(200);
      const unknown = list.body.find((t: { phone: string }) => t.phone === UNKNOWN);
      expect(unknown.pending).toBe(1);
      expect(list.body.find((t: { phone: string }) => t.phone === MARIE).names).toBe('Marie Ngo');
      await http().get('/api/admin/whatsapp/threads').set(as(family)).expect(403);
      const full = await http().get(`/api/admin/whatsapp/threads/${MARIE}`).set(as(admin)).expect(200);
      expect(full.body.patients).toMatchObject([{ firstName: 'Marie' }]);
      expect(full.body.messages.length).toBeGreaterThan(10);
      const stranger = await http().get(`/api/admin/whatsapp/threads/${UNKNOWN}`).set(as(admin)).expect(200);
      expect(stranger.body.patients).toEqual([]);
    });

    it('refuse une réponse libre quand la fenêtre de 24 h est fermée', async () => {
      await closeWindow();
      const res = await http().post(`/api/admin/whatsapp/threads/${MARIE}/reply`).set(as(admin)).send({ text: 'Bonjour' }).expect(409);
      expect(res.body.message).toContain('24 h');
    });

    it('le simulateur est fermé hors mode simulation', async () => {
      await http().post('/api/admin/whatsapp/simulate').set(as(admin)).send({ phone: MARIE, text: '13/8' }).expect(403);
    });

    it("met à jour l'état d'un message envoyé (remis, lu)", async () => {
      const [out] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.phone, MARIE), eq(whatsappMessages.direction, 'OUT')));
      await signed({ entry: [{ changes: [{ value: { statuses: [{ id: out.waId, status: 'read' }] } }] }] }).expect(200);
      const [after] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, out.id));
      expect(after.status).toBe('READ');
    });
  });

  describe('numéro partagé', () => {
    beforeAll(async () => {
      const res = await http()
        .post('/api/patients')
        .set(as(family))
        .send({ firstName: 'Paul', lastName: 'Ngo', whatsappPhone: '677123456', hasSmartphone: true, city: 'DOUALA', district: 'Akwa', conditions: ['DIABETES'], plan: 'ESSENTIEL' })
        .expect(201);
      paulId = res.body.id;
      await db.update(patients).set({ consentGivenAt: new Date() }).where(eq(patients.id, paulId));
    });

    it('demande le prénom quand deux parents partagent le numéro', async () => {
      await incoming(MARIE, '13/8');
      expect(lastText(MARIE)).toContain('Ce numéro est utilisé pour Marie et Paul');
      expect(await db.select().from(readings).where(eq(readings.patientId, paulId))).toHaveLength(0);
    });

    it('« Paul glycémie 1,3 » va bien dans le dossier de Paul', async () => {
      await incoming(MARIE, 'Paul glycémie 1,3');
      const rows = await db.select().from(readings).where(eq(readings.patientId, paulId));
      expect(rows).toMatchObject([{ type: 'GLUCOSE', value: '1.30' }]);
    });
  });

  describe('rappels', () => {
    let consultationId: string;

    beforeAll(async () => {
      // Le médecin prescrit avec des heures de prise
      const [c] = await db.select().from(consultations).where(eq(consultations.patientId, marieId));
      consultationId = c.id;
      await db.update(consultations).set({ scheduledAt: new Date(Date.now() - 5 * 60_000) }).where(eq(consultations.id, c.id));
      await http()
        .post(`/api/doctor/consultations/${c.id}/complete`)
        .set(as(doc))
        .send({
          summary: 'Tension à surveiller.',
          prescription: [
            { name: 'Amlodipine 5 mg', dosage: '1 le matin', times: ['08:00'] },
            { name: 'Hydrochlorothiazide 25 mg', dosage: '1 matin et soir' },
          ],
        })
        .expect(201);
    });

    it('regroupe les médicaments du matin en un seul rappel, une seule fois', async () => {
      await closeWindow();
      const at = new Date('2030-03-10T07:05:00Z'); // 8 h 05 à Douala
      await db.update(prescriptions).set({ createdAt: new Date('2030-03-01T10:00:00Z') });
      expect(await reminders.medication(at)).toBe(1);
      expect(wa.last(MARIE)).toEqual({
        to: MARIE,
        template: 'ps_rappel_medicaments',
        params: ['Marie', 'matin', 'Amlodipine 5 mg, Hydrochlorothiazide 25 mg'],
      });
      expect(await reminders.medication(new Date('2030-03-10T07:20:00Z'))).toBe(0); // déjà envoyé
      expect(await reminders.medication(new Date('2030-03-10T09:00:00Z'))).toBe(0); // hors créneau
      expect(await reminders.medication(new Date('2030-03-10T19:10:00Z'))).toBe(1); // 20 h 10 : le soir
      expect(wa.last(MARIE)?.params?.[2]).toBe('Hydrochlorothiazide 25 mg');
    });

    it('« Marie OK » confirme la prise', async () => {
      await db
        .update(whatsappMessages)
        .set({ createdAt: new Date() })
        .where(and(eq(whatsappMessages.patientId, marieId), eq(whatsappMessages.kind, 'med_reminder')));
      await incoming(MARIE, 'Marie ok');
      const rem = await db.select().from(whatsappMessages).where(eq(whatsappMessages.kind, 'med_reminder'));
      expect(rem.filter((r) => r.acknowledgedAt)).toHaveLength(1);
    });

    it('plus aucun rappel après STOP, jusqu’à REPRENDRE', async () => {
      mailer.outbox.length = 0;
      await incoming(MARIE, 'Marie stop');
      expect(lastText(MARIE)).toContain('Pour reprendre, répondez REPRENDRE');
      expect(mailsTo('famille@exemple.fr')[0].subject).toBe('Marie a arrêté les messages WhatsApp');
      expect(await reminders.medication(new Date('2030-03-11T07:05:00Z'))).toBe(0);
      await incoming(MARIE, 'Marie reprendre');
      expect(await reminders.medication(new Date('2030-03-11T07:06:00Z'))).toBe(1);
    });

    it('rappelle la consultation la veille au soir puis le jour même avec le lien vidéo', async () => {
      const at = new Date('2030-03-12T09:00:00Z'); // 10 h à Douala
      await db
        .update(consultations)
        .set({ status: 'SCHEDULED', scheduledAt: at, mode: 'VIDEO', videoUrl: 'https://meet.jit.si/ps-test' })
        .where(eq(consultations.id, consultationId));
      expect(await reminders.appointments(new Date('2030-03-11T16:30:00Z'))).toBe(0); // 17 h 30 la veille : trop tôt
      expect(await reminders.appointments(new Date('2030-03-11T17:30:00Z'))).toBe(1); // 18 h 30 la veille
      expect(await reminders.appointments(new Date('2030-03-11T18:30:00Z'))).toBe(0);
      expect(await reminders.appointments(new Date('2030-03-12T07:30:00Z'))).toBe(1); // 8 h 30, 1 h 30 avant
      const last = wa.last(MARIE)!;
      expect(last.text ?? last.params!.join(' ')).toContain('https://meet.jit.si/ps-test');
    });
  });

  describe('code de livraison', () => {
    it('le parent reçoit le code quand la commande part, même après STOP', async () => {
      const [pr] = await db.select().from(prescriptions);
      await http().post(`/api/pharmacy/prescriptions/${pr.id}/price`).set(as(pharmacy)).send({ priceXaf: 3000 }).expect(201);
      await http().post(`/api/prescriptions/${pr.id}/pay`).set(as(family)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(200);
      tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
      await http().post('/api/webhooks/tranzak').send({ resourceId: tranzak.lastRequestId(), authKey: TRANZAK_AUTH_KEY }).expect(200);
      await db.update(patients).set({ whatsappOptOutAt: new Date() }).where(eq(patients.id, marieId));
      await closeWindow();
      await http().post(`/api/pharmacy/prescriptions/${pr.id}/ready`).set(as(pharmacy)).expect(201);
      const msg = wa.last(MARIE)!;
      expect(msg.template).toBe('ps_code_livraison');
      expect(msg.params![1]).toMatch(/^\d{4}$/);
      await db.update(patients).set({ whatsappOptOutAt: null }).where(eq(patients.id, marieId));
    });
  });

  describe('comptes rendus mensuels', () => {
    const month = new Date(Date.now() + 3600_000).toISOString().slice(0, 7);
    let reportId: string;

    it('génère un brouillon, invisible pour la famille', async () => {
      // Un rappel déjà lu (accusé de lecture de Meta) compte comme envoyé
      await db.update(whatsappMessages).set({ status: 'READ' }).where(eq(whatsappMessages.kind, 'med_reminder'));
      const gen = await http().post('/api/admin/reports/generate').set(as(admin)).send({ month }).expect(201);
      expect(gen.body.created).toBe(1);
      const again = await http().post('/api/admin/reports/generate').set(as(admin)).send({ month }).expect(201);
      expect(again.body.created).toBe(0);
      const drafts = await http().get('/api/admin/reports').set(as(admin)).expect(200);
      expect(drafts.body).toHaveLength(1);
      reportId = drafts.body[0].id;
      expect(drafts.body[0].content).toContain('Compte rendu de');
      expect(drafts.body[0].content).toMatch(/Tension : \d+ mesures/);
      expect(drafts.body[0].content).toMatch(/Prises de médicaments confirmées : 1 sur \d+ rappels/);
      const fam = await http().get(`/api/patients/${marieId}/reports`).set(as(family)).expect(200);
      expect(fam.body).toHaveLength(0);
    });

    it("l'équipe corrige puis envoie : la famille le reçoit et le voit", async () => {
      await http().patch(`/api/admin/reports/${reportId}`).set(as(admin)).send({ content: 'Compte rendu relu par l’équipe.' }).expect(200);
      mailer.outbox.length = 0;
      await http().post(`/api/admin/reports/${reportId}/send`).set(as(admin)).expect(201);
      expect(mailsTo('famille@exemple.fr')[0].text).toContain('Compte rendu relu par l’équipe.');
      expect(wa.last(FAMILY_PHONE)?.params?.[0]).toMatch(/^Compte rendu de .+ pour Marie$/);
      const fam = await http().get(`/api/patients/${marieId}/reports`).set(as(family)).expect(200);
      expect(fam.body[0].content).toBe('Compte rendu relu par l’équipe.');
      await http().post(`/api/admin/reports/${reportId}/send`).set(as(admin)).expect(409);
      await http().patch(`/api/admin/reports/${reportId}`).set(as(admin)).send({ content: 'x' }).expect(409);
      const [r] = await db.select().from(monthlyReports).where(eq(monthlyReports.id, reportId));
      expect(r.reviewedById).toBe(admin.id);
    });
  });

  describe('préférences de la famille', () => {
    it('plus de WhatsApp à la famille si elle le désactive (les e-mails continuent)', async () => {
      await http().patch('/api/auth/me').set(as(family)).send({ whatsappNotifications: false }).expect(200);
      const before = wa.to(FAMILY_PHONE).length;
      mailer.outbox.length = 0;
      await incoming(MARIE, 'Marie tension 18/11');
      expect(mailsTo('famille@exemple.fr').length).toBe(1);
      expect(wa.to(FAMILY_PHONE).length).toBe(before);
    });

    it("un échec d'envoi est journalisé sans bloquer l'action", async () => {
      wa.failNext = true;
      await incoming(MARIE, 'Marie 12/8');
      const [failed] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.status, 'FAILED'));
      expect(failed.error).toBe('Meta 500');
      expect((await db.select().from(readings).where(and(eq(readings.patientId, marieId), eq(readings.systolic, 120), eq(readings.diastolic, 80)))).length).toBe(1);
    });
  });
});
