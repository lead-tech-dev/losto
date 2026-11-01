// Lecture des messages écrits par les parents. Fonctions pures, testées dans test/whatsapp-parse.spec.ts.
import { ReadingInput } from '../care/thresholds';

// Minuscules, sans accents, virgule décimale → point : « Glycémie 1,2 » → « glycemie 1.2 »
export function simplify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ParsedReading =
  | { ok: true; reading: ReadingInput; label: string; note?: string }
  | { ok: false; question: string };

const fr = (n: number, digits = 2) => n.toFixed(digits).replace(/\.?0+$/, '').replace('.', ',');

// Tension : au Cameroun on la dit souvent en cmHg (« 13/8 » = 130/80 mmHg). On accepte les deux.
function bpValue(n: number): number {
  return n < 30 ? Math.round(n * 10) : Math.round(n);
}

/**
 * Trouve les mesures dans un message : « 13/8 », « tension 135 85 », « glycémie 1,2 », « sucre 120 », « poids 72 ».
 * Retourne [] si le message ne contient pas de mesure.
 */
export function parseReadings(raw: string): ParsedReading[] {
  const t = simplify(raw);
  const out: ParsedReading[] = [];

  // Tension : « 13/8 », « 135/85 », « 13.5 / 8.5 », « 140x90 », ou « tension 14 9 »
  const slash = t.match(/(\d{1,3}(?:\.\d)?)\s*[/x\\]\s*(\d{1,3}(?:\.\d)?)/);
  const spoken = !slash && t.match(/\b(?:tension|ta|tens)\b\D{0,12}(\d{1,3}(?:\.\d)?)\s+(?:sur\s+)?(\d{1,3}(?:\.\d)?)/);
  const bp = slash || spoken;
  if (bp) {
    const systolic = bpValue(Number(bp[1]));
    const diastolic = bpValue(Number(bp[2]));
    out.push({ ok: true, reading: { type: 'BLOOD_PRESSURE', systolic, diastolic }, label: `tension ${systolic}/${diastolic} mmHg` });
  }

  // Glycémie : mot-clé obligatoire, puis le nombre. Unité devinée : g/L (< 5), mg/dL (20 à 600).
  const gly = t.match(/\b(?:glycemie|glyc|gly|glucose|sucre|dextro)\b\D{0,15}(\d{1,3}(?:\.\d{1,2})?)\s*(mg|g\/l|g|mmol)?/);
  if (gly) {
    const n = Number(gly[1]);
    const unit = gly[2];
    let value: number | null = null;
    let note: string | undefined;
    if (unit === 'mmol') value = null;
    else if (unit === 'mg' || (n >= 20 && n <= 600)) {
      value = Math.round(n) / 100;
      note = `${Math.round(n)} mg/dL`;
    } else if (n > 0 && n < 5) value = n;
    if (value === null) {
      out.push({ ok: false, question: 'Pour la glycémie, écrivez la valeur affichée par l’appareil avec son unité, par exemple « glycémie 1,20 g/L » ou « glycémie 120 mg/dL ».' });
    } else {
      out.push({ ok: true, reading: { type: 'GLUCOSE', value }, label: `glycémie ${fr(value)} g/L`, note });
    }
  }

  const poids = t.match(/\b(?:poids|pese|kg)\b\D{0,10}(\d{2,3}(?:\.\d)?)|(\d{2,3}(?:\.\d)?)\s*kg\b/);
  if (poids) {
    const value = Number(poids[1] ?? poids[2]);
    out.push({ ok: true, reading: { type: 'WEIGHT', value }, label: `poids ${fr(value, 1)} kg` });
  }
  return out;
}

// ---------- Intentions ----------

// Signes d'alerte : on ne cherche pas à diagnostiquer, on pousse vers les secours et on prévient la famille.
const EMERGENCY = [
  'malaise', 'evanoui', 'perdu connaissance', 'inconscient', 'convuls',
  'douleur poitrine', 'douleur a la poitrine', 'mal a la poitrine', 'serre la poitrine', 'oppression',
  'respire mal', 'respirer', 'etouffe', 'essouffle',
  'paralys', 'bouche tordue', 'ne peut plus parler', 'parle mal', 'bras ne bouge', 'avc',
  'saigne', 'vomit du sang', 'crache du sang', 'sang dans', 'suis tombe', 'est tombe', 'chute',
  'urgence', 'au secours', 'aidez moi', 'tres mal', 'je vais mourir',
];

// Questions qui relèvent du médecin : jamais de réponse automatique, transfert à un humain
const MEDICAL = [
  'douleur', 'mal ', 'mal a', 'fievre', 'toux', 'vertige', 'tete qui tourne', 'fatigue', 'nausee', 'vomi', 'diarrhee',
  'gonfle', 'oedeme', 'demange', 'bouton', 'plaie', 'brulure', 'symptome',
  'medicament', 'comprime', 'dose', 'posologie', 'oublie', 'arrete', 'effet secondaire', 'traitement', 'ordonnance',
  'insuline', 'metformine', 'tension', 'diabete', 'regime', 'manger', 'alcool', 'enceinte', 'paludisme', 'palu',
];

export type Intent =
  | 'EMERGENCY'
  | 'STOP'
  | 'START'
  | 'YES'
  | 'TAKEN'
  | 'GREETING'
  | 'HELP'
  | 'NEXT_APPOINTMENT'
  | 'DELIVERY'
  | 'BILLING'
  | 'MEDICAL'
  | 'OTHER';

// Chaque mot-clé doit commencer un mot : « evanoui » trouve « évanouie », « mal » ne trouve pas « normal »
const has = (t: string, words: string[]) => words.some((w) => ` ${t} `.includes(` ${w}`));

// Symptôme ou question de traitement glissé dans un message (même s'il contient aussi une mesure)
export function mentionsMedical(raw: string): boolean {
  const t = simplify(raw).replace(/[!?.,;:]+/g, ' ');
  return has(t, MEDICAL.filter((w) => !['tension', 'diabete'].includes(w)));
}

export function intentOf(raw: string): Intent {
  const t = simplify(raw).replace(/[!?.,;:-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (has(t, EMERGENCY)) return 'EMERGENCY';
  if (/^(stop|arret|arreter|desinscri\w*)$/.test(t)) return 'STOP';
  if (/^(reprendre|start|recommencer)$/.test(t)) return 'START';
  if (/^(oui|ok oui|oui j'accepte|j'accepte|d'accord oui|yes)$/.test(t)) return 'YES';
  if (/^(ok|okay|c'est pris|pris|deja pris|fait|c'est fait|bien pris|medicaments pris|j'ai pris)( merci)?$/.test(t)) return 'TAKEN';
  if (/^(aide|menu|help|\?)$/.test(t)) return 'HELP';
  if (/\b(rendez ?vous|rdv|consultation|visite|quand (le|la) (docteur|medecin|infirmi))/.test(t)) return 'NEXT_APPOINTMENT';
  if (/\b(livr|livreur|colis|commande|pharmacie)/.test(t)) return 'DELIVERY';
  if (/\b(pai|abonnement|facture|argent|prix|cout|combien)/.test(t)) return 'BILLING';
  if (has(t, MEDICAL)) return 'MEDICAL';
  if (/^(bonjour|bonsoir|salut|merci|merci beaucoup|bonne nuit|bonne journee|coucou|hello)( \w+)?$/.test(t)) return 'GREETING';
  return 'OTHER';
}
