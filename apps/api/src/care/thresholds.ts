// Seuils d'alerte des relevés. Valeurs de départ courantes en pratique clinique,
// À FAIRE VALIDER PAR LE MÉDECIN RÉFÉRENT avant le lancement (elles ne remplacent pas son jugement).
//
// Tension (mmHg) — repères des recommandations européennes (ESC/ESH) :
//   grade 3 / urgence possible : systolique ≥ 180 ou diastolique ≥ 110
//   grade 2 : systolique ≥ 160 ou diastolique ≥ 100
//   hypotension : systolique < 90
// Glycémie (g/L ; 1 g/L = 100 mg/dL) — niveaux d'hypoglycémie de l'ADA :
//   < 0,54 g/L : hypoglycémie de niveau 2 (sévère)    < 0,70 g/L : niveau 1
//   > 3,00 g/L : hyperglycémie importante              > 2,50 g/L : à surveiller

export type Severity = 'WARNING' | 'URGENT';

export interface ReadingInput {
  type: 'BLOOD_PRESSURE' | 'GLUCOSE' | 'WEIGHT';
  systolic?: number | null;
  diastolic?: number | null;
  value?: number | null;
}

export const THRESHOLDS = {
  bp: { urgentSys: 180, urgentDia: 110, warnSys: 160, warnDia: 100, lowSys: 90 },
  glucose: { urgentLow: 0.54, warnLow: 0.7, warnHigh: 2.5, urgentHigh: 3.0 },
};

export function evaluateReading(r: ReadingInput): { severity: Severity; message: string } | null {
  if (r.type === 'BLOOD_PRESSURE' && r.systolic != null && r.diastolic != null) {
    const t = THRESHOLDS.bp;
    const bp = `${r.systolic}/${r.diastolic} mmHg`;
    if (r.systolic >= t.urgentSys || r.diastolic >= t.urgentDia) return { severity: 'URGENT', message: `Tension très élevée : ${bp}` };
    if (r.systolic < t.lowSys) return { severity: 'URGENT', message: `Tension basse : ${bp}` };
    if (r.systolic >= t.warnSys || r.diastolic >= t.warnDia) return { severity: 'WARNING', message: `Tension élevée : ${bp}` };
  }
  if (r.type === 'GLUCOSE' && r.value != null) {
    const t = THRESHOLDS.glucose;
    const g = `${String(r.value).replace('.', ',')} g/L`;
    if (r.value < t.urgentLow) return { severity: 'URGENT', message: `Hypoglycémie sévère : ${g}` };
    if (r.value > t.urgentHigh) return { severity: 'URGENT', message: `Glycémie très élevée : ${g}` };
    if (r.value < t.warnLow) return { severity: 'WARNING', message: `Hypoglycémie : ${g}` };
    if (r.value > t.warnHigh) return { severity: 'WARNING', message: `Glycémie élevée : ${g}` };
  }
  return null;
}

// Valeurs physiquement impossibles = erreur de saisie : refusées plutôt qu'enregistrées
export function implausible(r: ReadingInput): string | null {
  if (r.type === 'BLOOD_PRESSURE') {
    if (r.systolic == null || r.diastolic == null) return 'Saisissez la systolique et la diastolique';
    if (r.systolic < 50 || r.systolic > 300 || r.diastolic < 30 || r.diastolic > 200) return 'Tension hors des valeurs possibles';
    if (r.diastolic >= r.systolic) return 'La diastolique doit être inférieure à la systolique';
  }
  if (r.type === 'GLUCOSE' && (r.value == null || r.value < 0.1 || r.value > 8)) return 'Glycémie hors des valeurs possibles (en g/L)';
  if (r.type === 'WEIGHT' && (r.value == null || r.value < 20 || r.value > 300)) return 'Poids hors des valeurs possibles (en kg)';
  return null;
}
