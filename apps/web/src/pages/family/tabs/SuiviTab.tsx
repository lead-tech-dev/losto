import { useState } from 'react';
import LineChart from '../../../components/LineChart';
import { DELIVERY_STATUS, fmtDate, fmtShort, fmtSlotCm, KIND_LABELS, MODE_LABELS } from '../../../labels';
import { Dashboard, PatientDetail, Reading } from '../../../types';
import { useApi } from '../../../useApi';

const PERIODS = [
  { days: 30, label: '1 mois' },
  { days: 90, label: '3 mois' },
  { days: 365, label: '1 an' },
];

export default function SuiviTab({ patient }: { patient: PatientDetail }) {
  const { data: d, error } = useApi<Dashboard>(`/patients/${patient.id}/dashboard`);
  const [days, setDays] = useState(90);
  const tracksBp = patient.conditions.some((c) => ['HYPERTENSION', 'SENIOR_FOLLOWUP', 'CHOLESTEROL'].includes(c));
  const tracksGlucose = patient.conditions.includes('DIABETES');

  if (error) return <p className="error">{error}</p>;
  if (!d) return <p className="muted">Chargement…</p>;

  const bp = d.latestReadings.find((r) => r.type === 'BLOOD_PRESSURE');
  const glucose = d.latestReadings.find((r) => r.type === 'GLUCOSE');
  const weight = d.latestReadings.find((r) => r.type === 'WEIGHT');

  return (
    <div className="stack">
      <div className="grid-cards">
        <section className="card">
          <h3>Prochaine consultation</h3>
          {d.nextConsultation ? (
            <>
              <p className="big">{fmtSlotCm(d.nextConsultation.scheduledAt)}</p>
              <p className="muted small">
                Heure du Cameroun · {KIND_LABELS[d.nextConsultation.kind] ?? 'Consultation'} · {d.nextConsultation.doctorName} ·{' '}
                {MODE_LABELS[d.nextConsultation.mode]}
              </p>
              {d.nextConsultation.videoUrl && (
                <div className="video-box">
                  <p className="small">
                    Lien de la visio, à envoyer à {patient.firstName} sur WhatsApp : il l'ouvre à l'heure du rendez-vous,
                    sans rien installer.
                  </p>
                  <CopyText text={d.nextConsultation.videoUrl} />
                </div>
              )}
              {d.nextConsultation.mode === 'PHONE' && <p className="small">Le médecin appellera {patient.firstName} au {patient.whatsappPhone}.</p>}
            </>
          ) : (
            <p className="muted">Pas encore planifiée. Elle est fixée automatiquement dès que le suivi est actif.</p>
          )}
        </section>

        {d.nextVisit && (
          <section className="card">
            <h3>Prochaine visite à domicile</h3>
            <p className="big">{fmtSlotCm(d.nextVisit.scheduledAt)}</p>
            <p className="muted small">Heure du Cameroun · tension, glycémie et vérification du traitement</p>
          </section>
        )}

        <section className="card">
          <h3>Derniers relevés</h3>
          {d.latestReadings.length === 0 && <p className="muted">Aucun relevé pour l'instant.</p>}
          <dl className="readings">
            {bp && <ReadingRow label="Tension" value={`${bp.systolic}/${bp.diastolic} mmHg`} r={bp} />}
            {glucose && <ReadingRow label="Glycémie" value={`${fr(glucose.value)} g/L`} r={glucose} />}
            {weight && <ReadingRow label="Poids" value={`${fr(weight.value)} kg`} r={weight} />}
          </dl>
        </section>

        <section className="card">
          <h3>Traitement en cours</h3>
          {!d.treatment && <p className="muted">Aucun traitement renseigné.</p>}
          {d.treatment?.source === 'PRESCRIPTION' && (
            <>
              <ul className="plain">
                {d.treatment.items.map((it, i) => (
                  <li key={i}>
                    <strong>{it.name}</strong>
                    {it.dosage && <span className="muted"> · {it.dosage}</span>}
                  </li>
                ))}
              </ul>
              <p className="muted small">Ordonnance du {fmtDate(d.treatment.since)}</p>
            </>
          )}
          {d.treatment?.source === 'DECLARED' && (
            <>
              <p>{d.treatment.text}</p>
              <p className="muted small">Déclaré à l'inscription, à confirmer par le médecin</p>
            </>
          )}
        </section>
      </div>

      {(tracksBp || tracksGlucose) && (
        <section className="card">
          <div className="section-head">
            <h3>Évolution</h3>
            <div className="segmented" role="group" aria-label="Période">
              {PERIODS.map((p) => (
                <button key={p.days} type="button" className={days === p.days ? 'on' : ''} onClick={() => setDays(p.days)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {tracksBp && <BloodPressureChart patientId={patient.id} days={days} />}
          {tracksGlucose && <GlucoseChart patientId={patient.id} days={days} />}
        </section>
      )}

      <section className="card">
        <h3>Livraisons récentes</h3>
        {d.deliveries.length === 0 ? (
          <p className="muted">Aucune livraison pour l'instant.</p>
        ) : (
          <ul className="plain">
            {d.deliveries.map((dl) => (
              <li key={dl.id}>
                {DELIVERY_STATUS[dl.status]}
                <span className="muted"> · {fmtDate(dl.deliveredAt ?? dl.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-link">
      <code>{text}</code>
      <button type="button" className="btn btn-small" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
        {copied ? 'Copié' : 'Copier'}
      </button>
    </span>
  );
}

const fr = (n: number | null) => (n === null ? '—' : String(n).replace('.', ','));

function ReadingRow({ label, value, r }: { label: string; value: string; r: Reading }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong> <span className="muted small">le {fmtShort(r.measuredAt)}</span>
      </dd>
    </div>
  );
}

function BloodPressureChart({ patientId, days }: { patientId: string; days: number }) {
  const { data } = useApi<Reading[]>(`/patients/${patientId}/readings?type=BLOOD_PRESSURE&days=${days}`);
  if (!data) return null;
  return (
    <div className="chart-block">
      <h4>Tension</h4>
      <LineChart
        unit="mmHg"
        series={[
          { name: 'Systolique', color: '#0E5A43', points: data.map((r) => ({ date: r.measuredAt, value: r.systolic ?? 0 })) },
          { name: 'Diastolique', color: '#C2693E', points: data.map((r) => ({ date: r.measuredAt, value: r.diastolic ?? 0 })) },
        ]}
      />
    </div>
  );
}

function GlucoseChart({ patientId, days }: { patientId: string; days: number }) {
  const { data } = useApi<Reading[]>(`/patients/${patientId}/readings?type=GLUCOSE&days=${days}`);
  if (!data) return null;
  return (
    <div className="chart-block">
      <h4>Glycémie</h4>
      <LineChart
        unit="g/L"
        series={[{ name: 'Glycémie', color: '#0E5A43', points: data.map((r) => ({ date: r.measuredAt, value: r.value ?? 0 })) }]}
      />
    </div>
  );
}
