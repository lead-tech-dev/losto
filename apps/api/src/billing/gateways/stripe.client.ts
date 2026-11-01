import { Injectable, ServiceUnavailableException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

// Paiement par carte (abonnement mensuel renouvelé automatiquement) via Stripe.
// Les prix sont envoyés à chaque création (price_data) : rien à préparer dans le tableau de bord Stripe.

export interface SubscriptionCheckoutInput {
  customerId: string;
  planName: string;
  monthlyCents: number;
  signupFeeCents: number; // 0 si déjà payé
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}

export interface OneTimeCheckoutInput {
  customerId: string;
  label: string;
  amountCents: number;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}

// Forme minimale d'un événement Stripe : seuls les champs utilisés sont lus.
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

export abstract class StripeGateway {
  abstract get configured(): boolean;
  abstract ensureCustomer(existingId: string | null, email: string, name: string): Promise<string>;
  abstract createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ id: string; url: string }>;
  abstract createOneTimeCheckout(input: OneTimeCheckoutInput): Promise<{ id: string; url: string }>;
  abstract changePlan(subscriptionId: string, planName: string, monthlyCents: number): Promise<void>;
  abstract setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>;
  abstract billingPortalUrl(customerId: string, returnUrl: string): Promise<string>;
  abstract verifyWebhook(rawBody: Buffer, signature: string): StripeEvent;
  // Rembourse intégralement le paiement (session Checkout « cs_… » ou facture « in_… ») ; renvoie l'identifiant du remboursement
  abstract refund(providerRef: string): Promise<string>;
}

@Injectable()
export class StripeClient extends StripeGateway {
  private readonly stripe: Stripe;
  private readonly hasKey: boolean;
  private readonly webhookSecret?: string;

  constructor(config: ConfigService) {
    super();
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.hasKey = Boolean(key);
    // Sans clé, l'instance ne sert qu'à vérifier les signatures (calcul local, aucun appel réseau)
    this.stripe = new Stripe(key || 'sk_test_non_configure');
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET');
  }

  get configured(): boolean {
    return this.hasKey;
  }

  private ensureConfigured() {
    if (!this.hasKey) throw new ServiceUnavailableException('Le paiement par carte n’est pas encore configuré');
  }

  async refund(providerRef: string): Promise<string> {
    this.ensureConfigured();
    let paymentIntent: string | undefined;
    if (providerRef.startsWith('cs_')) {
      const session = await this.stripe.checkout.sessions.retrieve(providerRef);
      paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      // Abonnement : le premier paiement passe par la facture de la session
      if (!paymentIntent && session.invoice) return this.refund(typeof session.invoice === 'string' ? session.invoice : session.invoice.id!);
    } else if (providerRef.startsWith('in_')) {
      const list = await this.stripe.invoicePayments.list({ invoice: providerRef, limit: 1 });
      const pi = list.data[0]?.payment?.payment_intent;
      paymentIntent = typeof pi === 'string' ? pi : pi?.id;
    }
    if (!paymentIntent) throw new BadRequestException('Paiement introuvable chez Stripe : remboursez depuis le tableau de bord Stripe');
    const refund = await this.stripe.refunds.create({ payment_intent: paymentIntent, reason: 'requested_by_customer' });
    return refund.id;
  }

  async ensureCustomer(existingId: string | null, email: string, name: string): Promise<string> {
    this.ensureConfigured();
    if (existingId) return existingId;
    const c = await this.stripe.customers.create({ email, name });
    return c.id;
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput) {
    this.ensureConfigured();
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: input.monthlyCents,
          recurring: { interval: 'month' },
          product_data: { name: `Proche Santé · Formule ${input.planName}` },
        },
      },
    ];
    if (input.signupFeeCents > 0) {
      // Prix sans "recurring" : facturé une seule fois, sur la première facture
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: input.signupFeeCents,
          product_data: { name: 'Inscription (appareil de mesure et bilan de départ)' },
        },
      });
    }
    const s = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      line_items: lineItems,
      metadata: input.metadata,
      subscription_data: { metadata: input.metadata },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: 'fr',
    });
    return { id: s.id, url: s.url! };
  }

  async createOneTimeCheckout(input: OneTimeCheckoutInput) {
    this.ensureConfigured();
    const s = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: input.customerId,
      line_items: [
        { quantity: 1, price_data: { currency: 'eur', unit_amount: input.amountCents, product_data: { name: input.label } } },
      ],
      metadata: input.metadata,
      payment_intent_data: { metadata: input.metadata },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: 'fr',
    });
    return { id: s.id, url: s.url! };
  }

  // Changement de formule en cours de mois : Stripe calcule le prorata sur la prochaine facture.
  async changePlan(subscriptionId: string, planName: string, monthlyCents: number) {
    this.ensureConfigured();
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
    const item = sub.items.data[0];
    const product = await this.stripe.products.create({ name: `Proche Santé · Formule ${planName}` });
    await this.stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: item.id,
          price_data: { currency: 'eur', unit_amount: monthlyCents, recurring: { interval: 'month' }, product: product.id },
        },
      ],
      proration_behavior: 'create_prorations',
      metadata: { ...sub.metadata },
    });
  }

  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean) {
    this.ensureConfigured();
    await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
  }

  // Page Stripe où la famille met à jour sa carte (utile après un impayé)
  async billingPortalUrl(customerId: string, returnUrl: string) {
    this.ensureConfigured();
    const s = await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return s.url;
  }

  verifyWebhook(rawBody: Buffer, signature: string): StripeEvent {
    if (!this.webhookSecret) throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET manquant');
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret) as unknown as StripeEvent;
    } catch {
      throw new UnauthorizedException('Signature Stripe invalide');
    }
  }
}
