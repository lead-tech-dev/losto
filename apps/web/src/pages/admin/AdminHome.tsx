import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { useApi } from '../../useApi';
import { eur, since } from './common';

interface Overview {
  month: string;
  subscribers: { active: number; essentiel: number; serenite: number; pastDue: number; pending: number };
  mrrEur: number;
  revenueThisMonthEur: number;
  medicationsThisMonthEur: number;
  consultationsDone: number;
  consultationsNext7Days: number;
  urgentAlerts: number;
  whatsappWaiting: number;
  reportsToReview: number;
  delays: Delay[];
}

export interface Delay {
  kind: string;
  severity: 'high' | 'medium';
  label: string;
  patientId: string | null;
  patientName: string | null;
  who: string | null;
  since: string;
}

const KIND: Record<string, string> = {
  consultation: 'Consultation',
  visit: 'Visite',
  prescription: 'Ordonnance',
  delivery: 'Livraison',
  lab: 'Analyses',
  alert: 'Alerte',
  team: 'Équipe',
  whatsapp: 'WhatsApp',
};

// Tableau de bord de l'équipe : les chiffres du jour et tout ce qui attend une action
export default function AdminHome({ firstName }: { firstName: string }) {
  const { data: o } = useApi<Overview>('/admin/overview');

  return (
    <Layout>
      <h1>Bonjour {firstName}</h1>
      {!o && <p className="muted">Chargement…</p>}
      {o && (
        <>
          <div className="kpis">
            <Kpi label="Parents suivis" value={String(o.subscribers.active)} sub={`${o.subscribers.essentiel} Essentiel · ${o.subscribers.serenite} Sérénité`} to="/admin/parents?status=ACTIVE" />
            <Kpi label="Revenu mensuel récurrent" value={eur(o.mrrEur)} sub={`Encaissé ce mois : ${eur(o.revenueThisMonthEur)}`} to="/admin/indicateurs" />
            <Kpi label="Impayés" value={String(o.subscribers.pastDue)} sub={`${o.subscribers.pending} inscription${o.subscribers.pending > 1 ? 's' : ''} sans paiement`} tone={o.subscribers.pastDue ? 'warn' : undefined} to="/admin/paiements?onglet=impayes" />
            <Kpi label="Consultations" value={String(o.consultationsDone)} sub={`faites ce mois · ${o.consultationsNext7Days} dans les 7 jours`} />
            <Kpi label="Alertes urgentes" value={String(o.urgentAlerts)} sub="non traitées par le médecin" tone={o.urgentAlerts ? 'alert' : undefined} />
            <Kpi label="WhatsApp à traiter" value={String(o.whatsappWaiting)} sub={`${o.reportsToReview} compte${o.reportsToReview > 1 ? 's' : ''} rendu${o.reportsToReview > 1 ? 's' : ''} à relire`} tone={o.whatsappWaiting ? 'warn' : undefined} to="/admin/whatsapp" />
          </div>

          <section className="card">
            <div className="section-head">
              <h2>À traiter ({o.delays.length})</h2>
            </div>
            {o.delays.length === 0 && <p className="muted">Rien en retard. 👍</p>}
            <ul className="delays">
              {o.delays.map((d, i) => (
                <li key={i} className={d.severity === 'high' ? 'high' : ''}>
                  <span className={`badge ${d.severity === 'high' ? 'badge-urgent' : 'badge-warn'}`}>{KIND[d.kind] ?? d.kind}</span>
                  <span className="delay-text">
                    <strong>{d.label}</strong>
                    <span className="muted small">
                      {d.patientName && (d.patientId ? <Link to={`/admin/parents?search=${encodeURIComponent(d.patientName)}`}>{d.patientName}</Link> : d.patientName)}
                      {d.who && ` · ${d.who}`} · {since(d.since)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </Layout>
  );
}

function Kpi({ label, value, sub, tone, to }: { label: string; value: string; sub: string; tone?: 'warn' | 'alert'; to?: string }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="muted small">{sub}</span>
    </>
  );
  return to ? (
    <Link to={to} className={`kpi ${tone ?? ''}`}>{body}</Link>
  ) : (
    <div className={`kpi ${tone ?? ''}`}>{body}</div>
  );
}
