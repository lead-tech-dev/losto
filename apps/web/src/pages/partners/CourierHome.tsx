import { useState } from 'react';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { CourierDelivery } from '../../types';
import { useApi } from '../../useApi';

// Pensé pour le téléphone du livreur : récupérer, livrer contre le code du parent, signaler un échec.
export default function CourierHome({ firstName }: { firstName: string }) {
  const { data, reload } = useApi<CourierDelivery[]>('/courier/deliveries');
  const [notice, setNotice] = useState('');
  const toPick = (data ?? []).filter((d) => d.status === 'ASSIGNED');
  const onWay = (data ?? []).filter((d) => d.status === 'IN_TRANSIT');
  const failed = (data ?? []).filter((d) => d.status === 'FAILED');

  const done = (m: string) => {
    setNotice(m);
    reload();
    window.scrollTo({ top: 0 });
  };

  return (
    <Layout>
      <h1>Bonjour {firstName}</h1>
      {notice && <div className="notice notice-ok">{notice}</div>}
      {data?.length === 0 && <p className="muted">Aucune livraison pour l'instant.</p>}
      {onWay.length > 0 && <Group title="À livrer" items={onWay} onDone={done} />}
      {toPick.length > 0 && <Group title="À récupérer en pharmacie" items={toPick} onDone={done} />}
      {failed.length > 0 && <Group title="À repasser" items={failed} onDone={done} />}
    </Layout>
  );
}

function Group({ title, items, onDone }: { title: string; items: CourierDelivery[]; onDone: (m: string) => void }) {
  return (
    <section className="card">
      <h2>{title} ({items.length})</h2>
      {items.map((d) => <DeliveryCard key={d.id} d={d} onDone={onDone} />)}
    </section>
  );
}

function DeliveryCard({ d, onDone }: { d: CourierDelivery; onDone: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('Personne au domicile');
  const [error, setError] = useState('');

  async function call(path: string, body?: unknown, msg = 'Enregistré.') {
    setError('');
    try {
      await api(`/courier/deliveries/${d.id}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      onDone(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <article className="order">
      <div className="route">
        <div>
          <span className="muted small">Récupérer</span>
          <strong>{d.pickup.name}</strong>
          {d.pickup.phone && <a href={`tel:${d.pickup.phone}`} className="small">{d.pickup.phone}</a>}
        </div>
        <div>
          <span className="muted small">Livrer</span>
          <strong>{d.dropoff.name}</strong>
          <span className="small">{d.dropoff.address}</span>
          <a href={`tel:${d.dropoff.phone}`} className="btn btn-ghost btn-small">Appeler {d.dropoff.phone}</a>
        </div>
      </div>
      {d.status === 'FAILED' && <p className="small tone-warn">Échec : {d.failureReason} ({d.attempts} tentative{d.attempts > 1 ? 's' : ''})</p>}

      {d.status === 'ASSIGNED' && (
        <button type="button" className="btn btn-big" onClick={() => call('picked-up', undefined, 'Colis récupéré.')}>J'ai récupéré le colis</button>
      )}
      {d.status === 'IN_TRANSIT' && !failing && (
        <div className="stack-sm">
          <label>
            Code donné par le patient
            <input className="code-input" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
          </label>
          <div className="row">
            <button type="button" className="btn btn-big" disabled={code.length !== 4} onClick={() => call('delivered', { code }, 'Livraison confirmée. Merci !')}>
              Confirmer la remise
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setFailing(true)}>Livraison impossible</button>
          </div>
        </div>
      )}
      {failing && (
        <div className="row align-end">
          <label>
            Que s'est-il passé ?
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="btn btn-danger" onClick={() => call('failed', { reason }, 'Échec signalé, la famille est prévenue.')}>Signaler</button>
          <button type="button" className="btn btn-ghost" onClick={() => setFailing(false)}>Annuler</button>
        </div>
      )}
      {d.status === 'FAILED' && (
        <button type="button" className="btn" onClick={() => call('retry', undefined, 'Livraison relancée.')}>Repasser</button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}
