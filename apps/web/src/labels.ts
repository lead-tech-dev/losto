// Libellés affichés, en français, pour les valeurs envoyées par l'API.

export const CONDITION_LABELS: Record<string, string> = {
  DIABETES: 'Diabète',
  HYPERTENSION: 'Hypertension',
  CHOLESTEROL: 'Cholestérol',
  ASTHMA: 'Asthme',
  THYROID: 'Thyroïde',
  SENIOR_FOLLOWUP: 'Suivi général senior',
};

export const CITY_LABELS: Record<string, string> = { DOUALA: 'Douala', YAOUNDE: 'Yaoundé', OTHER: 'Autre ville' };

export const PLANS = [
  {
    id: 'ESSENTIEL',
    name: 'Essentiel',
    price: 25,
    features: ['1 téléconsultation par mois', 'Suivi WhatsApp et rappels', 'Médicaments livrés', 'Compte rendu mensuel'],
  },
  {
    id: 'SERENITE',
    name: 'Sérénité',
    price: 45,
    features: ['Tout Essentiel', '1 consultation en plus si besoin', '1 visite infirmière par mois', 'Analyses chaque trimestre'],
  },
] as const;

export const PLAN_LABELS: Record<string, string> = { ESSENTIEL: 'Essentiel', SERENITE: 'Sérénité' };

export const SUBSCRIPTION_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  PENDING: { label: 'En attente de paiement', tone: 'warn' },
  ACTIVE: { label: 'Actif', tone: 'ok' },
  PAST_DUE: { label: 'Paiement en retard', tone: 'warn' },
  SUSPENDED: { label: 'Suspendu (impayé)', tone: 'warn' },
  CANCELED: { label: 'Résilié', tone: 'muted' },
};

export const CONSULTATION_STATUS: Record<string, string> = {
  SCHEDULED: 'Prévue',
  DONE: 'Faite',
  MISSED: 'Manquée',
  CANCELED: 'Annulée',
};

export const MODE_LABELS: Record<string, string> = { VIDEO: 'Visio', PHONE: 'Téléphone' };

export const PRESCRIPTION_STATUS: Record<string, string> = {
  SENT: 'Envoyée à la pharmacie',
  AWAITING_PAYMENT: 'Prix à valider',
  PREPARING: 'En préparation',
  READY: 'Prête',
  DELIVERED: 'Livrée',
  CANCELED: 'Annulée',
};

export const DELIVERY_STATUS: Record<string, string> = {
  PENDING: 'À attribuer',
  ASSIGNED: 'Livreur attribué',
  IN_TRANSIT: 'En route',
  DELIVERED: 'Livrée',
  FAILED: 'Échec',
};

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export const fmtDate = (d: string) => dateFmt.format(new Date(d));
export const fmtDateTime = (d: string) => dateTimeFmt.format(new Date(d));
export const fmtMonth = (d: string) => monthFmt.format(new Date(d));
export const fmtShort = (d: string) => shortFmt.format(new Date(d));
export const fmtXaf = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n)} FCFA`;

export const KIND_LABELS: Record<string, string> = { INITIAL: 'Bilan de départ', MONTHLY: 'Consultation mensuelle', EXTRA: 'Consultation supplémentaire' };
export const URGENCY_LABELS: Record<string, string> = { ROUTINE: 'Sans urgence', URGENT: 'Dans les prochains jours', EMERGENCY: 'En urgence, aujourd’hui' };
export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

// Affichage en heure du Cameroun, quel que soit le fuseau de l'appareil
const doualaTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });
const doualaDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Douala' });
const doualaDayKey = new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Douala' });
export const fmtTimeCm = (d: string) => doualaTime.format(new Date(d));
export const fmtDayCm = (d: string) => doualaDay.format(new Date(d));
export const dayKeyCm = (d: string | Date) => doualaDayKey.format(new Date(d));
export const fmtSlotCm = (d: string) => `${fmtDayCm(d)} à ${fmtTimeCm(d)}`;
