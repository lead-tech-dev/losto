import { useState } from 'react';
import { api } from '../../../api';
import PayPanel from '../../../components/PayPanel';
import { DELIVERY_STATUS, fmtDate, fmtXaf, PRESCRIPTION_STATUS } from '../../../labels';
import { CheckoutResult, PatientDetail, Prescription, SubscriptionView } from '../../../types';
import { useApi } from '../../../useApi';

const XAF_PER_EUR = 655.957;

export default function PrescriptionsTab({ patient }: { patient: PatientDetail }) {
  const { data, reload } = useApi<Prescription[]>(`/patients/${patient.id}/prescriptions`);
  // Moyens de paiement réellement ouverts (clés Stripe / Tranzak configurées)
  const sub = useApi<SubscriptionView>(`/patients/${patient.id}/subscription`);
  const [paying, setPaying] = useState<string | null>(null);
  const [paidInfo, setPaidInfo] = useState('');

  if (!data) return <p className="muted">Chargement…</p>;
  if (data.length === 0) {
    return (
      <section className="card">
        <p className="muted">Aucune ordonnance pour l'instant. Elles apparaîtront ici après chaque consultation.</p>
      </section>
    );
  }

  const toPay = data.filter((p) => p.status === 'AWAITING_PAYMENT' && p.priceXaf);
  const inDelivery = data.filter((p) => p.deliveryCode);
  const refused = data.filter((p) => p.status === 'CANCELED' && p.cancelReason);
  const isOwner = patient.role === 'OWNER';

  return (
    <div className="stack">
      {paidInfo && <div className="notice notice-ok">{paidInfo}</div>}

      {inDelivery.map((p) => (
        <section key={p.id} className="card card-accent">
          <h3>Médicaments en livraison</h3>
          <p className="small">
            Ordonnance du {fmtDate(p.createdAt)} : {p.items.map((it) => it.name).join(', ')}
          </p>
          <p>
            Code à donner au livreur : <strong className="code-show">{p.deliveryCode}</strong>
          </p>
          <p className="muted small">
            Transmettez-le à {patient.firstName} ; le livreur ne remet le colis que contre ce code. Ne le communiquez à personne d'autre.
          </p>
        </section>
      ))}
      {refused.map((p) => (
        <p key={p.id} className="notice notice-warn">
          La pharmacie n'a pas pu servir l'ordonnance du {fmtDate(p.createdAt)} : {p.cancelReason}. Le médecin a été prévenu et va proposer une alternative.
        </p>
      ))}

      {toPay.map((p) => (
        <section key={p.id} className="card card-accent">
          <h3>Médicaments à valider : {fmtXaf(p.priceXaf!)}</h3>
          <ul className="plain">
            {p.items.map((it, i) => (
              <li key={i}>
                <strong>{it.name}</strong>
                {it.dosage && <span className="muted"> · {it.dosage}</span>}
                {it.quantity && <span className="muted"> · {it.quantity} unités</span>}
              </li>
            ))}
          </ul>
          {p.pharmacyNote && <p className="small">Note de la pharmacie : {p.pharmacyNote}</p>}
          <p className="muted small">Prix de la pharmacie, sans marge. Elle prépare la commande dès le paiement, puis un livreur l'apporte.</p>
          {!isOwner ? (
            <p className="muted small">Le titulaire du compte valide et règle les médicaments.</p>
          ) : paying === p.id ? (
            <PayPanel
              eur={`${(Math.ceil((p.priceXaf! / XAF_PER_EUR) * 100) / 100).toFixed(2).replace('.', ',')} €`}
              xaf={fmtXaf(p.priceXaf!)}
              card={Boolean(sub.data?.cardConfigured)}
              mobileMoney={Boolean(sub.data?.mobileMoneyConfigured)}
              recurring={false}
              start={(method, phone) =>
                api<CheckoutResult>(`/prescriptions/${p.id}/pay`, {
                  method: 'POST',
                  body: JSON.stringify({ method, phone }),
                })
              }
              onPaid={() => {
                setPaying(null);
                setPaidInfo('Paiement reçu : la pharmacie prépare les médicaments.');
                reload();
              }}
            />
          ) : (
            <div>
              <button type="button" className="btn" onClick={() => setPaying(p.id)}>
                Valider et payer
              </button>
            </div>
          )}
        </section>
      ))}

      <section className="card">
        <h3>Toutes les ordonnances</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Médicaments</th>
                <th>Médecin</th>
                <th>Statut</th>
                <th>Livraison</th>
                <th className="num">Prix</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td className="wrap">
                    {p.items.map((it, i) => (
                      <div key={i}>
                        {it.name}
                        {it.dosage && <span className="muted"> · {it.dosage}</span>}
                      </div>
                    ))}
                  </td>
                  <td>{p.doctorName}</td>
                  <td>{PRESCRIPTION_STATUS[p.status]}</td>
                  <td>{p.deliveryStatus ? DELIVERY_STATUS[p.deliveryStatus] : '—'}</td>
                  <td className="num">{p.priceXaf !== null ? fmtXaf(p.priceXaf) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
