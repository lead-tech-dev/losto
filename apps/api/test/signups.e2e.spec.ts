// Relance des inscriptions non payées : accord du parent, puis premier paiement ; l'équipe prend le relais à la fin.
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { SignupFollowupService } from '../src/billing/signup-followup.service';
import { Database } from '../src/db/db.module';
import { coverageZones, patients, payments, Role, subscriptions } from '../src/db/schema';
import { MailerService } from '../src/mail/mailer.service';
import { createTestApp, createUser, FakeWhatsApp } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

const PARENT = {
  lastName: 'Ngo',
  whatsappPhone: '677123456',
  hasSmartphone: true,
  city: 'DOUALA',
  district: 'Bonapriso',
  conditions: ['HYPERTENSION'],
  plan: 'ESSENTIEL',
};

describe('Relance des inscriptions non payées', () => {
  let app: INestApplication;
  let db: Database;
  let wa: FakeWhatsApp;
  let mailer: MailerService;
  let followup: SignupFollowupService;
  let family: { id: string; token: string };
  let admin: { id: string; token: string };

  const http = () => request(app.getHttpServer());
  const as = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const mails = (to: string) => mailer.outbox.filter((m) => m.to === to);
  const FAMILY = 'aminata@exemple.fr';
  const ADMIN = 'equipe@proche-sante.cm';

  async function newParent(firstName: string, extra: Record<string, unknown> = {}) {
    const res = await http().post('/api/patients').set(as(family)).send({ ...PARENT, ...extra, firstName }).expect(201);
    const [p] = await db.select().from(patients).where(eq(patients.id, res.body.id));
    return p;
  }
  const consent = (id: string, at: Date) => db.update(patients).set({ consentGivenAt: at }).where(eq(patients.id, id));
  const subOf = async (patientId: string) => (await db.select().from(subscriptions).where(eq(subscriptions.patientId, patientId)))[0];
  const at = (from: Date, days: number) => new Date(from.getTime() + days * DAY);

  beforeAll(async () => {
    ({ app, db, whatsapp: wa } = await createTestApp());
    mailer = app.get(MailerService);
    followup = app.get(SignupFollowupService);
    family = await createUser(app, db, Role.FAMILY, FAMILY, 'Aminata', 'Ngo');
    admin = await createUser(app, db, Role.ADMIN, ADMIN, 'Équipe', 'Proche Santé');
    await db.insert(coverageZones).values({ city: 'DOUALA', district: 'Bonapriso', districtKey: 'bonapriso' });
  });

  beforeEach(async () => {
    await db.delete(patients).where(eq(patients.familyUserId, family.id));
    mailer.outbox.length = 0;
    wa.sent.length = 0;
  });

  afterAll(() => app.close());

  it("relance l'accord du parent à J+1, J+3 et J+7, puis prévient l'équipe et s'arrête", async () => {
    const p = await newParent('Marie');
    expect(await followup.runDaily(at(p.createdAt, 0.5))).toEqual({ consent: 0, payment: 0, team: 0 });

    expect((await followup.runDaily(at(p.createdAt, 1.1))).consent).toBe(1);
    const first = mails(FAMILY).at(-1)!;
    expect(first.subject).toBe('Marie n’a pas encore confirmé son accord');
    expect(first.text).toContain(`/consentement/${p.consentToken}`);
    expect(first.text).toContain('répondre OUI');
    // Même jour : rien de plus
    expect((await followup.runDaily(at(p.createdAt, 1.5))).consent).toBe(0);

    const welcomesBefore = wa.sent.filter((m) => m.template === 'ps_bienvenue').length;
    expect((await followup.runDaily(at(p.createdAt, 3.1))).consent).toBe(1);
    expect(mails(FAMILY).at(-1)!.subject).toBe('Le suivi de Marie attend son accord');
    // Deuxième relance : le message de bienvenue est renvoyé au parent, une fois
    expect(wa.sent.filter((m) => m.template === 'ps_bienvenue').length).toBe(welcomesBefore + 1);

    const s = await followup.runDaily(at(p.createdAt, 7.2));
    expect(s).toEqual({ consent: 1, payment: 0, team: 1 });
    expect(mails(FAMILY).at(-1)!.subject).toBe('Dernier rappel : l’accord de Marie');
    expect(mails(FAMILY).at(-1)!.text).toMatch(/supprimer son dossier/);
    const alert = mails(ADMIN).at(-1)!;
    expect(alert.subject).toBe('Inscription à appeler : Marie Ngo');
    expect(alert.text).toContain(FAMILY);

    // Plus aucun message automatique ensuite
    expect(await followup.runDaily(at(p.createdAt, 15))).toEqual({ consent: 0, payment: 0, team: 0 });
    expect(await followup.runDaily(at(p.createdAt, 40))).toEqual({ consent: 0, payment: 0, team: 0 });
  });

  it('si la tâche a manqué des jours, une seule relance part : la plus récente', async () => {
    const p = await newParent('Joseph');
    expect(await followup.runDaily(at(p.createdAt, 8))).toEqual({ consent: 1, payment: 0, team: 1 });
    expect(mails(FAMILY)).toHaveLength(1);
    expect(mails(FAMILY)[0].subject).toMatch(/Dernier rappel/);
    expect((await followup.runDaily(at(p.createdAt, 9))).consent).toBe(0);
  });

  it("parent sans WhatsApp : la famille reçoit le lien à ouvrir avec lui", async () => {
    const p = await newParent('Paul', { hasSmartphone: false });
    await followup.runDaily(at(p.createdAt, 1.1));
    expect(mails(FAMILY)[0].text).toMatch(/n’a pas WhatsApp : ouvrez ce lien avec lui/);
  });

  it("après l'accord, les relances repartent de zéro pour le paiement, avec le montant et le lien", async () => {
    const p = await newParent('Marie');
    await followup.runDaily(at(p.createdAt, 1.1)); // relance d'accord n°1
    const agreed = at(p.createdAt, 2);
    await consent(p.id, agreed);

    expect((await followup.runDaily(at(agreed, 0.5))).payment).toBe(0);
    expect((await followup.runDaily(at(agreed, 1.1))).payment).toBe(1);
    const m = mails(FAMILY).at(-1)!;
    expect(m.subject).toBe('Marie a donné son accord : il ne reste que le paiement');
    expect(m.text).toMatch(/55 € ou 36.100 FCFA/);
    expect(m.text).toContain(`/parents/${p.id}/paiement`);
    expect(m.text).not.toMatch(/n’a pas abouti/);

    expect((await followup.runDaily(at(agreed, 3.1))).payment).toBe(1);
    expect(await followup.runDaily(at(agreed, 7.1))).toEqual({ consent: 0, payment: 1, team: 1 });
    expect(mails(ADMIN).at(-1)!.text).toMatch(/pas de paiement depuis l’accord/);
  });

  it("signale l'échec de la dernière tentative de paiement", async () => {
    const p = await newParent('Marie');
    const agreed = at(p.createdAt, 0);
    await consent(p.id, agreed);
    const s = await subOf(p.id);
    await db.insert(payments).values({
      payerId: family.id, patientId: p.id, subscriptionId: s.id, kind: 'SUBSCRIPTION', provider: 'TRANZAK', method: 'MOBILE_MONEY',
      status: 'FAILED', amount: 36100, currency: 'XAF', lines: [], failureReason: 'Solde insuffisant',
    });
    await followup.runDaily(at(agreed, 1.1));
    expect(mails(FAMILY).at(-1)!.text).toMatch(/dernière tentative n’a pas abouti \(solde insuffisant\)/);
  });

  it('ne relance pas pendant qu’un paiement est en cours de validation', async () => {
    const p = await newParent('Marie');
    const agreed = new Date(Date.now() - 1.5 * DAY);
    await consent(p.id, agreed);
    const s = await subOf(p.id);
    await db.insert(payments).values({
      payerId: family.id, patientId: p.id, subscriptionId: s.id, kind: 'SUBSCRIPTION', provider: 'TRANZAK', method: 'MOBILE_MONEY',
      status: 'PENDING', amount: 36100, currency: 'XAF', lines: [],
    });
    expect((await followup.runDaily(new Date())).payment).toBe(0);
  });

  it('ne relance pas : quartier non desservi, parent qui a répondu STOP, inscription payée ou effacée', async () => {
    const zone = await newParent('Hors', { district: 'Kribi centre' });
    await consent(zone.id, zone.createdAt);
    const stop = await newParent('Stop');
    await db.update(patients).set({ whatsappOptOutAt: new Date() }).where(eq(patients.id, stop.id));
    const paid = await newParent('Payé');
    await consent(paid.id, paid.createdAt);
    await db.update(subscriptions).set({ status: 'ACTIVE', signupFeePaidAt: new Date() }).where(eq(subscriptions.patientId, paid.id));
    const erased = await newParent('Effacé');
    await db.update(patients).set({ erasedAt: new Date() }).where(eq(patients.id, erased.id));

    expect(await followup.runDaily(at(new Date(), 2))).toEqual({ consent: 0, payment: 0, team: 0 });
    expect(mailer.outbox).toHaveLength(0);
  });

  it("le back-office liste les inscriptions en attente, avec l'étape et les relances ; réservé à l'équipe", async () => {
    const marie = await newParent('Marie');
    const joseph = await newParent('Joseph', { district: 'Kribi centre' });
    await consent(joseph.id, joseph.createdAt);
    await followup.runDaily(at(marie.createdAt, 3.1));

    await http().get('/api/admin/signups').set(as(family)).expect(403);
    const res = await http().get('/api/admin/signups').set(as(admin)).expect(200);
    const byName = Object.fromEntries(res.body.pending.map((r: { patient: string }) => [r.patient, r]));
    expect(byName['Marie Ngo']).toMatchObject({ stage: 'CONSENT', reminders: 2, family: 'Aminata Ngo', email: FAMILY, stopped: false });
    expect(byName['Joseph Ngo']).toMatchObject({ stage: 'ZONE', reminders: 0 });
    expect(res.body.conversion).toMatchObject({ signups: 2, paid: 0, rate: 0 });
  });
});
