import { DELIVERY_STATUS, fmtDate, fmtXaf, PRESCRIPTION_STATUS } from '../../../labels';
import { Prescription } from '../../../types';
import { useApi } from '../../../useApi';

export default function PrescriptionsTab({ patientId }: { patientId: string }) {
  const { data } = useApi<Prescription[]>(`/patients/${patientId}/prescriptions`);
  if (!data) return <p className="muted">Chargement…</p>;
  if (data.length === 0) {
    return (
      <section className="card">
        <p className="muted">Aucune ordonnance pour l'instant. Elles apparaîtront ici après chaque consultation.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <p className="muted small">Les médicaments sont facturés au prix de la pharmacie, sans marge de notre part.</p>
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
  );
}
