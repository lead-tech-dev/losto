import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import {
  availabilitySlots,
  consultations,
  homeVisits,
  labRequests,
  Patient,
  patients,
  subscriptions,
  users,
} from '../db/schema';
import { NotifyService } from '../mail/notify.service';
import { BusyInterval, findFreeSlot, fmtLocal } from './care-time';
import { CareTeamService } from './care-team.service';
import { newVideoUrl } from './video';

const HOUR = 60 * 60 * 1000;

const PANELS: Record<string, string[]> = {
  DIABETES: ['Glycémie à jeun', 'HbA1c', 'Créatinine'],
  HYPERTENSION: ['Créatinine', 'Ionogramme'],
  CHOLESTEROL: ['Bilan lipidique'],
  THYROID: ['TSH'],
  SENIOR_FOLLOWUP: ['NFS', 'Créatinine'],
  ASTHMA: [],
};

export function quarterlyPanel(conditions: string[]): string[] {
  return [...new Set(conditions.flatMap((c) => PANELS[c] ?? []))];
}
const DAY = 24 * HOUR;
const CONSULTATION_MINUTES = 20;
const VISIT_MINUTES = 45;

// Planifie automatiquement ce que la formule promet :
//   - à l'activation : bilan de départ au plus tôt avec le médecin
//   - chaque mois payé : une consultation (et une visite infirmière en Sérénité)
// Lancé au paiement (module 3) et chaque matin pour rattraper ce qui n'a pas pu être planifié.
@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly team: CareTeamService,
    private readonly notify: NotifyService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'Africa/Douala' })
  async daily() {
    const summary = await this.ensureAll(new Date());
    this.logger.log(`Planification quotidienne : ${JSON.stringify(summary)}`);
  }

  async ensureAll(now: Date) {
    const active = await this.db.select({ patientId: subscriptions.patientId }).from(subscriptions).where(eq(subscriptions.status, 'ACTIVE'));
    const summary = { consultations: 0, visits: 0, unassigned: 0 };
    for (const { patientId } of active) {
      const r = await this.ensureForPatient(patientId, now);
      summary.consultations += r.consultation ? 1 : 0;
      summary.visits += r.visit ? 1 : 0;
      summary.unassigned += r.unassigned ? 1 : 0;
    }
    return summary;
  }

  async ensureForPatient(patientId: string, now = new Date()) {
    const result = { consultation: false, visit: false, unassigned: false, labs: false };
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.patientId, patientId)).limit(1);
    if (!sub || sub.status !== 'ACTIVE' || !sub.currentPeriodEnd) return result;

    let [patient] = await this.db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient.consentGivenAt) return result;
    const serenite = sub.plan === 'SERENITE';
    patient = await this.team.autoAssign(patient, serenite);

    // Mois en cours = le mois payé qui se termine à currentPeriodEnd
    const periodEnd = sub.currentPeriodEnd;
    const periodStart = new Date(periodEnd);
    periodStart.setUTCMonth(periodStart.getUTCMonth() - 1);

    if (!patient.doctorId) result.unassigned = true;
    else {
      const existing = await this.db
        .select({ id: consultations.id, status: consultations.status })
        .from(consultations)
        .where(
          and(
            eq(consultations.patientId, patientId),
            inArray(consultations.kind, ['INITIAL', 'MONTHLY']),
            inArray(consultations.status, ['SCHEDULED', 'DONE']),
            gte(consultations.scheduledAt, periodStart),
            lt(consultations.scheduledAt, periodEnd),
          ),
        );
      if (existing.length === 0) {
        const [anyDone] = await this.db
          .select({ id: consultations.id })
          .from(consultations)
          .where(and(eq(consultations.patientId, patientId), eq(consultations.status, 'DONE')))
          .limit(1);
        const kind = anyDone ? 'MONTHLY' : 'INITIAL';
        // Bilan de départ : dès que possible ; ensuite, la consultation du mois
        const from = new Date(Math.max(now.getTime() + 2 * HOUR, periodStart.getTime()));
        const created = await this.scheduleConsultation(patient, kind, from, periodEnd);
        result.consultation = Boolean(created);
      }
    }

    if (serenite && patient.doctorId) result.labs = await this.ensureQuarterlyLabs(patient, now);

    if (serenite) {
      if (!patient.nurseId) result.unassigned = true;
      else {
        const visits = await this.db
          .select({ id: homeVisits.id })
          .from(homeVisits)
          .where(
            and(
              eq(homeVisits.patientId, patientId),
              inArray(homeVisits.status, ['SCHEDULED', 'DONE']),
              gte(homeVisits.scheduledAt, periodStart),
              lt(homeVisits.scheduledAt, periodEnd),
            ),
          );
        if (visits.length === 0) {
          const from = new Date(Math.max(now.getTime() + 24 * HOUR, periodStart.getTime()));
          result.visit = Boolean(await this.scheduleVisit(patient, from, periodEnd));
        }
      }
    }
    return result;
  }

  // Formule Sérénité : un bilan sanguin par trimestre, selon les maladies suivies.
  // Le panel est une proposition de départ à faire valider par le médecin référent ; le médecin peut en demander d'autres.
  private async ensureQuarterlyLabs(patient: Patient, now: Date): Promise<boolean> {
    const [recent] = await this.db
      .select({ id: labRequests.id })
      .from(labRequests)
      .where(and(eq(labRequests.patientId, patient.id), gte(labRequests.createdAt, new Date(now.getTime() - 90 * DAY))))
      .limit(1);
    if (recent) return false;
    const tests = quarterlyPanel(patient.conditions);
    if (!tests.length) return false;
    const labId = await this.team.ensureLab(patient);
    await this.db.insert(labRequests).values({
      patientId: patient.id,
      requestedById: patient.doctorId!,
      labId,
      tests,
      note: 'Bilan trimestriel de la formule Sérénité',
    });
    return true;
  }

  // Place une consultation dans le premier créneau libre du médecin (avant `before` si possible).
  async scheduleConsultation(patient: Patient, kind: 'INITIAL' | 'MONTHLY' | 'EXTRA', from: Date, before?: Date) {
    if (!patient.doctorId) return null;
    const at = await this.freeSlot(patient.doctorId, from, CONSULTATION_MINUTES);
    if (!at || (before && at >= before)) {
      this.logger.warn(`Pas de créneau libre pour le médecin ${patient.doctorId} (parent ${patient.id})`);
      return null;
    }
    const mode = patient.hasSmartphone ? 'VIDEO' : 'PHONE';
    const [c] = await this.db
      .insert(consultations)
      .values({
        patientId: patient.id,
        doctorId: patient.doctorId,
        scheduledAt: at,
        durationMinutes: CONSULTATION_MINUTES,
        kind,
        mode,
        videoUrl: mode === 'VIDEO' ? newVideoUrl() : null,
      })
      .returning();
    const label = kind === 'INITIAL' ? 'Bilan de départ' : 'Consultation';
    await this.notifyFamily(
      patient,
      `${label} de ${patient.firstName} : ${fmtLocal(at)}`,
      `${label} de ${patient.firstName} avec son médecin, ${mode === 'VIDEO' ? 'en visio' : 'par téléphone'}, le ${fmtLocal(at)} (heure du Cameroun).\n` +
        `Détails : ${appUrl(`/parents/${patient.id}`)}`,
    );
    return c;
  }

  async scheduleVisit(patient: Patient, from: Date, before?: Date) {
    if (!patient.nurseId) return null;
    const at = await this.freeSlot(patient.nurseId, from, VISIT_MINUTES);
    if (!at || (before && at >= before)) {
      this.logger.warn(`Pas de créneau libre pour l'infirmier ${patient.nurseId} (parent ${patient.id})`);
      return null;
    }
    const [v] = await this.db
      .insert(homeVisits)
      .values({ patientId: patient.id, nurseId: patient.nurseId, scheduledAt: at, durationMinutes: VISIT_MINUTES })
      .returning();
    await this.notifyFamily(
      patient,
      `Visite à domicile pour ${patient.firstName} : ${fmtLocal(at)}`,
      `L'infirmier(e) passera chez ${patient.firstName} le ${fmtLocal(at)} (heure du Cameroun) pour mesurer sa tension et sa glycémie et vérifier son traitement.`,
    );
    return v;
  }

  // Premier créneau libre d'un soignant : ses disponibilités moins ses rendez-vous déjà pris
  async freeSlot(userId: string, from: Date, minutes: number): Promise<Date | null> {
    const slots = await this.db.select().from(availabilitySlots).where(eq(availabilitySlots.userId, userId));
    const horizon = new Date(from.getTime() + 40 * DAY);
    const busy: BusyInterval[] = [];
    const cons = await this.db
      .select({ at: consultations.scheduledAt, d: consultations.durationMinutes })
      .from(consultations)
      .where(and(eq(consultations.doctorId, userId), eq(consultations.status, 'SCHEDULED'), gte(consultations.scheduledAt, new Date(from.getTime() - DAY)), lt(consultations.scheduledAt, horizon)));
    const visits = await this.db
      .select({ at: homeVisits.scheduledAt, d: homeVisits.durationMinutes })
      .from(homeVisits)
      .where(and(eq(homeVisits.nurseId, userId), eq(homeVisits.status, 'SCHEDULED'), gte(homeVisits.scheduledAt, new Date(from.getTime() - DAY)), lt(homeVisits.scheduledAt, horizon)));
    for (const x of [...cons, ...visits]) busy.push({ start: x.at, end: new Date(x.at.getTime() + x.d * 60_000) });
    return findFreeSlot(slots, busy, from, minutes, 30);
  }

  // Les `count` prochains créneaux libres (proposés au soignant pour reprogrammer)
  async nextFreeSlots(userId: string, from: Date, minutes: number, count = 8): Promise<Date[]> {
    const slots = await this.db.select().from(availabilitySlots).where(eq(availabilitySlots.userId, userId));
    const busy = await this.busyOf(userId);
    const out: Date[] = [];
    let cursor = from;
    while (out.length < count) {
      const s = findFreeSlot(slots, busy, cursor, minutes, 30);
      if (!s) break;
      out.push(s);
      busy.push({ start: s, end: new Date(s.getTime() + minutes * 60_000) });
      cursor = s;
    }
    return out;
  }

  private async busyOf(userId: string, ignoreConsultationId?: string): Promise<BusyInterval[]> {
    const cons = await this.db
      .select({ at: consultations.scheduledAt, d: consultations.durationMinutes })
      .from(consultations)
      .where(
        and(
          eq(consultations.doctorId, userId),
          eq(consultations.status, 'SCHEDULED'),
          ignoreConsultationId ? ne(consultations.id, ignoreConsultationId) : undefined,
        ),
      );
    const visits = await this.db
      .select({ at: homeVisits.scheduledAt, d: homeVisits.durationMinutes })
      .from(homeVisits)
      .where(and(eq(homeVisits.nurseId, userId), eq(homeVisits.status, 'SCHEDULED')));
    return [...cons, ...visits].map((x) => ({ start: x.at, end: new Date(x.at.getTime() + x.d * 60_000) }));
  }

  // Le créneau choisi est-il toujours libre ? (il a pu être pris entre-temps)
  async isFree(userId: string, at: Date, minutes: number, ignoreConsultationId?: string): Promise<boolean> {
    const slots = await this.db.select().from(availabilitySlots).where(eq(availabilitySlots.userId, userId));
    const found = findFreeSlot(slots, await this.busyOf(userId, ignoreConsultationId), at, minutes, 0);
    return found !== null && found.getTime() === at.getTime();
  }

  private async notifyFamily(patient: Patient, subject: string, text: string) {
    await this.notify.family(patient.id, subject, text);
  }

}
