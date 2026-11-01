import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AssistantReply {
  medical: boolean; // la question relève du médecin → transfert à un humain, pas de réponse automatique
  answer: string | null; // null = l'assistant ne sait pas → transfert à l'équipe
}

// Assistant pour les questions pratiques des parents (rendez-vous, livraison, paiement…).
// Il ne répond JAMAIS à une question de santé : il la signale pour qu'un humain la prenne.
// Une première barrière par mots-clés (parse.ts) écarte déjà les questions médicales avant de l'appeler.
export abstract class AssistantLlm {
  abstract readonly enabled: boolean;
  abstract reply(question: string, facts: string[]): Promise<AssistantReply>;
}

export class NoAssistant extends AssistantLlm {
  readonly enabled = false;
  async reply(): Promise<AssistantReply> {
    return { medical: false, answer: null };
  }
}

const SYSTEM = `Tu es l'assistant WhatsApp de Proche Santé, un service de suivi des maladies chroniques (diabète, tension…) pour des parents âgés à Douala et Yaoundé, payé par leurs enfants.
Tu réponds au parent, en français simple, poli, en 3 phrases au plus, sans emoji ni mise en forme.
Règles absolues :
- Tu ne donnes AUCUN conseil de santé, de médicament, de dose, d'alimentation ou d'interprétation de mesure. Si la question touche la santé, même un peu, réponds medical=true et answer=null.
- Tu n'utilises que les faits fournis. Si la réponse n'y est pas, answer=null.
- En cas de signe d'urgence, rappelle d'appeler le 119.
Réponds UNIQUEMENT avec un objet JSON : {"medical": boolean, "answer": string | null}`;

// Claude (API Anthropic). Activé seulement si ANTHROPIC_API_KEY est renseignée.
export class AnthropicAssistant extends AssistantLlm {
  private readonly logger = new Logger('AnthropicAssistant');
  private readonly key: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    super();
    this.key = config.get('ANTHROPIC_API_KEY') ?? '';
    this.model = config.get('ASSISTANT_MODEL') ?? 'claude-haiku-5-5';
  }

  get enabled() {
    return Boolean(this.key);
  }

  async reply(question: string, facts: string[]): Promise<AssistantReply> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 300,
          system: SYSTEM,
          messages: [{ role: 'user', content: `Faits connus :\n${facts.map((f) => `- ${f}`).join('\n')}\n\nMessage du parent :\n${question}` }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = json.content?.find((c) => c.type === 'text')?.text ?? '';
      return parseAssistantJson(text);
    } catch (e) {
      this.logger.error(`Assistant indisponible : ${(e as Error).message}`);
      return { medical: false, answer: null }; // en cas de doute, un humain répond
    }
  }
}

// Tolère un JSON entouré de texte ; toute réponse inexploitable est traitée comme « je ne sais pas »
export function parseAssistantJson(text: string): AssistantReply {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { medical: false, answer: null };
  try {
    const o = JSON.parse(m[0]) as { medical?: unknown; answer?: unknown };
    const medical = o.medical === true;
    const answer = !medical && typeof o.answer === 'string' && o.answer.trim() ? o.answer.trim().slice(0, 600) : null;
    return { medical, answer };
  } catch {
    return { medical: false, answer: null };
  }
}
