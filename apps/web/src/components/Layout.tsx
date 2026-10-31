import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Proche Santé
        </Link>
        {user && (
          <nav className="topnav">
            {user.role === 'ADMIN' && <Link to="/admin/comptes">Comptes</Link>}
            <span className="badge">{ROLE_LABELS[user.role]}</span>
            <span className="muted">
              {user.firstName} {user.lastName}
            </span>
            <button type="button" className="btn btn-ghost" onClick={logout}>
              Se déconnecter
            </button>
          </nav>
        )}
      </header>
      <main className="container">{children}</main>
    </div>
  );
}
