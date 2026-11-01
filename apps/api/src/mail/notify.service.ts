import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Database, DB } from '../db/db.module';
import { patients, users } from '../db/schema';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MailerService } from './mailer.service';

// Prévient une personne par e-mail ; un membre de la famille reçoit aussi le titre du message sur WhatsApp.
// Un échec d'envoi n'interrompt jamais l'action en cours.
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mailer: MailerService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  async user(userId: string | null | undefined, subject: string, text: string, opts: { salutation?: string; patientId?: string } = {}) {
    if (!userId) return;
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return;
    const hello = opts.salutation ?? `Bonjour ${u.firstName}`;
    await this.mailer
      .send({ to: u.email, subject, text: `${hello},\n\n${text}\n\nL’équipe Proche Santé` })
      .catch((e) => this.logger.error(`E-mail à ${u.email} : ${e.message}`));
    if (u.role === 'FAMILY') {
      await this.whatsapp.toFamilyUser(u.id, subject, opts.patientId).catch((e) => this.logger.error(`WhatsApp famille : ${e.message}`));
    }
  }

  // Le titulaire du compte famille du parent
  async family(patientId: string, subject: string, text: string) {
    const [p] = await this.db.select({ familyUserId: patients.familyUserId }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (p) await this.user(p.familyUserId, subject, text, { patientId });
  }

  // L'équipe Proche Santé (comptes admin actifs)
  async admins(subject: string, text: string) {
    const list = await this.db.select({ id: users.id }).from(users).where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)));
    for (const a of list) await this.user(a.id, subject, text);
  }
}
