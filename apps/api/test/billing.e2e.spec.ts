// Paiements : Mobile Money (Tranzak), carte (Stripe), relances, résiliation, médicaments, factures.
// Stripe et Tranzak sont simulés ; la vérification de signature Stripe est la vraie.
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import request from 'supertest';
import { BillingCronService } from '../src/billing/billing-cron.service';
import { addOneMonth } from '../src/billing/billing.util';
import { Database } from '../src/db/db.module';
import { auditLogs, consultations, coverageZones, patients, payments, prescriptions, Role, subscriptions } from '../src/db/schema';
import { MailerService } from '../src/mail/mailer.service';
import { createTestApp, createUser, FakeStripe, FakeTranzak, STRIPE_WEBHOOK_SECRET, TRANZAK_AUTH_KEY } from './helpers';

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

describe('Paiements', () => {
  let app: INestApplication;
  let db: Database;
  let stripe: FakeStripe;
  let tranzak: FakeTranzak;
  let mailer: MailerService;
  let cron: BillingCronService;
  let a: { id: string; token: string };
  let other: { id: string; token: string };
  let doctorId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
  const sub = async (patientId: string) =>
    (await db.select().from(subscriptions).where(eq(subscriptions.patientId, patientId)))[0];

  async function newParent(firstName: string, consent = true): Promise<string> {
    const res = await http().post('/api/patients').set(as(a)).send({ ...PARENT, firstName }).expect(201);
    if (consent) await db.update(patients).set({ consentGivenAt: new Date() }).where(eq(patients.id, res.body.id));
    return res.body.id;
  }

  function tranzakNotify(requestId: string, body: Record<string, unknown> = {}) {
    return http()
      .post('/api/webhooks/tranzak')
      .send({ eventType: 'REQUEST.COMPLETED', resourceId: requestId, authKey: TRANZAK_AUTH_KEY, ...body });
  }

  function stripeNotify(type: string, object: Record<string, unknown>, secret = STRIPE_WEBHOOK_SECRET) {
    const payload = JSON.stringify({ id: `evt_${Math.random()}`, object: 'event', type, data: { object } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return http()
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
  }

  beforeAll(async () => {
    ({ app, db, stripe, tranzak } = await createTestApp());
    mailer = app.get(MailerService);
    cron = app.get(BillingCronService);
    a = await createUser(app, db, Role.FAMILY, 'aminata@exemple.fr', 'Aminata', 'Ngo');
    other = await createUser(app, db, Role.FAMILY, 'autre@exemple.fr', 'Autre', 'Famille');
    doctorId = (await createUser(app, db, Role.DOCTOR, 'dr@exemple.cm', 'Jean', 'Mbarga')).id;
    await db.insert(coverageZones).values({ city: 'DOUALA', district: 'Bonapriso', districtKey: 'bonapriso' });
  });

  afterAll(() => app.close());

  describe('Mobile Money', () => {
    let marie: string;
    let paymentId: string;

    beforeAll(async () => {
      marie = await newParent('Marie');
    });

    it('annonce le montant du premier paiement : formule + inscription, en euros et en FCFA', async () => {
      const res = await http().get(`/api/patients/${marie}/subscription`).set(as(a)).expect(200);
      expect(res.body.status).toBe('PENDING');
      // 25 € → 16 400 FCFA et 30 € → 19 700 FCFA (taux fixe 655,957, arrondi à la centaine supérieure)
      expect(res.body.nextPayment).toEqual({ plan: 'ESSENTIEL', eur: 55, xaf: 36100, includesSignupFee: true });
      expect(res.body.canPay).toEqual({ card: true, mobileMoney: true, reason: null });
    });

    it("refuse de faire payer tant que le parent n'a pas donné son accord", async () => {
      const joseph = await newParent('Joseph', false);
      const res = await http()
        .post(`/api/patients/${joseph}/checkout`)
        .set(as(a))
        .send({ method: 'MOBILE_MONEY', phone: '677000000' })
        .expect(409);
      expect(res.body.message).toMatch(/accord/);
    });

    it('envoie la demande de paiement sur le téléphone', async () => {
      const res = await http()
        .post(`/api/patients/${marie}/checkout`)
        .set(as(a))
        .send({ method: 'MOBILE_MONEY', phone: '+237 6 77 12 34 56' })
        .expect(201);
      expect(res.body.kind).toBe('mobile');
      expect(res.body.payment).toMatchObject({ status: 'PENDING', amount: 36100, currency: 'XAF' });
      paymentId = res.body.payment.id;
      expect(tranzak.charges[0]).toMatchObject({
        amountXaf: 36100,
        mobileWalletNumber: '237677123456',
        mchTransactionRef: paymentId.replace(/-/g, ''),
      });
    });

    it("un double clic ne déclenche pas une deuxième demande sur le téléphone", async () => {
      const res = await http()
        .post(`/api/patients/${marie}/checkout`)
        .set(as(a))
        .send({ method: 'MOBILE_MONEY', phone: '677123456' })
        .expect(201);
      expect(res.body.payment.id).toBe(paymentId);
      expect(tranzak.charges).toHaveLength(1);
    });

    it('rejette une notification Tranzak sans la bonne clé', async () => {
      await tranzakNotify('REQ1', { authKey: 'mauvaise' }).expect(401);
    });

    it("ne croit pas une notification qui annonce un succès que Tranzak ne confirme pas", async () => {
      await tranzakNotify('REQ1', { resource: { status: 'SUCCESSFUL' } }).expect(200);
      const res = await http().get(`/api/payments/${paymentId}`).set(as(a)).expect(200);
      expect(res.body.status).toBe('PENDING');
    });

    it('active le suivi quand Tranzak confirme le paiement', async () => {
      mailer.outbox.length = 0;
      tranzak.complete('REQ1', 'SUCCESSFUL');
      await tranzakNotify('REQ1').expect(200);

      const res = await http().get(`/api/payments/${paymentId}`).set(as(a)).expect(200);
      expect(res.body.status).toBe('SUCCEEDED');
      expect(res.body.invoiceNumber).toBe(`PS-${new Date().getUTCFullYear()}-000001`);

      const s = await sub(marie);
      expect(s.status).toBe('ACTIVE');
      expect(s.paymentMethod).toBe('MOBILE_MONEY');
      expect(s.signupFeePaidAt).not.toBeNull();
      expect(Math.abs(s.currentPeriodEnd!.getTime() - addOneMonth(new Date()).getTime())).toBeLessThan(60_000);
      expect(mailer.outbox[0].subject).toMatch(/Paiement reçu : 36 100 FCFA/);
    });

    it('une notification reçue deux fois ne facture pas deux fois', async () => {
      await tranzakNotify('REQ1').expect(200);
      const rows = await db.select().from(payments).where(eq(payments.status, 'SUCCEEDED'));
      expect(rows).toHaveLength(1);
    });

    it('fournit la facture PDF au payeur, et à personne d’autre', async () => {
      const res = await http()
        .get(`/api/payments/${paymentId}/invoice`)
        .set(as(a))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await http().get(`/api/payments/${paymentId}/invoice`).set(as(other)).expect(404);
    });

    it("ne propose pas de renouveler un mois qui vient d'être payé", async () => {
      const res = await http().get(`/api/patients/${marie}/subscription`).set(as(a)).expect(200);
      expect(res.body.canPay.mobileMoney).toBe(false);
      expect(res.body.canPay.reason).toMatch(/payé jusqu/);
    });

    it('un changement de formule en cours de mois prend effet au prochain paiement', async () => {
      const res = await http().patch(`/api/patients/${marie}/plan`).set(as(a)).send({ plan: 'SERENITE' }).expect(200);
      expect(res.body).toMatchObject({ plan: 'ESSENTIEL', pendingPlan: 'SERENITE' });
      // Plus de frais d'inscription ; 45 € → 29 600 FCFA
      expect(res.body.nextPayment).toEqual({ plan: 'SERENITE', eur: 45, xaf: 29600, includesSignupFee: false });
    });

    it('rappelle le renouvellement 5 jours avant, une seule fois', async () => {
      const end = new Date(Date.now() + 3 * DAY);
      await db.update(subscriptions).set({ currentPeriodEnd: end }).where(eq(subscriptions.patientId, marie));
      mailer.outbox.length = 0;
      expect((await cron.runDaily(new Date())).reminders).toBe(1);
      expect(mailer.outbox[0].subject).toMatch(/arrive à échéance/);
      expect((await cron.runDaily(new Date())).reminders).toBe(0);
    });

    it('le renouvellement prolonge à partir de l’échéance, sans perdre de jours, avec la nouvelle formule', async () => {
      const before = (await sub(marie)).currentPeriodEnd!;
      const res = await http()
        .post(`/api/patients/${marie}/checkout`)
        .set(as(a))
        .send({ method: 'MOBILE_MONEY', phone: '677123456' })
        .expect(201);
      expect(res.body.payment.amount).toBe(29600);
      tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
      // Sans notification : la page qui attend la validation interroge le statut, qui est vérifié auprès de Tranzak
      const polled = await http().get(`/api/payments/${res.body.payment.id}`).set(as(a)).expect(200);
      expect(polled.body.status).toBe('SUCCEEDED');

      const s = await sub(marie);
      expect(s.currentPeriodEnd!.getTime()).toBe(addOneMonth(before).getTime());
      expect(s.plan).toBe('SERENITE');
      expect(s.pendingPlan).toBeNull();
    });

    it('relance après l’échéance, puis suspend au bout de 7 jours', async () => {
      const end = new Date(Date.now() - DAY);
      await db.update(subscriptions).set({ currentPeriodEnd: end, lastReminderAt: null }).where(eq(subscriptions.patientId, marie));
      mailer.outbox.length = 0;

      expect((await cron.runDaily(new Date())).pastDue).toBe(1);
      expect((await sub(marie)).status).toBe('PAST_DUE');
      expect(mailer.outbox[0].subject).toMatch(/Renouvellement en attente/);

      expect((await cron.runDaily(new Date(end.getTime() + 3.5 * DAY))).reminders).toBe(1);
      expect(mailer.outbox[1].subject).toMatch(/Dernier rappel/);

      expect((await cron.runDaily(new Date(end.getTime() + 8 * DAY))).suspended).toBe(1);
      expect((await sub(marie)).status).toBe('SUSPENDED');
      expect(mailer.outbox[2].subject).toMatch(/suspendu/);
    });

    it('un paiement refusé sur le téléphone est marqué échoué, le suivi reste suspendu', async () => {
      const res = await http()
        .post(`/api/patients/${marie}/checkout`)
        .set(as(a))
        .send({ method: 'MOBILE_MONEY', phone: '677123456' })
        .expect(201);
      tranzak.complete(tranzak.lastRequestId(), 'CANCELLED_BY_PAYER');
      const polled = await http().get(`/api/payments/${res.body.payment.id}`).set(as(a)).expect(200);
      expect(polled.body.status).toBe('FAILED');
      expect((await sub(marie)).status).toBe('SUSPENDED');
    });

    it('après régularisation, la résiliation laisse le suivi jusqu’à la fin du mois payé', async () => {
      await http().post(`/api/patients/${marie}/checkout`).set(as(a)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(201);
      tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
      await tranzakNotify(tranzak.lastRequestId()).expect(200);
      expect((await sub(marie)).status).toBe('ACTIVE');

      let res = await http().post(`/api/patients/${marie}/subscription/cancel`).set(as(a)).expect(200);
      expect(res.body).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
      res = await http().post(`/api/patients/${marie}/subscription/resume`).set(as(a)).expect(200);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      await http().post(`/api/patients/${marie}/subscription/cancel`).set(as(a)).expect(200);

      const end = (await sub(marie)).currentPeriodEnd!;
      mailer.outbox.length = 0;
      expect((await cron.runDaily(new Date(end.getTime() - 2 * DAY))).reminders).toBe(0); // pas de rappel : résilié
      expect((await cron.runDaily(new Date(end.getTime() + 60_000))).ended).toBe(1);
      expect((await sub(marie)).status).toBe('CANCELED');
    });
  });

  describe('Carte (Stripe)', () => {
    let rose: string;
    let localSubId: string;

    beforeAll(async () => {
      rose = await newParent('Rose');
      localSubId = (await sub(rose)).id;
    });

    const invoice = (id: string, extra: Record<string, unknown> = {}) => {
      const start = Math.floor(Date.now() / 1000);
      const end = Math.floor(addOneMonth(new Date()).getTime() / 1000);
      return {
        id,
        object: 'invoice',
        amount_paid: 5500,
        amount_due: 5500,
        billing_reason: 'subscription_create',
        parent: { subscription_details: { subscription: 'sub_rose', metadata: { subscriptionId: localSubId, includesSignupFee: '1' } } },
        lines: {
          data: [
            { description: 'Proche Santé · Formule Essentiel', amount: 2500, period: { start, end } },
            { description: 'Inscription', amount: 3000, period: { start, end: start } },
          ],
        },
        ...extra,
      };
    };

    it('ouvre la page de paiement Stripe avec la formule et l’inscription', async () => {
      const res = await http().post(`/api/patients/${rose}/checkout`).set(as(a)).send({ method: 'CARD' }).expect(201);
      expect(res.body).toEqual({ kind: 'redirect', url: 'https://checkout.stripe.test/abonnement' });
      expect(stripe.subscriptionCheckouts[0]).toMatchObject({
        monthlyCents: 2500,
        signupFeeCents: 3000,
        metadata: { subscriptionId: localSubId, includesSignupFee: '1' },
      });
    });

    it('rejette une notification Stripe mal signée', async () => {
      await stripeNotify('invoice.paid', invoice('in_1'), 'whsec_pirate').expect(401);
      expect((await sub(rose)).status).toBe('PENDING');
    });

    it('active le suivi à la première facture payée, une seule fois même si Stripe répète', async () => {
      mailer.outbox.length = 0;
      await stripeNotify('invoice.paid', invoice('in_1')).expect(200);
      const [first] = await db.select().from(payments).where(eq(payments.providerRef, 'in_1'));
      await stripeNotify('invoice.paid', invoice('in_1')).expect(200);
      const [again] = await db.select().from(payments).where(eq(payments.providerRef, 'in_1'));
      // Même numéro de facture, un seul reçu envoyé
      expect(again.invoiceNumber).toBe(first.invoiceNumber);
      expect(mailer.outbox.filter((m) => m.subject.startsWith('Paiement reçu'))).toHaveLength(1);
      const s = await sub(rose);
      expect(s).toMatchObject({ status: 'ACTIVE', paymentMethod: 'CARD', stripeSubscriptionId: 'sub_rose' });
      expect(s.signupFeePaidAt).not.toBeNull();
      const rows = await db.select().from(payments).where(eq(payments.subscriptionId, localSubId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ amount: 5500, currency: 'EUR', status: 'SUCCEEDED', method: 'CARD' });
    });

    it('la carte se renouvelle seule : pas de bouton de paiement', async () => {
      const res = await http().get(`/api/patients/${rose}/subscription`).set(as(a)).expect(200);
      expect(res.body.canPay).toMatchObject({ card: false, mobileMoney: false });
      expect(res.body.canPay.reason).toMatch(/automatiquement/);
    });

    it('change la formule chez Stripe (prorata calculé par Stripe)', async () => {
      await http().patch(`/api/patients/${rose}/plan`).set(as(a)).send({ plan: 'SERENITE' }).expect(200);
      expect(stripe.planChanges).toEqual([{ subscriptionId: 'sub_rose', monthlyCents: 4500 }]);
      expect((await sub(rose)).plan).toBe('SERENITE');
    });

    it('un prélèvement refusé met le suivi en retard et prévient la famille ; la relance réussie le rétablit', async () => {
      mailer.outbox.length = 0;
      await stripeNotify('invoice.payment_failed', invoice('in_2', { billing_reason: 'subscription_cycle', amount_paid: 0, amount_due: 4500 })).expect(200);
      expect((await sub(rose)).status).toBe('PAST_DUE');
      expect(mailer.outbox[0].subject).toMatch(/échoué/);

      await stripeNotify('invoice.paid', invoice('in_2', { billing_reason: 'subscription_cycle', amount_paid: 4500 })).expect(200);
      expect((await sub(rose)).status).toBe('ACTIVE');
      const [p] = await db.select().from(payments).where(eq(payments.providerRef, 'in_2'));
      expect(p).toMatchObject({ status: 'SUCCEEDED', amount: 4500 });
    });

    it('suspend après l’échec des relances Stripe, puis clôt à la suppression', async () => {
      await stripeNotify('customer.subscription.updated', { id: 'sub_rose', status: 'unpaid', cancel_at_period_end: false }).expect(200);
      expect((await sub(rose)).status).toBe('SUSPENDED');
      await stripeNotify('customer.subscription.deleted', { id: 'sub_rose', status: 'canceled' }).expect(200);
      expect((await sub(rose)).status).toBe('CANCELED');
    });
  });

  describe('Médicaments', () => {
    let prescriptionId: string;
    let paul: string;

    beforeAll(async () => {
      paul = await newParent('Paul');
      const [c] = await db
        .insert(consultations)
        .values({ patientId: paul, doctorId, scheduledAt: new Date(), status: 'DONE' })
        .returning();
      const [p] = await db
        .insert(prescriptions)
        .values({ consultationId: c.id, items: [{ name: 'Amlodipine 5 mg' }], status: 'AWAITING_PAYMENT', priceXaf: 6800 })
        .returning();
      prescriptionId = p.id;
    });

    it("une autre famille ne peut pas payer (ni voir) l'ordonnance", async () => {
      await http().post(`/api/prescriptions/${prescriptionId}/pay`).set(as(other)).send({ method: 'MOBILE_MONEY', phone: '677000000' }).expect(404);
    });

    it('par carte : converti en euros au taux fixe (6 800 FCFA → 10,37 €)', async () => {
      const res = await http().post(`/api/prescriptions/${prescriptionId}/pay`).set(as(a)).send({ method: 'CARD' }).expect(200);
      expect(res.body.kind).toBe('redirect');
      expect(stripe.oneTimeCheckouts[0].amountCents).toBe(1037);
    });

    it('par Mobile Money : payé en FCFA, la pharmacie peut préparer', async () => {
      const res = await http()
        .post(`/api/prescriptions/${prescriptionId}/pay`)
        .set(as(a))
        .send({ method: 'MOBILE_MONEY', phone: '699112233' })
        .expect(200);
      expect(res.body.payment).toMatchObject({ amount: 6800, currency: 'XAF' });
      tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
      await tranzakNotify(tranzak.lastRequestId()).expect(200);
      const [p] = await db.select().from(prescriptions).where(eq(prescriptions.id, prescriptionId));
      expect(p.status).toBe('PREPARING');
    });

    it("un paiement par carte arrivé en double est enregistré et signalé, sans repayer l'ordonnance", async () => {
      const [pending] = await db.select().from(payments).where(eq(payments.providerRef, 'cs_pay_1'));
      await stripeNotify('checkout.session.completed', { id: 'cs_pay_1', mode: 'payment', payment_status: 'paid', metadata: { paymentId: pending.id } }).expect(200);
      // Le paiement par carte arrive après le Mobile Money : il est enregistré (à rembourser par l'équipe), l'ordonnance reste en préparation
      const [p] = await db.select().from(prescriptions).where(eq(prescriptions.id, prescriptionId));
      expect(p.status).toBe('PREPARING');
      const flagged = await db.select().from(auditLogs).where(eq(auditLogs.action, 'billing.duplicate'));
      expect(flagged).toHaveLength(1);
      await http().post(`/api/prescriptions/${prescriptionId}/pay`).set(as(a)).send({ method: 'CARD' }).expect(409);
    });
  });

  it("l'historique ne montre que ses propres paiements", async () => {
    const mine = await http().get('/api/payments').set(as(a)).expect(200);
    expect(mine.body.length).toBeGreaterThan(5);
    expect(mine.body[0]).toHaveProperty('patientName');
    const theirs = await http().get('/api/payments').set(as(other)).expect(200);
    expect(theirs.body).toHaveLength(0);
  });
});
