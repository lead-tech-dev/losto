import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { appUrl } from '../common/app-url';
import { CoverageService } from '../coverage/coverage.service';
import { Database, DB } from '../db/db.module';
import {
  consultations,
  invoiceNumberSeq,
  patients,
  Payment,
  PaymentMethod,
  payments,
  Plan,
  prescriptions,
  Subscription,
  subscriptions,
  users,
} from '../db/schema';
import { MailerService } from '../mail/mailer.service';
import { PatientAccessService } from '../patients/patient-access.service';
import { eurToXaf, PLAN_LABELS, PLAN_PRICES_EUR, SIGNUP_FEE_EUR, xafToEurCents } from '../patients/plans';
import { addOneMonth, DAY_MS, fmtAmount, fmtDay, mchRef, toTranzakNumber } from './billing.util';
import { StripeGateway } from './gateways/stripe.client';
import { TranzakGateway, TranzakRequest } from './gateways/tranzak.client';

export interface PaymentLine {
  label: string;
  amount: number;
}

// Un renouvellement Mobile Money peut être payé dans les 7 jours qui précèdent l'échéance.
export const RENEWAL_WINDOW_DAYS = 7;
// Après ce délai sans validation sur le téléphone, une demande Mobile Money est abandonnée.
const MOBILE_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
// Une demande encore en attente depuis moins de 5 minutes est réutilisée (pas de double notification).
const MOBILE_REUSE_MS = 5 * 60 * 1000;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: PatientAccessService,
    private readonly coverage: CoverageService,
    private readonly stripe: StripeGateway,
    private readonly tranzak: TranzakGateway,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  // ================= Lecture =================

  async subscriptionView(userId: string, patientId: string) {
    const { patient, role } = await this.access.resolve(userId, patientId);
    const sub = await this.subscriptionOf(patientId);
    const nextPlan = sub.pendingPlan ?? sub.plan;
    const signupDue = !sub.signupFeePaidAt;
    const [pending] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.subscriptionId, sub.id), eq(payments.status, 'PENDING')))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    return {
      role,
      status: sub.status,
      plan: sub.plan,
      pendingPlan: sub.pendingPlan,
      paymentMethod: sub.paymentMethod,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      priceEur: PLAN_PRICES_EUR[sub.plan],
      // Ce que coûterait le prochain paiement, dans chaque monnaie
      nextPayment: {
        plan: nextPlan,
        eur: PLAN_PRICES_EUR[nextPlan] + (signupDue ? SIGNUP_FEE_EUR : 0),
        xaf: eurToXaf(PLAN_PRICES_EUR[nextPlan]) + (signupDue ? eurToXaf(SIGNUP_FEE_EUR) : 0),
        includesSignupFee: signupDue,
      },
      canPay: this.payability(sub, patient.consentGivenAt !== null, await this.coverage.isCovered(patient.city, patient.district)),
      pendingPayment: pending ? this.paymentView(pending) : null,
      cardConfigured: this.stripe.configured,
      mobileMoneyConfigured: this.tranzak.configured,
    };
  }

  // Ce que la famille peut payer maintenant, et sinon pourquoi
  private payability(sub: Subscription, consent: boolean, covered: boolean) {
    const blocked = (reason: string) => ({ card: false, mobileMoney: false, reason });
    if (!covered) return blocked('Le quartier de votre parent n’est pas encore desservi.');
    if (!consent) return blocked('Votre parent doit d’abord confirmer son accord.');

    const liveCard = sub.paymentMethod === 'CARD' && sub.stripeSubscriptionId && sub.status !== 'CANCELED';
    if (liveCard) {
      return {
        card: false,
        mobileMoney: false,
        reason:
          sub.status === 'ACTIVE'
            ? 'Votre carte est débitée automatiquement chaque mois.'
            : 'Mettez à jour votre carte pour régulariser le paiement.',
      };
    }
    if (sub.status === 'ACTIVE' && sub.currentPeriodEnd) {
      const inWindow = sub.currentPeriodEnd.getTime() - Date.now() <= RENEWAL_WINDOW_DAYS * DAY_MS;
      if (!inWindow) {
        return blocked(`Suivi payé jusqu’au ${fmtDay(sub.currentPeriodEnd)}. Le renouvellement sera possible 7 jours avant.`);
      }
      // Renouvellement : Mobile Money seulement (passer à la carte démarrerait un nouveau mois tout de suite)
      return { card: false, mobileMoney: true, reason: null };
    }
    return { card: true, mobileMoney: true, reason: null };
  }

  async listPayments(userId: string) {
    const rows = await this.db
      .select({ p: payments, patientFirstName: patients.firstName, patientLastName: patients.lastName })
      .from(payments)
      .innerJoin(patients, eq(patients.id, payments.patientId))
      .where(eq(payments.payerId, userId))
      .orderBy(desc(payments.createdAt));
    return rows.map((r) => ({ ...this.paymentView(r.p), patientName: `${r.patientFirstName} ${r.patientLastName}` }));
  }

  // Le statut d'un paiement Mobile Money est vérifié auprès de Tranzak à chaque consultation tant qu'il est en attente.
  async getPayment(userId: string, paymentId: string) {
    let p = await this.ownPayment(userId, paymentId);
    if (p.status === 'PENDING' && p.provider === 'TRANZAK' && p.providerRef) {
      p = (await this.refreshTranzakPayment(p)) ?? p;
    }
    return this.paymentView(p);
  }

  async ownPayment(userId: string, paymentId: string): Promise<Payment> {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!p || p.payerId !== userId) throw new NotFoundException('Paiement introuvable');
    return p;
  }

  paymentView(p: Payment) {
    return {
      id: p.id,
      kind: p.kind,
      method: p.method,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      amountLabel: fmtAmount(p.amount, p.currency),
      lines: p.lines as PaymentLine[],
      plan: p.plan,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      invoiceNumber: p.invoiceNumber,
      failureReason: p.failureReason,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
      patientId: p.patientId,
    };
  }

  // ================= Démarrer un paiement d'abonnement =================

  async startCardCheckout(userId: string, patientId: string): Promise<{ url: string }> {
    const { patient, sub } = await this.ownerContext(userId, patientId);
    const can = this.payability(sub, Boolean(patient.consentGivenAt), await this.coverage.isCovered(patient.city, patient.district));
    if (!can.card) throw new ConflictException(can.reason);

    const payer = await this.user(userId);
    const customerId = await this.stripe.ensureCustomer(payer.stripeCustomerId, payer.email, `${payer.firstName} ${payer.lastName}`);
    if (customerId !== payer.stripeCustomerId) {
      await this.db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
    }

    const plan = sub.pendingPlan ?? sub.plan;
    const signupFeeCents = sub.signupFeePaidAt ? 0 : SIGNUP_FEE_EUR * 100;
    const session = await this.stripe.createSubscriptionCheckout({
      customerId,
      planName: PLAN_LABELS[plan],
      monthlyCents: PLAN_PRICES_EUR[plan] * 100,
      signupFeeCents,
      metadata: {
        subscriptionId: sub.id,
        patientId,
        plan,
        includesSignupFee: signupFeeCents > 0 ? '1' : '0',
      },
      successUrl: appUrl(`/parents/${patientId}?paiement=carte`),
      cancelUrl: appUrl(`/parents/${patientId}/paiement`),
    });
    await this.audit.log(userId, 'billing.card_checkout', 'Subscription', sub.id);
    return { url: session.url };
  }

  async startMobileMoney(userId: string, patientId: string, phone: string) {
    const { patient, sub } = await this.ownerContext(userId, patientId);
    const can = this.payability(sub, Boolean(patient.consentGivenAt), await this.coverage.isCovered(patient.city, patient.district));
    if (!can.mobileMoney) throw new ConflictException(can.reason);

    const reused = await this.reusablePending(eq(payments.subscriptionId, sub.id));
    if (reused) return this.paymentView(reused);

    const plan = sub.pendingPlan ?? sub.plan;
    const lines: PaymentLine[] = [{ label: `Formule ${PLAN_LABELS[plan]}, 1 mois`, amount: eurToXaf(PLAN_PRICES_EUR[plan]) }];
    if (!sub.signupFeePaidAt) {
      lines.push({ label: 'Inscription (appareil de mesure et bilan de départ)', amount: eurToXaf(SIGNUP_FEE_EUR) });
    }
    return this.chargeMobile({
      userId,
      patientId,
      subscriptionId: sub.id,
      kind: 'SUBSCRIPTION',
      plan,
      includesSignupFee: !sub.signupFeePaidAt,
      lines,
      phone,
      description: `Proche Santé - suivi de ${patient.firstName} ${patient.lastName}`,
    });
  }

  // ================= Médicaments =================

  async payPrescription(userId: string, prescriptionId: string, method: PaymentMethod, phone?: string) {
    const [row] = await this.db
      .select({ p: prescriptions, patientId: consultations.patientId })
      .from(prescriptions)
      .innerJoin(consultations, eq(consultations.id, prescriptions.consultationId))
      .where(eq(prescriptions.id, prescriptionId))
      .limit(1);
    if (!row) throw new NotFoundException('Ordonnance introuvable');
    const patient = await this.access.requireOwner(userId, row.patientId);
    if (row.p.status !== 'AWAITING_PAYMENT' || !row.p.priceXaf) {
      throw new ConflictException('Cette ordonnance n’attend pas de paiement');
    }
    const label = `Médicaments, ordonnance du ${fmtDay(row.p.createdAt)}`;

    if (method === 'MOBILE_MONEY') {
      if (!phone) throw new BadRequestException('Numéro Mobile Money requis');
      const reused = await this.reusablePending(eq(payments.prescriptionId, prescriptionId));
      if (reused) return { kind: 'mobile' as const, payment: this.paymentView(reused) };
      const payment = await this.chargeMobile({
        userId,
        patientId: row.patientId,
        prescriptionId,
        kind: 'MEDICATION',
        lines: [{ label, amount: row.p.priceXaf }],
        phone,
        description: `Proche Santé - médicaments de ${patient.firstName}`,
      });
      return { kind: 'mobile' as const, payment };
    }

    // Carte : prix de la pharmacie (FCFA) converti en euros au taux fixe
    const payer = await this.user(userId);
    const customerId = await this.stripe.ensureCustomer(payer.stripeCustomerId, payer.email, `${payer.firstName} ${payer.lastName}`);
    if (customerId !== payer.stripeCustomerId) {
      await this.db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
    }
    const cents = xafToEurCents(row.p.priceXaf);
    const [payment] = await this.db
      .insert(payments)
      .values({
        payerId: userId,
        patientId: row.patientId,
        prescriptionId,
        kind: 'MEDICATION',
        provider: 'STRIPE',
        method: 'CARD',
        amount: cents,
        currency: 'EUR',
        lines: [{ label, amount: cents }],
      })
      .returning();
    const session = await this.stripe.createOneTimeCheckout({
      customerId,
      label,
      amountCents: cents,
      metadata: { paymentId: payment.id },
      successUrl: appUrl(`/parents/${row.patientId}?paiement=medicaments`),
      cancelUrl: appUrl(`/parents/${row.patientId}`),
    });
    await this.db.update(payments).set({ providerRef: session.id }).where(eq(payments.id, payment.id));
    return { kind: 'redirect' as const, url: session.url };
  }

  // ================= Formule et résiliation =================

  async changePlan(userId: string, patientId: string, plan: Plan) {
    const { sub } = await this.ownerContext(userId, patientId);
    const liveCard = sub.paymentMethod === 'CARD' && sub.stripeSubscriptionId && sub.status !== 'CANCELED';

    if (liveCard) {
      if (sub.status !== 'ACTIVE') throw new ConflictException('Régularisez d’abord le paiement par carte');
      if (plan !== sub.plan) {
        await this.stripe.changePlan(sub.stripeSubscriptionId!, PLAN_LABELS[plan], PLAN_PRICES_EUR[plan] * 100);
        await this.db.update(subscriptions).set({ plan }).where(eq(subscriptions.id, sub.id));
      }
    } else if (sub.status === 'ACTIVE') {
      // Mobile Money déjà payé pour ce mois : la nouvelle formule s'applique au prochain paiement
      await this.db
        .update(subscriptions)
        .set({ pendingPlan: plan === sub.plan ? null : plan })
        .where(eq(subscriptions.id, sub.id));
    } else {
      await this.db.update(subscriptions).set({ plan, pendingPlan: null }).where(eq(subscriptions.id, sub.id));
    }
    await this.audit.log(userId, 'billing.plan', 'Subscription', sub.id);
    return this.subscriptionView(userId, patientId);
  }

  async cancel(userId: string, patientId: string) {
    const { sub } = await this.ownerContext(userId, patientId);
    if (sub.status === 'CANCELED') throw new ConflictException('Cet abonnement est déjà résilié');

    if (sub.status === 'ACTIVE') {
      // Le suivi continue jusqu'à la fin du mois payé
      if (sub.paymentMethod === 'CARD' && sub.stripeSubscriptionId) {
        await this.stripe.setCancelAtPeriodEnd(sub.stripeSubscriptionId, true);
      }
      await this.db.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.id, sub.id));
    } else {
      // Rien de payé en cours (en attente, impayé, suspendu) : résiliation immédiate
      if (sub.paymentMethod === 'CARD' && sub.stripeSubscriptionId) {
        await this.stripe.setCancelAtPeriodEnd(sub.stripeSubscriptionId, true);
      }
      await this.db
        .update(subscriptions)
        .set({ status: 'CANCELED', canceledAt: new Date(), cancelAtPeriodEnd: false })
        .where(eq(subscriptions.id, sub.id));
    }
    await this.audit.log(userId, 'billing.cancel', 'Subscription', sub.id);
    return this.subscriptionView(userId, patientId);
  }

  async resume(userId: string, patientId: string) {
    const { sub } = await this.ownerContext(userId, patientId);
    if (sub.status !== 'ACTIVE' || !sub.cancelAtPeriodEnd) throw new ConflictException('Aucune résiliation à annuler');
    if (sub.paymentMethod === 'CARD' && sub.stripeSubscriptionId) {
      await this.stripe.setCancelAtPeriodEnd(sub.stripeSubscriptionId, false);
    }
    await this.db.update(subscriptions).set({ cancelAtPeriodEnd: false }).where(eq(subscriptions.id, sub.id));
    await this.audit.log(userId, 'billing.resume', 'Subscription', sub.id);
    return this.subscriptionView(userId, patientId);
  }

  async billingPortal(userId: string, patientId: string) {
    await this.ownerContext(userId, patientId);
    const payer = await this.user(userId);
    if (!payer.stripeCustomerId) throw new ConflictException('Aucune carte enregistrée');
    return { url: await this.stripe.billingPortalUrl(payer.stripeCustomerId, appUrl(`/parents/${patientId}`)) };
  }

  // ================= Règlement =================

  // Demande au fournisseur le vrai statut (on ne se fie jamais au contenu d'une notification).
  async refreshTranzakPayment(p: Payment): Promise<Payment | null> {
    if (p.status !== 'PENDING' || !p.providerRef) return null;
    let req: TranzakRequest;
    try {
      req = await this.tranzak.getRequest(p.providerRef);
    } catch (e) {
      this.logger.warn(`Statut Tranzak indisponible pour ${p.id} : ${(e as Error).message}`);
      return null;
    }
    return this.applyTranzakStatus(p, req);
  }

  private async applyTranzakStatus(p: Payment, req: TranzakRequest): Promise<Payment | null> {
    // Contrôle de cohérence : la demande doit correspondre à ce paiement, au franc près
    if (Number(req.amount) !== p.amount || (req.mchTransactionRef && req.mchTransactionRef !== mchRef(p.id))) {
      this.logger.error(`Tranzak : demande ${req.requestId} incohérente avec le paiement ${p.id}`);
      return null;
    }
    if (req.status === 'SUCCESSFUL') return this.settleSucceeded(p.id);
    if (['FAILED', 'CANCELLED', 'CANCELLED_BY_PAYER', 'CANCELLED/REFUNDED'].includes(req.status)) {
      return this.settleFailed(p.id, req.errorMessage ?? 'Paiement refusé ou annulé sur le téléphone');
    }
    return null;
  }

  // Passe un paiement en "réussi" et applique ses effets. Sans effet s'il l'était déjà (notifications en double).
  async settleSucceeded(paymentId: string, override?: { periodEnd?: Date; amount?: number }): Promise<Payment | null> {
    const result = await this.db.transaction(async (tx) => {
      // Verrou sur la ligne : deux notifications simultanées ne peuvent pas régler deux fois
      const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
      if (!p || p.status === 'SUCCEEDED') return null;

      const now = new Date();
      const [{ n }] = await tx.execute<{ n: string }>(sql`select nextval(${invoiceNumberSeq.seqName}) as n`).then((r) => r.rows);
      const invoiceNumber = `PS-${now.getUTCFullYear()}-${String(n).padStart(6, '0')}`;
      let periodStart = p.periodStart;
      let periodEnd = override?.periodEnd ?? p.periodEnd;

      if (p.kind === 'SUBSCRIPTION' && p.subscriptionId) {
        const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, p.subscriptionId)).for('update');
        if (p.provider === 'TRANZAK') {
          // Le mois payé commence à la fin de la période en cours si elle n'est pas finie, sinon maintenant
          periodStart = sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
          periodEnd = addOneMonth(periodStart);
        }
        await tx
          .update(subscriptions)
          .set({
            status: 'ACTIVE',
            paymentMethod: p.method,
            plan: p.plan ?? sub.plan,
            pendingPlan: p.provider === 'TRANZAK' ? null : sub.pendingPlan,
            currentPeriodEnd: periodEnd ?? sub.currentPeriodEnd,
            signupFeePaidAt: p.includesSignupFee ? (sub.signupFeePaidAt ?? now) : sub.signupFeePaidAt,
            cancelAtPeriodEnd: p.provider === 'TRANZAK' ? false : sub.cancelAtPeriodEnd,
            canceledAt: null,
            lastReminderAt: null,
          })
          .where(eq(subscriptions.id, sub.id));
      }
      let duplicate = false;
      if (p.kind === 'MEDICATION' && p.prescriptionId) {
        const moved = await tx
          .update(prescriptions)
          .set({ status: 'PREPARING' })
          .where(and(eq(prescriptions.id, p.prescriptionId), eq(prescriptions.status, 'AWAITING_PAYMENT')))
          .returning({ id: prescriptions.id });
        // Ordonnance déjà payée par un autre moyen (ex. carte ouverte puis Mobile Money) : à rembourser
        duplicate = moved.length === 0;
      }
      const [updated] = await tx
        .update(payments)
        .set({
          status: 'SUCCEEDED',
          paidAt: now,
          invoiceNumber,
          periodStart,
          periodEnd,
          failureReason: null,
          amount: override?.amount ?? p.amount,
        })
        .where(eq(payments.id, p.id))
        .returning();
      return { ...updated, duplicate };
    });

    if (result?.duplicate) {
      this.logger.warn(`Paiement ${result.id} en double pour l'ordonnance ${result.prescriptionId} : à rembourser`);
      await this.audit.log(result.payerId, 'billing.duplicate', 'Payment', result.id);
    }
    if (result) {
      await this.audit.log(result.payerId, 'billing.paid', 'Payment', result.id);
      await this.mailReceipt(result).catch((e) => this.logger.error(`E-mail de reçu : ${e.message}`));
    }
    return result;
  }

  async settleFailed(paymentId: string, reason: string): Promise<Payment | null> {
    const [p] = await this.db
      .update(payments)
      .set({ status: 'FAILED', failureReason: reason.slice(0, 300) })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING')))
      .returning();
    return p ?? null;
  }

  // ================= Interne =================

  private async chargeMobile(input: {
    userId: string;
    patientId: string;
    subscriptionId?: string;
    prescriptionId?: string;
    kind: 'SUBSCRIPTION' | 'MEDICATION';
    plan?: Plan;
    includesSignupFee?: boolean;
    lines: PaymentLine[];
    phone: string;
    description: string;
  }) {
    const amount = input.lines.reduce((s, l) => s + l.amount, 0);
    const wallet = toTranzakNumber(input.phone);
    const [payment] = await this.db
      .insert(payments)
      .values({
        payerId: input.userId,
        patientId: input.patientId,
        subscriptionId: input.subscriptionId,
        prescriptionId: input.prescriptionId,
        kind: input.kind,
        provider: 'TRANZAK',
        method: 'MOBILE_MONEY',
        amount,
        currency: 'XAF',
        lines: input.lines,
        plan: input.plan,
        includesSignupFee: input.includesSignupFee ?? false,
        mobileWalletNumber: wallet,
      })
      .returning();

    let req: TranzakRequest;
    try {
      req = await this.tranzak.chargeMobileWallet({
        amountXaf: amount,
        description: input.description,
        mchTransactionRef: mchRef(payment.id),
        mobileWalletNumber: wallet,
        payerNote: 'Proche Santé',
      });
    } catch (e) {
      await this.settleFailed(payment.id, (e as Error).message);
      throw e;
    }
    const [withRef] = await this.db
      .update(payments)
      .set({ providerRef: req.requestId })
      .where(eq(payments.id, payment.id))
      .returning();
    await this.audit.log(input.userId, 'billing.mobile_charge', 'Payment', payment.id);
    const settled = await this.applyTranzakStatus(withRef, req);
    return this.paymentView(settled ?? withRef);
  }

  // Évite d'envoyer deux demandes sur le téléphone si la famille clique deux fois
  private async reusablePending(where: ReturnType<typeof eq>): Promise<Payment | null> {
    const pendings = await this.db
      .select()
      .from(payments)
      .where(and(where, eq(payments.status, 'PENDING'), eq(payments.provider, 'TRANZAK')));
    for (const p of pendings) {
      const refreshed = (await this.refreshTranzakPayment(p)) ?? p;
      if (refreshed.status === 'SUCCEEDED') throw new ConflictException('Ce paiement vient d’être validé');
      if (refreshed.status === 'PENDING') {
        if (Date.now() - p.createdAt.getTime() < MOBILE_REUSE_MS) return refreshed;
        await this.settleFailed(p.id, 'Remplacé par une nouvelle demande');
      }
    }
    return null;
  }

  async expireStaleMobilePayments(now: Date) {
    const stale = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.status, 'PENDING'),
          eq(payments.provider, 'TRANZAK'),
          sql`${payments.createdAt} < ${new Date(now.getTime() - MOBILE_PENDING_TTL_MS)}`,
        ),
      );
    for (const p of stale) {
      const refreshed = await this.refreshTranzakPayment(p);
      if (!refreshed) await this.settleFailed(p.id, 'Paiement non validé sur le téléphone');
    }
    return stale.length;
  }

  private async ownerContext(userId: string, patientId: string) {
    const patient = await this.access.requireOwner(userId, patientId);
    const sub = await this.subscriptionOf(patientId);
    return { patient, sub };
  }

  async subscriptionOf(patientId: string): Promise<Subscription> {
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.patientId, patientId)).limit(1);
    if (!sub) throw new NotFoundException('Abonnement introuvable');
    return sub;
  }

  private async user(id: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!u) throw new ForbiddenException();
    return u;
  }

  async patientName(patientId: string) {
    const [p] = await this.db
      .select({ firstName: patients.firstName, lastName: patients.lastName })
      .from(patients)
      .where(eq(patients.id, patientId));
    return p ? `${p.firstName} ${p.lastName}` : '';
  }

  // ================= E-mails =================

  async notify(userId: string, subject: string, text: string) {
    const u = await this.user(userId);
    await this.mailer.send({ to: u.email, subject, text: `Bonjour ${u.firstName},\n\n${text}\n\nL’équipe Proche Santé` });
  }

  private async mailReceipt(p: Payment) {
    const name = await this.patientName(p.patientId);
    const what =
      p.kind === 'SUBSCRIPTION'
        ? `le suivi de ${name}${p.periodEnd ? `, jusqu’au ${fmtDay(p.periodEnd)}` : ''}`
        : `les médicaments de ${name} ; la pharmacie les prépare`;
    await this.notify(
      p.payerId,
      `Paiement reçu : ${fmtAmount(p.amount, p.currency)}`,
      `Nous avons bien reçu votre paiement de ${fmtAmount(p.amount, p.currency)} pour ${what}.\n` +
        `Votre facture ${p.invoiceNumber} est disponible dans votre espace : ${appUrl('/paiements')}`,
    );
  }

  // Utilisé par la tâche quotidienne et les notifications Stripe
  async subscriptionsByIds(ids: string[]) {
    if (!ids.length) return [];
    return this.db.select().from(subscriptions).where(inArray(subscriptions.id, ids));
  }
}
