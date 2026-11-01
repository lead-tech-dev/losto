import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { StripeGateway } from '../billing/gateways/stripe.client';
import { fmtLocal } from '../care/care-time';
import { Database, DB } from '../db/db.module';
import {
  alerts,
  auditLogs,
  CITIES,
  City,
  consultations,
  deliveries,
  homeVisits,
  labRequests,
  monthlyReports,
  partnerProfiles,
  patients,
  payments,
  prescriptions,
  Role,
  subscriptions,
  users,
  whatsappMessages,
} from '../db/schema';
import { NotifyService } from '../mail/notify.service';
import { PLAN_PRICES_EUR } from '../patients/plans';
import { monthStart, previousMonth } from '../whatsapp/reports.service';
import { partnerRates, whatsappCostXaf, XAF_PER_EUR, xafToEur } from './rates';
import { nextMonth, StatementsService } from './statements.service';

const H = 3600_000;

export interface Delay {
  kind: string;
  severity: 'high' | 'medium';
  label: string;
  patientId: string | null;
  patientName: string | null;
  who: string | null; // partenaire concerné
  since: Date;
}

// Montant d'un paiement en euros (les paiements Mobile Money sont en FCFA)
const toEur = (amount: number, currency: 'EUR' | 'XAF') => (currency === 'EUR' ? amount / 100 : amount / XAF_PER_EUR);
const round2 = (x: number) => Math.round(x * 100) / 100;

// Mois au format AAAA-MM (heure du Cameroun) d'un instant
const ymOf = (d: Date) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 7);

@Injectable()
export class BackofficeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly statements: StatementsService,
    private readonly stripe: StripeGateway,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  // ================= Tableau de bord =================

  async overview(now = new Date()) {
    const ym = ymOf(now);
    const from = monthStart(ym);
    const subs = await this.db.select({ status: subscriptions.status, plan: subscriptions.plan }).from(subscriptions);
    const active = subs.filter((s) => s.status === 'ACTIVE' || s.status === 'PAST_DUE');
    const mrr = active.reduce((sum, s) => sum + PLAN_PRICES_EUR[s.plan], 0);
    const paidThisMonth = await this.db
      .select({ amount: payments.amount, currency: payments.currency, kind: payments.kind })
      .from(payments)
      .where(and(eq(payments.status, 'SUCCEEDED'), gte(payments.paidAt, from)));
    const [{ done }] = await this.db
      .select({ done: count() })
      .from(consultations)
      .where(and(eq(consultations.status, 'DONE'), gte(consultations.completedAt, from)));
    const [{ upcoming }] = await this.db
      .select({ upcoming: count() })
      .from(consultations)
      .where(and(eq(consultations.status, 'SCHEDULED'), gte(consultations.scheduledAt, now), lt(consultations.scheduledAt, new Date(now.getTime() + 7 * 24 * H))));
    const [{ urgent }] = await this.db
      .select({ urgent: count() })
      .from(alerts)
      .where(and(eq(alerts.severity, 'URGENT'), isNull(alerts.acknowledgedAt)));
    const [{ waiting }] = await this.db
      .select({ waiting: count() })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.needsHuman, true), isNull(whatsappMessages.handledAt), eq(whatsappMessages.direction, 'IN')));
    const [{ drafts }] = await this.db.select({ drafts: count() }).from(monthlyReports).where(isNull(monthlyReports.sentAt));
    const delays = await this.delays(now);
    return {
      month: ym,
      subscribers: {
        active: active.length,
        essentiel: active.filter((s) => s.plan === 'ESSENTIEL').length,
        serenite: active.filter((s) => s.plan === 'SERENITE').length,
        pastDue: subs.filter((s) => s.status === 'PAST_DUE' || s.status === 'SUSPENDED').length,
        pending: subs.filter((s) => s.status === 'PENDING').length,
      },
      mrrEur: mrr,
      revenueThisMonthEur: round2(
        paidThisMonth.filter((p) => p.kind === 'SUBSCRIPTION').reduce((s, p) => s + toEur(p.amount, p.currency), 0),
      ),
      medicationsThisMonthEur: round2(
        paidThisMonth.filter((p) => p.kind === 'MEDICATION').reduce((s, p) => s + toEur(p.amount, p.currency), 0),
      ),
      consultationsDone: done,
      consultationsNext7Days: upcoming,
      urgentAlerts: urgent,
      whatsappWaiting: waiting,
      reportsToReview: drafts,
      delays,
    };
  }

  // ================= Retards =================

  // Tout ce qui attend trop longtemps, du plus ancien au plus récent
  async delays(now = new Date()): Promise<Delay[]> {
    const before = (hours: number) => new Date(now.getTime() - hours * H);
    const out: Delay[] = [];
    const name = (p: { first: string; last: string }) => `${p.first} ${p.last}`;
    const doc = alias(users, 'doc');

    const cons = await this.db
      .select({ c: consultations, first: patients.firstName, last: patients.lastName, docLast: doc.lastName })
      .from(consultations)
      .innerJoin(patients, eq(patients.id, consultations.patientId))
      .innerJoin(doc, eq(doc.id, consultations.doctorId))
      .where(and(eq(consultations.status, 'SCHEDULED'), lt(consultations.scheduledAt, before(2))));
    for (const x of cons) {
      out.push({ kind: 'consultation', severity: 'high', label: `Consultation du ${fmtLocal(x.c.scheduledAt)} non clôturée`, patientId: x.c.patientId, patientName: name(x), who: `Dr ${x.docLast}`, since: x.c.scheduledAt });
    }

    const visits = await this.db
      .select({ v: homeVisits, first: patients.firstName, last: patients.lastName, nurse: users.firstName })
      .from(homeVisits)
      .innerJoin(patients, eq(patients.id, homeVisits.patientId))
      .innerJoin(users, eq(users.id, homeVisits.nurseId))
      .where(and(eq(homeVisits.status, 'SCHEDULED'), lt(homeVisits.scheduledAt, before(4))));
    for (const x of visits) {
      out.push({ kind: 'visit', severity: 'medium', label: `Visite du ${fmtLocal(x.v.scheduledAt)} non clôturée`, patientId: x.v.patientId, patientName: name(x), who: x.nurse, since: x.v.scheduledAt });
    }

    const pharma = alias(partnerProfiles, 'pharma');
    const presc = await this.db
      .select({ p: prescriptions, patientId: patients.id, first: patients.firstName, last: patients.lastName, org: pharma.organizationName })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .innerJoin(patients, eq(patients.id, consultations.patientId))
      .leftJoin(pharma, eq(pharma.userId, prescriptions.pharmacyId))
      .where(inArray(prescriptions.status, ['SENT', 'AWAITING_PAYMENT', 'PREPARING']));
    for (const x of presc) {
      const who = x.org ?? 'Pharmacie';
      if (x.p.status === 'SENT' && !x.p.pharmacyId) {
        out.push({ kind: 'prescription', severity: 'high', label: 'Ordonnance sans pharmacie affectée', patientId: x.patientId, patientName: name(x), who: null, since: x.p.createdAt });
      } else if (x.p.status === 'SENT' && x.p.createdAt < before(24)) {
        out.push({ kind: 'prescription', severity: 'medium', label: 'Ordonnance pas encore chiffrée par la pharmacie', patientId: x.patientId, patientName: name(x), who, since: x.p.createdAt });
      } else if (x.p.status === 'AWAITING_PAYMENT' && (x.p.pricedAt ?? x.p.updatedAt) < before(48)) {
        out.push({ kind: 'prescription', severity: 'medium', label: 'Médicaments pas encore payés par la famille', patientId: x.patientId, patientName: name(x), who: null, since: x.p.pricedAt ?? x.p.updatedAt });
      } else if (x.p.status === 'PREPARING' && x.p.updatedAt < before(24)) {
        out.push({ kind: 'prescription', severity: 'high', label: 'Médicaments payés, commande pas encore prête', patientId: x.patientId, patientName: name(x), who, since: x.p.updatedAt });
      }
    }

    const dels = await this.db
      .select({ d: deliveries, patientId: patients.id, first: patients.firstName, last: patients.lastName, courier: users.firstName })
      .from(deliveries)
      .innerJoin(prescriptions, eq(prescriptions.id, deliveries.prescriptionId))
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .innerJoin(patients, eq(patients.id, consultations.patientId))
      .leftJoin(users, eq(users.id, deliveries.courierId))
      .where(inArray(deliveries.status, ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'FAILED']));
    for (const x of dels) {
      const d = x.d;
      if (d.status === 'PENDING') out.push({ kind: 'delivery', severity: 'high', label: 'Livraison sans livreur', patientId: x.patientId, patientName: name(x), who: null, since: d.createdAt });
      else if (d.status === 'FAILED') out.push({ kind: 'delivery', severity: 'high', label: `Livraison en échec : ${d.failureReason ?? ''}`.trim(), patientId: x.patientId, patientName: name(x), who: x.courier, since: d.updatedAt });
      else if (d.status === 'ASSIGNED' && d.createdAt < before(24)) out.push({ kind: 'delivery', severity: 'medium', label: 'Colis pas encore récupéré en pharmacie', patientId: x.patientId, patientName: name(x), who: x.courier, since: d.createdAt });
      else if (d.status === 'IN_TRANSIT' && (d.pickedUpAt ?? d.updatedAt) < before(6)) out.push({ kind: 'delivery', severity: 'medium', label: 'Colis en route depuis plus de 6 h', patientId: x.patientId, patientName: name(x), who: x.courier, since: d.pickedUpAt ?? d.updatedAt });
    }

    const labs = await this.db
      .select({ l: labRequests, first: patients.firstName, last: patients.lastName, org: partnerProfiles.organizationName })
      .from(labRequests)
      .innerJoin(patients, eq(patients.id, labRequests.patientId))
      .leftJoin(partnerProfiles, eq(partnerProfiles.userId, labRequests.labId))
      .where(inArray(labRequests.status, ['REQUESTED', 'SAMPLED', 'RESULTS_AVAILABLE']));
    for (const x of labs) {
      const l = x.l;
      if (l.status === 'REQUESTED' && !l.labId) out.push({ kind: 'lab', severity: 'medium', label: 'Analyses sans laboratoire affecté', patientId: l.patientId, patientName: name(x), who: null, since: l.createdAt });
      else if (l.status === 'REQUESTED' && l.createdAt < before(5 * 24)) out.push({ kind: 'lab', severity: 'medium', label: 'Prise de sang pas encore faite', patientId: l.patientId, patientName: name(x), who: x.org, since: l.createdAt });
      else if (l.status === 'SAMPLED' && (l.sampledAt ?? l.updatedAt) < before(4 * 24)) out.push({ kind: 'lab', severity: 'medium', label: 'Résultats d’analyses en attente', patientId: l.patientId, patientName: name(x), who: x.org, since: l.sampledAt ?? l.updatedAt });
      else if (l.status === 'RESULTS_AVAILABLE' && !l.reviewedAt && (l.resultsAt ?? l.updatedAt) < before(48)) out.push({ kind: 'lab', severity: l.resultsAbnormal ? 'high' : 'medium', label: `Résultats${l.resultsAbnormal ? ' anormaux' : ''} pas encore lus par le médecin`, patientId: l.patientId, patientName: name(x), who: null, since: l.resultsAt ?? l.updatedAt });
    }

    const urgent = await this.db
      .select({ a: alerts, first: patients.firstName, last: patients.lastName })
      .from(alerts)
      .innerJoin(patients, eq(patients.id, alerts.patientId))
      .where(and(eq(alerts.severity, 'URGENT'), isNull(alerts.acknowledgedAt), lt(alerts.createdAt, before(2))));
    for (const x of urgent) out.push({ kind: 'alert', severity: 'high', label: `Alerte urgente non traitée : ${x.a.message}`, patientId: x.a.patientId, patientName: name(x), who: null, since: x.a.createdAt });

    const noTeam = await this.db
      .select({ p: patients, since: subscriptions.updatedAt })
      .from(patients)
      .innerJoin(subscriptions, eq(subscriptions.patientId, patients.id))
      .where(and(inArray(subscriptions.status, ['ACTIVE', 'PAST_DUE']), or(isNull(patients.doctorId), isNull(patients.pharmacyId))));
    for (const x of noTeam) {
      out.push({ kind: 'team', severity: 'high', label: !x.p.doctorId ? 'Abonné sans médecin' : 'Abonné sans pharmacie', patientId: x.p.id, patientName: `${x.p.firstName} ${x.p.lastName}`, who: null, since: x.since });
    }

    const wa = await this.db
      .select({ m: whatsappMessages, first: patients.firstName, last: patients.lastName })
      .from(whatsappMessages)
      .leftJoin(patients, eq(patients.id, whatsappMessages.patientId))
      .where(and(eq(whatsappMessages.needsHuman, true), isNull(whatsappMessages.handledAt), eq(whatsappMessages.direction, 'IN'), lt(whatsappMessages.createdAt, before(4))));
    for (const x of wa) {
      out.push({ kind: 'whatsapp', severity: 'medium', label: `Message WhatsApp sans réponse : « ${x.m.body.slice(0, 60)} »`, patientId: x.m.patientId, patientName: x.first ? `${x.first} ${x.last}` : `+${x.m.phone}`, who: null, since: x.m.createdAt });
    }

    return out.sort((a, b) => (a.severity === b.severity ? a.since.getTime() - b.since.getTime() : a.severity === 'high' ? -1 : 1));
  }

  // ================= Parents suivis =================

  async patients(q: { search?: string; city?: string; status?: string }) {
    const doc = alias(users, 'doc');
    const nurse = alias(users, 'nurse');
    const owner = alias(users, 'owner');
    const pharma = alias(partnerProfiles, 'pharma');
    const lab = alias(partnerProfiles, 'labp');
    const where: SQL[] = [];
    if (q.city && (CITIES as readonly string[]).includes(q.city)) where.push(eq(patients.city, q.city as City));
    if (q.status === 'NONE') where.push(isNull(subscriptions.id));
    else if (q.status) where.push(eq(subscriptions.status, q.status as never));
    if (q.search?.trim()) {
      const like = `%${q.search.trim()}%`;
      where.push(or(ilike(patients.firstName, like), ilike(patients.lastName, like), ilike(patients.whatsappPhone, like), ilike(owner.email, like), ilike(owner.lastName, like))!);
    }
    const rows = await this.db
      .select({
        p: patients,
        sub: subscriptions,
        owner: { id: owner.id, firstName: owner.firstName, lastName: owner.lastName, email: owner.email, phone: owner.phone },
        doctor: doc.lastName,
        nurse: nurse.firstName,
        pharmacy: pharma.organizationName,
        lab: lab.organizationName,
      })
      .from(patients)
      .innerJoin(owner, eq(owner.id, patients.familyUserId))
      .leftJoin(subscriptions, eq(subscriptions.patientId, patients.id))
      .leftJoin(doc, eq(doc.id, patients.doctorId))
      .leftJoin(nurse, eq(nurse.id, patients.nurseId))
      .leftJoin(pharma, eq(pharma.userId, patients.pharmacyId))
      .leftJoin(lab, eq(lab.userId, patients.labId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(patients.createdAt))
      .limit(300);
    const ids = rows.map((r) => r.p.id);
    const next = ids.length
      ? await this.db
          .select({ patientId: consultations.patientId, at: sql<Date>`min(${consultations.scheduledAt})` })
          .from(consultations)
          .where(and(inArray(consultations.patientId, ids), eq(consultations.status, 'SCHEDULED')))
          .groupBy(consultations.patientId)
      : [];
    const nextBy = new Map(next.map((n) => [n.patientId, n.at]));
    return rows.map((r) => ({
      id: r.p.id,
      name: `${r.p.firstName} ${r.p.lastName}`,
      city: r.p.city,
      district: r.p.district,
      whatsappPhone: r.p.whatsappPhone,
      conditions: r.p.conditions,
      consentGiven: Boolean(r.p.consentGivenAt),
      whatsappOptOut: Boolean(r.p.whatsappOptOutAt),
      createdAt: r.p.createdAt,
      family: r.owner,
      subscription: r.sub
        ? { status: r.sub.status, plan: r.sub.plan, method: r.sub.paymentMethod, periodEnd: r.sub.currentPeriodEnd, cancelAtPeriodEnd: r.sub.cancelAtPeriodEnd }
        : null,
      team: {
        doctorId: r.p.doctorId,
        nurseId: r.p.nurseId,
        pharmacyId: r.p.pharmacyId,
        labId: r.p.labId,
        doctor: r.doctor ? `Dr ${r.doctor}` : null,
        nurse: r.nurse,
        pharmacy: r.pharmacy,
        lab: r.lab,
      },
      nextConsultation: nextBy.get(r.p.id) ?? null,
    }));
  }

  // Partenaires vérifiés et actifs d'une ville, avec le nombre de parents qu'ils suivent déjà
  async partners(city: string, role: string) {
    if (!(CITIES as readonly string[]).includes(city)) throw new BadRequestException('Ville inconnue');
    const col = { DOCTOR: patients.doctorId, NURSE: patients.nurseId, PHARMACY: patients.pharmacyId, LAB: patients.labId, COURIER: null }[role as 'DOCTOR'];
    if (col === undefined) throw new BadRequestException('Rôle inconnu');
    const list = await this.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, org: partnerProfiles.organizationName })
      .from(users)
      .innerJoin(partnerProfiles, eq(partnerProfiles.userId, users.id))
      .where(and(eq(users.role, role as Role), eq(users.isActive, true), isNotNull(partnerProfiles.verifiedAt), eq(partnerProfiles.city, city as City)))
      .orderBy(asc(users.lastName));
    const loads = col
      ? await this.db.select({ id: col, n: count() }).from(patients).where(isNotNull(col)).groupBy(col)
      : [];
    const by = new Map(loads.map((l) => [l.id, Number(l.n)]));
    return list.map((p) => ({
      id: p.id,
      name:
        role === 'PHARMACY' || role === 'LAB'
          ? (p.org ?? `${p.firstName} ${p.lastName}`)
          : `${role === 'DOCTOR' ? 'Dr ' : ''}${p.firstName} ${p.lastName}${p.org ? ` (${p.org})` : ''}`,
      patients: by.get(p.id) ?? 0,
    }));
  }

  // ================= Paiements =================

  async payments(q: { status?: string; kind?: string; month?: string; search?: string }) {
    const where: SQL[] = [];
    if (q.status) where.push(eq(payments.status, q.status as never));
    if (q.kind) where.push(eq(payments.kind, q.kind as never));
    if (q.month) where.push(and(gte(payments.createdAt, monthStart(q.month)), lt(payments.createdAt, monthStart(nextMonth(q.month))))!);
    if (q.search?.trim()) {
      const like = `%${q.search.trim()}%`;
      where.push(or(ilike(users.email, like), ilike(users.lastName, like), ilike(patients.firstName, like), ilike(payments.invoiceNumber, like))!);
    }
    const rows = await this.db
      .select({ p: payments, email: users.email, payer: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, patient: sql<string>`${patients.firstName} || ' ' || ${patients.lastName}` })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.payerId))
      .innerJoin(patients, eq(patients.id, payments.patientId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(300);
    return rows.map((r) => ({
      id: r.p.id,
      createdAt: r.p.createdAt,
      paidAt: r.p.paidAt,
      kind: r.p.kind,
      method: r.p.method,
      provider: r.p.provider,
      status: r.p.status,
      amount: r.p.amount,
      currency: r.p.currency,
      amountEur: round2(toEur(r.p.amount, r.p.currency)),
      invoiceNumber: r.p.invoiceNumber,
      failureReason: r.p.failureReason,
      refundedAt: r.p.refundedAt,
      refundReason: r.p.refundReason,
      refundRef: r.p.refundRef,
      payer: r.payer,
      email: r.email,
      patient: r.patient,
      patientId: r.p.patientId,
    }));
  }

  // Abonnements en retard de paiement ou suspendus, et médicaments chiffrés mais non payés
  async unpaid(now = new Date()) {
    const subs = await this.db
      .select({ s: subscriptions, first: patients.firstName, last: patients.lastName, payer: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, email: users.email, phone: users.phone })
      .from(subscriptions)
      .innerJoin(patients, eq(patients.id, subscriptions.patientId))
      .innerJoin(users, eq(users.id, subscriptions.payerId))
      .where(inArray(subscriptions.status, ['PAST_DUE', 'SUSPENDED']))
      .orderBy(asc(subscriptions.currentPeriodEnd));
    const meds = await this.db
      .select({ p: prescriptions, patientId: patients.id, first: patients.firstName, last: patients.lastName, payer: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, email: users.email })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .innerJoin(patients, eq(patients.id, consultations.patientId))
      .innerJoin(users, eq(users.id, patients.familyUserId))
      .where(and(eq(prescriptions.status, 'AWAITING_PAYMENT'), lt(prescriptions.updatedAt, new Date(now.getTime() - 48 * H))));
    return {
      subscriptions: subs.map((r) => ({
        patientId: r.s.patientId,
        patient: `${r.first} ${r.last}`,
        status: r.s.status,
        plan: r.s.plan,
        method: r.s.paymentMethod,
        periodEnd: r.s.currentPeriodEnd,
        payer: r.payer,
        email: r.email,
        phone: r.phone,
      })),
      medications: meds.map((r) => ({ prescriptionId: r.p.id, patientId: r.patientId, patient: `${r.first} ${r.last}`, priceXaf: r.p.priceXaf, since: r.p.pricedAt ?? r.p.updatedAt, payer: r.payer, email: r.email })),
    };
  }

  // Carte : remboursé chez Stripe. Mobile Money : l'équipe rembourse depuis le portail Tranzak, puis note la référence ici.
  async refund(adminId: string, paymentId: string, reason: string, reference?: string) {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) throw new NotFoundException('Paiement introuvable');
    if (p.status !== 'SUCCEEDED') throw new ConflictException('Seul un paiement réussi peut être remboursé');
    let ref = reference?.trim() || null;
    if (p.provider === 'STRIPE' && !ref) {
      if (!p.providerRef) throw new BadRequestException('Référence Stripe absente : remboursez depuis le tableau de bord Stripe et notez la référence');
      ref = await this.stripe.refund(p.providerRef);
    }
    if (!ref) throw new BadRequestException('Indiquez la référence du remboursement Mobile Money effectué sur le portail Tranzak');
    const [done] = await this.db
      .update(payments)
      .set({ status: 'REFUNDED', refundedAt: new Date(), refundReason: reason.trim(), refundRef: ref, refundedById: adminId })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'SUCCEEDED')))
      .returning();
    if (!done) throw new ConflictException('Ce paiement a déjà été remboursé');
    await this.audit.log(adminId, 'payment.refund', 'Payment', paymentId);
    const amount = p.currency === 'EUR' ? `${(p.amount / 100).toFixed(2).replace('.', ',')} €` : `${p.amount.toLocaleString('fr-FR')} FCFA`;
    await this.notify.user(
      p.payerId,
      `Remboursement de ${amount}`,
      `Nous vous avons remboursé ${amount}${p.invoiceNumber ? ` (facture ${p.invoiceNumber})` : ''}.\nMotif : ${reason.trim()}\n` +
        (p.provider === 'STRIPE' ? 'Le montant apparaîtra sur votre compte sous 5 à 10 jours.' : 'Le montant a été renvoyé sur votre compte Mobile Money.'),
    );
    return { ok: true, refundRef: ref };
  }

  // ================= Indicateurs du test =================

  async metrics(months = 6, now = new Date()) {
    const n = Math.min(Math.max(months, 1), 24);
    const list: string[] = [];
    let ym = ymOf(now);
    for (let i = 0; i < n; i++) {
      list.unshift(ym);
      ym = previousMonth(monthStart(ym));
    }
    const start = monthStart(list[0]);

    const allPatients = await this.db.select({ id: patients.id, createdAt: patients.createdAt }).from(patients);
    const subPays = await this.db
      .select({ patientId: payments.patientId, paidAt: payments.paidAt, periodStart: payments.periodStart, periodEnd: payments.periodEnd, amount: payments.amount, currency: payments.currency, kind: payments.kind })
      .from(payments)
      .where(eq(payments.status, 'SUCCEEDED'));
    const subscriptionPays = subPays.filter((p) => p.kind === 'SUBSCRIPTION');

    // Activation = premier abonnement payé
    const activation = new Map<string, Date>();
    for (const p of subscriptionPays) {
      const prev = activation.get(p.patientId);
      if (p.paidAt && (!prev || p.paidAt < prev)) activation.set(p.patientId, p.paidAt);
    }
    // Suivi actif à un instant = une période payée le couvre
    const activeAt = (t: Date) =>
      new Set(subscriptionPays.filter((p) => p.periodStart && p.periodEnd && p.periodStart <= t && t < p.periodEnd).map((p) => p.patientId)).size;
    const activeSetAt = (t: Date) =>
      new Set(subscriptionPays.filter((p) => p.periodStart && p.periodEnd && p.periodStart <= t && t < p.periodEnd).map((p) => p.patientId));

    const waRows = await this.db
      .select({ at: whatsappMessages.createdAt })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.direction, 'OUT'), inArray(whatsappMessages.status, ['SENT', 'DELIVERED', 'READ']), gte(whatsappMessages.createdAt, start)));
    const rates = partnerRates();
    const consRows = await this.db
      .select({ at: consultations.completedAt, kind: consultations.kind })
      .from(consultations)
      .where(and(eq(consultations.status, 'DONE'), gte(consultations.completedAt, start)));
    const visitRows = await this.db.select({ at: homeVisits.completedAt }).from(homeVisits).where(and(eq(homeVisits.status, 'DONE'), gte(homeVisits.completedAt, start)));
    const delRows = await this.db.select({ at: deliveries.deliveredAt, attempts: deliveries.attempts }).from(deliveries).where(and(eq(deliveries.status, 'DELIVERED'), gte(deliveries.deliveredAt, start)));
    const sampRows = await this.db
      .select({ at: labRequests.sampledAt })
      .from(labRequests)
      .where(and(eq(labRequests.appointmentMode, 'HOME_SAMPLING'), isNotNull(labRequests.sampledAt), gte(labRequests.sampledAt, start)));

    const inYm = (d: Date | null, m: string) => Boolean(d) && ymOf(d!) === m;
    const monthsOut = list.map((m) => {
      const from = monthStart(m);
      const to = monthStart(nextMonth(m));
      const end = to < now ? new Date(to.getTime() - 1) : now;
      const signups = allPatients.filter((p) => p.createdAt >= from && p.createdAt < to);
      const converted = signups.filter((p) => activation.has(p.id)).length;
      const activations = [...activation.values()].filter((d) => d >= from && d < to).length;
      const revenueEur = round2(
        subPays.filter((p) => p.kind === 'SUBSCRIPTION' && inYm(p.paidAt, m)).reduce((s, p) => s + toEur(p.amount, p.currency), 0),
      );
      const partnerCostXaf =
        consRows.filter((c) => inYm(c.at, m)).reduce((s, c) => s + (c.kind === 'INITIAL' ? rates.initialConsultation : rates.consultation), 0) +
        visitRows.filter((v) => inYm(v.at, m)).length * rates.homeVisit +
        delRows.filter((d) => inYm(d.at, m)).reduce((s, d) => s + rates.delivery + d.attempts * rates.failedDelivery, 0) +
        sampRows.filter((x) => inYm(x.at, m)).length * rates.homeSampling;
      const whatsappCostXafTotal = waRows.filter((w) => inYm(w.at, m)).length * whatsappCostXaf();
      const costEur = xafToEur(partnerCostXaf + whatsappCostXafTotal);
      const active = activeAt(end);
      return {
        month: m,
        signups: signups.length,
        conversionRate: signups.length ? Math.round((converted / signups.length) * 100) : null,
        activations,
        activeEnd: active,
        revenueEur,
        partnerCostEur: xafToEur(partnerCostXaf),
        whatsappCostEur: xafToEur(whatsappCostXafTotal),
        marginEur: round2(revenueEur - costEur),
        revenuePerClientEur: active ? round2(revenueEur / active) : null,
        costPerClientEur: active ? round2(costEur / active) : null,
        marginPerClientEur: active ? round2((revenueEur - costEur) / active) : null,
      };
    });

    // Fidélité par mois d'activation : part des parents encore suivis 1, 3 et 6 mois plus tard
    const cohorts = list.map((m) => {
      const members = [...activation.entries()].filter(([, d]) => ymOf(d) === m);
      const at = (k: number) => {
        const anyMember = members[0];
        if (!anyMember) return null;
        const checks = members.map(([id, d]) => {
          const t = new Date(d.getTime() + k * 30.44 * 24 * H);
          return t > now ? null : activeSetAt(t).has(id);
        });
        if (checks.some((c) => c === null)) return null; // trop tôt pour mesurer
        return Math.round((checks.filter(Boolean).length / members.length) * 100);
      };
      return { month: m, size: members.length, m1: at(1), m3: at(3), m6: at(6) };
    });

    return { months: monthsOut, cohorts, rates: { ...rates, whatsappMessage: whatsappCostXaf() } };
  }

  // ================= Journal des accès =================

  async auditLog(q: { action?: string; entity?: string; entityId?: string; actor?: string; from?: string; to?: string; page?: number }) {
    const where: SQL[] = [];
    if (q.action) where.push(ilike(auditLogs.action, `${q.action}%`));
    if (q.entity) where.push(eq(auditLogs.entity, q.entity));
    if (q.entityId && /^[0-9a-f-]{36}$/i.test(q.entityId)) where.push(eq(auditLogs.entityId, q.entityId));
    if (q.actor) where.push(or(ilike(users.email, `%${q.actor}%`), ilike(users.lastName, `%${q.actor}%`))!);
    if (q.from) where.push(gte(auditLogs.createdAt, new Date(q.from)));
    if (q.to) where.push(lt(auditLogs.createdAt, new Date(new Date(q.to).getTime() + 24 * H)));
    const page = Math.max(1, q.page ?? 1);
    const size = 100;
    const rows = await this.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        createdAt: auditLogs.createdAt,
        actorId: auditLogs.actorId,
        actorName: sql<string | null>`${users.firstName} || ' ' || ${users.lastName}`,
        actorEmail: users.email,
        actorRole: users.role,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(size + 1)
      .offset((page - 1) * size);
    return { page, hasMore: rows.length > size, rows: rows.slice(0, size) };
  }
}
