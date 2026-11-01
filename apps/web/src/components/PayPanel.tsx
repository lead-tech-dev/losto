import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { CheckoutResult, PaymentView } from '../types';

interface Props {
  eur: string; // montant affiché pour la carte, ex. "55 €"
  xaf: string; // montant affiché pour le Mobile Money, ex. "36 100 FCFA"
  card: boolean; // moyens proposés
  mobileMoney: boolean;
  defaultPhone?: string;
  recurring?: boolean; // abonnement (carte renouvelée chaque mois) ou paiement unique (médicaments)
  start: (method: 'CARD' | 'MOBILE_MONEY', phone?: string) => Promise<CheckoutResult>;
  onPaid: (p: PaymentView) => void;
}

const POLL_MS = 3000;
const POLL_LIMIT_MS = 4 * 60 * 1000;

// Choix du moyen de paiement, puis attente de la validation sur le téléphone (Mobile Money)
// ou redirection vers la page sécurisée Stripe (carte).
export default function PayPanel({ eur, xaf, card, mobileMoney, defaultPhone = '', recurring = true, start, onPaid }: Props) {
  const [method, setMethod] = useState<'CARD' | 'MOBILE_MONEY'>(mobileMoney ? 'MOBILE_MONEY' : 'CARD');
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<PaymentView | null>(null);
  const [failed, setFailed] = useState<PaymentView | null>(null);
  const startedAt = useRef(0);

  // Pendant l'attente, on demande le statut toutes les 3 secondes (l'API le vérifie auprès de Tranzak)
  useEffect(() => {
    if (!waiting) return;
    startedAt.current = Date.now();
    const timer = setInterval(async () => {
      try {
        const p = await api<PaymentView>(`/payments/${waiting.id}`);
        if (p.status === 'SUCCEEDED') {
          clearInterval(timer);
          setWaiting(null);
          onPaid(p);
        } else if (p.status !== 'PENDING') {
          clearInterval(timer);
          setWaiting(null);
          setFailed(p);
        } else if (Date.now() - startedAt.current > POLL_LIMIT_MS) {
          clearInterval(timer);
          setWaiting(null);
          setError('Toujours pas de validation. Si le payeur a validé, le paiement apparaîtra d’ici quelques minutes ; sinon, réessayez.');
        }
      } catch {
        // panne réseau passagère : on réessaie au prochain tour
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, onPaid]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setFailed(null);
    if (method === 'MOBILE_MONEY' && phone.replace(/\D/g, '').length < 9) {
      return setError('Indiquez le numéro MTN ou Orange qui va payer');
    }
    setBusy(true);
    try {
      const r = await start(method, method === 'MOBILE_MONEY' ? phone : undefined);
      if (r.kind === 'redirect') {
        window.location.href = r.url; // page de paiement sécurisée Stripe
        return;
      }
      if (r.payment.status === 'SUCCEEDED') onPaid(r.payment);
      else setWaiting(r.payment);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (waiting) {
    return (
      <div className="pay-wait" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <h3>Validez le paiement sur le téléphone</h3>
        <p>
          Une demande de <strong>{waiting.amountLabel}</strong> vient d'être envoyée au {formatPhone(phone)}. Le payeur
          doit l'accepter en saisissant son code secret Mobile Money.
        </p>
        <p className="muted small">Pas de message ? Il peut aussi valider depuis le menu de son opérateur. Cette page se met à jour toute seule.</p>
      </div>
    );
  }

  return (
    <form className="stack-sm" onSubmit={submit}>
      <fieldset className="pay-methods">
        <legend className="sr-only">Moyen de paiement</legend>
        {mobileMoney && (
          <label className={`pay-method ${method === 'MOBILE_MONEY' ? 'on' : ''}`}>
            <input type="radio" name="method" checked={method === 'MOBILE_MONEY'} onChange={() => setMethod('MOBILE_MONEY')} />
            <span className="pay-method-name">Mobile Money</span>
            <span className="pay-method-amount">{xaf}</span>
            <span className="muted small">MTN ou Orange, payé depuis le Cameroun</span>
          </label>
        )}
        {card && (
          <label className={`pay-method ${method === 'CARD' ? 'on' : ''}`}>
            <input type="radio" name="method" checked={method === 'CARD'} onChange={() => setMethod('CARD')} />
            <span className="pay-method-name">Carte bancaire</span>
            <span className="pay-method-amount">{eur}</span>
            <span className="muted small">{recurring ? 'Renouvelé automatiquement chaque mois' : 'Paiement unique, en euros'}</span>
          </label>
        )}
      </fieldset>

      {method === 'MOBILE_MONEY' && (
        <label>
          Numéro MTN ou Orange qui paie
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setError('');
            }}
            placeholder="6 77 12 34 56"
          />
          <span className="muted small hint">Le vôtre si vous avez un compte au Cameroun, celui de votre parent ou d'un proche.</span>
        </label>
      )}

      {failed && (
        <p className="error" role="alert">
          Paiement non abouti{failed.failureReason ? ` : ${failed.failureReason}` : ''}. Vous pouvez réessayer.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div>
        <button type="submit" className="btn btn-big" disabled={busy}>
          {busy ? 'Un instant…' : method === 'CARD' ? `Payer ${eur} par carte` : `Payer ${xaf}`}
        </button>
      </div>
    </form>
  );
}

function formatPhone(p: string) {
  const d = p.replace(/\D/g, '').replace(/^237/, '');
  // Espaces insécables : le numéro ne se coupe jamais en fin de ligne
  const nb = ' ';
  return d.length === 9 ? [d[0], d.slice(1, 3), d.slice(3, 5), d.slice(5, 7), d.slice(7)].join(nb) : p;
}
