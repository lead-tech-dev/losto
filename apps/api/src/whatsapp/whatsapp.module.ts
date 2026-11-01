import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CareModule } from '../care/care.module';
import { PatientsModule } from '../patients/patients.module';
import { AnthropicAssistant, AssistantLlm } from './assistant';
import { WhatsAppInboundService } from './inbound.service';
import { RemindersService } from './reminders.service';
import { ReportsService } from './reports.service';
import {
  AdminReportsController,
  AdminWhatsAppController,
  DoctorWhatsAppController,
  FamilyWhatsAppController,
  WhatsAppWebhookController,
} from './whatsapp.controller';

@Module({
  imports: [CareModule, PatientsModule],
  controllers: [WhatsAppWebhookController, AdminWhatsAppController, AdminReportsController, DoctorWhatsAppController, FamilyWhatsAppController],
  providers: [
    WhatsAppInboundService,
    RemindersService,
    ReportsService,
    // Assistant pour les questions pratiques : actif seulement si ANTHROPIC_API_KEY est renseignée
    { provide: AssistantLlm, inject: [ConfigService], useFactory: (config: ConfigService) => new AnthropicAssistant(config) },
  ],
  exports: [RemindersService, ReportsService, WhatsAppInboundService],
})
export class WhatsAppModule {}
