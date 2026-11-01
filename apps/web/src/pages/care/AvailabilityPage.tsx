import { useEffect, useState } from 'react';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { WEEKDAYS } from '../../labels';
import { Slot } from '../../types';
import { useApi } from '../../useApi';

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// Semaine type du soignant, en heure du Cameroun. Les rendez-vous sont placés automatiquement dans ces plages.
export default function AvailabilityPage() {
  const { data } = useApi<Slot[]>('/care/availability');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  useEffect(() => {
    if (data) setSlots(data);
  }, [data]);

  const update = (i: number, patch: Partial<Slot>) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    setMsg({});
    try {
      const saved = await api<Slot[]>('/care/availability', { method: 'PUT', body: JSON.stringify({ slots }) });
      setSlots(saved);
      setMsg({ ok: 'Disponibilités enregistrées. Les prochains rendez-vous seront placés dans ces plages.' });
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
  }

  return (
    <Layout>
      <h1>Mes disponibilités</h1>
      <p className="muted">
        Votre semaine type, en heure du Cameroun. Proche Santé y place automatiquement vos rendez-vous (20 minutes par
        consultation, 45 minutes par visite à domicile). Les rendez-vous déjà fixés ne bougent pas.
      </p>
      <section className="card">
        {WEEKDAYS.map((label, idx) => {
          const weekday = idx + 1;
          const daySlots = slots.map((s, i) => ({ s, i })).filter((x) => x.s.weekday === weekday);
          return (
            <div key={weekday} className="avail-day">
              <strong className="avail-label">{label}</strong>
              <div className="avail-slots">
                {daySlots.length === 0 && <span className="muted small">Indisponible</span>}
                {daySlots.map(({ s, i }) => (
                  <span key={i} className="avail-slot">
                    <label className="sr-only" htmlFor={`start-${i}`}>Début {label}</label>
                    <input id={`start-${i}`} type="time" step={600} value={toTime(s.startMinute)} onChange={(e) => update(i, { startMinute: toMin(e.target.value) })} />
                    <span aria-hidden="true">–</span>
                    <label className="sr-only" htmlFor={`end-${i}`}>Fin {label}</label>
                    <input id={`end-${i}`} type="time" step={600} value={toTime(s.endMinute)} onChange={(e) => update(i, { endMinute: toMin(e.target.value) })} />
                    <button type="button" className="btn btn-ghost btn-small" aria-label={`Retirer la plage du ${label}`} onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
                      Retirer
                    </button>
                  </span>
                ))}
              </div>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setSlots([...slots, { weekday, startMinute: 540, endMinute: 720 }])}>
                + Plage
              </button>
            </div>
          );
        })}
        {msg.error && <p className="error">{msg.error}</p>}
        {msg.ok && <p className="success">{msg.ok}</p>}
        <div>
          <button type="button" className="btn" onClick={save}>
            Enregistrer
          </button>
        </div>
      </section>
    </Layout>
  );
}
