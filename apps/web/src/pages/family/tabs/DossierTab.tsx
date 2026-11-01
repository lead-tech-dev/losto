import { useState } from 'react';
import { api } from '../../../api';
import PatientForm, { PatientFormValues, toPayload } from '../../../components/PatientForm';
import PlanPicker from '../../../components/PlanPicker';
import { CITY_LABELS, CONDITION_LABELS } from '../../../labels';
import { PatientDetail } from '../../../types';

interface Props {
  patient: PatientDetail;
  onSaved: (p: PatientDetail) => void;
  onPlanChanged: () => void;
}

const toForm = (p: PatientDetail): PatientFormValues => ({
  firstName: p.firstName,
  lastName: p.lastName,
  birthYear: p.birthYear ? String(p.birthYear) : '',
  whatsappPhone: p.whatsappPhone,
  hasSmartphone: p.hasSmartphone,
  city: p.city,
  district: p.district,
  addressDetails: p.addressDetails ?? '',
  conditions: p.conditions,
  medicalHistory: p.medicalHistory ?? '',
  currentTreatments: p.currentTreatments ?? '',
  notes: p.notes ?? '',
});

export default function DossierTab({ patient, onSaved, onPlanChanged }: Props) {
  const [saved, setSaved] = useState(false);

  // Un proche invité voit le dossier en lecture seule
  if (patient.role === 'MEMBER') return <ReadOnlyDossier p={patient} />;

  return (
    <div className="stack">
      {patient.subscription?.status === 'PENDING' && (
        <PlanSection patient={patient} onChanged={onPlanChanged} />
      )}
      {saved && <div className="notice notice-ok">Dossier enregistré.</div>}
      <PatientForm
        key={patient.id}
        initial={toForm(patient)}
        submitLabel="Enregistrer les modifications"
        onSubmit={async (values) => {
          const updated = await api<PatientDetail>(`/patients/${patient.id}`, {
            method: 'PATCH',
            body: JSON.stringify(toPayload(values)),
          });
          onSaved(updated);
          setSaved(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}

function PlanSection({ patient, onChanged }: { patient: PatientDetail; onChanged: () => void }) {
  const [error, setError] = useState('');
  return (
    <section className="card">
      <h3>Formule</h3>
      <PlanPicker
        value={patient.subscription!.plan}
        onChange={async (plan) => {
          setError('');
          try {
            await api(`/patients/${patient.id}/plan`, { method: 'PATCH', body: JSON.stringify({ plan }) });
            onChanged();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      <p className="muted small">Vous pouvez changer de formule librement tant que le premier paiement n'est pas fait.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ReadOnlyDossier({ p }: { p: PatientDetail }) {
  const rows: [string, string | null][] = [
    ['Année de naissance', p.birthYear ? String(p.birthYear) : null],
    ['WhatsApp', p.whatsappPhone],
    ['Smartphone', p.hasSmartphone ? 'Oui' : 'Non, appels seulement'],
    ['Adresse', `${p.district}, ${CITY_LABELS[p.city]}${p.addressDetails ? ` · ${p.addressDetails}` : ''}`],
    ['Maladies suivies', p.conditions.map((c) => CONDITION_LABELS[c]).join(', ')],
    ['Traitements déclarés', p.currentTreatments],
    ['Antécédents', p.medicalHistory],
    ['Autres informations', p.notes],
  ];
  return (
    <section className="card">
      <dl className="facts">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <p className="muted small">Seul le titulaire du compte peut modifier ce dossier.</p>
    </section>
  );
}
