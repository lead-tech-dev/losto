import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SimulatedTranzak } from './gateways/simulated-tranzak';
import { CareModule } from '../care/care.module';
import { CoverageModule } from '../coverage/coverage.module';
import { PatientsModule } from '../patients/patients.module';
import { BillingCronService } from './billing-cron.service';
import { BillingController, WebhooksController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeClient, StripeGateway } from './gateways/stripe.client';
import { TranzakClient, TranzakGateway } from './gateways/tranzak.client';
import { SignupFollowupService } from './signup-followup.service';
import { StripeEventsService } from './stripe-events.service';

@Module({
  imports: [PatientsModule, CoverageModule, CareModule],
  controllers: [BillingController, WebhooksController],
  providers: [
    BillingService,
    StripeEventsService,
    BillingCronService,
    SignupFollowupService,
    // Les tests remplacent ces deux classes par des versions simulées
    { provide: StripeGateway, useClass: StripeClient },
    {
      provide: TranzakGateway,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const simulate = config.get('PAYMENTS_SIMULATION') === 'true';
        if (simulate && process.env.NODE_ENV === 'production') {
          throw new Error('PAYMENTS_SIMULATION est interdit en production');
        }
        return simulate ? new SimulatedTranzak() : new TranzakClient(config);
      },
    },
  ],
  exports: [BillingService, StripeGateway, SignupFollowupService],
})
export class BillingModule {}
