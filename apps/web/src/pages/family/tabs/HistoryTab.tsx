import { CONSULTATION_STATUS, fmtDate, fmtMonth, fmtSlotCm, MODE_LABELS, URGENCY_LABELS } from '../../../labels';
import { Consultation, FamilyLab, Report } from '../../../types';
import { useApi } from '../../../useApi';

export default function HistoryTab({ patientId }: { patientId: string }) {
  const consultations = useApi<Consultation[]>(`/patients/${patientId}/consultations`);
  const reports = useApi<Report[]>(`/patients/${patientId}/reports`);
  const labs = useApi<FamilyLab[]>(`/patients/${patientId}/labs`);

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
        <h3>Analyses</h3>
        {labs.data?.length === 0 && <p className="muted">Aucune analyse demandée pour l'instant.</p>}
        <ul className="timeline">
          {labs.data?.map((l) => (
            <li key={l.id}>
              <div className="timeline-head">
                <strong>{l.tests.join(', ')}</strong>
                <span className="muted small">demandées le {fmtDate(l.createdAt)}{l.note ? ` · ${l.note}` : ''}</span>
              </div>
              {l.status === 'REQUESTED' && (
                <p className="small">
                  {l.appointmentAt
                    ? `Prise de sang le ${fmtSlotCm(l.appointmentAt)} (heure du Cameroun), ${l.appointmentMode === 'HOME_SAMPLING' ? 'à domicile' : 'au laboratoire'}.`
                    : 'Le laboratoire va appeler pour fixer la prise de sang.'}
                </p>
              )}
              {l.status === 'SAMPLED' && <p className="small">Prélèvement fait, résultats en cours.</p>}
              {l.awaitingDoctorReview && <p className="small">Résultats reçus : ils s'afficheront ici dès que le médecin les aura lus.</p>}
              {l.results && (
                <>
                  <p className="pre small">{l.results}</p>
                  {l.doctorComment && <p className="notice notice-ok small">Commentaire du médecin : {l.doctorComment}</p>}
                </>
              )}
            </li>
          ))}
        </ul>
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
              {c.referrals?.map((r, i) => (
                <p key={i} className={`notice ${r.urgency === 'ROUTINE' ? 'notice-ok' : 'notice-warn'} small`}>
                  <strong>Orientation : {r.destination}</strong> · {URGENCY_LABELS[r.urgency]}
                  <br />
                  {r.reason}
                </p>
              ))}
              {c.labRequests?.map((l, i) => (
                <p key={i} className="small">Analyses demandées : {l.tests.join(', ')} (détail ci-dessus)</p>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
