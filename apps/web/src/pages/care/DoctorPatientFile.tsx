import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import Layout from '../../components/Layout';
import LineChart from '../../components/LineChart';
import {
  CITY_LABELS,
  CONDITION_LABELS,
  CONSULTATION_STATUS,
  fmtDate,
  fmtSlotCm,
  KIND_LABELS,
  MODE_LABELS,
  PLAN_LABELS,
  PRESCRIPTION_STATUS,
  URGENCY_LABELS,
} from '../../labels';
import { PatientFile } from '../../types';
import { useApi } from '../../useApi';
import ConsultationPanel from './ConsultationPanel';

function ReviewForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  async function send() {
    try {
      await api(`/doctor/labs/${id}/review`, { method: 'POST', body: JSON.stringify({ comment }) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="row align-end">
      <label>
        Commentaire pour la famille (rend les résultats visibles)
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Résultats corrects, on continue le traitement." />
      </label>
      <button type="button" className="btn btn-small" onClick={send}>Marquer comme lus</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function DoctorPatientFile() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const { data: f, error, reload } = useApi<PatientFile>(`/doctor/patients/${id}`);
  const [notice, setNotice] = useState('');

  if (error) return <Layout><p className="error">{error}</p><Link to="/">← Agenda</Link></Layout>;
  if (!f) return <Layout><p className="muted">Chargement…</p></Layout>;

  const p = f.patient;
  const scheduled = f.consultations.filter((c) => c.status === 'SCHEDULED').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const selectedId = params.get('consultation') ?? scheduled.find((c) => new Date(c.scheduledAt).getTime() <= Date.now() + 60 * 60 * 1000)?.id;
  const current = scheduled.find((c) => c.id === selectedId);
  const past = f.consultations.filter((c) => c.status !== 'SCHEDULED');
  const bp = f.readings.filter((r) => r.type === 'BLOOD_PRESSURE');
  const glucose = f.readings.filter((r) => r.type === 'GLUCOSE');

  async function ack(alertId: string) {
    await api(`/doctor/alerts/${alertId}/ack`, { method: 'POST', body: JSON.stringify({}) });
    reload();
  }

  return (
    <Layout>
      <p className="small">
        <Link to="/">← Agenda</Link> · <Link to="/medecin/patients">Mes patients</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>
            {p.firstName} {p.lastName}
            {p.birthYear && <span className="muted h1-sub"> · {new Date().getFullYear() - p.birthYear} ans</span>}
          </h1>
          <p className="muted small">
            {p.conditions.map((c) => CONDITION_LABELS[c]).join(', ')} · {p.district}, {CITY_LABELS[p.city]} · {p.whatsappPhone}
            {!p.hasSmartphone && ' (pas de smartphone)'}
          </p>
        </div>
        {p.plan && <span className="badge">{PLAN_LABELS[p.plan]}</span>}
      </div>

      {notice && <div className="notice notice-ok">{notice}</div>}

      {f.openAlerts.length > 0 && (
        <section className="card card-alert">
          <h2>Alertes</h2>
          {f.openAlerts.map((a) => (
            <div key={a.id} className="alert-row">
              <span className={`badge ${a.severity === 'URGENT' ? 'badge-urgent' : 'badge-warn'}`}>{a.severity === 'URGENT' ? 'Urgent' : 'À surveiller'}</span>
              <span>{a.message} <span className="muted small">· {fmtSlotCm(a.createdAt)}</span></span>
              <button type="button" className="btn btn-small" onClick={() => ack(a.id)}>Marquer comme traitée</button>
            </div>
          ))}
        </section>
      )}

      {current ? (
        <ConsultationPanel
          key={current.id}
          c={current}
          file={f}
          onDone={(m) => {
            setNotice(m);
            setParams({});
            reload();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      ) : (
        scheduled.length > 0 && (
          <section className="card">
            <h2>Prochaines consultations</h2>
            <ul className="plain">
              {scheduled.map((c) => (
                <li key={c.id}>
                  <button type="button" className="link-btn" onClick={() => setParams({ consultation: c.id })}>
                    {fmtSlotCm(c.scheduledAt)} · {KIND_LABELS[c.kind]} · {MODE_LABELS[c.mode]}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <div className="file-grid">
        <section className="card">
          <h2>Dossier</h2>
          <dl className="facts">
            <div><dt>Antécédents</dt><dd>{p.medicalHistory || '—'}</dd></div>
            <div><dt>Traitement déclaré à l'inscription</dt><dd>{p.currentTreatments || '—'}</dd></div>
            <div><dt>À savoir</dt><dd>{p.notes || '—'}</dd></div>
            <div><dt>Adresse</dt><dd>{p.district}{p.addressDetails ? ` · ${p.addressDetails}` : ''}</dd></div>
          </dl>
        </section>

        <section className="card">
          <h2>Ordonnances</h2>
          {f.prescriptions.length === 0 && <p className="muted">Aucune.</p>}
          {f.prescriptions.slice(0, 4).map((pr) => (
            <div key={pr.id} className="presc">
              <p className="small muted">{fmtDate(pr.createdAt)} · {PRESCRIPTION_STATUS[pr.status]}</p>
              <ul className="plain">
                {pr.items.map((it, i) => <li key={i}><strong>{it.name}</strong>{it.dosage && <span className="muted"> · {it.dosage}</span>}</li>)}
              </ul>
            </div>
          ))}
        </section>
      </div>

      {(bp.length > 0 || glucose.length > 0) && (
        <section className="card">
          <h2>Relevés (12 mois)</h2>
          {bp.length > 0 && (
            <div className="chart-block">
              <h4>Tension</h4>
              <LineChart
                unit="mmHg"
                series={[
                  { name: 'Systolique', color: '#0E5A43', points: bp.map((r) => ({ date: r.measuredAt, value: r.systolic ?? 0 })) },
                  { name: 'Diastolique', color: '#C2693E', points: bp.map((r) => ({ date: r.measuredAt, value: r.diastolic ?? 0 })) },
                ]}
              />
            </div>
          )}
          {glucose.length > 0 && (
            <div className="chart-block">
              <h4>Glycémie</h4>
              <LineChart unit="g/L" series={[{ name: 'Glycémie', color: '#0E5A43', points: glucose.map((r) => ({ date: r.measuredAt, value: r.value ?? 0 })) }]} />
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Historique</h2>
        {past.length === 0 && f.homeVisits.length === 0 && <p className="muted">Première prise en charge.</p>}
        <ul className="timeline">
          {past.map((c) => (
            <li key={c.id}>
              <div className="timeline-head">
                <strong>{fmtDate(c.scheduledAt)}</strong>
                <span className="muted small">{KIND_LABELS[c.kind]} · {CONSULTATION_STATUS[c.status]}{c.missedReason ? ` (${c.missedReason})` : ''}</span>
              </div>
              {c.summary && <p className="pre">{c.summary}</p>}
            </li>
          ))}
          {f.homeVisits.filter((v) => v.status === 'DONE').map((v) => (
            <li key={v.id}>
              <div className="timeline-head">
                <strong>{fmtDate(v.scheduledAt)}</strong>
                <span className="muted small">Visite infirmière · traitement {v.treatmentChecked ? 'vérifié' : 'non vérifié'}</span>
              </div>
              {v.note && <p className="pre">{v.note}</p>}
            </li>
          ))}
        </ul>
        {f.referrals.length > 0 && (
          <>
            <h3>Orientations</h3>
            <ul className="plain">
              {f.referrals.map((r) => <li key={r.id}>{fmtDate(r.createdAt)} · <strong>{r.destination}</strong> · {URGENCY_LABELS[r.urgency]} · {r.reason}</li>)}
            </ul>
          </>
        )}
        {f.labRequests.length > 0 && (
          <>
            <h3>Analyses</h3>
            <ul className="plain">
              {f.labRequests.map((l) => (
                <li key={l.id} className="lab-item">
                  {fmtDate(l.createdAt)} · {l.tests.join(', ')}
                  {l.note && <span className="muted"> · {l.note}</span>} ·{' '}
                  {l.status === 'RESULTS_AVAILABLE' ? (l.reviewedAt ? 'lus' : <strong className="tone-warn">résultats à lire</strong>) : 'en attente'}
                  {l.resultsAbnormal && <span className="badge badge-warn"> anormal</span>}
                  {l.results && <p className="pre small">{l.results}</p>}
                  {l.doctorComment && <p className="small muted">Votre commentaire : {l.doctorComment}</p>}
                  {l.status === 'RESULTS_AVAILABLE' && !l.reviewedAt && <ReviewForm id={l.id} onDone={reload} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </Layout>
  );
}
