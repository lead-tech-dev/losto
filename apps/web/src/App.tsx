import { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Role } from './api';
import { useAuth } from './auth';
import AcceptInvitation from './pages/AcceptInvitation';
import AdminMessages from './pages/AdminMessages';
import AdminReports from './pages/AdminReports';
import AdminWhatsApp from './pages/AdminWhatsApp';
import Landing from './pages/public/Landing';
import { Cgu, Confidentialite, MentionsLegales } from './pages/public/Legal';
import AdminAudit from './pages/admin/AdminAudit';
import AdminMetrics from './pages/admin/AdminMetrics';
import AdminPatients from './pages/admin/AdminPatients';
import AdminPayments from './pages/admin/AdminPayments';
import AdminPayouts from './pages/admin/AdminPayouts';
import AdminZones from './pages/admin/AdminZones';
import MyStatement from './pages/partners/MyStatement';
import AdminUsers from './pages/AdminUsers';
import AvailabilityPage from './pages/care/AvailabilityPage';
import DoctorPatientFile from './pages/care/DoctorPatientFile';
import DoctorPatients from './pages/care/DoctorPatients';
import NurseVisitPage from './pages/care/NurseVisitPage';
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
function Protected({ children, role, roles }: { children: ReactNode; role?: Role; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="center muted">Chargement…</p>;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Accueil : la page de vente pour un visiteur, le tableau de bord une fois connecté
function Home() {
  const { user, loading } = useAuth();
  if (loading) return <p className="center muted">Chargement…</p>;
  return user ? <Dashboard /> : <Landing />;
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

      <Route path="/" element={<Home />} />
      <Route path="/cgu" element={<Cgu />} />
      <Route path="/confidentialite" element={<Confidentialite />} />
      <Route path="/mentions-legales" element={<MentionsLegales />} />
      <Route path="/profil" element={<Protected><ProfilePage /></Protected>} />

      {/* Espace famille */}
      <Route path="/parents/nouveau" element={<Protected role="FAMILY"><NewParent /></Protected>} />
      <Route path="/parents/:id" element={<Protected role="FAMILY"><ParentPage /></Protected>} />
      <Route path="/parents/:id/paiement" element={<Protected role="FAMILY"><PaymentPage /></Protected>} />
      <Route path="/paiements" element={<Protected role="FAMILY"><PaymentsPage /></Protected>} />
      <Route path="/messages" element={<Protected role="FAMILY"><MessagesPage /></Protected>} />

      {/* Soignants */}
      <Route path="/disponibilites" element={<Protected roles={['DOCTOR', 'NURSE']}><AvailabilityPage /></Protected>} />
      <Route path="/medecin/patients" element={<Protected role="DOCTOR"><DoctorPatients /></Protected>} />
      <Route path="/medecin/patients/:id" element={<Protected role="DOCTOR"><DoctorPatientFile /></Protected>} />
      <Route path="/infirmier/visites/:id" element={<Protected role="NURSE"><NurseVisitPage /></Protected>} />

      {/* Admin */}
      <Route path="/admin/comptes" element={<Protected role="ADMIN"><AdminUsers /></Protected>} />
      <Route path="/admin/messages" element={<Protected role="ADMIN"><AdminMessages /></Protected>} />
      <Route path="/admin/whatsapp" element={<Protected role="ADMIN"><AdminWhatsApp /></Protected>} />
      <Route path="/admin/parents" element={<Protected role="ADMIN"><AdminPatients /></Protected>} />
      <Route path="/admin/paiements" element={<Protected role="ADMIN"><AdminPayments /></Protected>} />
      <Route path="/admin/partenaires" element={<Protected role="ADMIN"><AdminPayouts /></Protected>} />
      <Route path="/admin/indicateurs" element={<Protected role="ADMIN"><AdminMetrics /></Protected>} />
      <Route path="/admin/journal" element={<Protected role="ADMIN"><AdminAudit /></Protected>} />
      <Route path="/admin/zones" element={<Protected role="ADMIN"><AdminZones /></Protected>} />
      <Route path="/releves" element={<Protected roles={['DOCTOR', 'NURSE', 'PHARMACY', 'LAB', 'COURIER']}><MyStatement /></Protected>} />
      <Route path="/admin/comptes-rendus" element={<Protected role="ADMIN"><AdminReports /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
