import { Plan } from '../db/schema';

// Prix mensuels en euros, affichés à la famille.
export const PLAN_PRICES_EUR: Record<Plan, number> = {
  ESSENTIEL: 25,
  SERENITE: 45,
};

export const SIGNUP_FEE_EUR = 30;

// Le franc CFA (XAF) est arrimé à l'euro : 1 € = 655,957 FCFA, taux fixe.
export const XAF_PER_EUR = 655.957;

// Prix en FCFA pour le Mobile Money, arrondis à la centaine supérieure.
export function eurToXaf(eur: number): number {
  return Math.ceil((eur * XAF_PER_EUR) / 100) * 100;
}

// Prix des médicaments (fixé en FCFA par la pharmacie) converti en centimes d'euro pour la carte.
export function xafToEurCents(xaf: number): number {
  return Math.ceil((xaf / XAF_PER_EUR) * 100);
}

export const PLAN_LABELS: Record<Plan, string> = { ESSENTIEL: 'Essentiel', SERENITE: 'Sérénité' };
