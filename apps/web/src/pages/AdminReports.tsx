import { useState } from 'react';
import { api } from '../api';
import Layout from '../components/Layout';
import { MonthlyReportRow } from '../types';
import { useApi } from '../useApi';

const month = (d: string) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Africa/Douala' }).format(new Date(d));

// Relecture des comptes rendus mensuels avant l'envoi aux familles
export default function AdminReports() {
  const [tab, setTab] = useState<'draft' | 'sent'>('draft');
  const list = useApi<MonthlyReportRow[]>(`/admin/reports?status=${tab}`);
  const [notice, setNotice] = useState('');

  async function generate() {
    const r = await api<{ month: string; created: number }>('/admin/reports/generate', { method: 'POST', body: JSON.stringify({}) });
    setNotice(`${r.created} brouillon${r.created > 1 ? 's' : ''} créé${r.created > 1 ? 's' : ''} pour ${month(`${r.month}-15`)}.`);
    list.reload();
  }

  return (
    <Layout>
      <div className="page-head">
        <h1>Comptes rendus mensuels</h1>
        <button type="button" className="btn btn-ghost btn-small" onClick={generate}>Générer ceux du mois dernier</button>
      </div>
      <p className="muted small">
        Le 1er de chaque mois, un brouillon est rédigé pour chaque parent à partir des consultations, relevés, rappels et livraisons. Relisez-le, corrigez-le si besoin, puis envoyez-le : la famille le reçoit par e-mail et WhatsApp.
      </p>
      {notice && <div className="notice notice-ok">{notice}</div>}
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'draft'} className={`tab ${tab === 'draft' ? 'on' : ''}`} onClick={() => setTab('draft')}>À relire</button>
        <button type="button" role="tab" aria-selected={tab === 'sent'} className={`tab ${tab === 'sent' ? 'on' : ''}`} onClick={() => setTab('sent')}>Envoyés</button>
      </div>
      {list.data?.length === 0 && <p className="muted">{tab === 'draft' ? 'Aucun compte rendu à relire.' : 'Aucun compte rendu envoyé.'}</p>}
      {list.data?.map((r) =>
        tab === 'draft' ? (
          <Draft key={r.id} r={r} onSent={(m) => { setNotice(m); list.reload(); }} />
        ) : (
          <details key={r.id} className="card">
            <summary>
              <strong>{r.patientName}</strong> · {month(r.month)} <span className="muted small">· envoyé le {new Date(r.sentAt!).toLocaleDateString('fr-FR')}</span>
            </summary>
            <p className="pre small">{r.content}</p>
          </details>
        ),
      )}
    </Layout>
  );
}

function Draft({ r, onSent }: { r: MonthlyReportRow; onSent: (m: string) => void }) {
  const [content, setContent] = useState(r.content);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const dirty = content !== r.content;

  async function save() {
    setError('');
    try {
      await api(`/admin/reports/${r.id}`, { method: 'PATCH', body: JSON.stringify({ content }) });
      setSaved('Enregistré.');
      r.content = content;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send() {
    setError('');
    try {
      if (dirty) await api(`/admin/reports/${r.id}`, { method: 'PATCH', body: JSON.stringify({ content }) });
      await api(`/admin/reports/${r.id}/send`, { method: 'POST' });
      onSent(`Compte rendu de ${r.patientName} envoyé à la famille.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>{r.patientName} · {month(r.month)}</h2>
      </div>
      <textarea className="report-edit" rows={Math.min(24, content.split('\n').length + 2)} value={content} onChange={(e) => { setContent(e.target.value); setSaved(''); }} />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={send}>Envoyer à la famille</button>
        <button type="button" className="btn btn-ghost" onClick={save} disabled={!dirty}>Enregistrer</button>
        {saved && <span className="success small">{saved}</span>}
      </div>
    </section>
  );
}
