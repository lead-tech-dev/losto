import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { CONDITION_LABELS, dayKeyCm, fmtDayCm, fmtTimeCm, KIND_LABELS, MODE_LABELS } from '../../labels';
import { AgendaItem, AlertView, Slot } from '../../types';
import { useApi } from '../../useApi';

export default function DoctorHome({ firstName }: { firstName: string }) {
  const agenda = useApi<AgendaItem[]>('/doctor/agenda');
  const alerts = useApi<AlertView[]>('/doctor/alerts');
  const availability = useApi<Slot[]>('/care/availability');
  const today = dayKeyCm(new Date());

  const upcoming = (agenda.data ?? []).filter((c) => c.status === 'SCHEDULED');
  const todays = upcoming.filter((c) => dayKeyCm(c.scheduledAt) === today);
  const later = upcoming.filter((c) => dayKeyCm(c.scheduledAt) > today);
  const byDay = later.reduce<Record<string, AgendaItem[]>>((acc, c) => {
    (acc[dayKeyCm(c.scheduledAt)] ??= []).push(c);
    return acc;
  }, {});

  return (
    <Layout>
      <h1>Bonjour Dr {firstName}</h1>

      {availability.data?.length === 0 && (
        <div className="notice notice-action">
          <span>Indiquez vos disponibilités pour recevoir des rendez-vous.</span>
          <Link className="btn" to="/disponibilites">Mes disponibilités</Link>
        </div>
      )}

      {alerts.data && alerts.data.length > 0 && (
        <section className="card card-alert">
          <h2>Alertes à traiter ({alerts.data.length})</h2>
          <ul className="plain">
            {alerts.data.map((a) => (
              <li key={a.id} className="alert-row">
                <span className={`badge ${a.severity === 'URGENT' ? 'badge-urgent' : 'badge-warn'}`}>{a.severity === 'URGENT' ? 'Urgent' : 'À surveiller'}</span>
                <span>
                  <strong>{a.patientName}</strong> · {a.message} <span className="muted small">· {fmtDayCm(a.createdAt)} à {fmtTimeCm(a.createdAt)}</span>
                </span>
                <Link to={`/medecin/patients/${a.patientId}`} className="btn btn-small">Ouvrir le dossier</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Aujourd'hui</h2>
        {todays.length === 0 && <p className="muted">Aucune consultation aujourd'hui.</p>}
        <ul className="agenda">
          {todays.map((c) => <AgendaRow key={c.id} c={c} />)}
        </ul>
      </section>

      <section className="card">
        <h2>Cette semaine</h2>
        {Object.keys(byDay).length === 0 && <p className="muted">Rien de prévu les prochains jours.</p>}
        {Object.entries(byDay).map(([day, items]) => (
          <div key={day} className="agenda-day">
            <h3>{fmtDayCm(items[0].scheduledAt)}</h3>
            <ul className="agenda">{items.map((c) => <AgendaRow key={c.id} c={c} />)}</ul>
          </div>
        ))}
      </section>
    </Layout>
  );
}

function AgendaRow({ c }: { c: AgendaItem }) {
  return (
    <li className="agenda-row">
      <span className="agenda-time">{fmtTimeCm(c.scheduledAt)}</span>
      <span className="agenda-main">
        <strong>{c.patient.name}</strong>
        <span className="muted small">
          {KIND_LABELS[c.kind]} · {MODE_LABELS[c.mode]} · {c.patient.conditions.map((x) => CONDITION_LABELS[x]).join(', ')}
        </span>
      </span>
      <Link className="btn btn-small" to={`/medecin/patients/${c.patient.id}?consultation=${c.id}`}>
        Ouvrir
      </Link>
    </li>
  );
}
