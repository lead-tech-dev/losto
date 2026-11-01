import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { CONDITION_LABELS } from '../labels';

export interface PatientFormValues {
  firstName: string;
  lastName: string;
  birthYear: string;
  whatsappPhone: string;
  hasSmartphone: boolean;
  city: string;
  district: string;
  addressDetails: string;
  conditions: string[];
  medicalHistory: string;
  currentTreatments: string;
  notes: string;
}

export const EMPTY_PATIENT: PatientFormValues = {
  firstName: '',
  lastName: '',
  birthYear: '',
  whatsappPhone: '',
  hasSmartphone: true,
  city: 'DOUALA',
  district: '',
  addressDetails: '',
  conditions: [],
  medicalHistory: '',
  currentTreatments: '',
  notes: '',
};

// Ce qu'on envoie à l'API : nombres convertis, champs vides envoyés vides (l'API les met à null).
export function toPayload(v: PatientFormValues) {
  return {
    firstName: v.firstName,
    lastName: v.lastName,
    ...(v.birthYear ? { birthYear: Number(v.birthYear) } : {}),
    whatsappPhone: v.whatsappPhone,
    hasSmartphone: v.hasSmartphone,
    city: v.city,
    district: v.district,
    addressDetails: v.addressDetails,
    conditions: v.conditions,
    medicalHistory: v.medicalHistory,
    currentTreatments: v.currentTreatments,
    notes: v.notes,
  };
}

interface Props {
  initial: PatientFormValues;
  submitLabel: string;
  onSubmit: (values: PatientFormValues) => Promise<void>;
  extra?: React.ReactNode; // ex. le choix de la formule à l'inscription
}

export default function PatientForm({ initial, submitLabel, onSubmit, extra }: Props) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [covered, setCovered] = useState<boolean | null>(null);

  const set = (key: keyof PatientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV({ ...v, [key]: e.target.value });

  // Vérifie le quartier dès qu'il est saisi (petite pause pour ne pas appeler l'API à chaque lettre)
  useEffect(() => {
    if (v.city === 'OTHER') return setCovered(false);
    if (v.district.trim().length < 2) return setCovered(null);
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ city: v.city, district: v.district });
      api<{ covered: boolean }>(`/coverage?${q}`)
        .then((r) => setCovered(r.covered))
        .catch(() => setCovered(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [v.city, v.district]);

  function toggleCondition(c: string) {
    setV({ ...v, conditions: v.conditions.includes(c) ? v.conditions.filter((x) => x !== c) : [...v.conditions, c] });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (v.conditions.length === 0) return setError('Choisissez au moins une maladie à suivre');
    setBusy(true);
    try {
      await onSubmit(v);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <section className="card">
        <h2>Votre parent</h2>
        <div className="row">
          <label>
            Prénom
            <input required value={v.firstName} onChange={set('firstName')} />
          </label>
          <label>
            Nom
            <input required value={v.lastName} onChange={set('lastName')} />
          </label>
          <label className="narrow">
            Année de naissance
            <input inputMode="numeric" pattern="[0-9]{4}" value={v.birthYear} onChange={set('birthYear')} placeholder="1955" />
          </label>
        </div>
        <div className="row">
          <label>
            Numéro WhatsApp au Cameroun
            <input required type="tel" value={v.whatsappPhone} onChange={set('whatsappPhone')} placeholder="6 77 12 34 56" />
          </label>
          <fieldset className="inline-choice">
            <legend>A-t-il un smartphone ?</legend>
            <label className="radio">
              <input type="radio" checked={v.hasSmartphone} onChange={() => setV({ ...v, hasSmartphone: true })} /> Oui
            </label>
            <label className="radio">
              <input type="radio" checked={!v.hasSmartphone} onChange={() => setV({ ...v, hasSmartphone: false })} /> Non, appels seulement
            </label>
          </fieldset>
        </div>
      </section>

      <section className="card">
        <h2>Où habite-t-il ?</h2>
        <div className="row">
          <label className="narrow">
            Ville
            <select value={v.city} onChange={set('city')}>
              <option value="DOUALA">Douala</option>
              <option value="YAOUNDE">Yaoundé</option>
              <option value="OTHER">Autre ville</option>
            </select>
          </label>
          <label>
            Quartier
            <input required value={v.district} onChange={set('district')} placeholder="Bonapriso, Bastos…" />
          </label>
        </div>
        {covered === true && <p className="small tone-ok">Ce quartier est desservi.</p>}
        {covered === false && (
          <p className="small tone-warn">
            Ce quartier n'est pas encore desservi. Vous pouvez inscrire votre parent : nous vous prévenons dès que le
            service y ouvre.
          </p>
        )}
        <label>
          Repères pour le livreur (facultatif)
          <input value={v.addressDetails} onChange={set('addressDetails')} placeholder="Près de la pharmacie du carrefour, portail bleu" />
        </label>
      </section>

      <section className="card">
        <h2>Sa santé</h2>
        <fieldset className="checks">
          <legend>Maladies à suivre</legend>
          {Object.entries(CONDITION_LABELS).map(([id, label]) => (
            <label key={id} className={`check ${v.conditions.includes(id) ? 'on' : ''}`}>
              <input type="checkbox" checked={v.conditions.includes(id)} onChange={() => toggleCondition(id)} />
              {label}
            </label>
          ))}
        </fieldset>
        <label>
          Traitements en cours (facultatif)
          <textarea rows={2} value={v.currentTreatments} onChange={set('currentTreatments')} placeholder="Nom des médicaments et dosage, si vous les connaissez" />
        </label>
        <label>
          Antécédents (facultatif)
          <textarea rows={2} value={v.medicalHistory} onChange={set('medicalHistory')} placeholder="Opérations, hospitalisations, allergies…" />
        </label>
        <label>
          Autre chose à savoir (facultatif)
          <textarea rows={2} value={v.notes} onChange={set('notes')} placeholder="Parle surtout duala, vit avec sa sœur…" />
        </label>
      </section>

      {extra}

      {error && <p className="error" role="alert">{error}</p>}
      <div>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
