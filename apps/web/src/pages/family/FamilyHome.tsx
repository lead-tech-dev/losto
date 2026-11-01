import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { CITY_LABELS, CONDITION_LABELS, PLAN_LABELS, SUBSCRIPTION_STATUS } from '../../labels';
import { PatientSummary } from '../../types';
import { useApi } from '../../useApi';

export default function FamilyHome({ firstName }: { firstName: string }) {
  const { data: patients, error, loading } = useApi<PatientSummary[]>('/patients');

  return (
    <Layout>
      <div className="page-head">
        <h1>Bonjour {firstName}</h1>
        <Link className="btn" to="/parents/nouveau">
          Inscrire un parent
        </Link>
      </div>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Chargement…</p>}

      {patients && patients.length === 0 && (
        <section className="card empty">
          <h2>Inscrivez votre premier parent</h2>
          <p>
            En 5 minutes : ses coordonnées à Douala ou Yaoundé, les maladies à suivre et la formule. Un médecin le
            contacte ensuite pour un premier bilan.
          </p>
          <Link className="btn" to="/parents/nouveau">
            Commencer
          </Link>
        </section>
      )}

      <div className="grid-cards">
        {patients?.map((p) => {
          const status = p.subscription ? SUBSCRIPTION_STATUS[p.subscription.status] : null;
          return (
            <Link key={p.id} to={`/parents/${p.id}`} className="card patient-card">
              <div className="patient-card-head">
                <h2>
                  {p.firstName} {p.lastName}
                </h2>
                {p.role === 'MEMBER' && <span className="badge badge-muted">Suivi partagé</span>}
              </div>
              <p className="muted small">
                {p.district}, {CITY_LABELS[p.city]}
              </p>
              <div className="chips">
                {p.conditions.map((c) => (
                  <span key={c} className="chip">
                    {CONDITION_LABELS[c]}
                  </span>
                ))}
              </div>
              {p.subscription && status && (
                <p className="small">
                  Formule {PLAN_LABELS[p.subscription.plan]} · <span className={`tone-${status.tone}`}>{status.label}</span>
                </p>
              )}
              {!p.covered && <p className="small tone-warn">Quartier pas encore desservi</p>}
              {!p.consentGiven && <p className="small tone-warn">Consentement du parent en attente</p>}
            </Link>
          );
        })}
      </div>
    </Layout>
  );
}
