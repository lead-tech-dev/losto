import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { BillingModule } from './billing/billing.module';
import { CareModule } from './care/care.module';
import { LogisticsModule } from './logistics/logistics.module';
import { CoverageModule } from './coverage/coverage.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { MailModule } from './mail/mail.module';
import { MessagesModule } from './messages/messages.module';
import { PatientsModule } from './patients/patients.module';
import { UsersModule } from './users/users.module';
import { WhatsAppCoreModule } from './whatsapp/whatsapp-core.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Limite à 100 requêtes par minute et par adresse IP (protège contre le bourrage de mots de passe)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DbModule,
    WhatsAppCoreModule,
    MailModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CoverageModule,
    PatientsModule,
    MessagesModule,
    ScheduleModule.forRoot(),
    BillingModule,
    CareModule,
    LogisticsModule,
    WhatsAppModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordre des gardes : limite de débit, puis connexion obligatoire, puis contrôle du rôle
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
