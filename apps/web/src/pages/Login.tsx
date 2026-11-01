import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; notice?: string } | null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate(state?.from ?? '/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Connexion</h1>
        {state?.notice && <p className="success">{state.notice}</p>}
        <label>
          Adresse e-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        <p className="muted small">
          <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
        </p>
        <p className="muted small">
          Pas encore de compte ?{' '}
          <Link to="/inscription" state={state?.from ? { from: state.from } : undefined}>
            Inscrire un parent
          </Link>
        </p>
      </form>
    </div>
  );
}
