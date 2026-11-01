import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, Matches, ValidateIf } from 'class-validator';
import { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CAMEROON_PHONE } from '../common/text';
import { Database, DB } from '../db/db.module';
import { PAYMENT_METHODS, PaymentMethod, payments, Plan, PLANS, Role, users } from '../db/schema';
import { BillingService } from './billing.service';
import { StripeGateway } from './gateways/stripe.client';
import { renderInvoicePdf } from './invoice-pdf';
import { StripeEventsService } from './stripe-events.service';

export class CheckoutDto {
  @IsIn(PAYMENT_METHODS, { message: 'Moyen de paiement inconnu' })
  method: PaymentMethod;

  // Numéro MTN ou Orange qui recevra la demande de paiement (celui du parent, d'un proche au pays...)
  @ValidateIf((o) => o.method === 'MOBILE_MONEY')
  @Matches(CAMEROON_PHONE, { message: 'Numéro Mobile Money camerounais invalide (ex. 6 77 12 34 56)' })
  phone?: string;
}

export class PlanDto {
  @IsIn(PLANS, { message: 'Formule inconnue' })
  plan: Plan;
}

const Id = () => Param('id', ParseUUIDPipe);

@Roles(Role.FAMILY)
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get('patients/:id/subscription')
  subscription(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.billing.subscriptionView(u.id, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('patients/:id/checkout')
  async checkout(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CheckoutDto) {
    if (dto.method === 'CARD') return { kind: 'redirect', ...(await this.billing.startCardCheckout(u.id, id)) };
    return { kind: 'mobile', payment: await this.billing.startMobileMoney(u.id, id, dto.phone!) };
  }

  @Patch('patients/:id/plan')
  changePlan(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: PlanDto) {
    return this.billing.changePlan(u.id, id, dto.plan);
  }

  @HttpCode(200)
  @Post('patients/:id/subscription/cancel')
  cancel(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.billing.cancel(u.id, id);
  }

  @HttpCode(200)
  @Post('patients/:id/subscription/resume')
  resume(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.billing.resume(u.id, id);
  }

  @HttpCode(200)
  @Post('patients/:id/billing-portal')
  portal(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.billing.billingPortal(u.id, id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  @Post('prescriptions/:id/pay')
  payPrescription(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CheckoutDto) {
    return this.billing.payPrescription(u.id, id, dto.method, dto.phone);
  }

  @Get('payments')
  list(@CurrentUser() u: AuthUser) {
    return this.billing.listPayments(u.id);
  }

  // Interrogé toutes les quelques secondes pendant que le payeur valide sur son téléphone
  @SkipThrottle()
  @Get('payments/:id')
  payment(@CurrentUser() u: AuthUser, @Id() id: string) {
    return this.billing.getPayment(u.id, id);
  }

  @Get('payments/:id/invoice')
  async invoice(@CurrentUser() u: AuthUser, @Id() id: string, @Res() res: Response) {
    const p = await this.billing.ownPayment(u.id, id);
    if (p.status !== 'SUCCEEDED' || !p.invoiceNumber) throw new NotFoundException('Facture disponible après paiement');
    const [payer] = await this.db.select().from(users).where(eq(users.id, u.id));
    const pdf = await renderInvoicePdf(
      p,
      { name: `${payer.firstName} ${payer.lastName}`, lines: [payer.email, ...(payer.phone ? [payer.phone] : [])] },
      await this.billing.patientName(p.patientId),
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="facture-${p.invoiceNumber}.pdf"`,
      'Content-Length': String(pdf.length),
    });
    res.end(pdf);
  }
}

// Notifications envoyées par les prestataires de paiement : publiques, mais vérifiées.
@Public()
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly stripe: StripeGateway,
    private readonly stripeEvents: StripeEventsService,
    private readonly billing: BillingService,
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: Database,
  ) {}

  // Stripe signe chaque notification : sans signature valide, rien n'est traité.
  @HttpCode(200)
  @Post('stripe')
  async stripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody || !signature) throw new UnauthorizedException('Signature Stripe absente');
    const event = this.stripe.verifyWebhook(req.rawBody, signature);
    await this.stripeEvents.handle(event);
    return { received: true };
  }

  // Tranzak (TPN) : la notification n'est pas signée. On vérifie la clé si elle est configurée,
  // puis on redemande à Tranzak le vrai statut du paiement : le contenu reçu ne sert qu'à savoir lequel.
  @HttpCode(200)
  @Post('tranzak')
  async tranzakWebhook(@Body() body: Record<string, any>) {
    const expectedKey = this.config.get<string>('TRANZAK_WEBHOOK_AUTH_KEY');
    if (expectedKey && body?.authKey !== expectedKey) throw new UnauthorizedException('Clé de notification invalide');
    const requestId = String(body?.resourceId ?? body?.resource?.requestId ?? '');
    if (!requestId) return { received: true };

    const [p] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.provider, 'TRANZAK'), eq(payments.providerRef, requestId)))
      .limit(1);
    if (p) await this.billing.refreshTranzakPayment(p);
    return { received: true };
  }
}
