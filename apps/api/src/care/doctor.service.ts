import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import {
  alerts,
  consultations,
  homeVisits,
  labRequests,
  Patient,
  patients,
  prescriptions,
  readings,
  referrals,
  subscriptions,
  users,
} from '../db/schema';
import { MailerService } from '../mail/mailer.service';
import { fmtLocal } from './care-time';
import { ClinicalAccessService } from './clinical-access.service';
import { CompleteConsultationDto } from './dto/care.dto';
import { ReadingsService } from './readings.service';
import { SchedulingService } from './scheduling.service';
import { newVideoUrl } from './video';

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class DoctorService {
  private readonly logger = new Logger(DoctorService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: ClinicalAccessService,
    private readonly scheduling: SchedulingService,
    private readonly readingsSvc: ReadingsService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  // Consultations entre deux dates, avec le nom du patient
  async agenda(doctorId: string, from: Date, to: Date) {
    const rows = await this.db
      .select({
        c: consultations,
        firstName: patients.firstName,
        lastName: patients.lastName,
        phone: patients.whatsappPhone,
        conditions: patients.conditions,
      })
      .from(consultations)
      .innerJoin(patients, eq(patients.id, consultations.patientId))
      .where(and(eq(consultations.doctorId, doctorId), gte(consultations.scheduledAt, from), lt(consultations.scheduledAt, to)))
      .orderBy(asc(consultations.scheduledAt));
    return rows.map((r) => ({
      ...consultationView(r.c),
      patient: { id: r.c.patientId, name: `${r.firstName} ${r.lastName}`, phone: r.phone, conditions: r.conditions },
    }));
  }

  async patients(doctorId: string) {
    const list = await this.db.select().from(patients).where(eq(patients.doctorId, doctorId)).orderBy(asc(patients.lastName));
    if (!list.length) return [];
    const ids = list.map((p) => p.id);
    const subs = await this.db.select().from(subscriptions).where(inArray(subscriptions.patientId, ids));
    const openAlerts = await this.db
      .select({ patientId: alerts.patientId, n: count() })
      .from(alerts)
      .where(and(inArray(alerts.patientId, ids), isNull(alerts.acknowledgedAt)))
      .groupBy(alerts.patientId);
    const next = await this.db
      .select({ patientId: consultations.patientId, at: consultations.scheduledAt })
      .from(consultations)
      .where(and(inArray(consultations.patientId, ids), eq(consultations.status, 'SCHEDULED')))
      .orderBy(asc(consultations.scheduledAt));
    return list.map((p) => ({
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      birthYear: p.birthYear,
      city: p.city,
      district: p.district,
      conditions: p.conditions,
      plan: subs.find((s) => s.patientId === p.id)?.plan ?? null,
      subscriptionStatus: subs.find((s) => s.patientId === p.id)?.status ?? null,
      openAlerts: openAlerts.find((a) => a.patientId === p.id)?.n ?? 0,
      nextConsultation: next.find((n) => n.patientId === p.id)?.at ?? null,
    }));
  }

  // Dossier complet du patient, pour le médecin affecté
  async patientFile(doctorId: string, patientId: string) {
    const p = await this.access.patientForDoctor(doctorId, patientId);
    await this.audit.log(doctorId, 'clinical.read', 'Patient', patientId);
    const since = new Date(Date.now() - 365 * DAY);
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.patientId, patientId));
    const [cons, presc, labs, refs, visits, reads, openAlerts] = await Promise.all([
      this.db.select().from(consultations).where(eq(consultations.patientId, patientId)).orderBy(desc(consultations.scheduledAt)),
      this.db
        .select({ p: prescriptions })
        .from(prescriptions)
        .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
        .where(eq(consultations.patientId, patientId))
        .orderBy(desc(prescriptions.createdAt)),
      this.db.select().from(labRequests).where(eq(labRequests.patientId, patientId)).orderBy(desc(labRequests.createdAt)),
      this.db.select().from(referrals).where(eq(referrals.patientId, patientId)).orderBy(desc(referrals.createdAt)),
      this.db.select().from(homeVisits).where(eq(homeVisits.patientId, patientId)).orderBy(desc(homeVisits.scheduledAt)),
      this.db
        .select()
        .from(readings)
        .where(and(eq(readings.patientId, patientId), gte(readings.measuredAt, since)))
        .orderBy(asc(readings.measuredAt)),
      this.db.select().from(alerts).where(and(eq(alerts.patientId, patientId), isNull(alerts.acknowledgedAt))).orderBy(desc(alerts.createdAt)),
    ]);
    return {
      patient: {
        id: p.id,
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
        plan: sub?.plan ?? null,
        subscriptionStatus: sub?.status ?? null,
      },
      consultations: cons.map(consultationView),
      prescriptions: presc.map((r) => ({ id: r.p.id, items: r.p.items, status: r.p.status, createdAt: r.p.createdAt, consultationId: r.p.consultationId })),
      labRequests: labs,
      referrals: refs,
      homeVisits: visits.map((v) => ({ id: v.id, scheduledAt: v.scheduledAt, status: v.status, note: v.note, treatmentChecked: v.treatmentChecked })),
      readings: reads.map((r) => ({ id: r.id, type: r.type, systolic: r.systolic, diastolic: r.diastolic, value: r.value === null ? null : Number(r.value), measuredAt: r.measuredAt, source: r.source })),
      openAlerts,
    };
  }

  // Le médecin termine la consultation : compte rendu, relevés, ordonnance, analyses, orientation.
  async complete(doctorId: string, consultationId: string, dto: CompleteConsultationDto) {
    const { consultation: c, patient } = await this.access.consultationForDoctor(doctorId, consultationId);
    if (c.status !== 'SCHEDULED') throw new ConflictException('Cette consultation est déjà clôturée');
    if (c.scheduledAt.getTime() > Date.now() + 60 * 60 * 1000) {
      throw new BadRequestException('La consultation n’a pas encore eu lieu');
    }
    if (dto.readings) this.readingsSvc.validate(dto.readings);
    if (dto.prescription?.length && !patient.pharmacyId) {
      throw new ConflictException('Aucune pharmacie partenaire n’est affectée à ce patient : prévenez l’équipe');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(consultations)
        .set({ status: 'DONE', summary: dto.summary.trim(), completedAt: new Date() })
        .where(eq(consultations.id, c.id));
      if (dto.readings?.length) {
        await this.readingsSvc.record(tx, patient, dto.readings, { source: 'DOCTOR', recordedById: doctorId, consultationId: c.id });
      }
      if (dto.prescription?.length) {
        await tx.insert(prescriptions).values({ consultationId: c.id, pharmacyId: patient.pharmacyId, items: dto.prescription, status: 'SENT' });
      }
      if (dto.labs?.tests.length) {
        await tx.insert(labRequests).values({ patientId: patient.id, consultationId: c.id, requestedById: doctorId, tests: dto.labs.tests, note: dto.labs.note });
      }
      if (dto.referral) {
        await tx.insert(referrals).values({ patientId: patient.id, consultationId: c.id, doctorId, ...dto.referral, familyNotifiedAt: new Date() });
      }
    });
    await this.audit.log(doctorId, 'consultation.complete', 'Consultation', c.id);

    const parts = [`Le compte rendu de la consultation de ${patient.firstName} est disponible dans votre espace.`];
    if (dto.prescription?.length) parts.push('Une ordonnance a été envoyée à la pharmacie ; vous recevrez son prix à valider.');
    if (dto.labs?.tests.length) parts.push(`Analyses demandées : ${dto.labs.tests.join(', ')}.`);
    if (dto.referral) {
      const urgent = dto.referral.urgency !== 'ROUTINE';
      parts.push(
        `${urgent ? 'IMPORTANT : ' : ''}le médecin oriente ${patient.firstName} vers : ${dto.referral.destination}` +
          `${dto.referral.urgency === 'EMERGENCY' ? ', en urgence, dès aujourd’hui' : dto.referral.urgency === 'URGENT' ? ', dans les prochains jours' : ''}.\n` +
          `Motif : ${dto.referral.reason}`,
      );
    }
    await this.notifyFamily(
      patient,
      dto.referral && dto.referral.urgency !== 'ROUTINE'
        ? `Important : ${patient.firstName} doit consulter ${dto.referral.destination}`
        : `Compte rendu de la consultation de ${patient.firstName}`,
      `${parts.join('\n\n')}\n\n${appUrl(`/parents/${patient.id}`)}`,
    );
    return this.patientFile(doctorId, patient.id);
  }

  // Parent injoignable : consultation marquée manquée et replacée au prochain créneau libre
  async missed(doctorId: string, consultationId: string, reason: string) {
    const { consultation: c, patient } = await this.access.consultationForDoctor(doctorId, consultationId);
    if (c.status !== 'SCHEDULED') throw new ConflictException('Cette consultation est déjà clôturée');
    await this.db.update(consultations).set({ status: 'MISSED', missedReason: reason.trim() }).where(eq(consultations.id, c.id));
    await this.audit.log(doctorId, 'consultation.missed', 'Consultation', c.id);
    const next = await this.scheduling.scheduleConsultation(patient, c.kind, new Date(Date.now() + DAY));
    return { rescheduledTo: next?.scheduledAt ?? null };
  }

  async reschedule(doctorId: string, consultationId: string, at: Date) {
    const { consultation: c, patient } = await this.access.consultationForDoctor(doctorId, consultationId);
    if (c.status !== 'SCHEDULED') throw new ConflictException('Cette consultation est déjà clôturée');
    if (at.getTime() < Date.now()) throw new BadRequestException('Choisissez une date à venir');
    // Le créneau actuel de cette consultation ne compte pas comme occupé
    if (!(await this.scheduling.isFree(doctorId, at, c.durationMinutes, c.id))) {
      throw new ConflictException('Ce créneau n’est plus libre ou hors de vos disponibilités');
    }
    await this.db.update(consultations).set({ scheduledAt: at }).where(eq(consultations.id, c.id));
    await this.audit.log(doctorId, 'consultation.reschedule', 'Consultation', c.id);
    await this.notifyFamily(
      patient,
      `Consultation de ${patient.firstName} déplacée`,
      `La consultation de ${patient.firstName} est déplacée au ${fmtLocal(at)} (heure du Cameroun).`,
    );
    return { scheduledAt: at };
  }

  async slots(doctorId: string, minutes = 20) {
    return this.scheduling.nextFreeSlots(doctorId, new Date(Date.now() + 60 * 60 * 1000), minutes, 10);
  }

  // Consultation en plus (Sérénité, ou suivi rapproché décidé par le médecin)
  async extra(doctorId: string, patientId: string, at?: Date, mode?: 'VIDEO' | 'PHONE') {
    const patient = await this.access.patientForDoctor(doctorId, patientId);
    if (!at) {
      const c = await this.scheduling.scheduleConsultation(patient, 'EXTRA', new Date(Date.now() + 60 * 60 * 1000));
      if (!c) throw new ConflictException('Aucun créneau libre dans vos disponibilités');
      return consultationView(c);
    }
    if (!(await this.scheduling.isFree(doctorId, at, 20))) {
      throw new ConflictException('Ce créneau n’est pas libre ou hors de vos disponibilités');
    }
    const m = mode ?? (patient.hasSmartphone ? 'VIDEO' : 'PHONE');
    const [c] = await this.db
      .insert(consultations)
      .values({ patientId, doctorId, scheduledAt: at, kind: 'EXTRA', mode: m, videoUrl: m === 'VIDEO' ? newVideoUrl() : null })
      .returning();
    await this.notifyFamily(patient, `Consultation supplémentaire pour ${patient.firstName}`, `Le médecin a prévu une consultation le ${fmtLocal(at)} (heure du Cameroun).`);
    return consultationView(c);
  }

  async openAlerts(doctorId: string) {
    return this.db
      .select({ a: alerts, firstName: patients.firstName, lastName: patients.lastName })
      .from(alerts)
      .innerJoin(patients, eq(patients.id, alerts.patientId))
      .where(and(eq(patients.doctorId, doctorId), isNull(alerts.acknowledgedAt)))
      .orderBy(desc(alerts.createdAt))
      .then((rows) => rows.map((r) => ({ ...r.a, patientName: `${r.firstName} ${r.lastName}` })));
  }

  async acknowledge(doctorId: string, alertId: string, note?: string) {
    const [a] = await this.db.select().from(alerts).where(eq(alerts.id, alertId)).limit(1);
    if (!a) throw new BadRequestException('Alerte introuvable');
    await this.access.patientForDoctor(doctorId, a.patientId);
    await this.db
      .update(alerts)
      .set({ acknowledgedAt: new Date(), acknowledgedById: doctorId, acknowledgeNote: note?.trim() || null })
      .where(eq(alerts.id, alertId));
    await this.audit.log(doctorId, 'alert.ack', 'Alert', alertId);
    return { ok: true };
  }

  private async notifyFamily(patient: Patient, subject: string, text: string) {
    const [owner] = await this.db.select().from(users).where(eq(users.id, patient.familyUserId));
    if (!owner) return;
    await this.mailer
      .send({ to: owner.email, subject, text: `Bonjour ${owner.firstName},\n\n${text}\n\nL’équipe Proche Santé` })
      .catch((e) => this.logger.error(`E-mail famille : ${e.message}`));
  }
}

export function consultationView(c: typeof consultations.$inferSelect) {
  return {
    id: c.id,
    patientId: c.patientId,
    scheduledAt: c.scheduledAt,
    durationMinutes: c.durationMinutes,
    kind: c.kind,
    mode: c.mode,
    status: c.status,
    videoUrl: c.videoUrl,
    summary: c.summary,
    missedReason: c.missedReason,
    completedAt: c.completedAt,
  };
}
