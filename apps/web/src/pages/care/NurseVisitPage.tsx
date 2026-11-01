import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { CONDITION_LABELS, fmtDate, fmtSlotCm } from '../../labels';
import { NurseVisitDetail } from '../../types';
import { useApi } from '../../useApi';

interface AlertResult {
  severity: 'WARNING' | 'URGENT';
  message: string;
}

// Visite à domicile, pensée pour le téléphone : mesures, traitement vérifié, note, puis alertes éventuelles.
export default function NurseVisitPage() {
  const { id } = useParams<{ id: string }>();
  const { data: d, error } = useApi<NurseVisitDetail>(`/nurse/visits/${id}`);
  const [bp, setBp] = useState({ sys: '', dia: '' });
  const [glucose, setGlucose] = useState('');
  const [weight, setWeight] = useState('');
  const [checked, setChecked] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState<AlertResult[] | null>(null);
  const [missed, setMissed] = useState<string | null>(null);

  if (error) return <Layout><p className="error">{error}</p></Layout>;
  if (!d) return <Layout><p className="muted">Chargement…</p></Layout>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    const readings = [];
    if (bp.sys || bp.dia) readings.push({ type: 'BLOOD_PRESSURE', systolic: Number(bp.sys), diastolic: Number(bp.dia) });
    if (glucose) readings.push({ type: 'GLUCOSE', value: Number(glucose.replace(',', '.')) });
    if (weight) readings.push({ type: 'WEIGHT', value: Number(weight.replace(',', '.')) });
    if (readings.length === 0) return setFormError('Saisissez au moins une mesure');
    if (checked === null) return setFormError('Indiquez si le traitement a été vérifié');
    if (note.trim().length < 3) return setFormError('Ajoutez une note de visite');
    try {
      const r = await api<{ alerts: AlertResult[] }>(`/nurse/visits/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ readings, treatmentChecked: checked, note }),
      });
      setDone(r.alerts);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  async function markMissed() {
    try {
      const r = await api<{ rescheduledTo: string | null }>(`/nurse/visits/${id}/missed`, { method: 'POST', body: JSON.stringify({ reason: 'Personne au domicile' }) });
      setMissed(r.rescheduledTo ? `Visite replacée le ${fmtSlotCm(r.rescheduledTo)}.` : 'Aucun créneau libre : ajoutez des disponibilités.');
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  const urgent = done?.some((a) => a.severity === 'URGENT');

  return (
    <Layout>
      <p className="small"><Link to="/">← Mes visites</Link></p>
      <h1>{d.patient.name}</h1>
      <p className="muted small">
        {fmtSlotCm(d.visit.scheduledAt)} · {d.patient.address} ·{' '}
        <a href={`tel:${d.patient.phone}`}>{d.patient.phone}</a>
      </p>

      {done && (
        <section className={`card ${urgent ? 'card-urgent' : done.length ? 'card-alert' : ''}`} role="status">
          {done.length === 0 && <h2>Visite enregistrée. Aucune valeur anormale.</h2>}
          {done.length > 0 && (
            <>
              <h2>{urgent ? 'Valeur dangereuse : agissez maintenant' : 'Valeur à surveiller'}</h2>
              <ul className="plain">{done.map((a, i) => <li key={i}><strong>{a.message}</strong></li>)}</ul>
              {urgent ? (
                <p>
                  Le médecin a été alerté par e-mail. <strong>Appelez-le maintenant.</strong> Si le patient fait un malaise,
                  a du mal à respirer ou ne répond plus normalement, appelez les secours ou conduisez-le aux urgences.
                </p>
              ) : (
                <p>Le médecin verra cette valeur dans ses alertes.</p>
              )}
            </>
          )}
          <div><Link className="btn" to="/">Retour à mes visites</Link></div>
        </section>
      )}

      {missed && <div className="notice notice-ok">{missed} <Link to="/">Retour</Link></div>}

      {!done && !missed && d.visit.status === 'SCHEDULED' && (
        <>
          <section className="card">
            <h2>À savoir</h2>
            <p className="small">{d.patient.conditions.map((c) => CONDITION_LABELS[c]).join(', ')}{d.patient.birthYear ? ` · ${new Date().getFullYear() - d.patient.birthYear} ans` : ''}</p>
            {d.patient.notes && <p className="small">{d.patient.notes}</p>}
            <h3>Traitement à vérifier</h3>
            {!d.treatment && <p className="muted">Aucun traitement connu.</p>}
            {d.treatment && 'items' in d.treatment && (
              <>
                <ul className="plain">{d.treatment.items.map((it, i) => <li key={i}><strong>{it.name}</strong>{it.dosage && <span className="muted"> · {it.dosage}</span>}</li>)}</ul>
                <p className="muted small">Ordonnance du {fmtDate(d.treatment.since)}</p>
              </>
            )}
            {d.treatment && 'declared' in d.treatment && <p>{d.treatment.declared} <span className="muted small">(déclaré par la famille)</span></p>}
            {d.recentReadings.length > 0 && (
              <>
                <h3>Derniers relevés</h3>
                <ul className="plain small">
                  {d.recentReadings.slice(0, 4).map((r, i) => (
                    <li key={i}>
                      {fmtDate(r.measuredAt)} ·{' '}
                      {r.type === 'BLOOD_PRESSURE' ? `Tension ${r.systolic}/${r.diastolic}` : r.type === 'GLUCOSE' ? `Glycémie ${String(r.value).replace('.', ',')} g/L` : `Poids ${r.value} kg`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <form className="card" onSubmit={submit}>
            <h2>Mesures</h2>
            <div className="row">
              <label className="narrow">Systolique<input inputMode="numeric" value={bp.sys} onChange={(e) => setBp({ ...bp, sys: e.target.value })} placeholder="135" /></label>
              <label className="narrow">Diastolique<input inputMode="numeric" value={bp.dia} onChange={(e) => setBp({ ...bp, dia: e.target.value })} placeholder="85" /></label>
            </div>
            <div className="row">
              <label className="narrow">Glycémie (g/L)<input inputMode="decimal" value={glucose} onChange={(e) => setGlucose(e.target.value)} placeholder="1,10" /></label>
              <label className="narrow">Poids (kg)<input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
            </div>
            <fieldset className="inline-choice">
              <legend>Traitement vérifié (boîtes, prises) ?</legend>
              <label className="radio"><input type="radio" checked={checked === true} onChange={() => setChecked(true)} /> Oui, bien pris</label>
              <label className="radio"><input type="radio" checked={checked === false} onChange={() => setChecked(false)} /> Non / problème</label>
            </fieldset>
            <label>
              Note de visite (pour le médecin)
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="État général, observance, besoins…" />
            </label>
            {formError && <p className="error" role="alert">{formError}</p>}
            <div className="row">
              <button type="submit" className="btn btn-big">Enregistrer la visite</button>
              <button type="button" className="btn btn-ghost" onClick={markMissed}>Personne au domicile</button>
            </div>
          </form>
        </>
      )}
    </Layout>
  );
}
