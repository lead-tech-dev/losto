import { useState } from 'react';
import { downloadInvoice } from '../invoice';
import { fmtDate } from '../labels';
import { PaymentView } from '../types';

const STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'En attente', tone: 'warn' },
  SUCCEEDED: { label: 'Payé', tone: 'ok' },
  FAILED: { label: 'Échoué', tone: 'warn' },
  CANCELED: { label: 'Annulé', tone: 'muted' },
  REFUNDED: { label: 'Remboursé', tone: 'muted' },
};

export default function PaymentsTable({ payments, showPatient = false }: { payments: PaymentView[]; showPatient?: boolean }) {
  const [error, setError] = useState('');
  if (payments.length === 0) return <p className="muted">Aucun paiement pour l'instant.</p>;

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              {showPatient && <th>Parent</th>}
              <th>Objet</th>
              <th>Moyen</th>
              <th>Statut</th>
              <th className="num">Montant</th>
              <th>Facture</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.paidAt ?? p.createdAt)}</td>
                {showPatient && <td>{p.patientName}</td>}
                <td className="wrap">
                  {p.lines.map((l) => l.label).join(' + ')}
                  {p.status === 'FAILED' && p.failureReason && <div className="muted small">{p.failureReason}</div>}
                </td>
                <td>{p.method === 'CARD' ? 'Carte' : 'Mobile Money'}</td>
                <td className={`tone-${STATUS[p.status].tone}`}>{STATUS[p.status].label}</td>
                <td className="num">{p.amountLabel}</td>
                <td>
                  {p.invoiceNumber ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => downloadInvoice(p.id, p.invoiceNumber!).catch((e) => setError(e.message))}
                    >
                      PDF {p.invoiceNumber}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
