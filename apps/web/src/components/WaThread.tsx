import { FormEvent, useEffect, useRef, useState } from 'react';
import { WaMessage } from '../types';

const KIND_LABELS: Record<string, string> = {
  welcome: 'Bienvenue',
  med_reminder: 'Rappel médicaments',
  appt_reminder: 'Rappel rendez-vous',
  reading_ack: 'Réponse automatique',
  emergency: 'Consigne d’urgence',
  assistant: 'Réponse automatique',
  handoff: 'Transfert à l’équipe',
  staff_reply: 'Réponse de l’équipe',
  delivery_code: 'Code de livraison',
  consent: 'Consentement',
  opt_out: 'Arrêt des messages',
  opt_in: 'Reprise des messages',
  which_patient: 'Question : quel parent ?',
  unknown_sender: 'Numéro inconnu',
};

const STATUS: Record<string, string> = { SENT: 'envoyé', DELIVERED: 'remis', READ: 'lu', FAILED: 'échec', SKIPPED: 'non envoyé' };

const fmt = (d: string) =>
  new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });

// Conversation WhatsApp avec un parent, vue par l'équipe ou par le médecin (à droite : ce que Proche Santé a envoyé).
export default function WaThread({
  messages,
  windowOpen,
  onReply,
  onHandled,
}: {
  messages: WaMessage[];
  windowOpen: boolean;
  onReply?: (text: string) => Promise<void>;
  onHandled?: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const pending = messages.some((m) => m.needsHuman && !m.handledAt && m.direction === 'IN');

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || !onReply) return;
    setBusy(true);
    setError('');
    try {
      await onReply(text);
      setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="thread">
      <div className="thread-list wa-list">
        {messages.length === 0 && <p className="muted small center">Aucun message pour l'instant.</p>}
        {messages.map((m) => {
          const out = m.direction === 'OUT';
          const flagged = m.needsHuman && !out && !m.handledAt;
          return (
            <div key={m.id} className={`bubble ${out ? 'mine wa-out' : 'theirs'} ${flagged ? 'flagged' : ''} ${m.kind === 'emergency' ? 'wa-emergency' : ''}`}>
              {out && <span className="bubble-kind">{KIND_LABELS[m.kind] ?? m.kind}{m.template ? ' · modèle' : ''}</span>}
              <p className="pre">{m.body}</p>
              <span className="bubble-meta">
                {fmt(m.createdAt)}
                {out && ` · ${STATUS[m.status] ?? m.status}`}
                {m.acknowledgedAt && ' · pris ✓'}
                {flagged && ' · à traiter'}
                {m.error && ` · ${m.error}`}
              </span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {onReply &&
        (windowOpen ? (
          <form className="thread-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="wa-reply">Réponse</label>
            <textarea id="wa-reply" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Votre réponse, envoyée sur WhatsApp…" />
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button type="submit" className="btn" disabled={busy}>Envoyer sur WhatsApp</button>
              {pending && onHandled && (
                <button type="button" className="btn btn-ghost" onClick={() => onHandled()}>Marquer comme traité</button>
              )}
            </div>
          </form>
        ) : (
          <div className="stack-sm">
            <p className="muted small">
              Le dernier message du parent date de plus de 24 h : WhatsApp n'autorise pas de réponse libre. Appelez-le ; la réponse sera possible dès qu'il réécrira.
            </p>
            {pending && onHandled && (
              <div><button type="button" className="btn btn-ghost" onClick={() => onHandled()}>Marquer comme traité</button></div>
            )}
          </div>
        ))}
    </div>
  );
}
