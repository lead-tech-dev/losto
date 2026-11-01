import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';

interface Preview {
  patientFirstName: string;
  familyName: string;
  given: boolean;
}

// Page ouverte par le parent depuis WhatsApp, sur son téléphone, sans compte : texte simple et gros bouton.
export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Preview>(`/consent/${token}`).then(setP).catch((e: Error) => setError(e.message));
  }, [token]);

  async function accept() {
    try {
      await api(`/consent/${token}`, { method: 'POST' });
      setP((prev) => (prev ? { ...prev, given: true } : prev));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="auth-page">
      <section className="card auth-card consent">
        <p className="brand-lg">Proche Santé</p>
        {error && <p className="error">{error}</p>}
        {p && !p.given && (
          <>
            <h1>Bonjour {p.patientFirstName}</h1>
            <p>
              <strong>{p.familyName}</strong> vous a inscrit(e) à Proche Santé pour être suivi(e) chaque mois par un
              médecin, recevoir vos médicaments à la maison et des rappels sur WhatsApp.
            </p>
            <p>En acceptant :</p>
            <ul>
              <li>un médecin partenaire vous appellera pour un premier bilan ;</li>
              <li>
                {p.familyName} recevra les comptes rendus de vos consultations et vos relevés de tension ou de glycémie
                ;
              </li>
              <li>vous pourrez arrêter à tout moment en nous écrivant sur WhatsApp.</li>
            </ul>
            <button type="button" className="btn btn-big" onClick={accept}>
              J'accepte
            </button>
            <p className="muted small">Si vous n'êtes pas d'accord, ne faites rien : aucun suivi ne commencera.</p>
          </>
        )}
        {p?.given && (
          <>
            <h1>Merci {p.patientFirstName}</h1>
            <p>Votre accord est enregistré. Un médecin vous appellera bientôt pour faire le point.</p>
          </>
        )}
      </section>
    </div>
  );
}
