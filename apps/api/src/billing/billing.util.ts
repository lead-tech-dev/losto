// Petites fonctions de calcul utilisées par la facturation.

export const DAY_MS = 24 * 60 * 60 * 1000;

// +1 mois en gardant le jour, ramené au dernier jour du mois si besoin (31 janvier → 28/29 février).
export function addOneMonth(d: Date): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}

export function fmtEur(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

export function fmtXaf(xaf: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(xaf).replace(/ | /g, ' ')} FCFA`;
}

export function fmtAmount(amount: number, currency: 'EUR' | 'XAF'): string {
  return currency === 'EUR' ? fmtEur(amount) : fmtXaf(amount);
}

export function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Douala' }).format(d);
}

// "+237 6 77 12 34 56" → "237677123456" (format attendu par Tranzak)
export function toTranzakNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('237') ? digits : `237${digits}`;
}

// Identifiant marchand Tranzak : 32 caractères maximum → l'UUID du paiement sans tirets
export function mchRef(paymentId: string): string {
  return paymentId.replace(/-/g, '');
}
