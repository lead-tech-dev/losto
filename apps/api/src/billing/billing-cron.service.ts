import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, lte } from 'drizzle-orm';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import { subscriptions } from '../db/schema';
import { eurToXaf, PLAN_PRICES_EUR } from '../patients/plans';
import { BillingService } from './billing.service';
import { DAY_MS, fmtDay, fmtXaf } from './billing.util';

// Rappels et relances Mobile Money (la carte est renouvelée et relancée par Stripe).
//
//   J-5  rappel : « le suivi arrive à échéance, renouvelez »
//   J0   échéance passée sans paiement → PAST_DUE + relance
//   J+3  deuxième relance
//   J+7  suspension du suivi + e-mail
//   Résiliation demandée → l'abonnement se termine à l'échéance, sans relance.
export const REMIND_BEFORE_DAYS = 5;
export const SECOND_REMINDER_DAYS = 3;
export const SUSPEND_AFTER_DAYS = 7;

@Injectable()
export class BillingCronService {
  private readonly logger = new Logger(BillingCronService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly billing: BillingService,
  ) {}

  // Tous les jours à 8 h, heure du Cameroun
  @Cron('0 8 * * *', { timeZone: 'Africa/Douala' })
  async daily() {
    const summary = await this.runDaily(new Date());
    this.logger.log(`Facturation quotidienne : ${JSON.stringify(summary)}`);
  }

  async runDaily(now: Date) {
    const summary = { reminders: 0, pastDue: 0, suspended: 0, ended: 0, expiredPayments: 0 };
    summary.expiredPayments = await this.billing.expireStaleMobilePayments(now);

    const due = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.paymentMethod, 'MOBILE_MONEY'),
          lte(subscriptions.currentPeriodEnd, new Date(now.getTime() + REMIND_BEFORE_DAYS * DAY_MS)),
        ),
      );

    for (const sub of due) {
      if (!sub.currentPeriodEnd || !['ACTIVE', 'PAST_DUE'].includes(sub.status)) continue;
      const end = sub.currentPeriodEnd;
      const days = (now.getTime() - end.getTime()) / DAY_MS; // négatif avant l'échéance
      // Un rappel par étape : on n'envoie que si le dernier rappel date d'avant le début de l'étape
      const sentSince = (stageStart: Date) => sub.lastReminderAt !== null && sub.lastReminderAt >= stageStart;
      const name = await this.billing.patientName(sub.patientId);
      const plan = sub.pendingPlan ?? sub.plan;
      const amount = fmtXaf(eurToXaf(PLAN_PRICES_EUR[plan]));
      const payUrl = appUrl(`/parents/${sub.patientId}/paiement`);

      if (sub.status === 'ACTIVE' && days >= 0) {
        if (sub.cancelAtPeriodEnd) {
          await this.set(sub.id, { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false });
          await this.billing.notify(sub.payerId, `Fin du suivi de ${name}`, `Comme demandé, le suivi de ${name} s’est terminé le ${fmtDay(end)}.`);
          summary.ended++;
          continue;
        }
        await this.set(sub.id, { status: 'PAST_DUE', lastReminderAt: now });
        await this.billing.notify(
          sub.payerId,
          `Renouvellement en attente pour ${name}`,
          `Le mois de suivi de ${name} s’est terminé le ${fmtDay(end)}. Pour continuer sans interruption, ` +
            `réglez ${amount} par Mobile Money : ${payUrl}`,
        );
        summary.pastDue++;
        continue;
      }

      if (sub.status === 'ACTIVE' && days < 0 && !sub.cancelAtPeriodEnd) {
        const stageStart = new Date(end.getTime() - REMIND_BEFORE_DAYS * DAY_MS);
        if (sentSince(stageStart)) continue;
        await this.set(sub.id, { lastReminderAt: now });
        await this.billing.notify(
          sub.payerId,
          `Le suivi de ${name} arrive à échéance le ${fmtDay(end)}`,
          `Pour renouveler le suivi de ${name} pour un mois, réglez ${amount} par Mobile Money : ${payUrl}\n` +
            `Le nouveau mois commencera le ${fmtDay(end)}, sans perdre de jours.`,
        );
        summary.reminders++;
        continue;
      }

      if (sub.status === 'PAST_DUE') {
        if (days >= SUSPEND_AFTER_DAYS) {
          await this.set(sub.id, { status: 'SUSPENDED', lastReminderAt: now });
          await this.billing.notify(
            sub.payerId,
            `Suivi de ${name} suspendu`,
            `Sans paiement depuis le ${fmtDay(end)}, le suivi de ${name} est suspendu : plus de consultations ni de rappels.\n` +
              `Il reprend dès le paiement de ${amount} : ${payUrl}`,
          );
          summary.suspended++;
        } else if (days >= SECOND_REMINDER_DAYS && !sentSince(new Date(end.getTime() + SECOND_REMINDER_DAYS * DAY_MS))) {
          await this.set(sub.id, { lastReminderAt: now });
          await this.billing.notify(
            sub.payerId,
            `Dernier rappel : suivi de ${name}`,
            `Le paiement du suivi de ${name} est toujours en attente. Sans paiement d’ici le ` +
              `${fmtDay(new Date(end.getTime() + SUSPEND_AFTER_DAYS * DAY_MS))}, le suivi sera suspendu.\n` +
              `Réglez ${amount} par Mobile Money : ${payUrl}`,
          );
          summary.reminders++;
        }
      }
    }
    return summary;
  }

  private set(id: string, patch: Partial<typeof subscriptions.$inferInsert>) {
    return this.db.update(subscriptions).set(patch).where(eq(subscriptions.id, id));
  }
}
