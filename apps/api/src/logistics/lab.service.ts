import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { fmtLocal } from '../care/care-time';
import { CareTeamService } from '../care/care-team.service';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import { alerts, labRequests, patients, users } from '../db/schema';
import { NotifyService } from '../mail/notify.service';

@Injectable()
export class LabService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly team: CareTeamService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  // Demandes adressées à ce laboratoire : identité, contact et analyses, sans le reste du dossier
  async list(labId: string) {
    const rows = await this.db
      .select({
        l: labRequests,
        firstName: patients.firstName,
        lastName: patients.lastName,
        phone: patients.whatsappPhone,
        district: patients.district,
        addressDetails: patients.addressDetails,
        doctorFirstName: users.firstName,
        doctorLastName: users.lastName,
      })
      .from(labRequests)
      .innerJoin(patients, eq(patients.id, labRequests.patientId))
      .innerJoin(users, eq(users.id, labRequests.requestedById))
      .where(and(eq(labRequests.labId, labId), inArray(labRequests.status, ['REQUESTED', 'SAMPLED', 'RESULTS_AVAILABLE'])))
      .orderBy(desc(labRequests.createdAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.l.id,
      tests: r.l.tests,
      note: r.l.note,
      status: r.l.status,
      appointmentAt: r.l.appointmentAt,
      appointmentMode: r.l.appointmentMode,
      sampledAt: r.l.sampledAt,
      results: r.l.results,
      resultsAbnormal: r.l.resultsAbnormal,
      resultsAt: r.l.resultsAt,
      createdAt: r.l.createdAt,
      patient: {
        name: `${r.firstName} ${r.lastName}`,
        phone: r.phone,
        address: `${r.district}${r.addressDetails ? ` · ${r.addressDetails}` : ''}`,
      },
      doctorName: `Dr ${r.doctorFirstName} ${r.doctorLastName}`,
    }));
  }

  private async own(labId: string, requestId: string) {
    const [l] = await this.db.select().from(labRequests).where(eq(labRequests.id, requestId)).limit(1);
    if (!l || l.labId !== labId) throw new NotFoundException('Demande introuvable');
    const [p] = await this.db.select().from(patients).where(eq(patients.id, l.patientId));
    return { l, p };
  }

  async appointment(labId: string, requestId: string, at: Date, mode: 'AT_LAB' | 'HOME_SAMPLING') {
    const { l, p } = await this.own(labId, requestId);
    if (l.status !== 'REQUESTED') throw new ConflictException('Le prélèvement est déjà fait');
    if (at.getTime() < Date.now()) throw new BadRequestException('Choisissez une date à venir');
    await this.db.update(labRequests).set({ appointmentAt: at, appointmentMode: mode }).where(eq(labRequests.id, requestId));
    await this.audit.log(labId, 'lab.appointment', 'LabRequest', requestId);
    const [lab] = await this.db.select().from(users).where(eq(users.id, labId));
    await this.notify.family(
      p.id,
      `Prise de sang de ${p.firstName} : ${fmtLocal(at)}`,
      (mode === 'HOME_SAMPLING'
        ? `Le laboratoire passera chez ${p.firstName} le ${fmtLocal(at)} (heure du Cameroun) pour la prise de sang.`
        : `${p.firstName} est attendu(e) au laboratoire ${lab.firstName} ${lab.lastName} le ${fmtLocal(at)} (heure du Cameroun).`) +
        `\nAnalyses : ${(l.tests as string[]).join(', ')}. Certaines demandent d'être à jeun : le laboratoire le précisera.`,
    );
    return { appointmentAt: at, appointmentMode: mode };
  }

  async sampled(labId: string, requestId: string) {
    const { l } = await this.own(labId, requestId);
    if (l.status !== 'REQUESTED') throw new ConflictException('Déjà prélevé');
    await this.db.update(labRequests).set({ status: 'SAMPLED', sampledAt: new Date() }).where(eq(labRequests.id, requestId));
    await this.audit.log(labId, 'lab.sampled', 'LabRequest', requestId);
    return { status: 'SAMPLED' };
  }

  // Dépôt des résultats : le médecin est prévenu ; la famille les verra une fois lus par lui
  async results(labId: string, requestId: string, results: string, abnormal: boolean) {
    const { l, p } = await this.own(labId, requestId);
    if (l.status === 'RESULTS_AVAILABLE') throw new ConflictException('Résultats déjà déposés : contactez l’équipe pour une correction');
    if (l.status === 'CANCELED') throw new ConflictException('Demande annulée');
    await this.db.transaction(async (tx) => {
      await tx
        .update(labRequests)
        .set({ status: 'RESULTS_AVAILABLE', results: results.trim(), resultsAbnormal: abnormal, resultsAt: new Date(), sampledAt: l.sampledAt ?? new Date() })
        .where(eq(labRequests.id, requestId));
      // Résultat anormal signalé par le labo : il apparaît dans les alertes du médecin
      if (abnormal) {
        await tx.insert(alerts).values({
          patientId: p.id,
          labRequestId: requestId,
          doctorId: p.doctorId,
          severity: 'WARNING',
          message: `Résultats d'analyses anormaux : ${(l.tests as string[]).join(', ')}`,
        });
      }
    });
    await this.audit.log(labId, 'lab.results', 'LabRequest', requestId);
    await this.notify.user(
      p.doctorId,
      `${abnormal ? 'Résultats ANORMAUX' : 'Résultats'} d'analyses : ${p.firstName} ${p.lastName}`,
      `Les résultats (${(l.tests as string[]).join(', ')}) sont disponibles. Ils seront visibles par la famille après votre lecture.\n` +
        `${appUrl(`/medecin/patients/${p.id}`)}`,
    );
    await this.notify.family(
      p.id,
      `Analyses de ${p.firstName} : résultats reçus`,
      `Le laboratoire a transmis les résultats au médecin. Ils apparaîtront dans votre espace dès qu'il les aura lus et commentés.`,
    );
    return { status: 'RESULTS_AVAILABLE' };
  }

  // Le médecin lit et commente : les résultats deviennent visibles pour la famille
  async review(doctorId: string, requestId: string, comment: string) {
    const [l] = await this.db.select().from(labRequests).where(eq(labRequests.id, requestId)).limit(1);
    if (!l) throw new NotFoundException('Demande introuvable');
    const [p] = await this.db.select().from(patients).where(eq(patients.id, l.patientId));
    if (p.doctorId !== doctorId) throw new NotFoundException('Demande introuvable');
    if (l.status !== 'RESULTS_AVAILABLE') throw new ConflictException('Pas encore de résultats');
    await this.db.transaction(async (tx) => {
      await tx.update(labRequests).set({ reviewedAt: new Date(), doctorComment: comment.trim() }).where(eq(labRequests.id, requestId));
      await tx
        .update(alerts)
        .set({ acknowledgedAt: new Date(), acknowledgedById: doctorId })
        .where(and(eq(alerts.labRequestId, requestId), isNull(alerts.acknowledgedAt)));
    });
    await this.audit.log(doctorId, 'lab.review', 'LabRequest', requestId);
    await this.notify.family(
      p.id,
      `Résultats d'analyses de ${p.firstName} commentés par le médecin`,
      `Le médecin a lu les résultats : « ${comment.trim()} »\nDétail : ${appUrl(`/parents/${p.id}`)}`,
    );
    return { reviewedAt: new Date() };
  }

  // Demandes sans laboratoire (aucun n'était disponible au moment de la demande) : rattrapage quotidien
  async assignPending() {
    const pending = await this.db.select().from(labRequests).where(and(isNull(labRequests.labId), eq(labRequests.status, 'REQUESTED')));
    let n = 0;
    for (const l of pending) {
      const [p] = await this.db.select().from(patients).where(eq(patients.id, l.patientId));
      const labId = await this.team.ensureLab(p);
      if (!labId) continue;
      await this.db.update(labRequests).set({ labId }).where(eq(labRequests.id, l.id));
      n++;
    }
    return n;
  }
}
