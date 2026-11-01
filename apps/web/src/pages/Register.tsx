import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  // Après une invitation, on revient sur la page de l'invitation une fois le compte créé
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères');
      return;
    }
    setBusy(true);
    try {
      await register({ ...form, phone: form.phone || undefined, acceptTerms });
      navigate(from ?? '/parents/nouveau', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Créer votre compte famille</h1>
        <p className="muted small">Vous pourrez ensuite inscrire votre parent et choisir sa formule.</p>
        <div className="row">
          <label>
            Prénom
            <input required value={form.firstName} onChange={set('firstName')} autoComplete="given-name" />
          </label>
          <label>
            Nom
            <input required value={form.lastName} onChange={set('lastName')} autoComplete="family-name" />
          </label>
        </div>
        <label>
          Adresse e-mail
          <input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </label>
        <label>
          Numéro WhatsApp (facultatif)
          <input type="tel" value={form.phone} onChange={set('phone')} placeholder="+33 6 …" autoComplete="tel" />
        </label>
        <label>
          Mot de passe (8 caractères minimum)
          <input type="password" required value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
        <label className={`check ${acceptTerms ? 'on' : ''}`}>
          <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required />
          <span>
            J’accepte les <Link to="/cgu" target="_blank">conditions générales</Link> et la{' '}
            <Link to="/confidentialite" target="_blank">politique de confidentialité</Link>
          </span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy || !acceptTerms}>
          {busy ? 'Création…' : 'Créer mon compte'}
        </button>
        <p className="muted small">
          Déjà inscrit(e) ?{' '}
          <Link to="/connexion" state={from ? { from } : undefined}>
            Se connecter
          </Link>
        </p>
      </form>
    </div>
  );
}
