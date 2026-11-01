import { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Role } from './api';
import { useAuth } from './auth';
import AcceptInvitation from './pages/AcceptInvitation';
import AdminMessages from './pages/AdminMessages';
import AdminUsers from './pages/AdminUsers';
import ConsentPage from './pages/ConsentPage';
import Dashboard from './pages/Dashboard';
import MessagesPage from './pages/family/MessagesPage';
import NewParent from './pages/family/NewParent';
import ParentPage from './pages/family/ParentPage';
import PaymentPage from './pages/family/PaymentPage';
import PaymentsPage from './pages/family/PaymentsPage';
import Login from './pages/Login';
import { ForgotPassword, ResetPassword } from './pages/PasswordPages';
import ProfilePage from './pages/ProfilePage';
import Register from './pages/Register';

// Bloque les pages privées : redirige vers la connexion (puis revient ici) si personne n'est connecté.
function Protected({ children, role }: { children: ReactNode; role?: Role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="center muted">Chargement…</p>;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Pages publiques */}
      <Route path="/connexion" element={<Login />} />
      <Route path="/inscription" element={<Register />} />
      <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
      <Route path="/reinitialiser" element={<ResetPassword />} />
      <Route path="/consentement/:token" element={<ConsentPage />} />
      {/* L'invitation gère elle-même le passage par la connexion */}
      <Route path="/invitation" element={<AcceptInvitation />} />

      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/profil" element={<Protected><ProfilePage /></Protected>} />

      {/* Espace famille */}
      <Route path="/parents/nouveau" element={<Protected role="FAMILY"><NewParent /></Protected>} />
      <Route path="/parents/:id" element={<Protected role="FAMILY"><ParentPage /></Protected>} />
      <Route path="/parents/:id/paiement" element={<Protected role="FAMILY"><PaymentPage /></Protected>} />
      <Route path="/paiements" element={<Protected role="FAMILY"><PaymentsPage /></Protected>} />
      <Route path="/messages" element={<Protected role="FAMILY"><MessagesPage /></Protected>} />

      {/* Admin */}
      <Route path="/admin/comptes" element={<Protected role="ADMIN"><AdminUsers /></Protected>} />
      <Route path="/admin/messages" element={<Protected role="ADMIN"><AdminMessages /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
