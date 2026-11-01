// Petits utilitaires partagés par les écrans du back-office
export const ROLE_NAMES: Record<string, string> = {
  DOCTOR: 'Médecin',
  NURSE: 'Infirmier(e)',
  PHARMACY: 'Pharmacie',
  LAB: 'Laboratoire',
  COURIER: 'Livreur',
};

export const eur = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n} %`);

// « il y a 3 h », « il y a 2 j »
export function since(d: string): string {
  const h = Math.max(0, (Date.now() - new Date(d).getTime()) / 3600_000);
  if (h < 1) return 'à l’instant';
  if (h < 48) return `depuis ${Math.round(h)} h`;
  return `depuis ${Math.round(h / 24)} j`;
}

// Mois courant et mois précédent au format AAAA-MM (heure du Cameroun)
export const thisMonth = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 7);
export function lastMonth(): string {
  const d = new Date(Date.now() + 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}
export const monthLabel = (ym: string) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-15T00:00:00Z`));
