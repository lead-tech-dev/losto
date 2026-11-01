import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import Layout from '../../components/Layout';
import PatientForm, { EMPTY_PATIENT, toPayload } from '../../components/PatientForm';
import PlanPicker from '../../components/PlanPicker';
import { PatientDetail } from '../../types';

export default function NewParent() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState('ESSENTIEL');

  return (
    <Layout>
      <p className="small">
        <Link to="/">← Mes parents</Link>
      </p>
      <h1>Inscrire un parent</h1>
      <PatientForm
        initial={EMPTY_PATIENT}
        submitLabel="Inscrire mon parent"
        extra={
          <section className="card">
            <h2>La formule</h2>
            <PlanPicker value={plan} onChange={setPlan} />
            <p className="muted small">
              Sans engagement. Inscription 30 € une seule fois (tensiomètre ou glucomètre remis à votre parent et bilan
              de départ). Le paiement se fera à l'étape suivante ; aucun montant n'est prélevé maintenant.
            </p>
          </section>
        }
        onSubmit={async (values) => {
          const p = await api<PatientDetail>('/patients', {
            method: 'POST',
            body: JSON.stringify({ ...toPayload(values), plan }),
          });
          navigate(`/parents/${p.id}`, { state: { created: true } });
        }}
      />
    </Layout>
  );
}
