import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

// Envoi d'e-mails. Avec SMTP_HOST défini : envoi réel. Sans : les e-mails sont gardés en mémoire
// (et affichés dans la console en développement), ce qui permet de tester sans serveur mail.
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transport?: Transporter;
  private readonly from: string;
  readonly outbox: Mail[] = [];

  constructor(config: ConfigService) {
    this.from = config.get('MAIL_FROM') ?? 'Proche Santé <no-reply@proche-sante.local>';
    const host = config.get<string>('SMTP_HOST');
    if (host) {
      this.transport = createTransport({
        host,
        port: Number(config.get('SMTP_PORT') ?? 587),
        auth: { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASS') },
      });
    }
  }

  async send(mail: Mail): Promise<void> {
    if (this.transport) {
      await this.transport.sendMail({ from: this.from, ...mail });
      return;
    }
    this.outbox.push(mail);
    if (process.env.NODE_ENV !== 'test') {
      this.logger.log(`E-mail (non envoyé, pas de SMTP) à ${mail.to} : ${mail.subject}\n${mail.text}`);
    }
  }
}
