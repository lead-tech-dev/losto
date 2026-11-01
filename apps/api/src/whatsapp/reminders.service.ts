import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { fmtLocal } from '../care/care-time';
import { Database, DB } from '../db/db.module';
import { consultations, homeVisits, labRequests, Patient, patients, prescriptions, subscriptions, users } from '../db/schema';
import { doualaClock, guessTimes, momentLabel, REMINDER_WINDOW_MIN, toMinutes, VALID_TIME } from './schedule';
import { WhatsAppService } from './whatsapp.service';

interface Item {
  name: string;
  dosage?: string;
  times?: string[];
}

// Rappels automatiques aux parents : médicaments aux heures de prise, rendez-vous la veille et le jour même.
// Chaque rappel a une clé unique : relancer la tâche ne l'envoie jamais deux fois.
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly wa: WhatsAppService,
  ) {}

  // Cadence réglable : en production gratuite (base Neon qui s'endort), REMINDERS_CRON="*/15 6-21 * * *"
  // limite les réveils de la base aux heures utiles. Les fenêtres d'envoi (30 min) restent couvertes.
  @Cron(process.env.REMINDERS_CRON || '*/5 * * * *', { name: 'whatsapp-reminders', timeZone: 'Africa/Douala' })
  async tick() {
    if (process.env.NODE_ENV === 'test') return;
    const now = new Date();
    const meds = await this.medication(now).catch((e) => this.logger.error(`Rappels médicaments : ${e.message}`));
    const appts = await this.appointments(now).catch((e) => this.logger.error(`Rappels rendez-vous : ${e.message}`));
    if ((meds ?? 0) + (appts ?? 0) > 0) this.logger.log(`Rappels envoyés : ${meds ?? 0} médicaments, ${appts ?? 0} rendez-vous`);
  }

  // Parents suivis qui ont accepté et peuvent recevoir des messages
  private async eligible(): Promise<Patient[]> {
    return this.db
      .select({ p: patients })
      .from(patients)
      .innerJoin(subscriptions, eq(subscriptions.patientId, patients.id))
      .where(
        and(
          inArray(subscriptions.status, ['ACTIVE', 'PAST_DUE']),
          isNotNull(patients.consentGivenAt),
          eq(patients.hasSmartphone, true),
          isNull(patients.whatsappOptOutAt),
        ),
      )
      .then((rows) => rows.map((r) => r.p));
  }

  // Traitement en cours : la dernière ordonnance non annulée des 60 derniers jours
  async currentTreatment(patientId: string, now = new Date()): Promise<Item[]> {
    const [last] = await this.db
      .select({ items: prescriptions.items })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .where(
        and(
          eq(consultations.patientId, patientId),
          ne(prescriptions.status, 'CANCELED'),
          gt(prescriptions.createdAt, new Date(now.getTime() - 60 * 86400_000)),
        ),
      )
      .orderBy(desc(prescriptions.createdAt))
      .limit(1);
    return (last?.items as Item[] | undefined) ?? [];
  }

  // Un message par créneau horaire, qui regroupe tous les médicaments de ce moment-là
  async medication(now = new Date()): Promise<number> {
    const { date, minutes } = doualaClock(now);
    let sent = 0;
    for (const p of await this.eligible()) {
      const bySlot = new Map<string, string[]>();
      for (const it of await this.currentTreatment(p.id, now)) {
        const times = it.times?.filter((t) => VALID_TIME.test(t)).length ? it.times! : guessTimes(it.dosage);
        for (const t of times) bySlot.set(t, [...(bySlot.get(t) ?? []), it.name]);
      }
      for (const [time, names] of bySlot) {
        const start = toMinutes(time);
        if (minutes < start || minutes >= start + REMINDER_WINDOW_MIN) continue;
        const list = names.join(', ');
        const r = await this.wa.toPatient(p, {
          kind: 'med_reminder',
          text: `Bonjour ${p.firstName}, c’est l’heure des médicaments du ${momentLabel(time)} : ${list}. Répondez OK quand vous les avez pris.`,
          template: { name: 'ps_rappel_medicaments', params: [p.firstName, momentLabel(time), list] },
          dedupeKey: `med:${p.id}:${date}:${time}`,
        });
        if (r.status === 'SENT') sent++;
      }
    }
    return sent;
  }

  // Veille (à partir de 18 h) et jour même (2 h avant, avec le lien vidéo)
  async appointments(now = new Date()): Promise<number> {
    const { date: today, minutes } = doualaClock(now);
    const horizon = new Date(now.getTime() + 30 * 3600_000);
    const items: { patientId: string; key: string; at: Date; what: string; detail: string; sameDayOnly?: boolean }[] = [];

    const cons = await this.db
      .select({ c: consultations, doctor: users.lastName })
      .from(consultations)
      .innerJoin(users, eq(users.id, consultations.doctorId))
      .where(and(eq(consultations.status, 'SCHEDULED'), gt(consultations.scheduledAt, now), lt(consultations.scheduledAt, horizon)));
    for (const { c, doctor } of cons) {
      items.push({
        patientId: c.patientId,
        key: `rdv:c:${c.id}:${c.scheduledAt.toISOString()}`,
        at: c.scheduledAt,
        what: `consultation avec le Dr ${doctor} ${fmtLocal(c.scheduledAt)}`,
        detail: c.mode === 'VIDEO' && c.videoUrl ? `appel vidéo, ouvrez ce lien à l’heure du rendez-vous : ${c.videoUrl}` : 'le médecin vous appellera sur ce numéro',
      });
    }
    const visits = await this.db
      .select({ v: homeVisits, nurse: users.firstName })
      .from(homeVisits)
      .innerJoin(users, eq(users.id, homeVisits.nurseId))
      .where(and(eq(homeVisits.status, 'SCHEDULED'), gt(homeVisits.scheduledAt, now), lt(homeVisits.scheduledAt, horizon)));
    for (const { v, nurse } of visits) {
      items.push({
        patientId: v.patientId,
        key: `rdv:v:${v.id}:${v.scheduledAt.toISOString()}`,
        at: v.scheduledAt,
        what: `visite à domicile de ${nurse} ${fmtLocal(v.scheduledAt)}`,
        detail: 'gardez vos boîtes de médicaments et votre carnet à portée de main',
      });
    }
    const labs = await this.db
      .select()
      .from(labRequests)
      .where(and(eq(labRequests.status, 'REQUESTED'), gt(labRequests.appointmentAt, now), lt(labRequests.appointmentAt, horizon)));
    for (const l of labs) {
      items.push({
        patientId: l.patientId,
        key: `rdv:l:${l.id}:${l.appointmentAt!.toISOString()}`,
        at: l.appointmentAt!,
        what: `prise de sang ${l.appointmentMode === 'HOME_SAMPLING' ? 'à domicile' : 'au laboratoire'} ${fmtLocal(l.appointmentAt!)}`,
        detail: /jeun/i.test(l.note ?? '') ? 'venez à jeun : rien à manger après 22 h la veille, l’eau est permise' : 'gardez votre ordonnance avec vous',
      });
    }
    if (!items.length) return 0;

    const eligible = new Map((await this.eligibleForAppointments(items.map((i) => i.patientId))).map((p) => [p.id, p]));
    let sent = 0;
    for (const it of items) {
      const p = eligible.get(it.patientId);
      if (!p) continue;
      const apptDay = doualaClock(it.at).date;
      const hoursLeft = (it.at.getTime() - now.getTime()) / 3600_000;
      let when: 'veille' | 'jour' | null = null;
      if (hoursLeft <= 2 && minutes >= 6 * 60) when = 'jour'; // jamais avant 6 h du matin
      else if (apptDay !== today && minutes >= 18 * 60 && hoursLeft <= 30) when = 'veille';
      if (!when) continue;
      const r = await this.wa.toPatient(p, {
        kind: 'appt_reminder',
        text: `Bonjour ${p.firstName}, rappel de votre rendez-vous : ${it.what}. Précision : ${it.detail}. À bientôt, Proche Santé.`,
        template: { name: 'ps_rappel_rdv', params: [p.firstName, it.what, it.detail] },
        dedupeKey: `${it.key}:${when}`,
      });
      if (r.status === 'SENT') sent++;
    }
    return sent;
  }

  // Rendez-vous : il suffit que le parent ait accepté et puisse recevoir des messages (pas besoin de l'abonnement)
  private async eligibleForAppointments(ids: string[]) {
    return this.db
      .select()
      .from(patients)
      .where(and(inArray(patients.id, ids), isNotNull(patients.consentGivenAt), eq(patients.hasSmartphone, true), isNull(patients.whatsappOptOutAt)));
  }
}
