import { FormEvent, useState } from 'react';
import Layout from '../../components/Layout';
import { ROLE_LABELS } from '../../components/Layout';
import { fmtDateTime } from '../../labels';
import { useApi } from '../../useApi';

interface Page {
  page: number;
  hasMore: boolean;
  rows: { id: string; action: string; entity: string; entityId: string | null; createdAt: string; actorName: string | null; actorEmail: string | null; actorRole: string | null }[];
}

// Les actions les plus fréquentes, en clair
const ACTIONS: Record<string, string> = {
  'patient.read': 'A consulté le dossier',
  'patient.create': 'A inscrit un parent',
  'patient.consent': 'Le parent a donné son accord (lien)',
  'patient.consent.whatsapp': 'Le parent a donné son accord (WhatsApp)',
  'care.set_team': 'A changé l’équipe',
  'payment.refund': 'A remboursé un paiement',
  'payout.paid': 'A versé un relevé',
  'report.send': 'A envoyé un compte rendu',
  'report.edit': 'A corrigé un compte rendu',
  'whatsapp.thread.read': 'A lu les messages WhatsApp',
  'whatsapp.emergency': 'Message d’urgence reçu',
  'whatsapp.opt_out': 'Le parent a répondu STOP',
  'clinical.read': 'A consulté le dossier médical',
  'user.create': 'A créé un compte',
  'user.login': 'S’est connecté',
  'user.activate': 'A réactivé un compte',
  'user.deactivate': 'A désactivé un compte',
  'partner.verify': 'A vérifié un partenaire',
  'pharmacy.price': 'A chiffré une ordonnance',
  'lab.results': 'A déposé des résultats',
  'lab.review': 'A lu des résultats',
  'delivery.delivered': 'A livré des médicaments',
  'coverage.add': 'A ajouté un quartier',
  'coverage.remove': 'A retiré un quartier',
};

export default function AdminAudit() {
  const [f, setF] = useState({ actor: '', action: '', entity: '', entityId: '', from: '', to: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const q = new URLSearchParams(Object.entries({ ...applied, page: String(page) }).filter(([, v]) => v));
  const { data } = useApi<Page>(`/admin/audit?${q}`);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Layout>
      <h1>Journal des accès</h1>
      <p className="muted small">Chaque lecture d’un dossier de santé et chaque action sensible, avec son auteur. Conservé pour les contrôles et les demandes des familles.</p>
      <form className="row align-end filters" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setApplied(f); }}>
        <label>
          Qui
          <input value={f.actor} onChange={set('actor')} placeholder="Nom ou e-mail" />
        </label>
        <label className="narrow-wide">
          Action
          <select value={f.action} onChange={set('action')}>
            <option value="">Toutes</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="narrow-wide">
          Sur
          <select value={f.entity} onChange={set('entity')}>
            <option value="">Tout</option>
            <option value="Patient">Parent</option>
            <option value="Payment">Paiement</option>
            <option value="User">Compte</option>
            <option value="MonthlyReport">Compte rendu</option>
            <option value="Prescription">Ordonnance</option>
            <option value="LabRequest">Analyses</option>
          </select>
        </label>
        <label className="narrow">
          Du
          <input type="date" value={f.from} onChange={set('from')} />
        </label>
        <label className="narrow">
          Au
          <input type="date" value={f.to} onChange={set('to')} />
        </label>
        <button type="submit" className="btn">Filtrer</button>
      </form>
      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>Quand</th>
              <th>Qui</th>
              <th>Action</th>
              <th>Sur</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.createdAt)}</td>
                <td className="wrap">
                  {r.actorName ?? <span className="muted">Système / parent</span>}
                  {r.actorRole && <span className="muted small"> · {ROLE_LABELS[r.actorRole]}</span>}
                </td>
                <td className="wrap">{ACTIONS[r.action] ?? r.action}</td>
                <td className="wrap small">
                  {r.entity}
                  {r.entityId && <code className="muted"> {r.entityId.slice(0, 8)}</code>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.rows.length === 0 && <p className="muted">Aucune entrée.</p>}
      </div>
      <div className="row">
        <button type="button" className="btn btn-ghost btn-small" disabled={page === 1} onClick={() => setPage(page - 1)}>← Plus récent</button>
        <span className="small muted">Page {page}</span>
        <button type="button" className="btn btn-ghost btn-small" disabled={!data?.hasMore} onClick={() => setPage(page + 1)}>Plus ancien →</button>
      </div>
    </Layout>
  );
}
