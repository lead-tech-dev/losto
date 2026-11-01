// Heures de prise des médicaments et créneaux de rappel. Fonctions pures (heure du Cameroun, UTC+1 toute l'année).
import { DOUALA_OFFSET_MIN } from '../care/care-time';
import { simplify } from './parse';

export const SLOT_TIMES = { matin: '08:00', midi: '13:00', soir: '20:00', coucher: '21:00' } as const;

// Devine les heures à partir de la posologie écrite par le médecin, quand il ne les a pas cochées.
// « 1 cp matin et soir » → 08:00, 20:00 ; « 3 fois par jour » → 08:00, 13:00, 20:00 ; rien de clair → aucun rappel.
export function guessTimes(dosage: string | null | undefined): string[] {
  if (!dosage) return [];
  const t = simplify(dosage);
  const out = new Set<string>();
  if (/\bmatin\b/.test(t)) out.add(SLOT_TIMES.matin);
  if (/\bmidi\b|\bdejeuner\b/.test(t)) out.add(SLOT_TIMES.midi);
  if (/\bsoir\b|\bdiner\b/.test(t)) out.add(SLOT_TIMES.soir);
  if (/\bcoucher\b|\bnuit\b/.test(t)) out.add(SLOT_TIMES.coucher);
  if (!out.size) {
    const n = t.match(/(\d)\s*(?:fois|x|prises?)\s*(?:par|\/)\s*(?:jour|j)\b|(\d)\s*\/\s*j\b/);
    const times = Number(n?.[1] ?? n?.[2] ?? 0) || (/\b(par jour|chaque jour|\/ ?j)\b/.test(t) ? 1 : 0);
    if (times === 1) out.add(SLOT_TIMES.matin);
    if (times === 2) [SLOT_TIMES.matin, SLOT_TIMES.soir].forEach((x) => out.add(x));
    if (times >= 3) [SLOT_TIMES.matin, SLOT_TIMES.midi, SLOT_TIMES.soir].forEach((x) => out.add(x));
  }
  return [...out].sort();
}

export const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function momentLabel(time: string): string {
  const h = Number(time.slice(0, 2));
  return h < 11 ? 'matin' : h < 16 ? 'midi' : 'soir';
}

// Heure locale de Douala : { date: '2026-11-01', minutes: 485 }
export function doualaClock(now: Date): { date: string; minutes: number } {
  const local = new Date(now.getTime() + DOUALA_OFFSET_MIN * 60_000);
  return { date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Le rappel part dans la demi-heure qui suit l'heure prévue (la tâche tourne toutes les 5 minutes)
export const REMINDER_WINDOW_MIN = 30;
