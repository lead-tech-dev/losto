import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import Layout from '../components/Layout';
import DoctorHome from './care/DoctorHome';
import NurseHome from './care/NurseHome';
import AdminHome from './admin/AdminHome';
import FamilyHome from './family/FamilyHome';
import CourierHome from './partners/CourierHome';
import LabHome from './partners/LabHome';
import PharmacyHome from './partners/PharmacyHome';

// Contenu d'accueil selon le rôle. Chaque espace sera rempli par les modules suivants.
const SPACES: Record<string, { title: string; text: string; next: string }> = {
  FAMILY: {
    title: 'Votre espace famille',
    text: 'Inscrivez votre parent, choisissez sa formule et suivez ses consultations et comptes rendus.',
    next: 'Module 2 : inscription du parent et tableau de bord',
  },
  DOCTOR: {
    title: 'Votre espace médecin',
    text: 'Retrouvez vos consultations du jour, les fiches patients et rédigez vos comptes rendus.',
    next: 'Module 4 : agenda et téléconsultations',
  },
  NURSE: {
    title: 'Votre espace infirmier(e)',
    text: 'Vos visites à domicile et la saisie des relevés de tension et de glycémie.',
    next: 'Module 4 : visites à domicile',
  },
  PHARMACY: {
    title: 'Votre espace pharmacie',
    text: 'Les ordonnances à préparer et leur remise au livreur.',
    next: 'Module 5 : ordonnances et préparation',
  },
  COURIER: {
    title: 'Votre espace livreur',
    text: 'Vos livraisons du jour et leur confirmation.',
    next: 'Module 5 : livraisons',
  },
  ADMIN: {
    title: 'Pilotage Proche Santé',
    text: 'Créez les comptes partenaires, vérifiez leurs documents et suivez l’activité.',
    next: 'Module 7 : indicateurs et suivi des abonnés',
  },
};

export default function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'FAMILY') return <FamilyHome firstName={user.firstName} />;
  if (user.role === 'DOCTOR') return <DoctorHome firstName={user.lastName} />;
  if (user.role === 'NURSE') return <NurseHome firstName={user.firstName} />;
  if (user.role === 'PHARMACY') return <PharmacyHome />;
  if (user.role === 'LAB') return <LabHome />;
  if (user.role === 'COURIER') return <CourierHome firstName={user.firstName} />;
  if (user.role === 'ADMIN') return <AdminHome firstName={user.firstName} />;
  const space = SPACES[user.role];

  return (
    <Layout>
      <h1>Bonjour {user.firstName}</h1>
      <section className="card">
        <h2>{space.title}</h2>
        <p>{space.text}</p>
        <p className="muted small">À venir : {space.next}</p>
        {user.role === 'ADMIN' && (
          <div className="row">
            <Link className="btn" to="/admin/comptes">
              Gérer les comptes
            </Link>
            <Link className="btn btn-ghost" to="/admin/messages">
              Messages des familles
            </Link>
            <Link className="btn btn-ghost" to="/admin/whatsapp">
              WhatsApp des parents
            </Link>
            <Link className="btn btn-ghost" to="/admin/comptes-rendus">
              Comptes rendus à relire
            </Link>
          </div>
        )}
      </section>
    </Layout>
  );
}
