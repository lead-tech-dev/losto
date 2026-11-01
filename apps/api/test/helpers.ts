import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  OneTimeCheckoutInput,
  StripeClient,
  StripeEvent,
  StripeGateway,
  SubscriptionCheckoutInput,
} from '../src/billing/gateways/stripe.client';
import { MobileChargeInput, TranzakGateway, TranzakRequest, TranzakStatus } from '../src/billing/gateways/tranzak.client';
import { Database, DB } from '../src/db/db.module';
import { runMigrations } from '../src/db/migrate';
import { Role, users } from '../src/db/schema';

export const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
export const TRANZAK_AUTH_KEY = 'cle-notification-tranzak';

// Faux Tranzak : garde les demandes en mémoire ; le test décide quand le payeur valide ou refuse.
export class FakeTranzak extends TranzakGateway {
  charges: MobileChargeInput[] = [];
  requests = new Map<string, TranzakRequest>();
  get configured() {
    return true;
  }
  async chargeMobileWallet(input: MobileChargeInput): Promise<TranzakRequest> {
    this.charges.push(input);
    const req: TranzakRequest = {
      requestId: `REQ${this.charges.length}`,
      status: 'PENDING',
      amount: input.amountXaf,
      currencyCode: 'XAF',
      mchTransactionRef: input.mchTransactionRef,
    };
    this.requests.set(req.requestId, req);
    return { ...req };
  }
  async getRequest(requestId: string): Promise<TranzakRequest> {
    return { ...this.requests.get(requestId)! };
  }
  complete(requestId: string, status: TranzakStatus) {
    this.requests.get(requestId)!.status = status;
  }
  lastRequestId() {
    return `REQ${this.charges.length}`;
  }
}

// Faux Stripe : enregistre les appels ; la vérification de signature est la vraie (bibliothèque Stripe).
export class FakeStripe extends StripeGateway {
  subscriptionCheckouts: SubscriptionCheckoutInput[] = [];
  oneTimeCheckouts: OneTimeCheckoutInput[] = [];
  planChanges: { subscriptionId: string; monthlyCents: number }[] = [];
  cancelFlags: { subscriptionId: string; cancel: boolean }[] = [];
  private real = new StripeClient(new ConfigService({ STRIPE_WEBHOOK_SECRET }));
  get configured() {
    return true;
  }
  async ensureCustomer(existing: string | null) {
    return existing ?? 'cus_test';
  }
  async createSubscriptionCheckout(input: SubscriptionCheckoutInput) {
    this.subscriptionCheckouts.push(input);
    return { id: `cs_sub_${this.subscriptionCheckouts.length}`, url: 'https://checkout.stripe.test/abonnement' };
  }
  async createOneTimeCheckout(input: OneTimeCheckoutInput) {
    this.oneTimeCheckouts.push(input);
    return { id: `cs_pay_${this.oneTimeCheckouts.length}`, url: 'https://checkout.stripe.test/paiement' };
  }
  async changePlan(subscriptionId: string, _plan: string, monthlyCents: number) {
    this.planChanges.push({ subscriptionId, monthlyCents });
  }
  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean) {
    this.cancelFlags.push({ subscriptionId, cancel });
  }
  async billingPortalUrl() {
    return 'https://billing.stripe.test/portail';
  }
  verifyWebhook(rawBody: Buffer, signature: string): StripeEvent {
    return this.real.verifyWebhook(rawBody, signature);
  }
}

// Démarre l'API complète sur une base de test vidée, avec les prestataires de paiement simulés.
export async function createTestApp(): Promise<{
  app: INestApplication;
  db: Database;
  stripe: FakeStripe;
  tranzak: FakeTranzak;
}> {
  const url = testDatabaseUrl();
  process.env.JWT_SECRET ??= 'secret-de-test-suffisamment-long';
  process.env.TRANZAK_WEBHOOK_AUTH_KEY = TRANZAK_AUTH_KEY;
  await runMigrations(url);

  const stripe = new FakeStripe();
  const tranzak = new FakeTranzak();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StripeGateway)
    .useValue(stripe)
    .overrideProvider(TranzakGateway)
    .useValue(tranzak)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  const db = app.get<Database>(DB);
  await db.execute(sql`TRUNCATE users, coverage_zones RESTART IDENTITY CASCADE`);
  await db.execute(sql`ALTER SEQUENCE invoice_number_seq RESTART WITH 1`);
  return { app, db, stripe, tranzak };
}

// Crée un compte directement en base et renvoie son jeton de connexion.
export async function createUser(
  app: INestApplication,
  db: Database,
  role: Role,
  email: string,
  firstName = 'Test',
  lastName = 'User',
): Promise<{ id: string; token: string }> {
  const password = 'MotDePasse123';
  const [u] = await db
    .insert(users)
    .values({ email, passwordHash: await bcrypt.hash(password, 4), role, firstName, lastName })
    .returning();
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
  return { id: u.id, token: res.body.accessToken };
}

export function tokenFromMail(text: string): string {
  const m = text.match(/token=([\w-]+)/);
  if (!m) throw new Error(`Pas de jeton dans l'e-mail : ${text}`);
  return m[1];
}

// Les tests vident les tables : on refuse toute base dont le nom ne contient pas « test ».
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !/test/i.test(new URL(url).pathname)) {
    throw new Error('DATABASE_URL doit pointer vers une base de test (nom contenant « test »), ex. postgresql://…/losto_test');
  }
  return url;
}
