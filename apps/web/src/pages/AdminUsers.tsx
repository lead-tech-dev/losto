import { FormEvent, useEffect, useState } from 'react';
import { api, Role, User } from '../api';
import Layout, { ROLE_LABELS } from '../components/Layout';

interface AdminUser extends User {
  isActive: boolean;
  partnerProfile: { city: string; organizationName: string | null; licenseNumber: string | null; verifiedAt: string | null } | null;
}

const STAFF_ROLES: Role[] = ['DOCTOR', 'NURSE', 'PHARMACY', 'LAB', 'COURIER', 'ADMIN'];
const EMPTY = { email: '', password: '', role: 'DOCTOR' as Role, firstName: '', lastName: '', phone: '', city: 'DOUALA', organizationName: '', licenseNumber: '' };

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = () => api<AdminUser[]>('/admin/users').then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    const isAdmin = form.role === 'ADMIN';
    // On n'envoie que les champs remplis (l'API refuse les champs vides inutiles)
    const payload: Record<string, string> = {
      email: form.email,
      password: form.password,
      role: form.role,
      firstName: form.firstName,
      lastName: form.lastName,
    };
    if (form.phone) payload.phone = form.phone;
    if (!isAdmin) {
      payload.city = form.city;
      if (form.organizationName) payload.organizationName = form.organizationName;
      if (form.licenseNumber) payload.licenseNumber = form.licenseNumber;
    }
    try {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(payload) });
      setInfo(`Compte ${ROLE_LABELS[form.role]} créé pour ${form.email}`);
      setForm(EMPTY);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleActive(u: AdminUser) {
    try {
      await api(`/admin/users/${u.id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive: !u.isActive }) });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function verify(u: AdminUser) {
    try {
      await api(`/admin/users/${u.id}/verify`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Layout>
      <h1>Comptes</h1>

      <form className="card" onSubmit={onCreate}>
        <h2>Créer un compte partenaire</h2>
        <div className="row">
          <label>
            Rôle
            <select value={form.role} onChange={set('role')}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {form.role !== 'ADMIN' && (
            <label>
              Ville
              <select value={form.city} onChange={set('city')}>
                <option value="DOUALA">Douala</option>
                <option value="YAOUNDE">Yaoundé</option>
                <option value="OTHER">Autre</option>
              </select>
            </label>
          )}
        </div>
        <div className="row">
          <label>
            Prénom
            <input required value={form.firstName} onChange={set('firstName')} />
          </label>
          <label>
            Nom
            <input required value={form.lastName} onChange={set('lastName')} />
          </label>
        </div>
        <div className="row">
          <label>
            E-mail
            <input type="email" required value={form.email} onChange={set('email')} />
          </label>
          <label>
            Téléphone
            <input type="tel" value={form.phone} onChange={set('phone')} />
          </label>
        </div>
        {form.role !== 'ADMIN' && (
          <div className="row">
            <label>
              Cabinet / pharmacie
              <input value={form.organizationName} onChange={set('organizationName')} />
            </label>
            <label>
              N° d’Ordre ou d’agrément
              <input value={form.licenseNumber} onChange={set('licenseNumber')} />
            </label>
          </div>
        )}
        <label>
          Mot de passe provisoire (8 caractères minimum)
          <input type="text" required minLength={8} value={form.password} onChange={set('password')} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        {info && <p className="success">{info}</p>}
        <button type="submit" className="btn">
          Créer le compte
        </button>
      </form>

      <section className="card">
        <h2>Tous les comptes ({users.length})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôle</th>
                <th>E-mail</th>
                <th>Ville</th>
                <th>Vérifié</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.firstName} {u.lastName}
                  </td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>{u.email}</td>
                  <td>{u.partnerProfile?.city ?? '—'}</td>
                  <td>
                    {u.partnerProfile ? (
                      u.partnerProfile.verifiedAt ? (
                        'Oui'
                      ) : (
                        <button type="button" className="btn btn-small" onClick={() => verify(u)}>
                          Vérifier
                        </button>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{u.isActive ? 'Actif' : 'Désactivé'}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => toggleActive(u)}>
                      {u.isActive ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
}
