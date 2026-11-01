// Chiffrement des données de santé en clair dans la base (AES-256-GCM).
// Même si la base fuitait (sauvegarde volée, accès hébergeur), antécédents, comptes rendus, résultats
// d'analyses et messages des parents restent illisibles sans DATA_ENCRYPTION_KEY.
// Format stocké : « enc:v1:<iv>:<tag>:<texte chiffré> » (base64). Une valeur sans ce préfixe est lue
// telle quelle : les anciennes données restent lisibles et sont chiffrées par db/encrypt-existing.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { customType } from 'drizzle-orm/pg-core';

const PREFIX = 'enc:v1:';
let cached: Buffer | null = null;
let warned = false;

export function encryptionKey(): Buffer {
  if (cached) return cached;
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY doit faire 32 octets encodés en base64 (openssl rand -base64 32)');
    cached = key;
    return key;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATA_ENCRYPTION_KEY manquant');
  if (!warned && process.env.NODE_ENV !== 'test') {
    warned = true;
    console.warn('⚠ DATA_ENCRYPTION_KEY absent : clé de développement utilisée (jamais en production)');
  }
  cached = createHash('sha256').update('proche-sante-cle-de-developpement').digest();
  return cached;
}

// Remise à zéro (tests de changement de clé)
export function resetEncryptionKeyCache() {
  cached = null;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function decrypt(value: string): string {
  if (!isEncrypted(value)) return value;
  const [iv, tag, data] = value.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Colonne texte chiffrée de façon transparente : on écrit et on lit du texte clair dans le code.
// Attention : impossible de filtrer ou trier en SQL sur ces colonnes (chaque chiffrement est différent).
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value) {
    return encrypt(value);
  },
  fromDriver(value) {
    return decrypt(value);
  },
});

// Colonnes chiffrées (table, colonne) : utilisé pour chiffrer les données existantes
export const ENCRYPTED_COLUMNS: [string, string][] = [
  ['patients', 'medical_history'],
  ['patients', 'current_treatments'],
  ['patients', 'notes'],
  ['consultations', 'summary'],
  ['home_visits', 'note'],
  ['lab_requests', 'results'],
  ['lab_requests', 'doctor_comment'],
  ['referrals', 'reason'],
  ['monthly_reports', 'content'],
  ['whatsapp_messages', 'body'],
];
