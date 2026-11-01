import { useState } from 'react';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { fmtDate, fmtSlotCm } from '../../labels';
import { LabRequestRow } from '../../types';
import { useApi } from '../../useApi';

// Date + heure saisies en heure du Cameroun (UTC+1 toute l'année) → instant ISO
function cameroonIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+01:00`).toISOString();
}

export default function LabHome() {
  const { data, reload } = useApi<LabRequestRow[]>('/lab/requests');
  const [notice, setNotice] = useState('');
  const todo = (data ?? []).filter((r) => r.status !== 'RESULTS_AVAILABLE');
  const done = (data ?? []).filter((r) => r.status === 'RESULTS_AVAILABLE');

  return (
    <Layout>
      <h1>Analyses</h1>
      {notice && <div className="notice notice-ok">{notice}</div>}
      <section className="card">
        <h2>À traiter ({todo.length})</h2>
        {todo.length === 0 && <p className="muted">Aucune demande en attente.</p>}
        {todo.map((r) => (
          <LabCard key={r.id} r={r} onDone={(m) => { setNotice(m); reload(); }} />
        ))}
      </section>
      <section className="card">
        <h2>Résultats envoyés</h2>
        <ul className="plain small">
          {done.map((r) => (
            <li key={r.id}>
              {fmtDate(r.resultsAt ?? r.createdAt)} · {r.patient.name} · {r.tests.join(', ')} {r.resultsAbnormal && <span className="badge badge-warn">anormal</span>}
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}

function LabCard({ r, onDone }: { r: LabRequestRow; onDone: (m: string) => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('08:00');
  const [mode, setMode] = useState<'AT_LAB' | 'HOME_SAMPLING'>('HOME_SAMPLING');
  const [results, setResults] = useState('');
  const [abnormal, setAbnormal] = useState(false);
  const [error, setError] = useState('');

  async function call(path: string, body?: unknown, msg = 'Enregistré.') {
    setError('');
    try {
      await api(`/lab/requests/${r.id}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      onDone(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <article className="order">
      <div className="order-head">
        <strong>{r.patient.name}</strong>
        <span className="muted small">
          {r.patient.address} · <a href={`tel:${r.patient.phone}`}>{r.patient.phone}</a> · demandé par {r.doctorName} le {fmtDate(r.createdAt)}
        </span>
      </div>
      <p><strong>{r.tests.join(' · ')}</strong>{r.note && <span className="muted small"> · {r.note}</span>}</p>

      {r.status === 'REQUESTED' && (
        <>
          {r.appointmentAt && (
            <p className="small">
              Rendez-vous : {fmtSlotCm(r.appointmentAt)} · {r.appointmentMode === 'HOME_SAMPLING' ? 'prélèvement à domicile' : 'au laboratoire'}
            </p>
          )}
          <div className="row align-end">
            <label className="narrow">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="narrow">Heure (Cameroun)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <label className="narrow-wide">
              Lieu
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="HOME_SAMPLING">Prélèvement à domicile</option>
                <option value="AT_LAB">Au laboratoire</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => (date ? call('appointment', { at: cameroonIso(date, time), mode }, 'Rendez-vous envoyé à la famille.') : setError('Choisissez une date'))}
            >
              {r.appointmentAt ? 'Changer le rendez-vous' : 'Fixer le rendez-vous'}
            </button>
            <button type="button" className="btn" onClick={() => call('sampled', undefined, 'Prélèvement enregistré.')}>Prélèvement fait</button>
          </div>
        </>
      )}

      {r.status === 'SAMPLED' && (
        <div className="stack-sm">
          <label>
            Résultats
            <textarea rows={4} value={results} onChange={(e) => setResults(e.target.value)} placeholder={'HbA1c : 7,2 %\nCréatinine : 9 mg/L'} />
          </label>
          <label className={`check ${abnormal ? 'on' : ''}`}>
            <input type="checkbox" checked={abnormal} onChange={(e) => setAbnormal(e.target.checked)} />
            Au moins une valeur hors normes (alerte au médecin)
          </label>
          <div>
            <button type="button" className="btn" onClick={() => call('results', { results, abnormal }, 'Résultats envoyés au médecin.')}>Envoyer les résultats</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}
