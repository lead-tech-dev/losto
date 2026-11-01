import { Link } from 'react-router-dom';

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="container footer-inner">
        <span className="brand">Proche Santé</span>
        <nav aria-label="Informations légales">
          <Link to="/cgu">Conditions générales</Link>
          <Link to="/confidentialite">Confidentialité</Link>
          <Link to="/mentions-legales">Mentions légales</Link>
        </nav>
        <p className="muted small">Proche Santé n’est pas un service d’urgence. En cas d’urgence au Cameroun, appelez le 119.</p>
      </div>
    </footer>
  );
}
