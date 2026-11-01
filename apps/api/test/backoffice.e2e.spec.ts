// Back-office : tableau de bord, retards, parents, paiements et remboursements, relevés des partenaires,
// indicateurs, journal des accès. Réservé à l'équipe (rôle ADMIN).
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { Database } from '../src/db/db.module';
import {
  alerts,
  consultations,
  coverageZones,
  deliveries,
  homeVisits,
  partnerProfiles,
  patients,
  payments,
  prescriptions,
  Role,
  subscriptions,
} from '../src/db/schema';
import { MailerService } from '../src/mail/mailer.service';
import { createTestApp, createUser, FakeStripe, FakeTranzak, TRANZAK_AUTH_KEY } from './helpers';

type U = { id: string; token: string };

describe('Back-office', () => {
  let app: INestApplication;
  let db: Database;
  let tranzak: FakeTranzak;
  let stripe: FakeStripe;
  let mailer: MailerService;
  let family: U, admin: U, doc: U, nurse: U, pharmacy: U, courier: U, lab: U;
  let marieId: string;
  const ym = new Date(Date.now() + 3600_000).toISOString().slice(0, 7);

  const http = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });

  async function partner(role: Role, email: string, first: string, last: string, org?: string): Promise<U> {
    const u = await createUser(app, db, role, email, first, last);
    await db.insert(partnerProfiles).values({ userId: u.id, city: 'DOUALA', verifiedAt: new Date(), organizationName: org ?? null });
    return u;
  }
  const pay = async () => {
    tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
    await http().post('/api/webhooks/tranzak').send({ resourceId: tranzak.lastRequestId(), authKey: TRANZAK_AUTH_KEY }).expect(200);
  };

  beforeAll(async () => {
    ({ app, db, tranzak, stripe } = await createTestApp());
    mailer = app.get(MailerService);
    await db.insert(coverageZones).values({ city: 'DOUALA', district: 'Akwa', districtKey: 'akwa' });
    family = await createUser(app, db, Role.FAMILY, 'famille@exemple.fr', 'Aminata', 'Ngo');
    admin = await createUser(app, db, Role.ADMIN, 'admin@exemple.cm', 'Admin', 'Test');
    doc = await partner(Role.DOCTOR, 'dr@exemple.cm', 'Jean', 'Mbarga');
    nurse = await partner(Role.NURSE, 'inf@exemple.cm', 'Brigitte', 'Eto');
    pharmacy = await partner(Role.PHARMACY, 'pharma@exemple.cm', 'P', 'H', 'Pharmacie du Port');
    courier = await partner(Role.COURIER, 'livreur@exemple.cm', 'Moussa', 'Bello');
    lab = await partner(Role.LAB, 'labo@exemple.cm', 'L', 'A', 'Labo Akwa');
    await http()
      .put('/api/care/availability')
      .set(as(doc))
      .send({ slots: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 360, endMinute: 1320 })) })
      .expect(200);
    await http()
      .put('/api/care/availability')
      .set(as(nurse))
      .send({ slots: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 360, endMinute: 1320 })) })
      .expect(200);

    const res = await http()
      .post('/api/patients')
      .set(as(family))
      .send({ firstName: 'Marie', lastName: 'Ngo', whatsappPhone: '677123456', hasSmartphone: true, city: 'DOUALA', district: 'Akwa', conditions: ['DIABETES'], plan: 'SERENITE' })
      .expect(201);
    marieId = res.body.id;
    await db.update(patients).set({ consentGivenAt: new Date() }).where(eq(patients.id, marieId));
    await http().post(`/api/patients/${marieId}/checkout`).set(as(family)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(201);
    await pay();

    // Bilan de départ fait, avec une ordonnance → payée → livrée
    const [c] = await db.select().from(consultations).where(eq(consultations.patientId, marieId));
    await db.update(consultations).set({ scheduledAt: new Date(Date.now() - 5 * 60_000) }).where(eq(consultations.id, c.id));
    await http()
      .post(`/api/doctor/consultations/${c.id}/complete`)
      .set(as(doc))
      .send({ summary: 'Bilan de départ.', prescription: [{ name: 'Metformine 500 mg', dosage: '1 matin et soir' }] })
      .expect(201);
    const [pr] = await db.select().from(prescriptions);
    await http().post(`/api/pharmacy/prescriptions/${pr.id}/price`).set(as(pharmacy)).send({ priceXaf: 4500 }).expect(201);
    await http().post(`/api/prescriptions/${pr.id}/pay`).set(as(family)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(200);
    await pay();
    await http().post(`/api/pharmacy/prescriptions/${pr.id}/ready`).set(as(pharmacy)).expect(201);
    const [d] = await db.select().from(deliveries);
    await db.update(deliveries).set({ attempts: 1 }).where(eq(deliveries.id, d.id)); // un premier passage manqué
    await http().post(`/api/courier/deliveries/${d.id}/picked-up`).set(as(courier)).expect(201);
    await http().post(`/api/courier/deliveries/${d.id}/delivered`).set(as(courier)).send({ code: d.code }).expect(201);

    // Visite infirmière faite
    const [v] = await db.select().from(homeVisits).where(eq(homeVisits.patientId, marieId));
    await db.update(homeVisits).set({ status: 'DONE', completedAt: new Date() }).where(eq(homeVisits.id, v.id));
  });

  afterAll(() => app.close());

  it("réservé à l'équipe : famille et partenaires refusés", async () => {
    await http().get('/api/admin/overview').set(as(family)).expect(403);
    await http().get('/api/admin/payouts').set(as(doc)).expect(403);
    await http().get('/api/admin/metrics').expect(401);
  });

  it('tableau de bord : abonnés, revenu mensuel récurrent, activité', async () => {
    const res = await http().get('/api/admin/overview').set(as(admin)).expect(200);
    expect(res.body.subscribers).toMatchObject({ active: 1, serenite: 1, essentiel: 0, pending: 0 });
    expect(res.body.mrrEur).toBe(45);
    // 45 € + 30 € d'inscription, payés en FCFA (arrondis à la centaine) → environ 75 €
    expect(res.body.revenueThisMonthEur).toBeGreaterThan(74);
    expect(res.body.medicationsThisMonthEur).toBeCloseTo(4500 / 655.957, 1);
    expect(res.body.consultationsDone).toBe(1);
  });

  describe('retards', () => {
    it('signale ce qui traîne, les plus graves en premier', async () => {
      const [late] = await db.insert(consultations).values({ patientId: marieId, doctorId: doc.id, scheduledAt: new Date(Date.now() - 3 * 3600_000), kind: 'EXTRA' }).returning();
      await db.insert(alerts).values({ patientId: marieId, doctorId: doc.id, severity: 'URGENT', message: 'Tension très élevée : 190/110 mmHg', createdAt: new Date(Date.now() - 3 * 3600_000) });
      const [c] = await db.select().from(consultations).where(eq(consultations.id, late.id));
      await db.insert(prescriptions).values({ consultationId: c.id, pharmacyId: pharmacy.id, items: [{ name: 'Amlodipine' }], status: 'SENT', createdAt: new Date(Date.now() - 30 * 3600_000) });

      const res = await http().get('/api/admin/delays').set(as(admin)).expect(200);
      const labels = res.body.map((d: { label: string }) => d.label);
      expect(labels.some((l: string) => l.endsWith('non clôturée') && l.startsWith('Consultation'))).toBe(true);
      expect(labels).toContain('Alerte urgente non traitée : Tension très élevée : 190/110 mmHg');
      expect(labels).toContain('Ordonnance pas encore chiffrée par la pharmacie');
      const severities = res.body.map((d: { severity: string }) => d.severity);
      expect(severities.indexOf('medium')).toBeGreaterThan(severities.lastIndexOf('high'));
      expect(res.body.find((d: { kind: string }) => d.kind === 'consultation')).toMatchObject({ patientName: 'Marie Ngo', who: 'Dr Mbarga' });
    });
  });

  describe('parents', () => {
    it('liste les parents avec famille, formule et équipe ; recherche et filtres', async () => {
      const res = await http().get('/api/admin/patients').query({ search: 'marie' }).set(as(admin)).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        name: 'Marie Ngo',
        family: { email: 'famille@exemple.fr' },
        subscription: { status: 'ACTIVE', plan: 'SERENITE', method: 'MOBILE_MONEY' },
        team: { doctor: 'Dr Mbarga', nurse: 'Brigitte', pharmacy: 'Pharmacie du Port', lab: 'Labo Akwa' }, // Sérénité : laboratoire affecté à l'activation
      });
      expect((await http().get('/api/admin/patients').query({ status: 'PENDING' }).set(as(admin)).expect(200)).body).toHaveLength(0);
    });

    it("propose les partenaires vérifiés de la ville avec leur nombre de parents, et permet de changer l'équipe", async () => {
      const lab2 = await partner(Role.LAB, 'labo2@exemple.cm', 'L', 'B', 'Labo Bonapriso');
      const res = await http().get('/api/admin/partners').query({ city: 'DOUALA', role: 'LAB' }).set(as(admin)).expect(200);
      expect(res.body).toEqual([
        { id: lab.id, name: 'Labo Akwa', patients: 1 },
        { id: lab2.id, name: 'Labo Bonapriso', patients: 0 },
      ]);
      await http().patch(`/api/admin/patients/${marieId}/care-team`).set(as(admin)).send({ labId: lab2.id }).expect(200);
      const after = await http().get('/api/admin/partners').query({ city: 'DOUALA', role: 'LAB' }).set(as(admin)).expect(200);
      expect(after.body.map((p: { patients: number }) => p.patients)).toEqual([0, 1]);
    });
  });

  describe('relevés des partenaires', () => {
    it('calcule ce qui est dû à chacun pour le mois', async () => {
      const res = await http().get('/api/admin/payouts').query({ month: ym }).set(as(admin)).expect(200);
      const by = Object.fromEntries(res.body.map((s: { role: string; totalXaf: number; items: number }) => [s.role, s]));
      expect(by.DOCTOR).toMatchObject({ name: 'Dr Jean Mbarga', totalXaf: 8000, items: 1 }); // bilan de départ
      expect(by.NURSE).toMatchObject({ totalXaf: 5000, items: 1 });
      expect(by.COURIER).toMatchObject({ totalXaf: 1500 + 500, items: 2 }); // livraison + un passage manqué
      expect(by.PHARMACY).toMatchObject({ name: 'Pharmacie du Port', totalXaf: 4500 }); // prix des médicaments reversé
      expect(by.LAB).toBeUndefined();
    });

    it('marque un relevé payé une seule fois ; le partenaire est prévenu et voit son relevé', async () => {
      mailer.outbox.length = 0;
      await http().post(`/api/admin/payouts/${courier.id}/${ym}/paid`).set(as(admin)).send({ reference: 'OM-123' }).expect(201);
      await http().post(`/api/admin/payouts/${courier.id}/${ym}/paid`).set(as(admin)).send({}).expect(409);
      expect(mailer.outbox[0]).toMatchObject({ to: 'livreur@exemple.cm' });
      expect(mailer.outbox[0].text).toMatch(/versé 2\s000 FCFA pour .+ \(2 actes\)/);

      const mine = await http().get('/api/me/statement').query({ month: ym }).set(as(courier)).expect(200);
      expect(mine.body).toMatchObject({ totalXaf: 2000, payout: { amountXaf: 2000, reference: 'OM-123' } });
      expect(mine.body.lines.map((l: { label: string }) => l.label)).toEqual(['Livraison', 'Passage sans remise (1)']);
      expect(mine.body.lines[0].patient).toBe('Marie N.');
      // Un partenaire ne voit que le sien
      const other = await http().get('/api/me/statement').query({ month: ym }).set(as(doc)).expect(200);
      expect(other.body.partnerId).toBe(doc.id);
    });

    it('refuse de marquer payé un relevé vide', async () => {
      await http().post(`/api/admin/payouts/${lab.id}/${ym}/paid`).set(as(admin)).send({}).expect(409);
    });
  });

  describe('paiements', () => {
    it('liste les paiements avec payeur, parent et montant en euros', async () => {
      const res = await http().get('/api/admin/payments').query({ status: 'SUCCEEDED' }).set(as(admin)).expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.find((p: { kind: string }) => p.kind === 'MEDICATION')).toMatchObject({ amount: 4500, currency: 'XAF', patient: 'Marie Ngo', email: 'famille@exemple.fr' });
    });

    it('rembourse une carte chez Stripe automatiquement', async () => {
      const [card] = await db
        .insert(payments)
        .values({ payerId: family.id, patientId: marieId, kind: 'SUBSCRIPTION', provider: 'STRIPE', method: 'CARD', status: 'SUCCEEDED', amount: 4500, currency: 'EUR', lines: [], providerRef: 'cs_test_1', paidAt: new Date() })
        .returning();
      mailer.outbox.length = 0;
      const res = await http().post(`/api/admin/payments/${card.id}/refund`).set(as(admin)).send({ reason: 'Double paiement' }).expect(201);
      expect(res.body.refundRef).toBe('re_test_1');
      expect(stripe.refunds).toEqual(['cs_test_1']);
      const [after] = await db.select().from(payments).where(eq(payments.id, card.id));
      expect(after).toMatchObject({ status: 'REFUNDED', refundReason: 'Double paiement', refundedById: admin.id });
      expect(mailer.outbox[0].subject).toBe('Remboursement de 45,00 €');
      await http().post(`/api/admin/payments/${card.id}/refund`).set(as(admin)).send({ reason: 'x' }).expect(409);
    });

    it('Mobile Money : exige la référence du remboursement fait sur Tranzak', async () => {
      const [mm] = await db.select().from(payments).where(eq(payments.kind, 'MEDICATION'));
      await http().post(`/api/admin/payments/${mm.id}/refund`).set(as(admin)).send({ reason: 'Rupture de stock' }).expect(400);
      await http().post(`/api/admin/payments/${mm.id}/refund`).set(as(admin)).send({ reason: 'Rupture de stock', reference: 'TZ-REF-9' }).expect(201);
      const [after] = await db.select().from(payments).where(eq(payments.id, mm.id));
      expect(after).toMatchObject({ status: 'REFUNDED', refundRef: 'TZ-REF-9' });
    });

    it('liste les impayés', async () => {
      await db.update(subscriptions).set({ status: 'PAST_DUE' }).where(eq(subscriptions.patientId, marieId));
      const res = await http().get('/api/admin/unpaid').set(as(admin)).expect(200);
      expect(res.body.subscriptions).toMatchObject([{ patient: 'Marie Ngo', status: 'PAST_DUE', email: 'famille@exemple.fr' }]);
      await db.update(subscriptions).set({ status: 'ACTIVE' }).where(eq(subscriptions.patientId, marieId));
    });
  });

  describe('indicateurs', () => {
    it('inscriptions, conversion, abonnés actifs, revenu, coûts et marge du mois', async () => {
      const res = await http().get('/api/admin/metrics').query({ months: 3 }).set(as(admin)).expect(200);
      expect(res.body.months).toHaveLength(3);
      const now = res.body.months.at(-1);
      expect(now).toMatchObject({ month: ym, signups: 1, conversionRate: 100, activations: 1, activeEnd: 1 });
      // Coût partenaires (hors pharmacie, reversée) : bilan 8 000 + visite 5 000 + livraison 1 500 + passage 500 FCFA
      expect(now.partnerCostEur).toBeCloseTo(15000 / 655.957, 1);
      // Le remboursement par carte n'entre pas dans le revenu (statut REFUNDED)
      expect(now.revenueEur).toBeLessThan(80);
      expect(now.marginEur).toBeCloseTo(now.revenueEur - now.partnerCostEur - now.whatsappCostEur, 1);
      expect(now.marginPerClientEur).toBeCloseTo(now.marginEur, 1);
      expect(res.body.cohorts.at(-1)).toMatchObject({ month: ym, size: 1, m1: null, m3: null, m6: null });
    });
  });

  describe('journal des accès', () => {
    it('filtre par action et indique qui a agi', async () => {
      const res = await http().get('/api/admin/audit').query({ action: 'payment.refund' }).set(as(admin)).expect(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows[0]).toMatchObject({ entity: 'Payment', actorEmail: 'admin@exemple.cm', actorRole: 'ADMIN' });
      const reads = await http().get('/api/admin/audit').query({ entity: 'Patient', entityId: marieId }).set(as(admin)).expect(200);
      expect(reads.body.rows.length).toBeGreaterThan(0);
    });
  });
});
