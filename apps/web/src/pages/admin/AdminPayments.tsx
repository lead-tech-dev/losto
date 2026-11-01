import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { fmtDate, fmtXaf, PLAN_LABELS, SUBSCRIPTION_STATUS } from '../../labels';
import { useApi } from '../../useApi';

interface Pay {
  id: string;
  createdAt: string;
  paidAt: string | null;
  kind: 'SUBSCRIPTION' | 'MEDICATION';
  method: 'CARD' | 'MOBILE_MONEY';
  provider: 'STRIPE' | 'TRANZAK';
  status: string;
  amount: number;
  currency: 'EUR' | 'XAF';
  amountEur: number;
  invoiceNumber: string | null;
  failureReason: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  refundRef: string | null;
  payer: string;
  email: string;
  patient: string;
}

interface Unpaid {
  subscriptions: { patientId: string; patient: string; status: string; plan: string; method: string | null; periodEnd: string | null; payer: string; email: string; phone: string | null }[];
  medications: { prescriptionId: string; patient: string; priceXaf: number | null; since: string; payer: string; email: string }[];
}

const STATUS: Record<string, string> = { PENDING: 'En cours', SUCCEEDED: 'Réussi', FAILED: 'Échoué', CANCELED: 'Annulé', REFUNDED: 'Remboursé' };
const amountOf = (p: Pay) => (p.currency === 'EUR' ? `${(p.amount / 100).toFixed(2).replace('.', ',')} €` : fmtXaf(p.amount));

export default function AdminPayments() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') === 'impayes' ? 'unpaid' : 'list';
  return (
    <Layout>
      <h1>Paiements</h1>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'list'} className={`tab ${tab === 'list' ? 'on' : ''}`} onClick={() => setParams({})}>Tous les paiements</button>
        <button type="button" role="tab" aria-selected={tab === 'unpaid'} className={`tab ${tab === 'unpaid' ? 'on' : ''}`} onClick={() => setParams({ onglet: 'impayes' })}>Impayés</button>
      </div>
      {tab === 'list' ? <PaymentList /> : <UnpaidList />}
    </Layout>
  );
}

function PaymentList() {
  const [f, setF] = useState({ status: '', kind: '', month: '', search: '' });
  const [applied, setApplied] = useState(f);
  const q = new URLSearchParams(Object.entries(applied).filter(([, v]) => v));
  const { data, reload } = useApi<Pay[]>(`/admin/payments?${q}`);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const totals = (data ?? []).filter((p) => p.status === 'SUCCEEDED').reduce((s, p) => s + p.amountEur, 0);

  return (
    <>
      <form className="row align-end filters" onSubmit={(e: FormEvent) => { e.preventDefault(); setApplied(f); }}>
        <label>
          Rechercher
          <input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder="Famille, parent, n° de facture" />
        </label>
        <label className="narrow-wide">
          Statut
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Tous</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="narrow-wide">
          Objet
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="">Tous</option>
            <option value="SUBSCRIPTION">Abonnement</option>
            <option value="MEDICATION">Médicaments</option>
          </select>
        </label>
        <label className="narrow-wide">
          Mois
          <input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />
        </label>
        <button type="submit" className="btn">Filtrer</button>
      </form>
      {notice && <div className="notice notice-ok">{notice}</div>}
      <p className="muted small">
        {data ? `${data.length} paiement${data.length > 1 ? 's' : ''} · réussis : ${totals.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €` : 'Chargement…'}
      </p>
      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Famille / parent</th>
              <th>Objet</th>
              <th>Moyen</th>
              <th>Statut</th>
              <th className="num">Montant</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.paidAt ?? p.createdAt)}</td>
                <td className="wrap">
                  {p.payer} <span className="muted">· {p.patient}</span>
                  <br />
                  <span className="muted small">{p.email}</span>
                </td>
                <td>{p.kind === 'SUBSCRIPTION' ? 'Abonnement' : 'Médicaments'}{p.invoiceNumber && <span className="muted small"><br />{p.invoiceNumber}</span>}</td>
                <td>{p.method === 'CARD' ? 'Carte' : 'Mobile Money'}</td>
                <td className="wrap">
                  <span className={`badge ${p.status === 'SUCCEEDED' ? '' : p.status === 'FAILED' ? 'badge-urgent' : 'badge-muted'}`}>{STATUS[p.status]}</span>
                  {p.failureReason && <span className="muted small"><br />{p.failureReason}</span>}
                  {p.refundedAt && <span className="muted small"><br />{p.refundReason} · {p.refundRef}</span>}
                </td>
                <td className="num">{amountOf(p)}</td>
                <td>
                  {p.status === 'SUCCEEDED' && refunding !== p.id && (
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setRefunding(p.id)}>Rembourser</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {refunding && data && (
        <RefundForm
          p={data.find((x) => x.id === refunding)!}
          onClose={() => setRefunding(null)}
          onDone={(m) => {
            setRefunding(null);
            setNotice(m);
            reload();
          }}
        />
      )}
    </>
  );
}

function RefundForm({ p, onClose, onDone }: { p: Pay; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const card = p.provider === 'STRIPE';
  async function send(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api(`/admin/payments/${p.id}/refund`, { method: 'POST', body: JSON.stringify({ reason, ...(reference.trim() && { reference }) }) });
      onDone(`${amountOf(p)} remboursés à ${p.payer}.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form className="card card-accent" onSubmit={send}>
      <h2>Rembourser {amountOf(p)} à {p.payer}</h2>
      <p className="muted small">
        {card
          ? 'Le remboursement est fait automatiquement sur la carte (Stripe). La famille est prévenue par e-mail.'
          : 'Mobile Money : faites d’abord le remboursement depuis le portail Tranzak, puis notez ici sa référence.'}
      </p>
      <div className="row align-end">
        <label>
          Motif (communiqué à la famille)
          <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Double paiement, rupture de stock…" />
        </label>
        {!card && (
          <label className="narrow-wide">
            Référence Tranzak
            <input required value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        )}
        <button type="submit" className="btn btn-danger">Rembourser</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
      </div>
      <p className="muted small">Un remboursement ne résilie pas l’abonnement : faites-le à part si besoin.</p>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function UnpaidList() {
  const { data } = useApi<Unpaid>('/admin/unpaid');
  if (!data) return <p className="muted">Chargement…</p>;
  return (
    <>
      <section className="card">
        <h2>Abonnements impayés ({data.subscriptions.length})</h2>
        {data.subscriptions.length === 0 && <p className="muted">Aucun.</p>}
        <ul className="plain">
          {data.subscriptions.map((s) => (
            <li key={s.patientId} className="unpaid">
              <span className={`badge ${s.status === 'SUSPENDED' ? 'badge-urgent' : 'badge-warn'}`}>{SUBSCRIPTION_STATUS[s.status].label}</span>{' '}
              <strong>{s.patient}</strong> · {PLAN_LABELS[s.plan]} · {s.method === 'CARD' ? 'carte' : 'Mobile Money'}
              {s.periodEnd && <> · échéance {fmtDate(s.periodEnd)}</>}
              <br />
              <span className="small">
                {s.payer} · <a href={`mailto:${s.email}`}>{s.email}</a>
                {s.phone && <> · <a href={`tel:${s.phone}`}>{s.phone}</a></>}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Médicaments chiffrés, non payés depuis plus de 48 h ({data.medications.length})</h2>
        {data.medications.length === 0 && <p className="muted">Aucun.</p>}
        <ul className="plain">
          {data.medications.map((m) => (
            <li key={m.prescriptionId} className="unpaid">
              <strong>{m.patient}</strong> · {m.priceXaf ? fmtXaf(m.priceXaf) : '—'} · depuis le {fmtDate(m.since)}
              <br />
              <span className="small">{m.payer} · <a href={`mailto:${m.email}`}>{m.email}</a></span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
