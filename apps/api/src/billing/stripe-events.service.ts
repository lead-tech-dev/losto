import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { appUrl } from '../common/app-url';
import { Database, DB } from '../db/db.module';
import { payments, Subscription, subscriptions } from '../db/schema';
import { PLAN_LABELS } from '../patients/plans';
import { BillingService, PaymentLine } from './billing.service';
import { fmtEur } from './billing.util';
import { StripeEvent } from './gateways/stripe.client';

// Traite les notifications Stripe (déjà vérifiées par signature).
// Chaque traitement est idempotent : Stripe peut envoyer le même événement plusieurs fois.
@Injectable()
export class StripeEventsService {
  private readonly logger = new Logger(StripeEventsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly billing: BillingService,
  ) {}

  async handle(event: StripeEvent): Promise<void> {
    const o = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
        return this.checkoutCompleted(o);
      case 'checkout.session.expired':
        return this.checkoutExpired(o);
      case 'invoice.paid':
        return this.invoicePaid(o);
      case 'invoice.payment_failed':
        return this.invoiceFailed(o);
      case 'customer.subscription.updated':
        return this.subscriptionUpdated(o);
      case 'customer.subscription.deleted':
        return this.subscriptionDeleted(o);
      default:
        return; // les autres événements ne nous concernent pas
    }
  }

  private async checkoutCompleted(s: Record<string, any>) {
    if (s.mode === 'subscription' && s.metadata?.subscriptionId && s.subscription) {
      // Lie l'abonnement Stripe à notre abonnement ; l'activation se fait sur la facture payée
      await this.db
        .update(subscriptions)
        .set({ stripeSubscriptionId: String(s.subscription), paymentMethod: 'CARD' })
        .where(eq(subscriptions.id, s.metadata.subscriptionId));
    }
    if (s.mode === 'payment' && s.metadata?.paymentId && s.payment_status === 'paid') {
      await this.billing.settleSucceeded(s.metadata.paymentId);
    }
  }

  private async checkoutExpired(s: Record<string, any>) {
    if (s.mode === 'payment' && s.metadata?.paymentId) {
      await this.billing.settleFailed(s.metadata.paymentId, 'Paiement par carte abandonné');
    }
  }

  // Facture d'abonnement payée (premier mois ou renouvellement automatique)
  private async invoicePaid(inv: Record<string, any>) {
    const sub = await this.subscriptionForInvoice(inv);
    if (!sub) return;
    const meta = this.invoiceSubscriptionMeta(inv);
    const lines: PaymentLine[] = (inv.lines?.data ?? []).map((l: Record<string, any>) => ({
      label: String(l.description ?? 'Abonnement'),
      amount: Number(l.amount ?? 0),
    }));
    // Fin de la période payée = fin de la ligne d'abonnement (date Unix en secondes)
    const recurring = (inv.lines?.data ?? []).find((l: Record<string, any>) => l.period?.end && l.period.end !== l.period.start);
    const periodEnd = recurring ? new Date(recurring.period.end * 1000) : undefined;
    const periodStart = recurring ? new Date(recurring.period.start * 1000) : undefined;
    const includesSignupFee = inv.billing_reason === 'subscription_create' && meta?.includesSignupFee === '1';

    const paymentId = await this.upsertInvoicePayment(inv, sub, lines, { periodStart, periodEnd, includesSignupFee });
    await this.billing.settleSucceeded(paymentId, { periodEnd, amount: Number(inv.amount_paid) });
  }

  private async invoiceFailed(inv: Record<string, any>) {
    const sub = await this.subscriptionForInvoice(inv);
    if (!sub) return;
    const paymentId = await this.upsertInvoicePayment(inv, sub, [{ label: 'Abonnement mensuel', amount: Number(inv.amount_due) }], {});
    await this.billing.settleFailed(paymentId, 'Carte refusée');
    if (sub.status === 'ACTIVE') {
      await this.db.update(subscriptions).set({ status: 'PAST_DUE' }).where(eq(subscriptions.id, sub.id));
    }
    const name = await this.billing.patientName(sub.patientId);
    await this.billing.notify(
      sub.payerId,
      'Votre paiement par carte a échoué',
      `Le prélèvement de ${fmtEur(Number(inv.amount_due))} pour le suivi de ${name} n’a pas abouti.\n` +
        `Nous réessaierons automatiquement dans les prochains jours. Pour éviter l’interruption du suivi, ` +
        `vérifiez ou changez votre carte : ${appUrl(`/parents/${sub.patientId}`)}`,
    );
  }

  private async subscriptionUpdated(s: Record<string, any>) {
    const sub = await this.byStripeId(s.id);
    if (!sub) return;
    const patch: Partial<Subscription> = { cancelAtPeriodEnd: Boolean(s.cancel_at_period_end) };
    // "unpaid" = Stripe a épuisé ses relances : le suivi est suspendu
    if (s.status === 'unpaid' && sub.status !== 'SUSPENDED') {
      patch.status = 'SUSPENDED';
      const name = await this.billing.patientName(sub.patientId);
      await this.billing.notify(
        sub.payerId,
        `Suivi de ${name} suspendu`,
        `Malgré plusieurs tentatives, le paiement par carte n’a pas pu être effectué. Le suivi de ${name} est suspendu.\n` +
          `Pour le reprendre, mettez à jour votre carte : ${appUrl(`/parents/${sub.patientId}`)}`,
      );
    }
    if (s.status === 'past_due' && sub.status === 'ACTIVE') patch.status = 'PAST_DUE';
    await this.db.update(subscriptions).set(patch).where(eq(subscriptions.id, sub.id));
  }

  private async subscriptionDeleted(s: Record<string, any>) {
    const sub = await this.byStripeId(s.id);
    if (!sub || sub.status === 'CANCELED') return;
    await this.db
      .update(subscriptions)
      .set({ status: 'CANCELED', canceledAt: new Date(), cancelAtPeriodEnd: false })
      .where(eq(subscriptions.id, sub.id));
    const name = await this.billing.patientName(sub.patientId);
    await this.billing.notify(
      sub.payerId,
      `Fin du suivi de ${name}`,
      `L’abonnement de ${name} (formule ${PLAN_LABELS[sub.plan]}) est terminé. Vous pouvez le reprendre à tout moment depuis votre espace.`,
    );
  }

  // ---------- Aides ----------

  // Champs déplacés selon la version de l'API Stripe : on lit les deux emplacements
  private invoiceSubscriptionMeta(inv: Record<string, any>): Record<string, string> | undefined {
    return inv.parent?.subscription_details?.metadata ?? inv.subscription_details?.metadata;
  }

  private invoiceStripeSubscriptionId(inv: Record<string, any>): string | undefined {
    const v = inv.parent?.subscription_details?.subscription ?? inv.subscription;
    return v ? String(typeof v === 'object' ? v.id : v) : undefined;
  }

  private async subscriptionForInvoice(inv: Record<string, any>): Promise<Subscription | null> {
    const stripeSubId = this.invoiceStripeSubscriptionId(inv);
    const localId = this.invoiceSubscriptionMeta(inv)?.subscriptionId;
    let sub: Subscription | undefined;
    if (localId) [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, localId)).limit(1);
    if (!sub && stripeSubId) sub = (await this.byStripeId(stripeSubId)) ?? undefined;
    if (!sub) {
      this.logger.warn(`Facture Stripe ${inv.id} sans abonnement correspondant`);
      return null;
    }
    // La facture peut arriver avant "checkout.session.completed" : on lie l'abonnement Stripe ici aussi
    if (stripeSubId && sub.stripeSubscriptionId !== stripeSubId) {
      await this.db
        .update(subscriptions)
        .set({ stripeSubscriptionId: stripeSubId, paymentMethod: 'CARD' })
        .where(eq(subscriptions.id, sub.id));
    }
    return sub;
  }

  private async byStripeId(stripeSubscriptionId: string): Promise<Subscription | null> {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return sub ?? null;
  }

  // Une ligne de paiement par facture Stripe (la même facture peut échouer puis réussir après relance)
  private async upsertInvoicePayment(
    inv: Record<string, any>,
    sub: Subscription,
    lines: PaymentLine[],
    extra: { periodStart?: Date; periodEnd?: Date; includesSignupFee?: boolean },
  ): Promise<string> {
    const [existing] = await this.db
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(and(eq(payments.provider, 'STRIPE'), eq(payments.providerRef, String(inv.id))))
      .limit(1);
    if (existing) {
      if (existing.status === 'FAILED') {
        await this.db.update(payments).set({ status: 'PENDING', lines }).where(eq(payments.id, existing.id));
      }
      return existing.id;
    }
    const [p] = await this.db
      .insert(payments)
      .values({
        payerId: sub.payerId,
        patientId: sub.patientId,
        subscriptionId: sub.id,
        kind: 'SUBSCRIPTION',
        provider: 'STRIPE',
        method: 'CARD',
        amount: Number(inv.amount_paid || inv.amount_due || 0),
        currency: 'EUR',
        lines,
        plan: sub.plan,
        includesSignupFee: extra.includesSignupFee ?? false,
        periodStart: extra.periodStart,
        periodEnd: extra.periodEnd,
        providerRef: String(inv.id),
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });
    if (p) return p.id;
    // Insertion concurrente du même événement : on relit
    const [again] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.provider, 'STRIPE'), eq(payments.providerRef, String(inv.id))));
    return again.id;
  }
}
