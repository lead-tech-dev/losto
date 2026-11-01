import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

// Version des conditions générales et de la politique de confidentialité : à changer à chaque modification
// du texte (les familles inscrites avant gardent la trace de la version acceptée).
export const TERMS_VERSION = '2026-11-01';

// Informations légales affichées par les pages publiques (mentions légales, confidentialité, CGU).
// L'éditeur est configuré par variables d'environnement : rien à recompiler quand les coordonnées changent.
@Controller('legal')
export class LegalController {
  @Public()
  @Get()
  info() {
    const details = (process.env.INVOICE_ISSUER_DETAILS ?? '').split('|').map((s) => s.trim()).filter(Boolean);
    return {
      version: TERMS_VERSION,
      operator: {
        name: process.env.INVOICE_ISSUER_NAME || 'Startup Valley',
        details, // adresse, RCCM, NIU…
        email: process.env.LEGAL_CONTACT_EMAIL || null,
        dpoEmail: process.env.LEGAL_DPO_EMAIL || process.env.LEGAL_CONTACT_EMAIL || null,
        director: process.env.LEGAL_DIRECTOR || null, // directeur de la publication
      },
      // Sous-traitants qui traitent des données pour Proche Santé
      processors: [
        { name: 'Vercel Inc.', role: 'Hébergement du site', location: 'Union européenne et États-Unis' },
        { name: 'Render Services Inc.', role: 'Hébergement de l’application', location: 'Francfort, Allemagne' },
        { name: 'Neon Inc.', role: 'Base de données chiffrée', location: 'Francfort, Allemagne' },
        { name: 'Tranzak', role: 'Paiements Mobile Money', location: 'Cameroun' },
        { name: 'Meta Platforms (WhatsApp)', role: 'Messages WhatsApp aux parents et aux familles', location: 'Union européenne et États-Unis' },
        { name: 'Fournisseur d’e-mails (SMTP)', role: 'Envoi des e-mails', location: 'Union européenne' },
        ...(process.env.ANTHROPIC_API_KEY
          ? [{ name: 'Anthropic PBC', role: 'Assistant pour les questions pratiques (jamais les questions de santé)', location: 'États-Unis' }]
          : []),
      ],
    };
  }
}

@Module({ controllers: [LegalController] })
export class LegalModule {}
