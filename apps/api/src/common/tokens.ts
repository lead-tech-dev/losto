import { createHash, randomBytes } from 'crypto';

// Jeton aléatoire envoyé par lien (invitation, réinitialisation de mot de passe).
// On envoie le jeton, on ne stocke que son empreinte : une fuite de la base ne donne pas de liens valides.
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Jeton stocké en clair (consentement : le lien doit pouvoir être renvoyé au parent)
export function randomToken(): string {
  return randomBytes(24).toString('base64url');
}
