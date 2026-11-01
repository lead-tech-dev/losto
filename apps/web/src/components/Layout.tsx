import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

export const ROLE_LABELS: Record<string, string> = {
  FAMILY: 'Famille',
  DOCTOR: 'Médecin',
  NURSE: 'Infirmier(e)',
  PHARMACY: 'Pharmacie',
  LAB: 'Laboratoire',
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
                <NavLink to="/paiements">Paiements</NavLink>
                <NavLink to="/messages">
                  Messages {unread > 0 && <span className="badge badge-alert">{unread}</span>}
                </NavLink>
              </>
            )}
            {user.role === 'DOCTOR' && (
              <>
                <NavLink to="/" end>Agenda</NavLink>
                <NavLink to="/medecin/patients">Patients</NavLink>
                <NavLink to="/disponibilites">Disponibilités</NavLink>
                <NavLink to="/releves">Mes relevés</NavLink>
              </>
            )}
            {user.role === 'NURSE' && (
              <>
                <NavLink to="/" end>Visites</NavLink>
                <NavLink to="/disponibilites">Disponibilités</NavLink>
                <NavLink to="/releves">Mes relevés</NavLink>
              </>
            )}
            {(user.role === 'PHARMACY' || user.role === 'LAB' || user.role === 'COURIER') && (
              <>
                <NavLink to="/" end>{user.role === 'COURIER' ? 'Livraisons' : user.role === 'LAB' ? 'Analyses' : 'Ordonnances'}</NavLink>
                <NavLink to="/releves">Mes relevés</NavLink>
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
      {user?.role === 'ADMIN' && (
        // Back-office : sous-menu qui défile horizontalement sur téléphone
        <nav className="subnav" aria-label="Back-office">
          <div className="container subnav-inner">
            <NavLink to="/" end>Tableau de bord</NavLink>
            <NavLink to="/admin/parents">Parents</NavLink>
            <NavLink to="/admin/paiements">Paiements</NavLink>
            <NavLink to="/admin/partenaires">Partenaires</NavLink>
            <NavLink to="/admin/indicateurs">Indicateurs</NavLink>
            <NavLink to="/admin/whatsapp">WhatsApp</NavLink>
            <NavLink to="/admin/comptes-rendus">Comptes rendus</NavLink>
            <NavLink to="/admin/messages">Messages</NavLink>
            <NavLink to="/admin/comptes">Comptes</NavLink>
            <NavLink to="/admin/zones">Zones</NavLink>
            <NavLink to="/admin/journal">Journal</NavLink>
          </div>
        </nav>
      )}
      <main className="container">{children}</main>
    </div>
  );
}
