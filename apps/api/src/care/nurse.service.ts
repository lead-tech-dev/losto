import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, ne } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Database, DB } from '../db/db.module';
import { consultations, homeVisits, patients, prescriptions, readings } from '../db/schema';
import { ClinicalAccessService } from './clinical-access.service';
import { CompleteVisitDto } from './dto/care.dto';
import { ReadingsService } from './readings.service';
import { SchedulingService } from './scheduling.service';

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class NurseService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: ClinicalAccessService,
    private readonly readingsSvc: ReadingsService,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditService,
  ) {}

  async visits(nurseId: string, from: Date, to: Date) {
    const rows = await this.db
      .select({
        v: homeVisits,
        firstName: patients.firstName,
        lastName: patients.lastName,
        phone: patients.whatsappPhone,
        district: patients.district,
        city: patients.city,
        addressDetails: patients.addressDetails,
      })
      .from(homeVisits)
      .innerJoin(patients, eq(patients.id, homeVisits.patientId))
      .where(and(eq(homeVisits.nurseId, nurseId), gte(homeVisits.scheduledAt, from), lt(homeVisits.scheduledAt, to)))
      .orderBy(asc(homeVisits.scheduledAt));
    return rows.map((r) => ({
      id: r.v.id,
      patientId: r.v.patientId,
      scheduledAt: r.v.scheduledAt,
      status: r.v.status,
      note: r.v.note,
      patient: {
        name: `${r.firstName} ${r.lastName}`,
        phone: r.phone,
        address: `${r.district}, ${r.city === 'DOUALA' ? 'Douala' : r.city === 'YAOUNDE' ? 'Yaoundé' : ''}${r.addressDetails ? ` · ${r.addressDetails}` : ''}`,
      },
    }));
  }

  // Ce dont l'infirmier(e) a besoin pour la visite : pas d'antécédents détaillés ni de comptes rendus
  async visitDetail(nurseId: string, visitId: string) {
    const { visit, patient } = await this.access.visitForNurse(nurseId, visitId);
    await this.audit.log(nurseId, 'clinical.read', 'Patient', patient.id);
    const [lastPrescription] = await this.db
      .select({ items: prescriptions.items, createdAt: prescriptions.createdAt })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .where(and(eq(consultations.patientId, patient.id), ne(prescriptions.status, 'CANCELED')))
      .orderBy(desc(prescriptions.createdAt))
      .limit(1);
    const recent = await this.db
      .select()
      .from(readings)
      .where(and(eq(readings.patientId, patient.id), gte(readings.measuredAt, new Date(Date.now() - 90 * DAY))))
      .orderBy(desc(readings.measuredAt))
      .limit(10);
    return {
      visit: { id: visit.id, scheduledAt: visit.scheduledAt, status: visit.status, note: visit.note, treatmentChecked: visit.treatmentChecked },
      patient: {
        id: patient.id,
        name: `${patient.firstName} ${patient.lastName}`,
        birthYear: patient.birthYear,
        phone: patient.whatsappPhone,
        address: `${patient.district}${patient.addressDetails ? ` · ${patient.addressDetails}` : ''}`,
        conditions: patient.conditions,
        notes: patient.notes,
      },
      treatment: lastPrescription
        ? { items: lastPrescription.items, since: lastPrescription.createdAt }
        : patient.currentTreatments
          ? { declared: patient.currentTreatments }
          : null,
      recentReadings: recent.map((r) => ({ type: r.type, systolic: r.systolic, diastolic: r.diastolic, value: r.value === null ? null : Number(r.value), measuredAt: r.measuredAt })),
    };
  }

  // Fin de visite : relevés (contrôlés et comparés aux seuils), vérification du traitement, note
  async complete(nurseId: string, visitId: string, dto: CompleteVisitDto) {
    const { visit, patient } = await this.access.visitForNurse(nurseId, visitId);
    if (visit.status !== 'SCHEDULED') throw new ConflictException('Cette visite est déjà clôturée');
    this.readingsSvc.validate(dto.readings);
    const created = await this.db.transaction(async (tx) => {
      const list = await this.readingsSvc.record(tx, patient, dto.readings, { source: 'NURSE', recordedById: nurseId, homeVisitId: visit.id });
      await tx
        .update(homeVisits)
        .set({ status: 'DONE', treatmentChecked: dto.treatmentChecked, note: dto.note.trim(), completedAt: new Date() })
        .where(eq(homeVisits.id, visit.id));
      return list;
    });
    await this.audit.log(nurseId, 'visit.complete', 'HomeVisit', visit.id);
    await this.readingsSvc.emailDoctor(patient, created);
    // Les alertes reviennent à l'écran de l'infirmier(e) avec la conduite à tenir
    return { alerts: created };
  }

  async missed(nurseId: string, visitId: string, reason: string) {
    const { visit, patient } = await this.access.visitForNurse(nurseId, visitId);
    if (visit.status !== 'SCHEDULED') throw new ConflictException('Cette visite est déjà clôturée');
    await this.db.update(homeVisits).set({ status: 'MISSED', missedReason: reason.trim() }).where(eq(homeVisits.id, visit.id));
    await this.audit.log(nurseId, 'visit.missed', 'HomeVisit', visit.id);
    const next = await this.scheduling.scheduleVisit(patient, new Date(Date.now() + DAY));
    return { rescheduledTo: next?.scheduledAt ?? null };
  }
}
