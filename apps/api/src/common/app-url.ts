// Adresse de l'appli web, pour construire les liens envoyés par e-mail ou WhatsApp.
export function appUrl(path: string): string {
  const base = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
  return `${base}${path}`;
}
