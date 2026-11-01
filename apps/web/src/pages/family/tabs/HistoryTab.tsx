import { CONSULTATION_STATUS, fmtDate, fmtMonth, MODE_LABELS } from '../../../labels';
import { Consultation, Report } from '../../../types';
import { useApi } from '../../../useApi';

export default function HistoryTab({ patientId }: { patientId: string }) {
  const consultations = useApi<Consultation[]>(`/patients/${patientId}/consultations`);
  const reports = useApi<Report[]>(`/patients/${patientId}/reports`);

  return (
    <div className="stack">
      <section className="card">
        <h3>Comptes rendus mensuels</h3>
        {reports.data?.length === 0 && <p className="muted">Le premier compte rendu arrivera à la fin du premier mois de suivi.</p>}
        {reports.data?.map((r) => (
          <details key={r.id} className="report">
            <summary>Compte rendu · {fmtMonth(r.month)}</summary>
            <p className="pre">{r.content}</p>
          </details>
        ))}
      </section>

      <section className="card">
        <h3>Consultations</h3>
        {consultations.data?.length === 0 && <p className="muted">Aucune consultation pour l'instant.</p>}
        <ul className="timeline">
          {consultations.data?.map((c) => (
            <li key={c.id}>
              <div className="timeline-head">
                <strong>{fmtDate(c.scheduledAt)}</strong>
                <span className="muted small">
                  {c.doctorName} · {MODE_LABELS[c.mode]} · {CONSULTATION_STATUS[c.status]}
                </span>
              </div>
              {c.summary && <p className="pre">{c.summary}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
