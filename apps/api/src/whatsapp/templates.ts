// Modèles de messages à faire valider par Meta (catégorie « utilitaire », langue fr).
// Hors de la fenêtre de 24 h, c'est le seul moyen d'écrire en premier. Règles de Meta respectées :
// un texte ne commence ni ne finit par une variable, et deux variables ne se suivent pas.
// Le nom et le texte ci-dessous doivent être recopiés à l'identique dans le gestionnaire WhatsApp de Meta.

export const TEMPLATES = {
  ps_bienvenue: {
    params: ['prénom du parent', 'nom de l’enfant'],
    body:
      'Bonjour {{1}}, ici Proche Santé. Votre enfant {{2}} vous a inscrit(e) pour le suivi de votre santé à domicile : ' +
      'un médecin vous appellera chaque mois et vous pourrez envoyer ici votre tension et votre glycémie. ' +
      'Répondez OUI pour accepter. Répondez STOP si vous ne souhaitez pas de messages.',
  },
  ps_rappel_medicaments: {
    params: ['prénom', 'moment', 'liste des médicaments'],
    body: 'Bonjour {{1}}, c’est l’heure des médicaments du {{2}} : {{3}}. Répondez OK quand vous les avez pris.',
  },
  ps_rappel_rdv: {
    params: ['prénom', 'rendez-vous (quoi et quand)', 'précision (lien visio, numéro…)'],
    body: 'Bonjour {{1}}, rappel de votre rendez-vous : {{2}}. Précision : {{3}}. À bientôt, Proche Santé.',
  },
  ps_code_livraison: {
    params: ['prénom', 'code'],
    body: 'Bonjour {{1}}, vos médicaments arrivent. Donnez ce code au livreur, et à lui seulement : {{2}}. Merci, Proche Santé.',
  },
  ps_info_famille: {
    params: ['message'],
    body: 'Proche Santé : {{1}}. Le détail est dans votre espace famille et dans votre e-mail.',
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;

export function renderTemplate(name: TemplateName, params: string[]): string {
  return TEMPLATES[name].body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');
}

// Meta refuse les paramètres avec retours à la ligne, tabulations ou plus de 4 espaces consécutifs
export function cleanParam(value: string): string {
  return value.replace(/[\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim().slice(0, 900);
}
