import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

export const ROLE_LABELS: Record<string, string> = {
  FAMILY: 'Famille',
  DOCTOR: 'Médecin',
  NURSE: 'Infirmier(e)',
  PHARMACY: 'Pharmacie',
  COURIER: 'Livreur',
  ADMIN: 'Admin',
};

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);

  // Pastille "messages non lus" pour les familles
  useEffect(() => {
    if (user?.role !== 'FAMILY') return;
    api<{ unread: number }>('/messages/unread')
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, [user]);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Proche Santé
        </Link>
        {user && (
          <nav className="topnav" aria-label="Navigation principale">
            {user.role === 'FAMILY' && (
              <>
                <NavLink to="/" end>
                  Mes parents
                </NavLink>
                <NavLink to="/messages">
                  Messages {unread > 0 && <span className="badge badge-alert">{unread}</span>}
                </NavLink>
              </>
            )}
            {user.role === 'ADMIN' && (
              <>
                <NavLink to="/admin/comptes">Comptes</NavLink>
                <NavLink to="/admin/messages">Messages</NavLink>
              </>
            )}
            <NavLink to="/profil">
              {user.firstName} {user.lastName}
            </NavLink>
            <span className="badge">{ROLE_LABELS[user.role]}</span>
            <button type="button" className="btn btn-ghost btn-small" onClick={logout}>
              Se déconnecter
            </button>
          </nav>
        )}
      </header>
      <main className="container">{children}</main>
    </div>
  );
}
