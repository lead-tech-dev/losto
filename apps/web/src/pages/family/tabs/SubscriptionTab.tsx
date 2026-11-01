import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api';
import PaymentsTable from '../../../components/PaymentsTable';
import PlanPicker from '../../../components/PlanPicker';
import { fmtDate, PLAN_LABELS, SUBSCRIPTION_STATUS } from '../../../labels';
import { PatientDetail, PaymentView, SubscriptionView } from '../../../types';
import { useApi } from '../../../useApi';

export default function SubscriptionTab({ patient, onChanged }: { patient: PatientDetail; onChanged: () => void }) {
  const { data: s, setData, reload } = useApi<SubscriptionView>(`/patients/${patient.id}/subscription`);
  const allPayments = useApi<PaymentView[]>(patient.role === 'OWNER' ? '/payments' : null);
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!s) return <p className="muted">Chargement…</p>;
  const isOwner = s.role === 'OWNER';
  const status = SUBSCRIPTION_STATUS[s.status];
  const payments = (allPayments.data ?? []).filter((p) => p.patientId === patient.id);
  const liveCard = s.paymentMethod === 'CARD' && s.status !== 'CANCELED' && s.status !== 'PENDING';
  const payable = s.canPay.card || s.canPay.mobileMoney;

  async function run(path: string, body?: unknown) {
    setError('');
    try {
      const updated = await api<SubscriptionView>(path, { method: body ? 'PATCH' : 'POST', body: body ? JSON.stringify(body) : undefined });
      setData(updated);
      setConfirmCancel(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function openPortal() {
    try {
      const r = await api<{ url: string }>(`/patients/${patient.id}/billing-portal`, { method: 'POST' });
      window.location.href = r.url;
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-head">
          <h3>
            Formule {PLAN_LABELS[s.plan]} · {s.priceEur} € / mois
          </h3>
          <span className={`badge tone-${status.tone}`}>{status.label}</span>
        </div>
        <dl className="facts">
          {s.paymentMethod && (
            <div>
              <dt>Moyen de paiement</dt>
              <dd>{s.paymentMethod === 'CARD' ? 'Carte bancaire, prélevée chaque mois' : 'Mobile Money, payé chaque mois'}</dd>
            </div>
          )}
          {s.currentPeriodEnd && s.status !== 'PENDING' && (
            <div>
              <dt>{s.cancelAtPeriodEnd ? 'Fin du suivi' : s.status === 'ACTIVE' ? 'Payé jusqu’au' : 'Échéance dépassée depuis le'}</dt>
              <dd>{fmtDate(s.currentPeriodEnd)}</dd>
            </div>
          )}
          {s.pendingPlan && (
            <div>
              <dt>Au prochain paiement</dt>
              <dd>Passage à la formule {PLAN_LABELS[s.pendingPlan]}</dd>
            </div>
          )}
        </dl>

        {s.status === 'SUSPENDED' && (
          <p className="notice notice-warn">Le suivi est suspendu faute de paiement : plus de consultations ni de rappels. Il reprend dès le paiement.</p>
        )}
        {s.cancelAtPeriodEnd && (
          <p className="notice notice-warn">Résiliation demandée : le suivi s'arrêtera le {fmtDate(s.currentPeriodEnd!)}.</p>
        )}

        {isOwner && (
          <div className="row">
            {payable && (
              <Link className="btn" to={`/parents/${patient.id}/paiement`}>
                {s.status === 'PENDING' || s.status === 'CANCELED' ? 'Activer le suivi' : 'Payer maintenant'}
              </Link>
            )}
            {liveCard && (
              <button type="button" className="btn btn-ghost" onClick={openPortal}>
                {s.status === 'ACTIVE' ? 'Changer de carte' : 'Mettre à jour ma carte'}
              </button>
            )}
            {s.cancelAtPeriodEnd && (
              <button type="button" className="btn btn-ghost" onClick={() => run(`/patients/${patient.id}/subscription/resume`)}>
                Annuler la résiliation
              </button>
            )}
          </div>
        )}
        {!payable && s.canPay.reason && s.status !== 'ACTIVE' && <p className="muted small">{s.canPay.reason}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {isOwner && s.status !== 'CANCELED' && (
        <section className="card">
          <h3>Changer de formule</h3>
          <PlanPicker value={s.pendingPlan ?? s.plan} onChange={(plan) => run(`/patients/${patient.id}/plan`, { plan })} />
          <p className="muted small">
            {s.status === 'PENDING'
              ? 'Vous pouvez changer librement avant le premier paiement.'
              : s.paymentMethod === 'CARD'
                ? 'Le changement est immédiat ; la différence est calculée au prorata sur votre prochaine facture.'
                : 'Le mois en cours est déjà payé : la nouvelle formule s’appliquera au prochain paiement.'}
          </p>
        </section>
      )}

      {isOwner && (
        <section className="card">
          <h3>Paiements et factures</h3>
          <PaymentsTable payments={payments} />
        </section>
      )}

      {isOwner && s.status !== 'CANCELED' && !s.cancelAtPeriodEnd && (
        <section className="card">
          <h3>Résilier</h3>
          {!confirmCancel ? (
            <>
              <p className="muted small">
                Sans frais.{' '}
                {s.status === 'ACTIVE'
                  ? `Le suivi continue jusqu’au ${fmtDate(s.currentPeriodEnd!)}, puis s’arrête.`
                  : 'Le suivi s’arrête immédiatement.'}
              </p>
              <div>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(true)}>
                  Résilier l'abonnement
                </button>
              </div>
            </>
          ) : (
            <div className="row">
              <p>Confirmer la résiliation du suivi de {patient.firstName} ?</p>
              <button type="button" className="btn btn-danger" onClick={() => run(`/patients/${patient.id}/subscription/cancel`)}>
                Oui, résilier
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { setConfirmCancel(false); reload(); }}>
                Non
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
