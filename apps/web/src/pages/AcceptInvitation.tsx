import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Layout from '../components/Layout';

interface Preview {
  email: string;
  patientFirstName: string;
  invitedBy: string;
}

export default function AcceptInvitation() {
  const { user, loading, logout } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !token) return;
    api<Preview>(`/invitations/${token}`).then(setPreview).catch((e: Error) => setError(e.message));
  }, [user, token]);

  if (loading) return null;
  // Pas connecté : on passe par la connexion (ou l'inscription), puis on revient ici
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;

  async function accept() {
    try {
      const r = await api<{ patientId: string }>(`/invitations/${token}/accept`, { method: 'POST' });
      navigate(`/parents/${r.patientId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const wrongAccount = preview && preview.email !== user.email;

  return (
    <Layout>
      <section className="card narrow-card">
        <h1>Invitation</h1>
        {error && <p className="error">{error}</p>}
        {preview && (
          <>
            <p>
              <strong>{preview.invitedBy}</strong> vous invite à suivre la santé de <strong>{preview.patientFirstName}</strong>{' '}
              : consultations, relevés et comptes rendus, en lecture seule.
            </p>
            {wrongAccount ? (
              <>
                <p className="tone-warn">
                  Cette invitation est adressée à {preview.email}, mais vous êtes connecté(e) avec {user.email}.
                </p>
                <button type="button" className="btn btn-ghost" onClick={logout}>
                  Changer de compte
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={accept}>
                Accepter l'invitation
              </button>
            )}
          </>
        )}
        <p className="small">
          <Link to="/">Retour à l'accueil</Link>
        </p>
      </section>
    </Layout>
  );
}
