import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNotNull, ne } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Database, DB } from '../db/db.module';
import {
  consultations,
  deliveries,
  homeVisits,
  labRequests,
  monthlyReports,
  referrals,
  prescriptions,
  readings,
  ReadingType,
  READING_TYPES,
  users,
} from '../db/schema';
import { PatientAccessService } from './patient-access.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// Ce que la famille voit du suivi médical de son parent. Les données sont écrites par les modules 4 à 6
// (médecin, pharmacie, livreur, WhatsApp) ; ici on ne fait que les lire, avec contrôle d'accès.
@Injectable()
export class PatientRecordsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
  ) {}

  async dashboard(userId: string, patientId: string) {
    const { patient } = await this.access.resolve(userId, patientId);
    await this.audit.log(userId, 'patient.dashboard', 'Patient', patientId);

    const [next] = await this.db
      .select({
        id: consultations.id,
        scheduledAt: consultations.scheduledAt,
        mode: consultations.mode,
        kind: consultations.kind,
        videoUrl: consultations.videoUrl,
        doctorFirstName: users.firstName,
        doctorLastName: users.lastName,
      })
      .from(consultations)
      .innerJoin(users, eq(users.id, consultations.doctorId))
      .where(
        and(
          eq(consultations.patientId, patientId),
          eq(consultations.status, 'SCHEDULED'),
          // encore affichée pendant l'heure qui suit le début, le temps de la consultation
          gte(consultations.scheduledAt, new Date(Date.now() - 60 * 60 * 1000)),
        ),
      )
      .orderBy(asc(consultations.scheduledAt))
      .limit(1);

    const [nextVisit] = await this.db
      .select({ id: homeVisits.id, scheduledAt: homeVisits.scheduledAt })
      .from(homeVisits)
      .where(and(eq(homeVisits.patientId, patientId), eq(homeVisits.status, 'SCHEDULED'), gte(homeVisits.scheduledAt, new Date())))
      .orderBy(asc(homeVisits.scheduledAt))
      .limit(1);

    // Dernier relevé de chaque type (tension, glycémie, poids)
    const latestReadings = await Promise.all(
      READING_TYPES.map(async (type) => {
        const [r] = await this.db
          .select()
          .from(readings)
          .where(and(eq(readings.patientId, patientId), eq(readings.type, type)))
          .orderBy(desc(readings.measuredAt))
          .limit(1);
        return r ? toReading(r) : null;
      }),
    );

    // Traitement en cours = dernière ordonnance non annulée ; à défaut, ce que la famille a déclaré à l'inscription
    const [lastPrescription] = await this.db
      .select({ items: prescriptions.items, createdAt: prescriptions.createdAt })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .where(and(eq(consultations.patientId, patientId), ne(prescriptions.status, 'CANCELED')))
      .orderBy(desc(prescriptions.createdAt))
      .limit(1);

    const recentDeliveries = await this.db
      .select({
        id: deliveries.id,
        status: deliveries.status,
        deliveredAt: deliveries.deliveredAt,
        createdAt: deliveries.createdAt,
      })
      .from(deliveries)
      .innerJoin(prescriptions, eq(prescriptions.id, deliveries.prescriptionId))
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .where(eq(consultations.patientId, patientId))
      .orderBy(desc(deliveries.createdAt))
      .limit(5);

    return {
      nextConsultation: next
        ? {
            id: next.id,
            scheduledAt: next.scheduledAt,
            mode: next.mode,
            kind: next.kind,
            videoUrl: next.videoUrl,
            doctorName: `Dr ${next.doctorFirstName} ${next.doctorLastName}`,
          }
        : null,
      nextVisit: nextVisit ?? null,
      latestReadings: latestReadings.filter((r) => r !== null),
      treatment: lastPrescription
        ? { source: 'PRESCRIPTION' as const, items: lastPrescription.items, since: lastPrescription.createdAt }
        : patient.currentTreatments
          ? { source: 'DECLARED' as const, text: patient.currentTreatments }
          : null,
      deliveries: recentDeliveries,
    };
  }

  async readings(userId: string, patientId: string, type: ReadingType, days = 90) {
    await this.access.resolve(userId, patientId);
    const rows = await this.db
      .select()
      .from(readings)
      .where(
        and(
          eq(readings.patientId, patientId),
          eq(readings.type, type),
          gte(readings.measuredAt, new Date(Date.now() - days * DAY_MS)),
        ),
      )
      .orderBy(asc(readings.measuredAt));
    return rows.map(toReading);
  }

  async consultations(userId: string, patientId: string) {
    await this.access.resolve(userId, patientId);
    const rows = await this.db
      .select({
        id: consultations.id,
        scheduledAt: consultations.scheduledAt,
        mode: consultations.mode,
        status: consultations.status,
        kind: consultations.kind,
        summary: consultations.summary,
        doctorFirstName: users.firstName,
        doctorLastName: users.lastName,
      })
      .from(consultations)
      .innerJoin(users, eq(users.id, consultations.doctorId))
      .where(eq(consultations.patientId, patientId))
      .orderBy(desc(consultations.scheduledAt));
    // Orientations et analyses décidées pendant chaque consultation
    const refs = await this.db.select().from(referrals).where(eq(referrals.patientId, patientId));
    const labs = await this.db.select().from(labRequests).where(eq(labRequests.patientId, patientId));
    return rows.map(({ doctorFirstName, doctorLastName, ...c }) => ({
      ...c,
      doctorName: `Dr ${doctorFirstName} ${doctorLastName}`,
      referrals: refs
        .filter((r) => r.consultationId === c.id)
        .map((r) => ({ destination: r.destination, urgency: r.urgency, reason: r.reason })),
      labRequests: labs.filter((l) => l.consultationId === c.id).map(familyLabView),
    }));
  }

  // Toutes les analyses (y compris le bilan trimestriel Sérénité, qui ne dépend pas d'une consultation)
  async labs(userId: string, patientId: string) {
    await this.access.resolve(userId, patientId);
    const rows = await this.db.select().from(labRequests).where(eq(labRequests.patientId, patientId)).orderBy(desc(labRequests.createdAt));
    return rows.map(familyLabView);
  }

  async reports(userId: string, patientId: string) {
    await this.access.resolve(userId, patientId);
    return this.db
      .select({
        id: monthlyReports.id,
        month: monthlyReports.month,
        content: monthlyReports.content,
        sentAt: monthlyReports.sentAt,
      })
      .from(monthlyReports)
      .where(and(eq(monthlyReports.patientId, patientId), isNotNull(monthlyReports.sentAt))) // brouillons non relus : invisibles
      .orderBy(desc(monthlyReports.month));
  }

  async prescriptions(userId: string, patientId: string) {
    await this.access.resolve(userId, patientId);
    const rows = await this.db
      .select({
        id: prescriptions.id,
        items: prescriptions.items,
        status: prescriptions.status,
        priceXaf: prescriptions.priceXaf,
        createdAt: prescriptions.createdAt,
        doctorFirstName: users.firstName,
        doctorLastName: users.lastName,
        deliveryStatus: deliveries.status,
        deliveredAt: deliveries.deliveredAt,
        deliveryCode: deliveries.code,
        pharmacyNote: prescriptions.pharmacyNote,
        cancelReason: prescriptions.cancelReason,
      })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .innerJoin(users, eq(users.id, consultations.doctorId))
      .leftJoin(deliveries, eq(deliveries.prescriptionId, prescriptions.id))
      .where(eq(consultations.patientId, patientId))
      .orderBy(desc(prescriptions.createdAt));
    return rows.map(({ doctorFirstName, doctorLastName, deliveryCode, ...p }) => ({
      ...p,
      doctorName: `Dr ${doctorFirstName} ${doctorLastName}`,
      // Le code n'est utile que tant que le colis n'est pas remis
      deliveryCode: p.deliveryStatus && ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'FAILED'].includes(p.deliveryStatus) ? deliveryCode : null,
    }));
  }
}

// Résultats visibles par la famille seulement après lecture et commentaire du médecin
function familyLabView(l: typeof labRequests.$inferSelect) {
  const reviewed = Boolean(l.reviewedAt);
  return {
    id: l.id,
    tests: l.tests as string[],
    note: l.note,
    status: l.status,
    appointmentAt: l.appointmentAt,
    appointmentMode: l.appointmentMode,
    awaitingDoctorReview: l.status === 'RESULTS_AVAILABLE' && !reviewed,
    results: reviewed ? l.results : null,
    doctorComment: reviewed ? l.doctorComment : null,
    createdAt: l.createdAt,
  };
}

function toReading(r: typeof readings.$inferSelect) {
  return {
    id: r.id,
    type: r.type,
    systolic: r.systolic,
    diastolic: r.diastolic,
    value: r.value === null ? null : Number(r.value), // numeric arrive en texte depuis PostgreSQL
    measuredAt: r.measuredAt,
    source: r.source,
  };
}
