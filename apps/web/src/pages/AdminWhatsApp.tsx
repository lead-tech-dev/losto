import { FormEvent, useState } from 'react';
import { api } from '../api';
import Layout from '../components/Layout';
import WaThread from '../components/WaThread';
import { WaMessage, WaThreadSummary } from '../types';
import { useApi } from '../useApi';

interface Status {
  configured: boolean;
  simulation: boolean;
  templates: { name: string; body: string; params: string[] }[];
}
interface FullThread {
  phone: string;
  patients: { id: string; firstName: string; lastName: string; district: string }[];
  windowOpen: boolean;
  messages: WaMessage[];
}

const fmt = (d: string) => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });

export default function AdminWhatsApp() {
  const status = useApi<Status>('/admin/whatsapp/status');
  const threads = useApi<WaThreadSummary[]>('/admin/whatsapp/threads');
  const [selected, setSelected] = useState<string | null>(null);
  const thread = useApi<FullThread>(selected ? `/admin/whatsapp/threads/${selected}` : null);
  const refresh = () => {
    thread.reload();
    threads.reload();
  };

  return (
    <Layout>
      <div className="page-head">
        <h1>WhatsApp des parents</h1>
        {status.data && (
          <span className={`badge ${status.data.simulation ? 'badge-warn' : status.data.configured ? '' : 'badge-urgent'}`}>
            {status.data.simulation ? 'Mode simulation' : status.data.configured ? 'Branché à Meta' : 'Non configuré'}
          </span>
        )}
      </div>
      {status.data?.simulation && <Simulator onSent={(phone) => { setSelected(phone); refresh(); }} />}
      <div className="split">
        <section className="card thread-index">
          {threads.data?.length === 0 && <p className="muted small">Aucun message.</p>}
          {threads.data?.map((t) => (
            <button key={t.phone} type="button" className={`thread-item ${selected === t.phone ? 'on' : ''}`} onClick={() => setSelected(t.phone)}>
              <span className="thread-sum">
                <strong>{t.names ?? `+${t.phone}`}</strong>
                <span className="muted small ellipsis">{t.lastDirection === 'OUT' ? 'Vous : ' : ''}{t.lastBody}</span>
                <span className="muted small">{fmt(t.lastAt)}</span>
              </span>
              {t.pending > 0 && <span className="badge badge-warn">{t.pending} à traiter</span>}
            </button>
          ))}
        </section>
        <section className="card grow">
          {!selected && <p className="muted">Choisissez une conversation. Celles qui attendent une réponse sont en haut.</p>}
          {selected && thread.data && (
            <>
              <h2>
                {thread.data.patients.length ? thread.data.patients.map((p) => `${p.firstName} ${p.lastName}`).join(' et ') : 'Numéro inconnu'}
                <span className="muted h1-sub"> · +{thread.data.phone}</span>
              </h2>
              <WaThread
                messages={thread.data.messages}
                windowOpen={thread.data.windowOpen}
                onReply={async (text) => {
                  await api(`/admin/whatsapp/threads/${selected}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
                  refresh();
                }}
                onHandled={async () => {
                  await api(`/admin/whatsapp/threads/${selected}/handled`, { method: 'POST' });
                  refresh();
                }}
              />
            </>
          )}
        </section>
      </div>
      {status.data && (
        <details className="card">
          <summary><strong>Modèles de messages à faire valider par Meta</strong></summary>
          <p className="muted small">Catégorie « Utilitaire », langue « Français ». Recopiez le nom et le texte à l'identique dans le gestionnaire WhatsApp de Meta.</p>
          {status.data.templates.map((t) => (
            <div key={t.name} className="template">
              <code>{t.name}</code>
              <p className="small">{t.body}</p>
              <p className="muted small">Variables : {t.params.map((p, i) => `{{${i + 1}}} ${p}`).join(' · ')}</p>
            </div>
          ))}
        </details>
      )}
    </Layout>
  );
}

// Écrire « comme le parent » pour essayer le parcours sans compte Meta
function Simulator({ onSent }: { onSent: (phone: string) => void }) {
  const [phone, setPhone] = useState('+237 6');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  async function send(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/admin/whatsapp/simulate', { method: 'POST', body: JSON.stringify({ phone, text }) });
      const digits = phone.replace(/\D/g, '');
      onSent(digits.length === 9 ? `237${digits}` : digits);
      setText('');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form className="card card-accent" onSubmit={send}>
      <h2>Simulateur : écrire comme un parent</h2>
      <div className="row align-end">
        <label className="narrow-wide">
          Numéro du parent
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Message
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="13/8, glycémie 1,2, OK, rendez-vous, j'ai mal à la tête…" />
        </label>
        <button type="submit" className="btn">Envoyer</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
