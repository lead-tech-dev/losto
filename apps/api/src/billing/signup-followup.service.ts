import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { appUrl } from '../common/app-url';
import { CoverageService } from '../coverage/coverage.service';
import { Database, DB } from '../db/db.module';
import { Patient, patients, payments, Subscription, subscriptions, users } from '../db/schema';
import { NotifyService } from '../mail/notify.service';
import { eurToXaf, PLAN_LABELS, PLAN_PRICES_EUR, SIGNUP_FEE_EUR } from '../patients/plans';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { DAY_MS, fmtDay, fmtXaf } from './billing.util';

// Relance des inscriptions qui n'ont pas abouti au premier paiement.
//
// Une inscription bloque à l'une de ces étapes :
//   CONSENT  le parent n'a pas encore confirmé son accord      (compté depuis l'inscription)
//   PAYMENT  le parent a accepté, le premier paiement manque    (compté depuis l'accord)
//   ZONE     le quartier n'est pas encore desservi : rien à demander à la famille, pas de relance
//
// Trois relances par étape, à J+1, J+3 et J+7. Changer d'étape (le parent accepte) repart de zéro.
// À la dernière relance, l'équipe est prévenue pour appeler la famille ; l'inscription reste ensuite
// dans la liste du back-office, sans autre message automatique.
export const SIGNUP_FOLLOWUP_DAYS = [1, 3, 7] as const;

export type SignupStage = 'CONSENT' | 'PAYMENT' | 'ZONE';

interface Row {
  sub: Subscription;
  patient: Patient;
  family: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
}

@Injectable()
export class SignupFollowupService {
  private readonly logger = new Logger(SignupFollowupService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly coverage: CoverageService,
    private readonly notify: NotifyService,
    private readonly wa: WhatsAppService,
  ) {}

  // Inscriptions jamais payées (parent non effacé, compte famille actif)
  private async pending(): Promise<Row[]> {
    const rows = await this.db
      .select({ sub: subscriptions, patient: patients, family: { id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone } })
      .from(subscriptions)
      .innerJoin(patients, eq(patients.id, subscriptions.patientId))
      .innerJoin(users, eq(users.id, patients.familyUserId))
      .where(and(eq(subscriptions.status, 'PENDING'), isNull(subscriptions.signupFeePaidAt), isNull(patients.erasedAt), eq(users.isActive, true)))
      .orderBy(desc(patients.createdAt));
    return rows;
  }

  private async stageOf(p: Patient): Promise<{ stage: SignupStage; since: Date }> {
    if (!p.consentGivenAt) return { stage: 'CONSENT', since: p.createdAt };
    if (!(await this.coverage.isCovered(p.city, p.district))) return { stage: 'ZONE', since: p.consentGivenAt };
    return { stage: 'PAYMENT', since: p.consentGivenAt };
  }

  // Relances déjà envoyées pour l'étape en cours (celles envoyées à une étape précédente ne comptent pas)
  static remindersSent(since: Date, lastReminderAt: Date | null): number {
    if (!lastReminderAt) return 0;
    return SIGNUP_FOLLOWUP_DAYS.filter((d) => lastReminderAt.getTime() >= since.getTime() + d * DAY_MS).length;
  }

  // La relance due maintenant (0, 1 ou 2), ou null. Si la tâche a manqué des jours, une seule relance part : la plus récente.
  static dueStep(since: Date, lastReminderAt: Date | null, now: Date): number | null {
    const elapsed = (now.getTime() - since.getTime()) / DAY_MS;
    const reached = SIGNUP_FOLLOWUP_DAYS.filter((d) => elapsed >= d).length;
    if (reached === 0) return null;
    return SignupFollowupService.remindersSent(since, lastReminderAt) >= reached ? null : reached - 1;
  }

  async runDaily(now = new Date()) {
    const summary = { consent: 0, payment: 0, team: 0 };
    for (const row of await this.pending()) {
      const { stage, since } = await this.stageOf(row.patient);
      if (stage === 'ZONE') continue;
      // Le parent a répondu STOP au message de bienvenue : c'est un refus, on n'insiste pas auprès de la famille
      if (stage === 'CONSENT' && row.patient.whatsappOptOutAt) continue;
      const step = SignupFollowupService.dueStep(since, row.sub.lastReminderAt, now);
      if (step === null) continue;
      // Un paiement Mobile Money est peut-être en train d'être validé sur le téléphone
      if (stage === 'PAYMENT' && (await this.paymentInProgress(row.sub.id, now))) continue;

      // Marque la relance d'abord : une seconde exécution simultanée ne renverra pas le même message
      const [claimed] = await this.db
        .update(subscriptions)
        .set({ lastReminderAt: now })
        .where(and(eq(subscriptions.id, row.sub.id), eq(subscriptions.status, 'PENDING')))
        .returning({ id: subscriptions.id });
      if (!claimed) continue;

      try {
        if (stage === 'CONSENT') await this.remindConsent(row, step, now);
        else await this.remindPayment(row, step, now);
        summary[stage === 'CONSENT' ? 'consent' : 'payment']++;
        if (step === SIGNUP_FOLLOWUP_DAYS.length - 1) {
          await this.alertTeam(row, stage, since);
          summary.team++;
        }
      } catch (e) {
        this.logger.error(`Relance de l'inscription ${row.patient.id} : ${(e as Error).message}`);
      }
    }
    return summary;
  }

  private async paymentInProgress(subscriptionId: string, now: Date) {
    const [p] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.subscriptionId, subscriptionId), eq(payments.status, 'PENDING'), gt(payments.createdAt, new Date(now.getTime() - DAY_MS))))
      .limit(1);
    return Boolean(p);
  }

  private async lastFailure(subscriptionId: string) {
    const [p] = await this.db
      .select({ status: payments.status, reason: payments.failureReason })
      .from(payments)
      .where(eq(payments.subscriptionId, subscriptionId))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (p?.status !== 'FAILED') return null;
    const reason = p.reason?.trim() || 'paiement non validé';
    return reason.charAt(0).toLowerCase() + reason.slice(1);
  }

  private async remindConsent({ patient: p, family }: Row, step: number, now: Date) {
    const name = p.firstName;
    const link = appUrl(`/consentement/${p.consentToken}`);
    const how = p.hasSmartphone
      ? `Nous lui avons envoyé un message WhatsApp au ${p.whatsappPhone} : il lui suffit de répondre OUI. ` +
        `Vous pouvez aussi l’appeler et lui faire suivre ce lien : ${link}`
      : `Votre parent n’a pas WhatsApp : ouvrez ce lien avec lui, au téléphone ou lors d’une visite, pour qu’il ou elle confirme : ${link}`;
    const subjects = [
      `${name} n’a pas encore confirmé son accord`,
      `Le suivi de ${name} attend son accord`,
      `Dernier rappel : l’accord de ${name}`,
    ];
    const bodies = [
      `Vous avez inscrit ${name} ${p.lastName} au suivi Proche Santé. Avant de commencer, ${name} doit donner son accord pour être suivi(e) : c’est sa décision.\n${how}`,
      `${name} n’a toujours pas confirmé son accord. Souvent, le message est passé inaperçu ou le numéro n’est pas le bon : ` +
        `vérifiez le numéro dans sa fiche si besoin.\n${how}`,
      `Sans l’accord de ${name}, nous ne pouvons pas démarrer son suivi. Notre équipe va vous appeler pour vous aider.\n${how}\n\n` +
        `Si vous ne souhaitez plus l’inscrire, vous pouvez supprimer son dossier depuis sa fiche, rubrique « Données personnelles ».`,
    ];
    await this.notify.user(family.id, subjects[step], bodies[step], { patientId: p.id });
    // À la deuxième relance, on renvoie aussi le message de bienvenue au parent (une fois)
    if (step === 1) {
      await this.wa.welcome(p, `${family.firstName} ${family.lastName}`, `welcome:${p.id}:relance`).catch(() => undefined);
    }
    this.logger.log(`Relance accord ${step + 1}/3 pour ${p.id} (${fmtDay(now)})`);
  }

  private async remindPayment({ sub, patient: p, family }: Row, step: number, now: Date) {
    const name = p.firstName;
    const amountXaf = fmtXaf(eurToXaf(PLAN_PRICES_EUR[sub.plan]) + eurToXaf(SIGNUP_FEE_EUR));
    const amountEur = `${PLAN_PRICES_EUR[sub.plan] + SIGNUP_FEE_EUR} €`;
    const payUrl = appUrl(`/parents/${p.id}/paiement`);
    const failure = await this.lastFailure(sub.id);
    const pay =
      `Premier paiement : ${amountEur} ou ${amountXaf} par Mobile Money (formule ${PLAN_LABELS[sub.plan]} et frais d’inscription, une seule fois).\n` +
      `Payer maintenant : ${payUrl}` +
      (failure ? `\n\nVotre dernière tentative n’a pas abouti (${failure}). Vous pouvez réessayer, ou choisir un autre moyen de paiement.` : '');
    const subjects = [
      `${name} a donné son accord : il ne reste que le paiement`,
      `Le suivi de ${name} peut commencer dès le paiement`,
      `Dernier rappel : le suivi de ${name}`,
    ];
    const bodies = [
      `Bonne nouvelle : ${name} a donné son accord pour être suivi(e). Dès le premier paiement, un médecin l’appelle pour le bilan de départ.\n\n${pay}`,
      `Le dossier de ${name} est complet. Il ne manque que le premier paiement : nous désignons alors son médecin, sa pharmacie et son infirmier, et fixons le bilan de départ.\n\n${pay}`,
      `Le suivi de ${name} n’a pas encore démarré. Si quelque chose vous bloque (moyen de paiement, prix, question sur le service), ` +
        `répondez à ce message ou écrivez-nous depuis votre espace : notre équipe va aussi vous appeler.\n\n${pay}\n\n` +
        `Si vous ne souhaitez plus l’inscrire, vous pouvez supprimer son dossier depuis sa fiche, rubrique « Données personnelles ».`,
    ];
    await this.notify.user(family.id, subjects[step], bodies[step], { patientId: p.id });
    this.logger.log(`Relance paiement ${step + 1}/3 pour ${p.id} (${fmtDay(now)})`);
  }

  private async alertTeam({ patient: p, family }: Row, stage: SignupStage, since: Date) {
    const what = stage === 'CONSENT' ? `le parent n’a pas confirmé son accord depuis le ${fmtDay(since)}` : `pas de paiement depuis l’accord du parent, le ${fmtDay(since)}`;
    await this.notify.admins(
      `Inscription à appeler : ${p.firstName} ${p.lastName}`,
      `Troisième relance envoyée sans résultat : ${what}.\n` +
        `Famille : ${family.firstName} ${family.lastName}, ${family.phone ?? 'pas de téléphone'}, ${family.email}\n` +
        `Liste des inscriptions en attente : ${appUrl('/admin/paiements?onglet=inscriptions')}`,
    );
  }

  // Back-office : toutes les inscriptions en attente, avec leur étape et les relances envoyées
  async list(now = new Date()) {
    const rows = await this.pending();
    const out = [];
    for (const r of rows) {
      const { stage, since } = await this.stageOf(r.patient);
      const failure = stage === 'PAYMENT' ? await this.lastFailure(r.sub.id) : null;
      out.push({
        patientId: r.patient.id,
        patient: `${r.patient.firstName} ${r.patient.lastName}`,
        city: r.patient.city,
        district: r.patient.district,
        plan: r.sub.plan,
        stage,
        stopped: stage === 'CONSENT' && Boolean(r.patient.whatsappOptOutAt), // le parent a répondu STOP
        since,
        days: Math.floor((now.getTime() - since.getTime()) / DAY_MS),
        createdAt: r.patient.createdAt,
        reminders: SignupFollowupService.remindersSent(since, r.sub.lastReminderAt),
        lastReminderAt: r.sub.lastReminderAt,
        lastFailure: failure,
        family: `${r.family.firstName} ${r.family.lastName}`,
        email: r.family.email,
        phone: r.family.phone,
      });
    }
    return out;
  }

  // Taux de conversion des inscriptions des 30 derniers jours (pour le pilotage)
  async conversion(now = new Date()) {
    const from = new Date(now.getTime() - 30 * DAY_MS);
    const rows = await this.db
      .select({ paid: subscriptions.signupFeePaidAt })
      .from(subscriptions)
      .innerJoin(patients, eq(patients.id, subscriptions.patientId))
      .where(and(gt(patients.createdAt, from), isNull(patients.erasedAt)));
    const paid = rows.filter((r) => r.paid !== null).length;
    return { signups: rows.length, paid, rate: rows.length ? paid / rows.length : null };
  }
}
