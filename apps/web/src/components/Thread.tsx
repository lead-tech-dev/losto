import { FormEvent, useEffect, useRef, useState } from 'react';
import { Message } from '../types';

interface Props {
  messages: Message[];
  mine: 'family' | 'team'; // de quel côté se trouve la personne qui lit
  onSend: (body: string) => Promise<void>;
  placeholder: string;
}

// Fil de discussion partagé par la famille et l'équipe.
export default function Thread({ messages, mine, onSend, placeholder }: Props) {
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setError('Le message est vide');
    setBusy(true);
    setError('');
    try {
      await onSend(body);
      setBody('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="thread">
      <div className="thread-list">
        {messages.length === 0 && <p className="muted small center">Aucun message pour l'instant.</p>}
        {messages.map((m) => {
          const isMine = (mine === 'team') === m.fromTeam;
          return (
            <div key={m.id} className={`bubble ${isMine ? 'mine' : 'theirs'}`}>
              <p className="pre">{m.body}</p>
              <span className="bubble-meta">
                {m.fromTeam ? 'Équipe Proche Santé' : 'Famille'} ·{' '}
                {new Date(m.createdAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form className="thread-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="msg">
          Votre message
        </label>
        <textarea
          id="msg"
          rows={3}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError('');
          }}
          placeholder={placeholder}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Envoi…' : 'Envoyer'}
        </button>
      </form>
    </div>
  );
}
