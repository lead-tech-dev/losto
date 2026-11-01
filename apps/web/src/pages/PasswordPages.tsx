import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setDone(r.message);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Mot de passe oublié</h1>
        {done ? (
          <p className="success">{done}</p>
        ) : (
          <>
            <p className="muted small">Indiquez votre adresse : nous vous envoyons un lien pour choisir un nouveau mot de passe.</p>
            <label>
              Adresse e-mail
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn">
              Envoyer le lien
            </button>
          </>
        )}
        <p className="muted small">
          <Link to="/connexion">Retour à la connexion</Link>
        </p>
      </form>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Le mot de passe doit faire au moins 8 caractères');
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      navigate('/connexion', { state: { notice: 'Mot de passe modifié. Vous pouvez vous connecter.' } });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Nouveau mot de passe</h1>
        {!token ? (
          <p className="error">Lien incomplet. Ouvrez le lien reçu par e-mail.</p>
        ) : (
          <>
            <label>
              Nouveau mot de passe (8 caractères minimum)
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn">
              Enregistrer
            </button>
          </>
        )}
        <p className="muted small">
          <Link to="/mot-de-passe-oublie">Demander un nouveau lien</Link>
        </p>
      </form>
    </div>
  );
}
