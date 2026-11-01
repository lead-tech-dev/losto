import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { BackofficeController, MyStatementController } from './backoffice.controller';
import { BackofficeService } from './backoffice.service';
import { StatementsService } from './statements.service';

// Back-office de l'équipe : pilotage, paiements, relevés des partenaires, indicateurs, journal
@Module({
  imports: [BillingModule],
  controllers: [BackofficeController, MyStatementController],
  providers: [BackofficeService, StatementsService],
})
export class BackofficeModule {}
