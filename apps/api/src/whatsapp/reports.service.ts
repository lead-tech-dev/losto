import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, AnyColumn, desc, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DOUALA_OFFSET_MIN, fmtLocal } from '../care/care-time';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import {
  alerts,
  consultations,
  deliveries,
  homeVisits,
  labRequests,
  monthlyReports,
  patients,
  prescriptions,
  readings,
  subscriptions,
  users,
  whatsappMessages,
} from '../db/schema';
import { NotifyService } from '../mail/notify.service';

// ---------- Rédaction (fonction pure, testée) ----------

export interface ReportData {
  firstName: string;
  monthLabel: string; // « octobre 2026 »
  consultations: { at: Date; doctor: string; mode: string; summary: string | null }[];
  missedConsultations: number;
  visits: { at: Date; nurse: string; treatmentChecked: boolean | null }[];
  bp: { systolic: number; diastolic: number }[];
  glucose: number[];
  weight: number[];
  alerts: { warning: number; urgent: number };
  reminders: { sent: number; confirmed: number };
  deliveries: number;
  labs: { tests: string[]; comment: string | null }[];
  next: string | null;
}

const day = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Africa/Douala' }).format(d);
const n1 = (x: number, digits = 2) => x.toFixed(digits).replace(/\.?0+$/, '').replace('.', ',');
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function buildReport(d: ReportData): string {
  const out: string[] = [`Compte rendu de ${d.monthLabel} pour ${d.firstName}`, ''];

  out.push('Consultations');
  if (!d.consultations.length) out.push('- Pas de consultation ce mois-ci.');
  for (const c of d.consultations) {
    out.push(`- ${day(c.at)}, Dr ${c.doctor} (${c.mode === 'VIDEO' ? 'vidéo' : 'téléphone'})${c.summary ? ` : ${c.summary.trim()}` : ''}`);
  }
  if (d.missedConsultations) out.push(`- ${plural(d.missedConsultations, 'consultation manquée', 'consultations manquées')}, reprogrammée${d.missedConsultations > 1 ? 's' : ''}.`);
  for (const v of d.visits) {
    out.push(`- ${day(v.at)}, visite à domicile de ${v.nurse}${v.treatmentChecked ? ', traitement vérifié' : ''}.`);
  }

  out.push('', 'Relevés');
  if (!d.bp.length && !d.glucose.length && !d.weight.length) out.push('- Aucun relevé ce mois-ci.');
  if (d.bp.length) {
    const sys = d.bp.map((b) => b.systolic);
    const dia = d.bp.map((b) => b.diastolic);
    const lo = d.bp.reduce((a, b) => (b.systolic < a.systolic ? b : a));
    const hi = d.bp.reduce((a, b) => (b.systolic > a.systolic ? b : a));
    out.push(
      `- Tension : ${plural(d.bp.length, 'mesure', 'mesures')}, moyenne ${Math.round(avg(sys))}/${Math.round(avg(dia))} mmHg` +
        (d.bp.length > 1 ? ` (de ${lo.systolic}/${lo.diastolic} à ${hi.systolic}/${hi.diastolic}).` : '.'),
    );
  }
  if (d.glucose.length) {
    out.push(
      `- Glycémie : ${plural(d.glucose.length, 'mesure', 'mesures')}, moyenne ${n1(avg(d.glucose))} g/L` +
        (d.glucose.length > 1 ? ` (de ${n1(Math.min(...d.glucose))} à ${n1(Math.max(...d.glucose))} g/L).` : '.'),
    );
  }
  if (d.weight.length) {
    const first = d.weight[0];
    const last = d.weight[d.weight.length - 1];
    out.push(d.weight.length > 1 && first !== last ? `- Poids : de ${n1(first, 1)} kg à ${n1(last, 1)} kg.` : `- Poids : ${n1(last, 1)} kg.`);
  }
  const totalAlerts = d.alerts.warning + d.alerts.urgent;
  if (totalAlerts) {
    out.push(
      `- ${plural(totalAlerts, 'valeur a', 'valeurs ont')} déclenché une alerte au médecin` +
        (d.alerts.urgent ? ` (dont ${plural(d.alerts.urgent, 'urgente', 'urgentes')})` : '') +
        '.',
    );
  }

  out.push('', 'Traitement');
  if (d.reminders.sent) {
    const pct = Math.round((d.reminders.confirmed / d.reminders.sent) * 100);
    out.push(`- Prises de médicaments confirmées : ${d.reminders.confirmed} sur ${d.reminders.sent} rappels (${pct} %).`);
  } else out.push('- Pas de rappel de médicaments ce mois-ci.');
  out.push(d.deliveries ? `- Médicaments livrés : ${plural(d.deliveries, 'fois', 'fois')}.` : '- Pas de livraison de médicaments ce mois-ci.');

  if (d.labs.length) {
    out.push('', 'Analyses');
    for (const l of d.labs) out.push(`- ${l.tests.join(', ')}${l.comment ? ` : ${l.comment}` : ' : résultats lus par le médecin.'}`);
  }

  out.push('', `Prochain rendez-vous : ${d.next ?? 'à programmer'}.`);
  return out.join('\n');
}

// Début du mois (heure du Cameroun) en instant UTC : « 2026-10 » → 2026-09-30T23:00:00Z
export function monthStart(ym: string): Date {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new BadRequestException('Mois attendu au format AAAA-MM');
  return new Date(Date.parse(`${ym}-01T00:00:00Z`) - DOUALA_OFFSET_MIN * 60_000);
}

export function previousMonth(now: Date): string {
  const local = new Date(now.getTime() + DOUALA_OFFSET_MIN * 60_000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

function nextMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

// ---------- Service ----------

// Le 1er de chaque mois, un brouillon par parent suivi. L'équipe le relit, le corrige, puis l'envoie à la famille.
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  @Cron('0 6 1 * *', { timeZone: 'Africa/Douala' })
  async monthly() {
    const r = await this.generateAll(previousMonth(new Date()));
    this.logger.log(`Comptes rendus de ${r.month} : ${r.created} brouillons`);
  }

  // Parents abonnés pendant le mois (même s'ils ont résilié depuis)
  async generateAll(ym: string) {
    const from = monthStart(ym);
    const to = monthStart(nextMonthOf(ym));
    const subs = await this.db
      .select({ patientId: subscriptions.patientId })
      .from(subscriptions)
      .where(and(isNotNull(subscriptions.currentPeriodEnd), gte(subscriptions.currentPeriodEnd, from), lt(subscriptions.createdAt, to)));
    let created = 0;
    for (const s of subs) if (await this.generate(s.patientId, ym)) created++;
    return { month: ym, created };
  }

  async generate(patientId: string, ym: string): Promise<boolean> {
    const from = monthStart(ym);
    const to = monthStart(nextMonthOf(ym));
    const [exists] = await this.db
      .select({ id: monthlyReports.id })
      .from(monthlyReports)
      .where(and(eq(monthlyReports.patientId, patientId), eq(monthlyReports.month, from)));
    if (exists) return false;
    const content = buildReport(await this.collect(patientId, ym, from, to));
    const [row] = await this.db.insert(monthlyReports).values({ patientId, month: from, content }).onConflictDoNothing().returning();
    return Boolean(row);
  }

  private async collect(patientId: string, ym: string, from: Date, to: Date): Promise<ReportData> {
    const [p] = await this.db.select().from(patients).where(eq(patients.id, patientId));
    const inMonth = (col: AnyColumn) => and(gte(col, from), lt(col, to));

    const cons = await this.db
      .select({ c: consultations, doctor: users.lastName })
      .from(consultations)
      .innerJoin(users, eq(users.id, consultations.doctorId))
      .where(and(eq(consultations.patientId, patientId), inMonth(consultations.scheduledAt), inArray(consultations.status, ['DONE', 'MISSED'])))
      .orderBy(consultations.scheduledAt);
    const visits = await this.db
      .select({ v: homeVisits, nurse: users.firstName })
      .from(homeVisits)
      .innerJoin(users, eq(users.id, homeVisits.nurseId))
      .where(and(eq(homeVisits.patientId, patientId), eq(homeVisits.status, 'DONE'), inMonth(homeVisits.scheduledAt)))
      .orderBy(homeVisits.scheduledAt);
    const rs = await this.db
      .select()
      .from(readings)
      .where(and(eq(readings.patientId, patientId), inMonth(readings.measuredAt)))
      .orderBy(readings.measuredAt);
    const al = await this.db.select({ severity: alerts.severity }).from(alerts).where(and(eq(alerts.patientId, patientId), inMonth(alerts.createdAt)));
    const rem = await this.db
      .select({ ack: whatsappMessages.acknowledgedAt })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.patientId, patientId),
          eq(whatsappMessages.kind, 'med_reminder'),
          inArray(whatsappMessages.status, ['SENT', 'DELIVERED', 'READ']),
          inMonth(whatsappMessages.createdAt),
        ),
      );
    const dels = await this.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .innerJoin(prescriptions, eq(prescriptions.id, deliveries.prescriptionId))
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .where(and(eq(consultations.patientId, patientId), eq(deliveries.status, 'DELIVERED'), inMonth(deliveries.deliveredAt)));
    const labs = await this.db
      .select()
      .from(labRequests)
      .where(and(eq(labRequests.patientId, patientId), isNotNull(labRequests.reviewedAt), inMonth(labRequests.reviewedAt)));
    const [next] = await this.db
      .select({ at: consultations.scheduledAt })
      .from(consultations)
      .where(and(eq(consultations.patientId, patientId), eq(consultations.status, 'SCHEDULED')))
      .orderBy(consultations.scheduledAt)
      .limit(1);

    const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-15T00:00:00Z`));
    return {
      firstName: p.firstName,
      monthLabel,
      consultations: cons
        .filter((x) => x.c.status === 'DONE')
        .map((x) => ({ at: x.c.scheduledAt, doctor: x.doctor, mode: x.c.mode, summary: x.c.summary })),
      missedConsultations: cons.filter((x) => x.c.status === 'MISSED').length,
      visits: visits.map((x) => ({ at: x.v.scheduledAt, nurse: x.nurse, treatmentChecked: x.v.treatmentChecked })),
      bp: rs.filter((r) => r.type === 'BLOOD_PRESSURE' && r.systolic && r.diastolic).map((r) => ({ systolic: r.systolic!, diastolic: r.diastolic! })),
      glucose: rs.filter((r) => r.type === 'GLUCOSE' && r.value).map((r) => Number(r.value)),
      weight: rs.filter((r) => r.type === 'WEIGHT' && r.value).map((r) => Number(r.value)),
      alerts: { warning: al.filter((a) => a.severity === 'WARNING').length, urgent: al.filter((a) => a.severity === 'URGENT').length },
      reminders: { sent: rem.length, confirmed: rem.filter((r) => r.ack).length },
      deliveries: dels.length,
      labs: labs.map((l) => ({ tests: l.tests as string[], comment: l.doctorComment })),
      next: next ? fmtLocal(next.at) : null,
    };
  }

  // ---------- Relecture par l'équipe ----------

  async list(status: 'draft' | 'sent') {
    return this.db
      .select({
        id: monthlyReports.id,
        month: monthlyReports.month,
        content: monthlyReports.content,
        sentAt: monthlyReports.sentAt,
        createdAt: monthlyReports.createdAt,
        patientId: patients.id,
        patientName: patients.firstName,
        patientLastName: patients.lastName,
      })
      .from(monthlyReports)
      .innerJoin(patients, eq(patients.id, monthlyReports.patientId))
      .where(status === 'draft' ? isNull(monthlyReports.sentAt) : isNotNull(monthlyReports.sentAt))
      .orderBy(desc(monthlyReports.month), patients.lastName)
      .limit(200)
      .then((rows) => rows.map((r) => ({ ...r, patientName: `${r.patientName} ${r.patientLastName}`, patientLastName: undefined })));
  }

  private async draft(id: string) {
    const [r] = await this.db.select().from(monthlyReports).where(eq(monthlyReports.id, id));
    if (!r) throw new NotFoundException('Compte rendu introuvable');
    if (r.sentAt) throw new ConflictException('Ce compte rendu a déjà été envoyé');
    return r;
  }

  async update(adminId: string, id: string, content: string) {
    await this.draft(id);
    await this.db.update(monthlyReports).set({ content: content.trim() }).where(eq(monthlyReports.id, id));
    await this.audit.log(adminId, 'report.edit', 'MonthlyReport', id);
    return { ok: true };
  }

  async send(adminId: string, id: string) {
    const r = await this.draft(id);
    // Envoi unique même si deux personnes cliquent en même temps
    const [done] = await this.db
      .update(monthlyReports)
      .set({ sentAt: new Date(), reviewedById: adminId })
      .where(and(eq(monthlyReports.id, id), isNull(monthlyReports.sentAt)))
      .returning();
    if (!done) throw new ConflictException('Ce compte rendu a déjà été envoyé');
    await this.audit.log(adminId, 'report.send', 'MonthlyReport', id);
    const [p] = await this.db.select().from(patients).where(eq(patients.id, r.patientId));
    const month = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'Africa/Douala' }).format(r.month);
    await this.notify.family(
      r.patientId,
      `Compte rendu de ${month} pour ${p.firstName}`,
      `${r.content}\n\nRetrouvez tous les comptes rendus dans votre espace : ${appUrl(`/parents/${p.id}`)}`,
    );
    return { ok: true, sentAt: done.sentAt };
  }
}

