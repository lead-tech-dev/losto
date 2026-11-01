import { randomBytes } from 'crypto';

// Lien de visio Jitsi : un nom de salle impossible à deviner par consultation.
// VIDEO_BASE_URL permet d'utiliser un serveur Jitsi hébergé par Proche Santé (recommandé : sur meet.jit.si,
// la personne qui ouvre la salle doit se connecter avec un compte Google ou GitHub).
export function newVideoUrl(): string {
  const base = (process.env.VIDEO_BASE_URL || 'https://meet.jit.si').replace(/\/$/, '');
  return `${base}/ProcheSante-${randomBytes(12).toString('hex')}`;
}
