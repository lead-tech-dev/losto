import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { CITY_LABELS, CONDITION_LABELS, fmtSlotCm, PLAN_LABELS, SUBSCRIPTION_STATUS } from '../../labels';
import { DoctorPatientRow } from '../../types';
import { useApi } from '../../useApi';

export default function DoctorPatients() {
  const { data } = useApi<DoctorPatientRow[]>('/doctor/patients');
  return (
    <Layout>
      <h1>Mes patients</h1>
      <section className="card">
        {data?.length === 0 && <p className="muted">Aucun patient ne vous est encore affecté.</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Suivi</th>
                <th>Quartier</th>
                <th>Formule</th>
                <th>Prochaine consultation</th>
                <th>Alertes</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/medecin/patients/${p.id}`}>{p.name}</Link>
                    {p.birthYear && <span className="muted small"> · {new Date().getFullYear() - p.birthYear} ans</span>}
                  </td>
                  <td className="wrap">{p.conditions.map((c) => CONDITION_LABELS[c]).join(', ')}</td>
                  <td>{p.district}, {CITY_LABELS[p.city]}</td>
                  <td>
                    {p.plan ? PLAN_LABELS[p.plan] : '—'}
                    {p.subscriptionStatus && p.subscriptionStatus !== 'ACTIVE' && (
                      <span className="tone-warn small"> · {SUBSCRIPTION_STATUS[p.subscriptionStatus].label}</span>
                    )}
                  </td>
                  <td>{p.nextConsultation ? fmtSlotCm(p.nextConsultation) : '—'}</td>
                  <td>{p.openAlerts > 0 ? <span className="badge badge-urgent">{p.openAlerts}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
}
