import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SentMessage {
  id: string;
}

// Envoi de messages WhatsApp. Deux façons d'écrire :
// - texte libre, seulement dans les 24 h qui suivent le dernier message du destinataire ;
// - modèle (« template ») validé à l'avance par Meta, à tout moment.
export abstract class WhatsAppGateway {
  abstract readonly configured: boolean;
  abstract sendText(to: string, body: string): Promise<SentMessage>;
  abstract sendTemplate(to: string, name: string, params: string[]): Promise<SentMessage>;
}

// API WhatsApp Cloud de Meta : https://developers.facebook.com/docs/whatsapp/cloud-api
export class MetaWhatsApp extends WhatsAppGateway {
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly base: string;

  constructor(config: ConfigService) {
    super();
    this.token = config.get('WHATSAPP_TOKEN') ?? '';
    this.phoneNumberId = config.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
    this.base = `https://graph.facebook.com/${config.get('WHATSAPP_API_VERSION') ?? 'v23.0'}`;
  }

  get configured() {
    return Boolean(this.token && this.phoneNumberId);
  }

  sendText(to: string, body: string) {
    return this.post({ to, type: 'text', text: { body, preview_url: true } });
  }

  sendTemplate(to: string, name: string, params: string[]) {
    return this.post({
      to,
      type: 'template',
      template: {
        name,
        language: { code: 'fr' },
        components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [],
      },
    });
  }

  private async post(payload: Record<string, unknown>): Promise<SentMessage> {
    if (!this.configured) throw new Error('WhatsApp non configuré (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)');
    const res = await fetch(`${this.base}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok || !json.messages?.[0]) {
      throw new Error(`Meta ${res.status}${json.error ? ` (${json.error.code}) : ${json.error.message}` : ''}`);
    }
    return { id: json.messages[0].id };
  }
}

// Mode simulation (WHATSAPP_SIMULATION=true) : rien ne part, tout est enregistré et visible dans l'espace admin.
// Jamais actif en production.
export class SimulatedWhatsApp extends WhatsAppGateway {
  private readonly logger = new Logger('SimulatedWhatsApp');
  private n = 0;
  readonly configured = true;

  async sendText(to: string, body: string) {
    this.logger.log(`→ +${to} : ${body.slice(0, 80)}`);
    return { id: `sim.${Date.now()}.${++this.n}` };
  }

  async sendTemplate(to: string, name: string, params: string[]) {
    this.logger.log(`→ +${to} [modèle ${name}] ${params.join(' | ').slice(0, 80)}`);
    return { id: `sim.${Date.now()}.${++this.n}` };
  }
}
