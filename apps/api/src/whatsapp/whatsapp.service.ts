import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt } from 'drizzle-orm';
import { Database, DB } from '../db/db.module';
import { Patient, patients, users, whatsappMessages } from '../db/schema';
import { WhatsAppGateway } from './gateway';
import { waPhone } from './phone';
import { cleanParam, renderTemplate, TemplateName } from './templates';

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SendInput {
  phone: string; // chiffres seulement
  kind: string;
  text: string; // texte libre (fenêtre ouverte)
  template?: { name: TemplateName; params: string[] }; // si la fenêtre est fermée
  patientId?: string | null;
  userId?: string | null;
  dedupeKey?: string;
  needsHuman?: boolean;
}

export interface SendResult {
  id: string | null;
  status: 'SENT' | 'FAILED' | 'SKIPPED' | 'DUPLICATE';
  via?: 'text' | 'template';
}

// Point de passage unique de tous les messages sortants : choix texte/modèle, anti-doublon, journal.
// Un échec d'envoi est enregistré mais ne fait jamais échouer l'action qui l'a provoqué.
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gateway: WhatsAppGateway,
  ) {}

  get configured() {
    return this.gateway.configured;
  }

  // Fenêtre de service : le destinataire a écrit dans les dernières 24 h → texte libre autorisé
  async windowOpen(phone: string, now = new Date()): Promise<boolean> {
    const [last] = await this.db
      .select({ at: whatsappMessages.createdAt })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.phone, phone), eq(whatsappMessages.direction, 'IN'), gt(whatsappMessages.createdAt, new Date(now.getTime() - WINDOW_MS))))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(1);
    return Boolean(last);
  }

  async send(input: SendInput): Promise<SendResult> {
    const open = await this.windowOpen(input.phone);
    const useTemplate = !open && input.template;
    const params = input.template?.params.map(cleanParam) ?? [];
    const body = useTemplate ? renderTemplate(input.template!.name, params) : input.text;

    // Réserve la ligne d'abord : si la même clé existe déjà, ce message a déjà été envoyé
    const [row] = await this.db
      .insert(whatsappMessages)
      .values({
        phone: input.phone,
        patientId: input.patientId ?? null,
        userId: input.userId ?? null,
        direction: 'OUT',
        kind: input.kind,
        template: useTemplate ? input.template!.name : null,
        body,
        status: 'SENT',
        dedupeKey: input.dedupeKey,
        needsHuman: input.needsHuman ?? false,
      })
      .onConflictDoNothing({ target: whatsappMessages.dedupeKey })
      .returning({ id: whatsappMessages.id });
    if (!row) return { id: null, status: 'DUPLICATE' };

    if (!open && !input.template) {
      // Texte libre impossible hors fenêtre et pas de modèle prévu pour ce message
      await this.db
        .update(whatsappMessages)
        .set({ status: 'SKIPPED', error: 'Fenêtre de 24 h fermée : le destinataire doit écrire d’abord' })
        .where(eq(whatsappMessages.id, row.id));
      return { id: row.id, status: 'SKIPPED' };
    }

    try {
      const sent = useTemplate
        ? await this.gateway.sendTemplate(input.phone, input.template!.name, params)
        : await this.gateway.sendText(input.phone, body);
      await this.db.update(whatsappMessages).set({ waId: sent.id }).where(eq(whatsappMessages.id, row.id));
      return { id: row.id, status: 'SENT', via: useTemplate ? 'template' : 'text' };
    } catch (e) {
      const error = (e as Error).message;
      this.logger.error(`WhatsApp vers +${input.phone} (${input.kind}) : ${error}`);
      await this.db.update(whatsappMessages).set({ status: 'FAILED', error }).where(eq(whatsappMessages.id, row.id));
      return { id: row.id, status: 'FAILED' };
    }
  }

  // Le parent peut-il recevoir des messages automatiques ? (smartphone, pas de STOP)
  reachable(p: Pick<Patient, 'hasSmartphone' | 'whatsappOptOutAt' | 'whatsappPhone'>): string | null {
    if (!p.hasSmartphone || p.whatsappOptOutAt) return null;
    return waPhone(p.whatsappPhone);
  }

  async toPatient(p: Patient, input: Omit<SendInput, 'phone' | 'patientId'>, opts: { evenIfOptedOut?: boolean } = {}) {
    const phone = opts.evenIfOptedOut ? waPhone(p.whatsappPhone) : this.reachable(p);
    if (!phone) return { id: null, status: 'SKIPPED' } as SendResult;
    return this.send({ ...input, phone, patientId: p.id });
  }

  // Notification à un membre de la famille (en plus de l'e-mail), s'il a un numéro et ne l'a pas désactivée
  async toFamilyUser(userId: string, message: string, patientId?: string, dedupeKey?: string): Promise<SendResult> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const phone = waPhone(u?.phone);
    if (!u || u.role !== 'FAMILY' || !u.whatsappNotifications || !phone) return { id: null, status: 'SKIPPED' };
    return this.send({
      phone,
      userId,
      patientId,
      kind: 'family_notice',
      text: `Proche Santé : ${message}`,
      template: { name: 'ps_info_famille', params: [message] },
      dedupeKey,
    });
  }

  async welcome(p: Patient, familyName: string, dedupeKey = `welcome:${p.id}`) {
    return this.toPatient(p, {
      kind: 'welcome',
      text: welcomeText(p.firstName, familyName),
      template: { name: 'ps_bienvenue', params: [p.firstName, familyName] },
      dedupeKey,
    });
  }

  async patientById(id: string) {
    const [p] = await this.db.select().from(patients).where(eq(patients.id, id)).limit(1);
    return p;
  }
}

// Message de bienvenue : présente le service et demande le consentement (réponse OUI)
export function welcomeText(parentFirstName: string, familyName: string) {
  return (
    `Bonjour ${parentFirstName}, ici Proche Santé. Votre enfant ${familyName} vous a inscrit(e) pour le suivi de votre santé à domicile : ` +
    'un médecin vous appellera chaque mois et vous pourrez envoyer ici votre tension et votre glycémie. ' +
    'Répondez OUI pour accepter. Répondez STOP si vous ne souhaitez pas de messages.'
  );
}
