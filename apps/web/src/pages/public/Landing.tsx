import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import PublicFooter from '../../components/PublicFooter';
import { PLANS } from '../../labels';

const XAF = (eur: number) => Math.ceil((eur * 655.957) / 100) * 100;

// Page d'accueil publique : la page de vente, branchée sur l'inscription et la vérification du quartier
export default function Landing() {
  return (
    <div className="public">
      <header className="public-header">
        <div className="container header-inner">
          <span className="brand">Proche Santé</span>
          <nav className="row">
            <Link to="/connexion" className="btn btn-ghost btn-small">Se connecter</Link>
            <Link to="/inscription" className="btn btn-small">Créer un compte</Link>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="container hero-inner">
          <p className="eyebrow">Douala · Yaoundé</p>
          <h1>Votre parent au Cameroun, suivi chaque mois par un médecin.</h1>
          <p className="hero-sub">
            Diabète, tension, cholestérol, asthme, thyroïde : un médecin l’appelle chaque mois, ses médicaments arrivent chez lui, et vous
            recevez un compte rendu clair, où que vous soyez.
          </p>
          <div className="row">
            <Link to="/inscription" className="btn btn-big">Inscrire mon parent</Link>
            <a href="#quartier" className="btn btn-ghost">Vérifier son quartier</a>
          </div>
        </div>
      </section>

      <section className="container">
        <h2 className="section-title">Comment ça marche</h2>
        <ol className="steps">
          <li><strong>Vous inscrivez votre parent</strong><span>En 5 minutes : ses coordonnées, ses maladies, la formule.</span></li>
          <li><strong>Il accepte sur WhatsApp</strong><span>Il répond OUI au message de bienvenue. Rien à installer.</span></li>
          <li><strong>Un médecin fait le bilan</strong><span>Par téléphone ou en vidéo, puis chaque mois.</span></li>
          <li><strong>Vous suivez tout</strong><span>Relevés, ordonnances, livraisons et compte rendu mensuel dans votre espace.</span></li>
        </ol>
      </section>

      <section className="container">
        <h2 className="section-title">Deux formules, sans engagement</h2>
        <div className="plans">
          {PLANS.map((p) => (
            <article key={p.id} className={`card plan ${p.id === 'SERENITE' ? 'plan-featured' : ''}`}>
              <h3>{p.name}</h3>
              <p className="plan-price">{p.price} € <span className="muted small">/ mois · {XAF(p.price).toLocaleString('fr-FR')} FCFA</span></p>
              <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            </article>
          ))}
        </div>
        <p className="muted small">
          Inscription : 30 € une seule fois (bilan de départ et appareil de mesure). Médicaments au prix de la pharmacie, sans marge. Paiement par
          Mobile Money. Résiliable à tout moment depuis votre espace.
        </p>
      </section>

      <section className="container" id="quartier">
        <CoverageCheck />
      </section>

      <section className="container trust">
        <div><strong>Médecins inscrits à l’Ordre</strong><span>Des professionnels de Douala et Yaoundé, vérifiés par notre équipe.</span></div>
        <div><strong>Alertes immédiates</strong><span>Une tension ou une glycémie anormale prévient le médecin et la famille.</span></div>
        <div><strong>Données protégées</strong><span>Chiffrées, vues seulement par l’équipe soignante et la famille.</span></div>
      </section>

      <section className="container faq">
        <h2 className="section-title">Questions fréquentes</h2>
        <details><summary>Et si mon parent n’a pas de smartphone ?</summary><p>Le médecin l’appelle sur son téléphone. Les rappels WhatsApp sont alors remplacés par les appels et les visites, et vous recevez tout dans votre espace.</p></details>
        <details><summary>Que se passe-t-il en cas d’urgence ?</summary><p>Proche Santé n’est pas un service d’urgence : il faut appeler le 119. Si votre parent nous signale un malaise sur WhatsApp, nous lui donnons cette consigne et vous prévenons aussitôt, ainsi que son médecin.</p></details>
        <details><summary>Comment sont livrés les médicaments ?</summary><p>La pharmacie partenaire prépare l’ordonnance après votre paiement, puis un livreur l’apporte au domicile. Votre parent donne un code à 4 chiffres pour recevoir le colis.</p></details>
        <details><summary>Puis-je arrêter quand je veux ?</summary><p>Oui, sans frais, depuis votre espace. Le suivi continue jusqu’à la fin du mois payé.</p></details>
      </section>

      <section className="container cta-final">
        <h2>Commencez aujourd’hui.</h2>
        <Link to="/inscription" className="btn btn-big">Inscrire mon parent</Link>
      </section>
      <PublicFooter />
    </div>
  );
}

function CoverageCheck() {
  const [city, setCity] = useState('DOUALA');
  const [district, setDistrict] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  async function check(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ covered: boolean }>(`/coverage?city=${city}&district=${encodeURIComponent(district.trim())}`);
      setResult(r.covered);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="card coverage" onSubmit={check}>
      <h2>Votre parent habite-t-il un quartier desservi ?</h2>
      <div className="row align-end">
        <label className="narrow-wide">
          Ville
          <select value={city} onChange={(e) => { setCity(e.target.value); setResult(null); }}>
            <option value="DOUALA">Douala</option>
            <option value="YAOUNDE">Yaoundé</option>
          </select>
        </label>
        <label>
          Quartier
          <input required value={district} onChange={(e) => { setDistrict(e.target.value); setResult(null); }} placeholder="Bonapriso, Bastos, Makepe…" />
        </label>
        <button type="submit" className="btn">Vérifier</button>
      </div>
      {result === true && (
        <p className="notice notice-ok">Bonne nouvelle : {district.trim()} est desservi. <Link to="/inscription">Inscrire mon parent</Link></p>
      )}
      {result === false && (
        <p className="notice notice-warn">
          {district.trim()} n’est pas encore desservi. Vous pouvez inscrire votre parent : nous vous prévenons dès que le service y ouvre.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
