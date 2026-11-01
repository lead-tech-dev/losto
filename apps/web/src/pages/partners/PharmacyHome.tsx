import { FormEvent, useState } from 'react';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { DELIVERY_STATUS, fmtDate, fmtXaf } from '../../labels';
import { PharmacyPrescription } from '../../types';
import { useApi } from '../../useApi';

const GROUPS = [
  { id: 'SENT', title: 'À chiffrer', hint: 'Indiquez le prix : la famille valide et paie avant que vous ne prépariez.' },
  { id: 'AWAITING_PAYMENT', title: 'En attente du paiement de la famille', hint: 'Ne préparez pas encore.' },
  { id: 'PREPARING', title: 'Payées : à préparer', hint: 'Marquez « prête » quand le sachet est fermé : un livreur est envoyé.' },
  { id: 'READY', title: 'Prêtes, en livraison', hint: '' },
] as const;

export default function PharmacyHome() {
  const { data, reload } = useApi<PharmacyPrescription[]>('/pharmacy/prescriptions');
  const [notice, setNotice] = useState('');

  return (
    <Layout>
      <h1>Ordonnances</h1>
      {notice && <div className="notice notice-ok">{notice}</div>}
      {GROUPS.map((g) => {
        const items = (data ?? []).filter((p) => p.status === g.id);
        return (
          <section key={g.id} className="card">
            <div className="section-head">
              <h2>{g.title} ({items.length})</h2>
            </div>
            {g.hint && <p className="muted small">{g.hint}</p>}
            {items.length === 0 && <p className="muted small">Rien pour l'instant.</p>}
            {items.map((p) => (
              <PrescriptionCard
                key={p.id}
                p={p}
                onDone={(m) => {
                  setNotice(m);
                  reload();
                }}
              />
            ))}
          </section>
        );
      })}
      <section className="card">
        <h2>Historique</h2>
        {!(data ?? []).some((p) => p.status === 'DELIVERED' || p.status === 'CANCELED') && <p className="muted small">Les ordonnances livrées ou non servies apparaîtront ici.</p>}
        <ul className="plain small">
          {(data ?? [])
            .filter((p) => p.status === 'DELIVERED' || p.status === 'CANCELED')
            .slice(0, 30)
            .map((p) => (
              <li key={p.id}>
                {fmtDate(p.createdAt)} · {p.patientName} · {p.status === 'DELIVERED' ? `livrée · ${fmtXaf(p.priceXaf ?? 0)}` : `non servie : ${p.cancelReason}`}
              </li>
            ))}
        </ul>
      </section>
    </Layout>
  );
}

function PrescriptionCard({ p, onDone }: { p: PharmacyPrescription; onDone: (m: string) => void }) {
  const [price, setPrice] = useState(p.priceXaf ? String(p.priceXaf) : '');
  const [note, setNote] = useState(p.pharmacyNote ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  async function call(path: string, body?: unknown, done?: string) {
    setError('');
    try {
      await api(`/pharmacy/prescriptions/${p.id}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      onDone(done ?? 'Enregistré.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function submitPrice(e: FormEvent) {
    e.preventDefault();
    const n = Number(price.replace(/\s/g, ''));
    if (!Number.isInteger(n) || n < 100) return setError('Prix en FCFA, nombre entier');
    call('price', { priceXaf: n, note: note || undefined }, `Prix envoyé à la famille de ${p.patientName}.`);
  }

  return (
    <article className="order">
      <div className="order-head">
        <strong>{p.patientName}</strong>
        <span className="muted small">
          {p.district} · {p.doctorName} · {fmtDate(p.createdAt)}
        </span>
      </div>
      <ul className="plain">
        {p.items.map((it, i) => (
          <li key={i}>
            <strong>{it.name}</strong>
            {it.dosage && <span className="muted"> · {it.dosage}</span>}
            {it.quantity && <span className="muted"> · {it.quantity} unités</span>}
          </li>
        ))}
      </ul>

      {(p.status === 'SENT' || p.status === 'AWAITING_PAYMENT') && !rejecting && (
        <form className="row align-end" onSubmit={submitPrice}>
          <label className="narrow">
            Prix total (FCFA)
            <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>
            Note pour la famille (facultatif)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Générique, boîte de 30…" />
          </label>
          <button type="submit" className="btn">{p.status === 'SENT' ? 'Envoyer le prix' : 'Corriger le prix'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setRejecting(true)}>Impossible à servir</button>
        </form>
      )}
      {rejecting && (
        <div className="row align-end">
          <label>
            Pourquoi ? (transmis au médecin et à la famille)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rupture de stock de…" />
          </label>
          <button type="button" className="btn btn-danger" onClick={() => call('reject', { reason }, 'Le médecin et la famille sont prévenus.')}>Confirmer</button>
          <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)}>Annuler</button>
        </div>
      )}
      {p.status === 'PREPARING' && (
        <div className="row">
          <span className="small">Payée : {fmtXaf(p.priceXaf ?? 0)}</span>
          <button type="button" className="btn" onClick={() => call('ready', undefined, 'Commande prête : un livreur va passer.')}>Commande prête</button>
        </div>
      )}
      {p.status === 'READY' && <p className="small">Livraison : {p.deliveryStatus ? DELIVERY_STATUS[p.deliveryStatus] : 'livreur en cours d’affectation'}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}
