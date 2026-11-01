import { useState } from 'react';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { fmtDate, fmtXaf } from '../../labels';
import { useApi } from '../../useApi';
import { lastMonth, monthLabel, ROLE_NAMES } from './common';

interface Summary {
  partnerId: string;
  name: string;
  role: string;
  city: string | null;
  month: string;
  items: number;
  totalXaf: number;
  payout: { amountXaf: number; reference: string | null; paidAt: string } | null;
}
export interface StatementView extends Omit<Summary, 'items'> {
  lines: { date: string; patient: string; label: string; amountXaf: number }[];
}

// Ce que Proche Santé doit à chaque partenaire pour un mois, et le suivi des versements
export default function AdminPayouts() {
  const [month, setMonth] = useState(lastMonth());
  const { data, reload } = useApi<Summary[]>(`/admin/payouts?month=${month}`);
  const [open, setOpen] = useState<string | null>(null);
  const due = (data ?? []).filter((s) => !s.payout).reduce((s, x) => s + x.totalXaf, 0);

  return (
    <Layout>
      <div className="page-head">
        <h1>Relevés des partenaires</h1>
        <label className="narrow-wide">
          Mois
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
      </div>
      <p className="muted small">
        Actes réalisés en {monthLabel(month)} × tarif ; pour les pharmacies, le prix des médicaments payé par les familles (reversé sans marge).
        {data && ` Reste à verser : ${fmtXaf(due)}.`}
      </p>
      {data?.length === 0 && <p className="muted">Aucun acte ce mois-ci.</p>}
      <div className="stack-sm">
        {data?.map((s) => (
          <article key={s.partnerId} className="card payout">
            <div className="payout-head">
              <span>
                <strong>{s.name}</strong>
                <span className="muted small"> · {ROLE_NAMES[s.role]} · {s.items} acte{s.items > 1 ? 's' : ''}</span>
              </span>
              <span className="payout-amount">{fmtXaf(s.totalXaf)}</span>
            </div>
            <div className="row">
              {s.payout ? (
                <span className="badge">Versé le {fmtDate(s.payout.paidAt)}{s.payout.reference ? ` · ${s.payout.reference}` : ''}</span>
              ) : (
                <PayButton s={s} onDone={reload} />
              )}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(open === s.partnerId ? null : s.partnerId)}>
                {open === s.partnerId ? 'Masquer le détail' : 'Voir le détail'}
              </button>
            </div>
            {open === s.partnerId && <Detail partnerId={s.partnerId} month={month} />}
          </article>
        ))}
      </div>
    </Layout>
  );
}

function PayButton({ s, onDone }: { s: Summary; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  if (!asking) return <button type="button" className="btn btn-small" onClick={() => setAsking(true)}>Marquer comme versé</button>;
  return (
    <span className="row align-end">
      <label className="narrow-wide">
        Référence du versement
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Orange Money, virement…" />
      </label>
      <button
        type="button"
        className="btn btn-small"
        onClick={() =>
          api(`/admin/payouts/${s.partnerId}/${s.month}/paid`, { method: 'POST', body: JSON.stringify({ reference }) })
            .then(onDone)
            .catch((e) => setError(e.message))
        }
      >
        Confirmer {fmtXaf(s.totalXaf)}
      </button>
      {error && <span className="error small">{error}</span>}
    </span>
  );
}

function Detail({ partnerId, month }: { partnerId: string; month: string }) {
  const { data } = useApi<StatementView>(`/admin/payouts/${partnerId}?month=${month}`);
  return data ? <Lines lines={data.lines} /> : <p className="muted small">Chargement…</p>;
}

export function Lines({ lines }: { lines: StatementView['lines'] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Acte</th>
            <th>Parent</th>
            <th className="num">Montant</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{fmtDate(l.date)}</td>
              <td>{l.label}</td>
              <td>{l.patient}</td>
              <td className="num">{fmtXaf(l.amountXaf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
