import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import { CITY_LABELS, CONDITION_LABELS, PLAN_LABELS, SUBSCRIPTION_STATUS } from '../../labels';
import { PatientDetail } from '../../types';
import { useApi } from '../../useApi';
import DossierTab from './tabs/DossierTab';
import FamilyTab from './tabs/FamilyTab';
import HistoryTab from './tabs/HistoryTab';
import PrescriptionsTab from './tabs/PrescriptionsTab';
import SubscriptionTab from './tabs/SubscriptionTab';
import SuiviTab from './tabs/SuiviTab';

const TABS = [
  { id: 'suivi', label: 'Suivi' },
  { id: 'historique', label: 'Consultations et comptes rendus' },
  { id: 'ordonnances', label: 'Ordonnances' },
  { id: 'abonnement', label: 'Abonnement' },
  { id: 'famille', label: 'Famille' },
  { id: 'dossier', label: 'Dossier' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function ParentPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [params] = useSearchParams();
  const justCreated = Boolean((location.state as { created?: boolean } | null)?.created);
  const cardReturn = params.get('paiement'); // retour de la page Stripe
  const [tab, setTab] = useState<TabId>(cardReturn === 'medicaments' ? 'ordonnances' : 'suivi');
  const { data: p, error, reload, setData } = useApi<PatientDetail>(`/patients/${id}`);

  // Au retour de Stripe, la confirmation arrive par notification quelques secondes plus tard : on rafraîchit
  useEffect(() => {
    if (cardReturn !== 'carte' || !p || p.subscription?.status === 'ACTIVE') return;
    const t = setTimeout(reload, 2500);
    return () => clearTimeout(t);
  }, [cardReturn, p, reload]);

  if (error) {
    return (
      <Layout>
        <p className="error">{error}</p>
        <Link to="/">← Mes parents</Link>
      </Layout>
    );
  }
  if (!p) return <Layout><p className="muted">Chargement…</p></Layout>;

  const sub = p.subscription;
  const status = sub ? SUBSCRIPTION_STATUS[sub.status] : null;
  const isOwner = p.role === 'OWNER';
  const needsPayment = sub && ['PENDING', 'PAST_DUE', 'SUSPENDED'].includes(sub.status);

  return (
    <Layout>
      <p className="small">
        <Link to="/">← Mes parents</Link>
      </p>

      <div className="page-head">
        <div>
          <h1>
            {p.firstName} {p.lastName}
          </h1>
          <p className="muted small">
            {p.district}, {CITY_LABELS[p.city]} · {p.conditions.map((c) => CONDITION_LABELS[c]).join(', ')}
          </p>
        </div>
        {sub && status && (
          <button type="button" className="plan-box" onClick={() => setTab('abonnement')}>
            <strong>
              {PLAN_LABELS[sub.plan]} · {sub.priceEur} € / mois
            </strong>
            <span className={`small tone-${status.tone}`}>{status.label}</span>
          </button>
        )}
      </div>

      {cardReturn === 'carte' &&
        (sub?.status === 'ACTIVE' ? (
          <div className="notice notice-ok">Paiement par carte confirmé : le suivi de {p.firstName} est actif.</div>
        ) : (
          <div className="notice notice-ok">Paiement par carte reçu, confirmation en cours…</div>
        ))}
      {justCreated && (
        <div className="notice notice-ok">
          {p.firstName} est inscrit(e). Dès son accord et le premier paiement, un médecin l'appelle pour le bilan de départ.
        </div>
      )}
      {!p.covered && (
        <div className="notice notice-warn">
          Le quartier {p.district} n'est pas encore desservi. Nous vous prévenons dès que le service y ouvre.
        </div>
      )}
      {!p.consentGiven && (
        <div className="notice notice-warn">
          <strong>{p.firstName} doit confirmer son accord.</strong>{' '}
          {isOwner && p.consentUrl ? (
            <>
              Envoyez-lui ce lien sur WhatsApp, il lui suffit de l'ouvrir et de cliquer sur « J'accepte » :
              <CopyLink url={p.consentUrl} />
            </>
          ) : (
            'Le titulaire du compte lui a envoyé le lien de confirmation.'
          )}
        </div>
      )}
      {isOwner && needsPayment && p.consentGiven && p.covered && cardReturn !== 'carte' && (
        <div className="notice notice-action">
          <span>
            {sub!.status === 'PENDING'
              ? `Dernière étape : activer le suivi de ${p.firstName}.`
              : `Le paiement du suivi de ${p.firstName} est en attente.`}
          </span>
          <Link className="btn" to={`/parents/${p.id}/paiement`}>
            {sub!.status === 'PENDING' ? 'Activer le suivi' : 'Régler maintenant'}
          </Link>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'suivi' && <SuiviTab patient={p} />}
      {tab === 'historique' && <HistoryTab patientId={p.id} />}
      {tab === 'ordonnances' && <PrescriptionsTab patient={p} />}
      {tab === 'abonnement' && <SubscriptionTab patient={p} onChanged={reload} />}
      {tab === 'famille' && <FamilyTab patient={p} />}
      {tab === 'dossier' && <DossierTab patient={p} onSaved={(updated) => setData(updated)} />}
    </Layout>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-link">
      <code>{url}</code>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => {
          navigator.clipboard?.writeText(url).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copié' : 'Copier le lien'}
      </button>
    </span>
  );
}
