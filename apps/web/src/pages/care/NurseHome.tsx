import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { dayKeyCm, fmtDayCm, fmtTimeCm } from '../../labels';
import { NurseVisit, Slot } from '../../types';
import { useApi } from '../../useApi';

export default function NurseHome({ firstName }: { firstName: string }) {
  const visits = useApi<NurseVisit[]>('/nurse/visits');
  const availability = useApi<Slot[]>('/care/availability');
  const upcoming = (visits.data ?? []).filter((v) => v.status === 'SCHEDULED');
  const byDay = upcoming.reduce<Record<string, NurseVisit[]>>((acc, v) => {
    (acc[dayKeyCm(v.scheduledAt)] ??= []).push(v);
    return acc;
  }, {});

  return (
    <Layout>
      <h1>Bonjour {firstName}</h1>
      {availability.data?.length === 0 && (
        <div className="notice notice-action">
          <span>Indiquez vos disponibilités pour recevoir des visites.</span>
          <Link className="btn" to="/disponibilites">Mes disponibilités</Link>
        </div>
      )}
      <section className="card">
        <h2>Mes visites à domicile</h2>
        {upcoming.length === 0 && <p className="muted">Aucune visite prévue cette semaine.</p>}
        {Object.entries(byDay).map(([day, items]) => (
          <div key={day} className="agenda-day">
            <h3>{fmtDayCm(items[0].scheduledAt)}</h3>
            <ul className="agenda">
              {items.map((v) => (
                <li key={v.id} className="agenda-row">
                  <span className="agenda-time">{fmtTimeCm(v.scheduledAt)}</span>
                  <span className="agenda-main">
                    <strong>{v.patient.name}</strong>
                    <span className="muted small">{v.patient.address}</span>
                  </span>
                  <Link className="btn btn-small" to={`/infirmier/visites/${v.id}`}>Ouvrir</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </Layout>
  );
}
