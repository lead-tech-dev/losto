// Pharmacie, laboratoire, livraison : la chaîne complète et le cloisonnement de chaque partenaire.
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { quarterlyPanel } from '../src/care/scheduling.service';
import { Database } from '../src/db/db.module';
import { alerts, consultations, coverageZones, deliveries, labRequests, partnerProfiles, patients, prescriptions, Role } from '../src/db/schema';
import { LogisticsCronService } from '../src/logistics/logistics-cron.service';
import { MailerService } from '../src/mail/mailer.service';
import { createTestApp, createUser, FakeTranzak, TRANZAK_AUTH_KEY } from './helpers';

type U = { id: string; token: string };

describe('Pharmacie, laboratoire, livraison', () => {
  let app: INestApplication;
  let db: Database;
  let tranzak: FakeTranzak;
  let mailer: MailerService;
  let family: U, doc: U, pharmacy: U, otherPharmacy: U, lab: U, otherLab: U, courier: U, otherCourier: U, admin: U;
  let patientId: string;
  let prescriptionId: string;
  let deliveryId: string;
  let deliveryCode: string;
  let labId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: U) => ({ Authorization: `Bearer ${u.token}` });

  async function partner(role: Role, email: string, name: string, city: 'DOUALA' | 'YAOUNDE' = 'DOUALA'): Promise<U> {
    const u = await createUser(app, db, role, email, name, 'Test');
    await db.insert(partnerProfiles).values({ userId: u.id, city, verifiedAt: new Date(), organizationName: role === 'PHARMACY' ? `Pharmacie ${name}` : null });
    return u;
  }

  beforeAll(async () => {
    ({ app, db, tranzak } = await createTestApp());
    mailer = app.get(MailerService);
    await db.insert(coverageZones).values({ city: 'DOUALA', district: 'Akwa', districtKey: 'akwa' });
    family = await createUser(app, db, Role.FAMILY, 'famille@exemple.fr', 'Aminata', 'Ngo');
    admin = await createUser(app, db, Role.ADMIN, 'admin@exemple.cm', 'Admin', 'Test');
    doc = await partner(Role.DOCTOR, 'dr@exemple.cm', 'Jean');
    pharmacy = await partner(Role.PHARMACY, 'pharma@exemple.cm', 'du Port');
    lab = await partner(Role.LAB, 'labo@exemple.cm', 'Labo Akwa');
    courier = await partner(Role.COURIER, 'livreur@exemple.cm', 'Moussa');
    // Partenaires d'une autre ville : jamais affectés à un parent de Douala
    otherPharmacy = await partner(Role.PHARMACY, 'pharma2@exemple.cm', 'Yaoundé', 'YAOUNDE');
    otherLab = await partner(Role.LAB, 'labo2@exemple.cm', 'Labo Yaoundé', 'YAOUNDE');
    otherCourier = await partner(Role.COURIER, 'livreur2@exemple.cm', 'Yaoundé', 'YAOUNDE');

    await http()
      .put('/api/care/availability')
      .set(as(doc))
      .send({ slots: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 360, endMinute: 1320 })) })
      .expect(200);

    const res = await http()
      .post('/api/patients')
      .set(as(family))
      .send({ firstName: 'Marie', lastName: 'Ngo', whatsappPhone: '677123456', hasSmartphone: true, city: 'DOUALA', district: 'Akwa', conditions: ['DIABETES'], plan: 'ESSENTIEL' })
      .expect(201);
    patientId = res.body.id;
    await db.update(patients).set({ consentGivenAt: new Date() }).where(eq(patients.id, patientId));
    await http().post(`/api/patients/${patientId}/checkout`).set(as(family)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(201);
    tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
    await http().post('/api/webhooks/tranzak').send({ resourceId: tranzak.lastRequestId(), authKey: TRANZAK_AUTH_KEY }).expect(200);

    // Le médecin tient le bilan de départ : ordonnance + analyses
    const [c] = await db.select().from(consultations).where(eq(consultations.patientId, patientId));
    await db.update(consultations).set({ scheduledAt: new Date(Date.now() - 5 * 60_000) }).where(eq(consultations.id, c.id));
    await http()
      .post(`/api/doctor/consultations/${c.id}/complete`)
      .set(as(doc))
      .send({
        summary: 'Bilan de départ, diabète à équilibrer.',
        prescription: [{ name: 'Metformine 500 mg', dosage: '1 matin et soir', quantity: 60 }],
        labs: { tests: ['HbA1c'] },
      })
      .expect(201);
    [{ id: prescriptionId }] = await db.select({ id: prescriptions.id }).from(prescriptions);
    [{ id: labId }] = await db.select({ id: labRequests.id }).from(labRequests);
  });

  afterAll(() => app.close());

  describe('pharmacie', () => {
    it("reçoit l'ordonnance de la pharmacie de la ville ; l'autre pharmacie ne la voit pas", async () => {
      const mine = await http().get('/api/pharmacy/prescriptions').set(as(pharmacy)).expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0]).toMatchObject({ status: 'SENT', patientName: 'Marie Ngo', doctorName: 'Dr Jean Test' });
      expect(mine.body[0].medicalHistory).toBeUndefined();
      const theirs = await http().get('/api/pharmacy/prescriptions').set(as(otherPharmacy)).expect(200);
      expect(theirs.body).toHaveLength(0);
      await http().post(`/api/pharmacy/prescriptions/${prescriptionId}/price`).set(as(otherPharmacy)).send({ priceXaf: 5000 }).expect(404);
    });

    it('ne peut pas marquer prête une commande non payée', async () => {
      await http().post(`/api/pharmacy/prescriptions/${prescriptionId}/ready`).set(as(pharmacy)).expect(409);
    });

    it('fixe le prix : la famille doit valider et payer', async () => {
      mailer.outbox.length = 0;
      await http().post(`/api/pharmacy/prescriptions/${prescriptionId}/price`).set(as(pharmacy)).send({ priceXaf: 4500, note: 'Générique' }).expect(201);
      expect(mailer.outbox[0].subject).toBe('Médicaments à valider : 4 500 FCFA');
      const fam = await http().get(`/api/patients/${patientId}/prescriptions`).set(as(family)).expect(200);
      expect(fam.body[0]).toMatchObject({ status: 'AWAITING_PAYMENT', priceXaf: 4500, pharmacyNote: 'Générique' });
    });

    it('ne change plus le prix pendant un paiement en cours', async () => {
      await http().post(`/api/prescriptions/${prescriptionId}/pay`).set(as(family)).send({ method: 'MOBILE_MONEY', phone: '677123456' }).expect(200);
      await http().post(`/api/pharmacy/prescriptions/${prescriptionId}/price`).set(as(pharmacy)).send({ priceXaf: 9000 }).expect(409);
      tranzak.complete(tranzak.lastRequestId(), 'SUCCESSFUL');
      await http().post('/api/webhooks/tranzak').send({ resourceId: tranzak.lastRequestId(), authKey: TRANZAK_AUTH_KEY }).expect(200);
      const [p] = await db.select().from(prescriptions).where(eq(prescriptions.id, prescriptionId));
      expect(p.status).toBe('PREPARING');
    });

    it('commande prête : livreur de la ville affecté, code envoyé à la famille', async () => {
      mailer.outbox.length = 0;
      const res = await http().post(`/api/pharmacy/prescriptions/${prescriptionId}/ready`).set(as(pharmacy)).expect(201);
      expect(res.body.courierAssigned).toBe(true);
      const [d] = await db.select().from(deliveries).where(eq(deliveries.prescriptionId, prescriptionId));
      expect(d).toMatchObject({ status: 'ASSIGNED', courierId: courier.id });
      expect(d.code).toMatch(/^\d{4}$/);
      deliveryId = d.id;
      deliveryCode = d.code;
      expect(mailer.outbox[0].subject).toContain(`code de livraison ${d.code}`);
      const fam = await http().get(`/api/patients/${patientId}/prescriptions`).set(as(family)).expect(200);
      expect(fam.body[0].deliveryCode).toBe(d.code);
    });
  });

  describe('livraison', () => {
    it("le livreur voit où aller, pas le contenu du colis ni le code ; l'autre livreur ne voit rien", async () => {
      const res = await http().get('/api/courier/deliveries').set(as(courier)).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].pickup.name).toBe('Pharmacie du Port');
      expect(res.body[0].dropoff).toMatchObject({ name: 'Marie Ngo', phone: '+237677123456' });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('Metformine');
      expect(raw).not.toContain(deliveryCode);
      expect((await http().get('/api/courier/deliveries').set(as(otherCourier)).expect(200)).body).toHaveLength(0);
      await http().post(`/api/courier/deliveries/${deliveryId}/picked-up`).set(as(otherCourier)).expect(404);
    });

    it('doit récupérer le colis avant de livrer', async () => {
      await http().post(`/api/courier/deliveries/${deliveryId}/delivered`).set(as(courier)).send({ code: deliveryCode }).expect(409);
      await http().post(`/api/courier/deliveries/${deliveryId}/picked-up`).set(as(courier)).expect(201);
    });

    it('un échec de livraison prévient la famille, puis le livreur repasse', async () => {
      mailer.outbox.length = 0;
      await http().post(`/api/courier/deliveries/${deliveryId}/failed`).set(as(courier)).send({ reason: 'Personne au domicile' }).expect(201);
      expect(mailer.outbox[0].subject).toBe('Livraison à Marie reportée');
      const r = await http().post(`/api/courier/deliveries/${deliveryId}/retry`).set(as(courier)).expect(201);
      expect(r.body.status).toBe('IN_TRANSIT');
    });

    it('refuse un mauvais code, en comptant les essais', async () => {
      const wrong = deliveryCode === '0000' ? '1111' : '0000';
      const res = await http().post(`/api/courier/deliveries/${deliveryId}/delivered`).set(as(courier)).send({ code: wrong }).expect(409);
      expect(res.body.message).toBe('Code incorrect. Encore 4 essai(s).');
    });

    it('livré avec le bon code : ordonnance livrée, famille prévenue, code plus affiché', async () => {
      mailer.outbox.length = 0;
      await http().post(`/api/courier/deliveries/${deliveryId}/delivered`).set(as(courier)).send({ code: deliveryCode }).expect(201);
      const [p] = await db.select().from(prescriptions).where(eq(prescriptions.id, prescriptionId));
      expect(p.status).toBe('DELIVERED');
      expect(mailer.outbox[0].subject).toBe('Médicaments livrés à Marie');
      const fam = await http().get(`/api/patients/${patientId}/prescriptions`).set(as(family)).expect(200);
      expect(fam.body[0]).toMatchObject({ deliveryStatus: 'DELIVERED', deliveryCode: null });
    });

    it('bloque après 5 codes erronés (impossible de deviner le code)', async () => {
      const [d] = await db
        .insert(deliveries)
        .values({ prescriptionId: (await addPrescription()).id, code: '4321', courierId: courier.id, status: 'IN_TRANSIT', pickedUpAt: new Date() })
        .returning();
      for (let i = 0; i < 5; i++) {
        await http().post(`/api/courier/deliveries/${d.id}/delivered`).set(as(courier)).send({ code: '0000' }).expect(409);
      }
      await http().post(`/api/courier/deliveries/${d.id}/delivered`).set(as(courier)).send({ code: '4321' }).expect(403);
    });
  });

  describe('laboratoire', () => {
    it("la demande d'analyses va au laboratoire de la ville ; l'autre labo ne la voit pas", async () => {
      const mine = await http().get('/api/lab/requests').set(as(lab)).expect(200);
      expect(mine.body.map((r: { id: string }) => r.id)).toContain(labId);
      expect((await http().get('/api/lab/requests').set(as(otherLab)).expect(200)).body).toHaveLength(0);
      await http().post(`/api/lab/requests/${labId}/sampled`).set(as(otherLab)).expect(404);
    });

    it('fixe un rendez-vous de prélèvement à domicile ; la famille est prévenue', async () => {
      mailer.outbox.length = 0;
      const at = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
      await http().post(`/api/lab/requests/${labId}/appointment`).set(as(lab)).send({ at, mode: 'HOME_SAMPLING' }).expect(201);
      expect(mailer.outbox[0].subject).toMatch(/^Prise de sang de Marie/);
      expect(mailer.outbox[0].text).toContain('passera chez Marie');
      await http().post(`/api/lab/requests/${labId}/sampled`).set(as(lab)).expect(201);
    });

    it('résultats anormaux : alerte au médecin ; la famille ne les voit pas avant sa lecture', async () => {
      await http().post(`/api/lab/requests/${labId}/results`).set(as(lab)).send({ results: 'HbA1c : 9,1 %', abnormal: true }).expect(201);
      const docAlerts = await http().get('/api/doctor/alerts').set(as(doc)).expect(200);
      expect(docAlerts.body[0].message).toBe("Résultats d'analyses anormaux : HbA1c");

      const before = await http().get(`/api/patients/${patientId}/labs`).set(as(family)).expect(200);
      const mine = before.body.find((l: { id: string }) => l.id === labId);
      expect(mine).toMatchObject({ awaitingDoctorReview: true, results: null });
    });

    it('après lecture par le médecin : résultats et commentaire visibles, alerte close', async () => {
      await http().post(`/api/doctor/labs/${labId}/review`).set(as(doc)).send({ comment: 'Diabète mal équilibré, traitement renforcé.' }).expect(201);
      const after = await http().get(`/api/patients/${patientId}/labs`).set(as(family)).expect(200);
      expect(after.body.find((l: { id: string }) => l.id === labId)).toMatchObject({
        awaitingDoctorReview: false,
        results: 'HbA1c : 9,1 %',
        doctorComment: 'Diabète mal équilibré, traitement renforcé.',
      });
      const open = await db.select().from(alerts).where(eq(alerts.labRequestId, labId));
      expect(open[0].acknowledgedAt).not.toBeNull();
    });
  });

  it('rattrapage quotidien : une livraison sans livreur en reçoit un dès que possible', async () => {
    const [d] = await db.insert(deliveries).values({ prescriptionId: (await addPrescription()).id, code: '1111', status: 'PENDING' }).returning();
    const r = await app.get(LogisticsCronService).daily();
    expect(r.deliveries).toBe(1);
    const [after] = await db.select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after).toMatchObject({ status: 'ASSIGNED', courierId: courier.id });
  });

  it('panel trimestriel selon les maladies suivies', () => {
    expect(quarterlyPanel(['DIABETES', 'HYPERTENSION'])).toEqual(['Glycémie à jeun', 'HbA1c', 'Créatinine', 'Ionogramme']);
    expect(quarterlyPanel(['ASTHMA'])).toEqual([]);
  });

  it("l'admin réaffecte une livraison, mais seulement à un livreur", async () => {
    await http().patch(`/api/admin/deliveries/${deliveryId}/courier`).set(as(admin)).send({ courierId: pharmacy.id }).expect(400);
    await http().patch(`/api/admin/deliveries/${deliveryId}/courier`).set(as(admin)).send({ courierId: otherCourier.id }).expect(200);
  });

  async function addPrescription() {
    const [c] = await db.select().from(consultations).where(eq(consultations.patientId, patientId));
    const [p] = await db.insert(prescriptions).values({ consultationId: c.id, pharmacyId: pharmacy.id, items: [{ name: 'X' }], status: 'READY' }).returning();
    return p;
  }
});
