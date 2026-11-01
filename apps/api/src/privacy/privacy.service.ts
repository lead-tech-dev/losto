import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, inArray, isNotNull, and } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { normalizeKey } from '../common/text';
import { randomToken } from '../common/tokens';
import { Database, DB } from '../db/db.module';
import {
  alerts,
  consultations,
  deliveries,
  homeVisits,
  invitations,
  labRequests,
  monthlyReports,
  Patient,
  patientMembers,
  patients,
  payments,
  prescriptions,
  readings,
  referrals,
  subscriptions,
  users,
  whatsappMessages,
} from '../db/schema';
import { NotifyService } from '../mail/notify.service';

// Droits des personnes (loi camerounaise 2024/017, RGPD) : obtenir une copie de toutes les données
// d'un parent, et les effacer. Les factures sont conservées (obligation comptable), sans données de santé.
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  async export(actorId: string, p: Patient) {
    const id = p.id;
    const cons = await this.db
      .select({ c: consultations, doctor: users.lastName })
      .from(consultations)
      .innerJoin(users, eq(users.id, consultations.doctorId))
      .where(eq(consultations.patientId, id))
      .orderBy(asc(consultations.scheduledAt));
    const consIds = cons.map((x) => x.c.id);
    const presc = consIds.length
      ? await this.db
          .select({ p: prescriptions, d: deliveries })
          .from(prescriptions)
          .leftJoin(deliveries, eq(deliveries.prescriptionId, prescriptions.id))
          .where(inArray(prescriptions.consultationId, consIds))
          .orderBy(asc(prescriptions.createdAt))
      : [];
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.patientId, id));
    const data = {
      service: 'Proche Santé',
      exportedAt: new Date(),
      note: 'Copie de toutes les données enregistrées pour ce parent. Les heures sont en temps universel (UTC).',
      parent: {
        firstName: p.firstName,
        lastName: p.lastName,
        birthYear: p.birthYear,
        whatsappPhone: p.whatsappPhone,
        hasSmartphone: p.hasSmartphone,
        city: p.city,
        district: p.district,
        addressDetails: p.addressDetails,
        conditions: p.conditions,
        medicalHistory: p.medicalHistory,
        currentTreatments: p.currentTreatments,
        notes: p.notes,
        consentGivenAt: p.consentGivenAt,
        whatsappOptOutAt: p.whatsappOptOutAt,
        createdAt: p.createdAt,
      },
      subscription: sub ? { plan: sub.plan, status: sub.status, paymentMethod: sub.paymentMethod, currentPeriodEnd: sub.currentPeriodEnd, createdAt: sub.createdAt } : null,
      consultations: cons.map(({ c, doctor }) => ({ date: c.scheduledAt, doctor: `Dr ${doctor}`, kind: c.kind, mode: c.mode, status: c.status, summary: c.summary, missedReason: c.missedReason })),
      prescriptions: presc.map(({ p: pr, d }) => ({ date: pr.createdAt, items: pr.items, status: pr.status, priceXaf: pr.priceXaf, pharmacyNote: pr.pharmacyNote, delivery: d ? { status: d.status, deliveredAt: d.deliveredAt } : null })),
      homeVisits: (await this.db.select().from(homeVisits).where(eq(homeVisits.patientId, id)).orderBy(asc(homeVisits.scheduledAt))).map((v) => ({ date: v.scheduledAt, status: v.status, treatmentChecked: v.treatmentChecked, note: v.note })),
      readings: (await this.db.select().from(readings).where(eq(readings.patientId, id)).orderBy(asc(readings.measuredAt))).map((r) => ({ date: r.measuredAt, type: r.type, systolic: r.systolic, diastolic: r.diastolic, value: r.value === null ? null : Number(r.value), source: r.source })),
      alerts: (await this.db.select().from(alerts).where(eq(alerts.patientId, id)).orderBy(asc(alerts.createdAt))).map((a) => ({ date: a.createdAt, severity: a.severity, message: a.message, acknowledgedAt: a.acknowledgedAt })),
      labs: (await this.db.select().from(labRequests).where(eq(labRequests.patientId, id)).orderBy(asc(labRequests.createdAt))).map((l) => ({ date: l.createdAt, tests: l.tests, status: l.status, appointmentAt: l.appointmentAt, results: l.results, resultsAbnormal: l.resultsAbnormal, doctorComment: l.doctorComment })),
      referrals: (await this.db.select().from(referrals).where(eq(referrals.patientId, id)).orderBy(asc(referrals.createdAt))).map((r) => ({ date: r.createdAt, destination: r.destination, urgency: r.urgency, reason: r.reason })),
      monthlyReports: (await this.db.select().from(monthlyReports).where(and(eq(monthlyReports.patientId, id), isNotNull(monthlyReports.sentAt))).orderBy(asc(monthlyReports.month))).map((m) => ({ month: m.month, content: m.content, sentAt: m.sentAt })),
      whatsappMessages: (await this.db.select().from(whatsappMessages).where(eq(whatsappMessages.patientId, id)).orderBy(asc(whatsappMessages.createdAt))).map((m) => ({ date: m.createdAt, direction: m.direction === 'IN' ? 'reçu du parent' : 'envoyé par Proche Santé', text: m.body })),
      payments: (await this.db.select().from(payments).where(eq(payments.patientId, id)).orderBy(desc(payments.createdAt))).map((x) => ({ date: x.paidAt ?? x.createdAt, kind: x.kind, status: x.status, amount: x.amount, currency: x.currency, invoiceNumber: x.invoiceNumber })),
    };
    await this.audit.log(actorId, 'patient.export', 'Patient', id);
    return data;
  }

  // Effacement définitif. On garde la ligne du parent (vide) et ses paiements : les factures doivent
  // être conservées et restent rattachées au compte de la famille qui a payé.
  async erase(actorId: string, p: Patient, confirmFirstName: string) {
    if (normalizeKey(confirmFirstName) !== normalizeKey(p.firstName)) {
      throw new BadRequestException(`Pour confirmer, écrivez le prénom du parent : ${p.firstName}`);
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const cons = await tx.select({ id: consultations.id }).from(consultations).where(eq(consultations.patientId, p.id));
      // Ordonnances et livraisons disparaissent avec les consultations ; les paiements perdent seulement le lien
      if (cons.length) await tx.delete(consultations).where(inArray(consultations.id, cons.map((c) => c.id)));
      for (const t of [readings, alerts, labRequests, homeVisits, referrals, monthlyReports, whatsappMessages, patientMembers, invitations] as const) {
        await tx.delete(t).where(eq(t.patientId, p.id));
      }
      await tx
        .update(subscriptions)
        .set({ status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false, pendingPlan: null })
        .where(eq(subscriptions.patientId, p.id));
      await tx
        .update(patients)
        .set({
          firstName: 'Parent',
          lastName: 'effacé',
          birthYear: null,
          whatsappPhone: '+237000000000',
          hasSmartphone: false,
          district: '—',
          addressDetails: null,
          conditions: [],
          medicalHistory: null,
          currentTreatments: null,
          notes: null,
          doctorId: null,
          nurseId: null,
          pharmacyId: null,
          labId: null,
          consentToken: randomToken(),
          consentGivenAt: null,
          whatsappOptOutAt: now,
          erasedAt: now,
        })
        .where(eq(patients.id, p.id));
    });
    await this.audit.log(actorId, 'patient.erase', 'Patient', p.id);
    await this.notify.user(
      p.familyUserId,
      `Données de ${p.firstName} effacées`,
      `Comme demandé, toutes les données de suivi de ${p.firstName} ${p.lastName} ont été effacées : dossier, consultations, ` +
        `ordonnances, relevés, analyses, comptes rendus et messages WhatsApp. Le suivi est arrêté.\n` +
        `Seules vos factures sont conservées, comme la loi l'impose, sans aucune information de santé.`,
    );
    return { ok: true };
  }
}
