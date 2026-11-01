import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Database, DB } from '../db/db.module';
import { patients, users } from '../db/schema';
import { MailerService } from './mailer.service';

// Envoi d'un e-mail à une personne ou à la famille d'un parent. Un échec d'envoi n'interrompt jamais l'action en cours.
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mailer: MailerService,
  ) {}

  async user(userId: string | null | undefined, subject: string, text: string, salutation?: string) {
    if (!userId) return;
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return;
    const hello = salutation ?? `Bonjour ${u.firstName}`;
    await this.mailer
      .send({ to: u.email, subject, text: `${hello},\n\n${text}\n\nL’équipe Proche Santé` })
      .catch((e) => this.logger.error(`E-mail à ${u.email} : ${e.message}`));
  }

  // Le titulaire du compte famille du parent
  async family(patientId: string, subject: string, text: string) {
    const [p] = await this.db.select({ familyUserId: patients.familyUserId }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (p) await this.user(p.familyUserId, subject, text);
  }
}
