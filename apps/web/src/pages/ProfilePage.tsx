import { FormEvent, useState } from 'react';
import { api, User } from '../api';
import { useAuth } from '../auth';
import Layout from '../components/Layout';

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    phone: user?.phone ?? '',
  });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState<{ profile?: string; pw?: string; error?: string; pwError?: string }>({});

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    try {
      const u = await api<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(profile) });
      setUser(u);
      setMsg({ profile: 'Profil enregistré.' });
    } catch (err) {
      setMsg({ error: (err as Error).message });
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    if (pw.newPassword.length < 8) return setMsg({ pwError: 'Le nouveau mot de passe doit faire au moins 8 caractères' });
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify(pw) });
      setPw({ currentPassword: '', newPassword: '' });
      setMsg({ pw: 'Mot de passe modifié.' });
    } catch (err) {
      setMsg({ pwError: (err as Error).message });
    }
  }

  if (!user) return null;

  return (
    <Layout>
      <h1>Mon profil</h1>
      <form className="card" onSubmit={saveProfile}>
        <h2>Coordonnées</h2>
        <div className="row">
          <label>
            Prénom
            <input required value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} />
          </label>
          <label>
            Nom
            <input required value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} />
          </label>
        </div>
        <div className="row">
          <label>
            Adresse e-mail
            <input value={user.email} disabled />
          </label>
          <label>
            Téléphone / WhatsApp
            <input type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="+33 6 …" />
          </label>
        </div>
        {msg.error && <p className="error">{msg.error}</p>}
        {msg.profile && <p className="success">{msg.profile}</p>}
        <div>
          <button type="submit" className="btn">
            Enregistrer
          </button>
        </div>
      </form>

      <form className="card" onSubmit={savePassword}>
        <h2>Mot de passe</h2>
        <div className="row">
          <label>
            Mot de passe actuel
            <input
              type="password"
              required
              autoComplete="current-password"
              value={pw.currentPassword}
              onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            />
          </label>
          <label>
            Nouveau mot de passe
            <input
              type="password"
              required
              autoComplete="new-password"
              value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            />
          </label>
        </div>
        {msg.pwError && <p className="error">{msg.pwError}</p>}
        {msg.pw && <p className="success">{msg.pw}</p>}
        <div>
          <button type="submit" className="btn">
            Changer le mot de passe
          </button>
        </div>
      </form>
    </Layout>
  );
}
