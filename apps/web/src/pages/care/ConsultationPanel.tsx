import { FormEvent, useState } from 'react';
import { api } from '../../api';
import { fmtSlotCm, KIND_LABELS, URGENCY_LABELS } from '../../labels';
import { ConsultationView, PatientFile } from '../../types';
import { useApi } from '../../useApi';

const COMMON_LABS = ['Glycémie à jeun', 'HbA1c', 'Créatinine', 'Bilan lipidique', 'Ionogramme', 'NFS', 'TSH'];

interface Line {
  name: string;
  dosage: string;
  quantity: string;
  times: string[];
  timesTouched?: boolean; // le médecin a choisi lui-même : on ne devine plus
}

// Heures des rappels WhatsApp (heure du Cameroun)
const SLOTS = [
  { time: '08:00', label: 'Matin' },
  { time: '13:00', label: 'Midi' },
  { time: '20:00', label: 'Soir' },
  { time: '21:00', label: 'Coucher' },
];

// Même règle que le serveur : « 1 matin et soir » → matin + soir
function guessTimes(dosage: string): string[] {
  const t = dosage.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const out: string[] = [];
  if (/\bmatin\b/.test(t)) out.push('08:00');
  if (/\bmidi\b|\bdejeuner\b/.test(t)) out.push('13:00');
  if (/\bsoir\b|\bdiner\b/.test(t)) out.push('20:00');
  if (/\bcoucher\b|\bnuit\b/.test(t)) out.push('21:00');
  if (out.length) return out;
  const n = Number(t.match(/(\d)\s*(?:fois|x|prises?)/)?.[1] ?? 0) || (/par jour/.test(t) ? 1 : 0);
  return n === 1 ? ['08:00'] : n === 2 ? ['08:00', '20:00'] : n >= 3 ? ['08:00', '13:00', '20:00'] : [];
}

// Poste de consultation : lancer l'appel, écrire le compte rendu, prescrire, demander des analyses, orienter.
export default function ConsultationPanel({
  c,
  file,
  onDone,
}: {
  c: ConsultationView;
  file: PatientFile;
  onDone: (message: string) => void;
}) {
  const p = file.patient;
  const [summary, setSummary] = useState('');
  const [bp, setBp] = useState({ sys: '', dia: '' });
  const [glucose, setGlucose] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [labs, setLabs] = useState<string[]>([]);
  const [otherLab, setOtherLab] = useState('');
  const [referral, setReferral] = useState<{ destination: string; urgency: string; reason: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'form' | 'missed' | 'reschedule'>('form');

  const started = new Date(c.scheduledAt).getTime() <= Date.now() + 60 * 60 * 1000;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (summary.trim().length < 10) return setError('Écrivez le compte rendu (il sera lu par la famille)');
    const readings = [];
    if (bp.sys || bp.dia) readings.push({ type: 'BLOOD_PRESSURE', systolic: Number(bp.sys), diastolic: Number(bp.dia) });
    if (glucose) readings.push({ type: 'GLUCOSE', value: Number(glucose.replace(',', '.')) });
    const prescription = lines
      .filter((l) => l.name.trim())
      .map((l) => ({ name: l.name.trim(), dosage: l.dosage.trim() || undefined, quantity: l.quantity ? Number(l.quantity) : undefined, times: l.times.length ? l.times : undefined }));
    const tests = [...labs, ...otherLab.split(',').map((t) => t.trim()).filter(Boolean)];
    if (referral && (referral.destination.trim().length < 2 || referral.reason.trim().length < 2)) {
      return setError('Complétez la destination et le motif de l’orientation');
    }
    setBusy(true);
    try {
      await api(`/doctor/consultations/${c.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          summary,
          readings: readings.length ? readings : undefined,
          prescription: prescription.length ? prescription : undefined,
          labs: tests.length ? { tests } : undefined,
          referral: referral ?? undefined,
        }),
      });
      onDone('Consultation clôturée. La famille a reçu le compte rendu.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card consult-panel" aria-labelledby="consult-title">
      <div className="section-head">
        <h2 id="consult-title">
          {KIND_LABELS[c.kind]} · {fmtSlotCm(c.scheduledAt)}
        </h2>
        <div className="row">
          {c.mode === 'VIDEO' && c.videoUrl ? (
            <a className="btn" href={c.videoUrl} target="_blank" rel="noreferrer">
              Ouvrir la visio
            </a>
          ) : null}
          <a className="btn btn-ghost" href={`tel:${p.whatsappPhone}`}>
            Appeler {p.whatsappPhone}
          </a>
        </div>
      </div>
      {c.mode === 'VIDEO' && (
        <p className="muted small">Le même lien a été transmis à la famille pour le parent. Si la visio ne passe pas, appelez.</p>
      )}

      {mode === 'missed' && <MissedForm c={c} onDone={onDone} onCancel={() => setMode('form')} />}
      {mode === 'reschedule' && <RescheduleForm c={c} onDone={onDone} onCancel={() => setMode('form')} />}

      {mode === 'form' && (
        <form className="stack-sm" onSubmit={submit}>
          {!started && <p className="notice notice-warn">Cette consultation n'a pas encore commencé : vous pourrez la clôturer à partir de l'heure prévue.</p>}

          <label>
            Compte rendu (lu par la famille, en termes simples)
            <textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="État général, résultats, décisions, conseils…" />
          </label>

          <fieldset className="row">
            <legend>Mesures pendant la consultation (facultatif)</legend>
            <label className="narrow">
              Systolique (mmHg)
              <input inputMode="numeric" value={bp.sys} onChange={(e) => setBp({ ...bp, sys: e.target.value })} />
            </label>
            <label className="narrow">
              Diastolique (mmHg)
              <input inputMode="numeric" value={bp.dia} onChange={(e) => setBp({ ...bp, dia: e.target.value })} />
            </label>
            <label className="narrow">
              Glycémie (g/L)
              <input inputMode="decimal" value={glucose} onChange={(e) => setGlucose(e.target.value)} placeholder="1,10" />
            </label>
          </fieldset>

          <fieldset className="stack-sm">
            <legend>Ordonnance (envoyée à la pharmacie partenaire)</legend>
            {lines.map((l, i) => (
              <div key={i} className="row align-end presc-line">
                <label>
                  Médicament et dosage
                  <input value={l.name} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Metformine 500 mg" />
                </label>
                <label>
                  Posologie
                  <input
                    value={l.dosage}
                    onChange={(e) =>
                      setLines(lines.map((x, j) => (j === i ? { ...x, dosage: e.target.value, times: x.timesTouched ? x.times : guessTimes(e.target.value) } : x)))
                    }
                    placeholder="1 matin et soir"
                  />
                </label>
                <label className="narrow">
                  Quantité
                  <input inputMode="numeric" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                </label>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  Retirer
                </button>
                <div className="slot-chips" role="group" aria-label={`Rappels WhatsApp pour ${l.name || 'ce médicament'}`}>
                  <span className="muted small">Rappel WhatsApp :</span>
                  {SLOTS.map((s) => {
                    const on = l.times.includes(s.time);
                    return (
                      <button
                        key={s.time}
                        type="button"
                        aria-pressed={on}
                        className={`chip ${on ? 'on' : ''}`}
                        onClick={() =>
                          setLines(
                            lines.map((x, j) =>
                              j === i ? { ...x, timesTouched: true, times: on ? x.times.filter((t) => t !== s.time) : [...x.times, s.time].sort() } : x,
                            ),
                          )
                        }
                      >
                        {s.label} <span className="muted">{s.time.replace(':00', ' h')}</span>
                      </button>
                    );
                  })}
                  {!l.times.length && <span className="muted small">aucun</span>}
                </div>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setLines([...lines, { name: '', dosage: '', quantity: '', times: [] }])}>
                + Médicament
              </button>
              {file.prescriptions[0] && lines.length === 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() =>
                    setLines(file.prescriptions[0].items.map((it) => ({ name: it.name, dosage: it.dosage ?? '', quantity: it.quantity ? String(it.quantity) : '', times: it.times ?? guessTimes(it.dosage ?? ''), timesTouched: Boolean(it.times) })))
                  }
                >
                  Renouveler la dernière ordonnance
                </button>
              )}
            </div>
          </fieldset>

          <fieldset className="checks">
            <legend>Analyses à demander</legend>
            {COMMON_LABS.map((t) => (
              <label key={t} className={`check ${labs.includes(t) ? 'on' : ''}`}>
                <input type="checkbox" checked={labs.includes(t)} onChange={() => setLabs(labs.includes(t) ? labs.filter((x) => x !== t) : [...labs, t])} />
                {t}
              </label>
            ))}
            <label className="grow">
              Autres (séparées par des virgules)
              <input value={otherLab} onChange={(e) => setOtherLab(e.target.value)} />
            </label>
          </fieldset>

          <fieldset className="stack-sm">
            <legend>Orientation vers un spécialiste ou l'hôpital</legend>
            {!referral ? (
              <div>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setReferral({ destination: '', urgency: 'ROUTINE', reason: '' })}>
                  + Orienter le patient
                </button>
              </div>
            ) : (
              <>
                <div className="row">
                  <label>
                    Vers
                    <input value={referral.destination} onChange={(e) => setReferral({ ...referral, destination: e.target.value })} placeholder="Cardiologue, urgences de l'hôpital Laquintinie…" />
                  </label>
                  <label className="narrow-wide">
                    Délai
                    <select value={referral.urgency} onChange={(e) => setReferral({ ...referral, urgency: e.target.value })}>
                      {Object.entries(URGENCY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Motif (transmis à la famille)
                  <input value={referral.reason} onChange={(e) => setReferral({ ...referral, reason: e.target.value })} />
                </label>
                <div>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setReferral(null)}>
                    Annuler l'orientation
                  </button>
                </div>
              </>
            )}
          </fieldset>

          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button type="submit" className="btn" disabled={busy || !started}>
              {busy ? 'Envoi…' : 'Terminer la consultation'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('missed')}>
              Patient injoignable
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('reschedule')}>
              Reprogrammer
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function MissedForm({ c, onDone, onCancel }: { c: ConsultationView; onDone: (m: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('Ne répond pas');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ rescheduledTo: string | null }>(`/doctor/consultations/${c.id}/missed`, { method: 'POST', body: JSON.stringify({ reason }) });
      onDone(r.rescheduledTo ? `Consultation manquée. Replacée le ${fmtSlotCm(r.rescheduledTo)} ; la famille est prévenue.` : 'Consultation manquée. Aucun créneau libre : ajoutez des disponibilités.');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form className="stack-sm" onSubmit={submit}>
      <label>
        Que s'est-il passé ?
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="btn">Marquer manquée et replacer</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Retour</button>
      </div>
    </form>
  );
}

function RescheduleForm({ c, onDone, onCancel }: { c: ConsultationView; onDone: (m: string) => void; onCancel: () => void }) {
  const { data: slots } = useApi<string[]>('/doctor/slots');
  const [error, setError] = useState('');
  async function pick(at: string) {
    try {
      await api(`/doctor/consultations/${c.id}/reschedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: at }) });
      onDone(`Consultation déplacée au ${fmtSlotCm(at)} ; la famille est prévenue.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="stack-sm">
      <p className="muted small">Vos prochains créneaux libres :</p>
      <div className="slot-grid">
        {slots?.map((s) => (
          <button key={s} type="button" className="btn btn-ghost btn-small" onClick={() => pick(s)}>
            {fmtSlotCm(s)}
          </button>
        ))}
        {slots?.length === 0 && <p className="muted">Aucun créneau libre : ajoutez des disponibilités.</p>}
      </div>
      {error && <p className="error">{error}</p>}
      <div>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Retour</button>
      </div>
    </div>
  );
}
