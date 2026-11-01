// Rémunération des partenaires, en FCFA par acte. Valeurs de départ À NÉGOCIER avec chaque partenaire :
// modifiables sans toucher au code via les variables d'environnement ci-dessous.
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export function partnerRates() {
  return {
    initialConsultation: num('RATE_CONSULTATION_INITIAL_XAF', 8000), // bilan de départ (plus long)
    consultation: num('RATE_CONSULTATION_XAF', 5000), // consultation mensuelle ou en plus
    homeVisit: num('RATE_HOME_VISIT_XAF', 5000), // visite infirmière à domicile
    delivery: num('RATE_DELIVERY_XAF', 1500), // livraison réussie
    failedDelivery: num('RATE_DELIVERY_FAILED_XAF', 500), // déplacement sans remise (personne au domicile…)
    homeSampling: num('RATE_HOME_SAMPLING_XAF', 2000), // déplacement du laboratoire pour une prise de sang à domicile
  };
}

// Estimation du coût d'un message WhatsApp envoyé (tarif Meta « Reste de l'Afrique », à ajuster)
export const whatsappCostXaf = () => num('WHATSAPP_COST_XAF', 15);

export const XAF_PER_EUR = 655.957;
export const xafToEur = (xaf: number) => Math.round((xaf / XAF_PER_EUR) * 100) / 100;
