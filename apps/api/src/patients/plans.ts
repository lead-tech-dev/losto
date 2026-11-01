import { Plan } from '../db/schema';

// Prix mensuels en euros, affichés à la famille. Le paiement réel arrive au module 3.
export const PLAN_PRICES_EUR: Record<Plan, number> = {
  ESSENTIEL: 25,
  SERENITE: 45,
};

export const SIGNUP_FEE_EUR = 30;
