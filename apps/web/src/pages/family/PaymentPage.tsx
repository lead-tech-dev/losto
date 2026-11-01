import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import Layout from '../../components/Layout';
import PayPanel from '../../components/PayPanel';
import { fmtDate, PLAN_LABELS } from '../../labels';
import { CheckoutResult, PatientDetail, SubscriptionView } from '../../types';
import { useApi } from '../../useApi';

const nf = new Intl.NumberFormat('fr-FR');

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const patient = useApi<PatientDetail>(`/patients/${id}`);
  const sub = useApi<SubscriptionView>(`/patients/${id}/subscription`);
  const [paid, setPaid] = useState(false);

  if (patient.error || sub.error) return <Layout><p className="error">{patient.error || sub.error}</p></Layout>;
  if (!patient.data || !sub.data) return <Layout><p className="muted">Chargement…</p></Layout>;

  const p = patient.data;
  const s = sub.data;
  const n = s.nextPayment;
  const isRenewal = s.status !== 'PENDING' && s.status !== 'CANCELED';
  const card = s.canPay.card && s.cardConfigured;
  const mobile = s.canPay.mobileMoney && s.mobileMoneyConfigured;

  return (
    <Layout>
      <p className="small">
        <Link to={`/parents/${id}`}>← {p.firstName} {p.lastName}</Link>
      </p>
      <h1>{isRenewal ? `Renouveler le suivi de ${p.firstName}` : `Activer le suivi de ${p.firstName}`}</h1>

      <div className="pay-layout">
        <section className="card">
          {paid ? (
            <div className="pay-done">
              <h2>Paiement reçu</h2>
              <p>Le suivi de {p.firstName} est actif. Un reçu vous a été envoyé par e-mail.</p>
              {!isRenewal && <p>Un médecin va appeler {p.firstName} dans les prochains jours pour le bilan de départ.</p>}
              <button type="button" className="btn" onClick={() => navigate(`/parents/${id}`)}>
                Revenir au suivi
              </button>
            </div>
          ) : s.canPay.reason ? (
            <p className="notice notice-warn">{s.canPay.reason}</p>
          ) : !card && !mobile ? (
            <p className="notice notice-warn">Le paiement en ligne n'est pas encore ouvert. Écrivez-nous depuis la messagerie.</p>
          ) : (
            <PayPanel
              eur={`${n.eur} €`}
              xaf={`${nf.format(n.xaf)} FCFA`}
              card={card}
              mobileMoney={mobile}
              start={(method, phone) =>
                api<CheckoutResult>(`/patients/${id}/checkout`, { method: 'POST', body: JSON.stringify({ method, phone }) })
              }
              onPaid={() => setPaid(true)}
            />
          )}
        </section>

        <aside className="card summary">
          <h3>Récapitulatif</h3>
          <dl className="facts">
            <div>
              <dt>Formule {PLAN_LABELS[n.plan]}</dt>
              <dd>{n.includesSignupFee ? n.eur - 30 : n.eur} € / mois</dd>
            </div>
            {n.includesSignupFee && (
              <div>
                <dt>Inscription (une seule fois)</dt>
                <dd>30 €</dd>
              </div>
            )}
            <div className="total">
              <dt>Total aujourd'hui</dt>
              <dd>
                {n.eur} € <span className="muted small">ou {nf.format(n.xaf)} FCFA</span>
              </dd>
            </div>
          </dl>
          <ul className="plain small muted">
            {isRenewal && s.currentPeriodEnd && <li>Le nouveau mois commence le {fmtDate(s.currentPeriodEnd)}, sans perdre de jours.</li>}
            <li>Sans engagement : résiliable à tout moment depuis l'onglet Abonnement.</li>
            <li>Mobile Money : un paiement par mois, avec un rappel 5 jours avant l'échéance.</li>
            <li>Carte : prélevée automatiquement chaque mois.</li>
          </ul>
        </aside>
      </div>
    </Layout>
  );
}
