// Contrôles au démarrage en production : mieux vaut refuser de démarrer qu'exposer des données de santé
// avec une configuration de développement.
export function checkProductionEnv(env: NodeJS.ProcessEnv = process.env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (env.NODE_ENV !== 'production') return { errors, warnings };

  if (!env.DATABASE_URL) errors.push('DATABASE_URL manquant');
  const jwt = env.JWT_SECRET ?? '';
  if (jwt.length < 32 || /remplace|change|exemple|secret-de-test/i.test(jwt)) errors.push('JWT_SECRET trop court ou valeur d’exemple (32 caractères aléatoires minimum)');
  if (!/^https:\/\//.test(env.WEB_ORIGIN ?? '')) errors.push('WEB_ORIGIN doit être l’adresse https du site (ex. https://proche-sante.vercel.app)');
  if (env.PAYMENTS_SIMULATION === 'true') errors.push('PAYMENTS_SIMULATION interdit en production');
  if (env.WHATSAPP_SIMULATION === 'true') errors.push('WHATSAPP_SIMULATION interdit en production');
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) errors.push('DATA_ENCRYPTION_KEY manquant ou invalide (openssl rand -base64 32) : il chiffre les données de santé');
  if (env.SEED_ADMIN_PASSWORD && env.SEED_ADMIN_PASSWORD.length < 12) errors.push('SEED_ADMIN_PASSWORD : 12 caractères minimum en production');

  if (!env.SMTP_HOST) warnings.push('SMTP_HOST absent : aucun e-mail ne part (mot de passe oublié, alertes, factures)');
  if (!env.TRANZAK_APP_ID || !env.TRANZAK_APP_KEY) warnings.push('Tranzak non configuré : aucun paiement possible');
  if (!env.WHATSAPP_TOKEN) warnings.push('WhatsApp non configuré : aucun message aux parents');
  if (!env.INVOICE_ISSUER_NAME) warnings.push('INVOICE_ISSUER_NAME absent : factures sans émetteur');
  return { errors, warnings };
}
