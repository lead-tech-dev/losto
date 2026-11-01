import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PublicFooter from '../../components/PublicFooter';
import { useApi } from '../../useApi';

interface LegalInfo {
  version: string;
  operator: { name: string; details: string[]; email: string | null; dpoEmail: string | null; director: string | null };
  processors: { name: string; role: string; location: string }[];
}

const fmtVersion = (v: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v));

function Shell({ title, children }: { title: string; children: (info: LegalInfo) => ReactNode }) {
  const { data } = useApi<LegalInfo>('/legal');
  return (
    <div className="public">
      <header className="public-header">
        <div className="container header-inner">
          <Link to="/" className="brand">Proche Santé</Link>
          <Link to="/connexion" className="btn btn-ghost btn-small">Se connecter</Link>
        </div>
      </header>
      <main className="container legal">
        <h1>{title}</h1>
        {data ? (
          <>
            <p className="muted small">Version du {fmtVersion(data.version)}</p>
            {children(data)}
          </>
        ) : (
          <p className="muted">Chargement…</p>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

const contact = (i: LegalInfo) => (i.operator.email ? <a href={`mailto:${i.operator.email}`}>{i.operator.email}</a> : 'la messagerie de votre espace famille');

export function MentionsLegales() {
  return (
    <Shell title="Mentions légales">
      {(i) => (
        <>
          <h2>Éditeur</h2>
          <p>
            Le service Proche Santé est édité par <strong>{i.operator.name}</strong>
            {i.operator.details.length > 0 && <>, {i.operator.details.join(', ')}</>}.
            {i.operator.director && <> Directeur de la publication : {i.operator.director}.</>} Contact : {contact(i)}.
          </p>
          <h2>Hébergement</h2>
          <ul>
            {i.processors.filter((p) => /Hébergement|Base de données/.test(p.role)).map((p) => (
              <li key={p.name}><strong>{p.name}</strong> : {p.role}</li>
            ))}
          </ul>
          <h2>Activité</h2>
          <p>
            Proche Santé organise le suivi à distance de personnes atteintes de maladies chroniques à Douala et Yaoundé. Les actes médicaux sont
            réalisés par des médecins et infirmiers partenaires, inscrits à leur Ordre professionnel au Cameroun, qui restent seuls responsables
            de leurs décisions médicales. Les médicaments sont délivrés par des pharmacies partenaires agréées.
          </p>
        </>
      )}
    </Shell>
  );
}

export function Confidentialite() {
  return (
    <Shell title="Politique de confidentialité">
      {(i) => (
        <>
          <p>
            Cette politique explique quelles données Proche Santé enregistre, pourquoi, qui les voit et comment exercer vos droits. Elle s’applique
            dans le respect de la loi camerounaise n° 2024/017 relative à la protection des données à caractère personnel et, pour les familles en
            Europe, du règlement général sur la protection des données (RGPD).
          </p>
          <h2>Responsable du traitement</h2>
          <p>{i.operator.name}{i.operator.details.length > 0 && <>, {i.operator.details.join(', ')}</>}. Contact pour vos données : {i.operator.dpoEmail ? <a href={`mailto:${i.operator.dpoEmail}`}>{i.operator.dpoEmail}</a> : contact(i)}.</p>
          <h2>Données enregistrées</h2>
          <ul>
            <li><strong>Famille</strong> : nom, e-mail, téléphone, paiements et factures.</li>
            <li><strong>Parent suivi</strong> : nom, année de naissance, numéro WhatsApp, adresse, maladies suivies, antécédents et traitements, consultations, comptes rendus, ordonnances, relevés (tension, glycémie, poids), analyses, messages WhatsApp échangés.</li>
            <li><strong>Partenaires</strong> : identité, numéro d’Ordre ou d’agrément, actes réalisés.</li>
          </ul>
          <h2>Pourquoi</h2>
          <p>
            Pour assurer le suivi médical demandé (consultations, rappels, livraison des médicaments, analyses), informer la famille, encaisser
            les paiements et respecter nos obligations comptables. Les données de santé ne sont traitées qu’avec l’accord explicite du parent,
            donné par lien ou en répondant OUI sur WhatsApp. Aucune donnée n’est vendue ni utilisée à des fins publicitaires.
          </p>
          <h2>Qui voit quoi</h2>
          <ul>
            <li>Le médecin et l’infirmier(e) du parent : son dossier médical.</li>
            <li>La pharmacie : l’ordonnance, sans les antécédents ni les comptes rendus.</li>
            <li>Le laboratoire : les analyses demandées, et le téléphone et l’adresse pour la prise de sang.</li>
            <li>Le livreur : le nom, le téléphone et l’adresse de livraison, jamais le contenu du colis.</li>
            <li>La famille titulaire et les proches qu’elle invite : comptes rendus, relevés, ordonnances, et résultats après lecture par le médecin.</li>
            <li>L’équipe Proche Santé : ce qui est nécessaire à l’organisation du suivi. Chaque consultation d’un dossier est enregistrée dans un journal.</li>
          </ul>
          <h2>Sous-traitants et hébergement</h2>
          <ul>
            {i.processors.map((p) => (
              <li key={p.name}><strong>{p.name}</strong> : {p.role} ({p.location})</li>
            ))}
          </ul>
          <p>
            Les données sont hébergées dans l’Union européenne (Allemagne). Les données de santé (antécédents, comptes rendus, résultats,
            messages) sont en plus chiffrées dans la base de données. Ces transferts hors du Cameroun s’appuient sur le consentement du parent et
            sur les garanties du RGPD.
          </p>
          <h2>Durée de conservation</h2>
          <p>
            Les données de suivi sont conservées tant que le suivi est actif, puis pendant la durée exigée pour le dossier médical, sauf demande
            d’effacement. Les factures sont conservées dix ans, comme la loi comptable l’impose, sans aucune donnée de santé.
          </p>
          <h2>Vos droits</h2>
          <p>
            Accès, rectification, opposition, effacement et copie de vos données : depuis l’espace famille (onglet Dossier : « Télécharger une
            copie des données » et « Effacer les données »), ou en écrivant à {i.operator.dpoEmail ? <a href={`mailto:${i.operator.dpoEmail}`}>{i.operator.dpoEmail}</a> : contact(i)}.
            Le parent peut aussi arrêter les messages en répondant STOP sur WhatsApp. Vous pouvez saisir l’Autorité de protection des données à
            caractère personnel (APDP) au Cameroun, ou la CNIL si vous résidez en France.
          </p>
          <h2>Cookies</h2>
          <p>
            Proche Santé n’utilise aucun cookie publicitaire ni outil de mesure d’audience. Seule votre session de connexion est gardée dans votre
            navigateur.
          </p>
          <h2>Incident de sécurité</h2>
          <p>En cas de fuite de données, nous prévenons l’autorité compétente et les personnes concernées dans les meilleurs délais.</p>
        </>
      )}
    </Shell>
  );
}

export function Cgu() {
  return (
    <Shell title="Conditions générales d’utilisation et de vente">
      {(i) => (
        <>
          <h2>1. Le service</h2>
          <p>
            {i.operator.name} (« Proche Santé ») propose aux familles un abonnement mensuel de suivi à distance d’un parent atteint d’une maladie
            chronique, vivant à Douala ou Yaoundé : consultations par un médecin partenaire, rappels et relevés sur WhatsApp, livraison des
            médicaments, compte rendu mensuel, et dans la formule Sérénité, visite infirmière et analyses trimestrielles.
          </p>
          <h2>2. Ce que Proche Santé n’est pas</h2>
          <p>
            <strong>Proche Santé n’est pas un service d’urgence.</strong> En cas de malaise, de douleur dans la poitrine, de difficulté à respirer
            ou à parler, appelez le 119 ou rendez-vous aux urgences. Les consultations à distance ne remplacent pas un examen à l’hôpital quand
            le médecin l’estime nécessaire. Les décisions médicales relèvent des seuls professionnels de santé partenaires.
          </p>
          <h2>3. Inscription et accord du parent</h2>
          <p>
            La famille crée un compte et inscrit son parent. Le suivi ne commence qu’après l’accord du parent lui-même. La famille garantit
            l’exactitude des informations transmises.
          </p>
          <h2>4. Prix et paiement</h2>
          <p>
            Formule Essentiel : 25 € par mois. Formule Sérénité : 45 € par mois. Frais d’inscription : 30 €, une seule fois. Paiement en francs CFA
            par Mobile Money (taux fixe 1 € = 655,957 FCFA, arrondi à la centaine supérieure). Les médicaments sont facturés au prix de la pharmacie,
            sans marge, et payés par la famille avant leur préparation. Une facture est émise pour chaque paiement.
          </p>
          <h2>5. Durée, renouvellement, résiliation</h2>
          <p>
            L’abonnement est mensuel. Sans paiement à l’échéance, la famille est relancée, puis le suivi est suspendu au bout de sept jours.
            La famille peut résilier à tout moment, sans frais, depuis son espace : le suivi continue jusqu’à la fin du mois payé. Le mois entamé
            n’est pas remboursé, sauf erreur de notre part.
          </p>
          <h2>6. Engagements de Proche Santé</h2>
          <p>
            Organiser les consultations et visites prévues par la formule, transmettre les ordonnances aux pharmacies partenaires, assurer la
            livraison dans les quartiers desservis, et protéger les données (voir la politique de confidentialité). Si une prestation prévue n’a
            pas lieu de notre fait, elle est reprogrammée.
          </p>
          <h2>7. Responsabilité</h2>
          <p>
            Proche Santé est responsable de l’organisation du service. Les professionnels de santé partenaires sont responsables de leurs actes.
            Proche Santé n’est pas responsable des interruptions dues aux réseaux téléphoniques, à WhatsApp ou aux opérateurs de Mobile Money.
          </p>
          <h2>8. Réclamations et droit applicable</h2>
          <p>
            Toute réclamation peut être adressée à {contact(i)}. Les présentes conditions sont régies par le droit camerounais ; les familles
            résidant dans l’Union européenne conservent les protections impératives de leur pays.
          </p>
        </>
      )}
    </Shell>
  );
}
