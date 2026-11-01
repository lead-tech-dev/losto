// Calcul des créneaux. Le Cameroun est en UTC+1 toute l'année (pas d'heure d'été) :
// une heure locale se convertit toujours en UTC en retirant 60 minutes.

export const DOUALA_OFFSET_MIN = 60;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export interface WeeklySlot {
  weekday: number; // 1 = lundi ... 7 = dimanche
  startMinute: number; // 540 = 9 h 00, heure du Cameroun
  endMinute: number;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

// Jour de la semaine (1-7) et minuit local, pour un instant donné
function localDay(t: number) {
  const local = new Date(t + DOUALA_OFFSET_MIN * MIN);
  const midnightLocalAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return {
    weekday: ((local.getUTCDay() + 6) % 7) + 1,
    // minuit local exprimé en UTC
    midnightUtc: midnightLocalAsUtc - DOUALA_OFFSET_MIN * MIN,
  };
}

// Premier créneau libre de `durationMinutes`, au plus tôt à `from`, dans les `horizonDays` jours suivants.
// Les créneaux démarrent sur une grille du pas de la durée à partir du début de chaque disponibilité.
// Exemple : disponibilité lundi 9 h-12 h, durée 20 min → 9 h 00, 9 h 20, 9 h 40... 11 h 40.
export function findFreeSlot(
  availability: WeeklySlot[],
  busy: BusyInterval[],
  from: Date,
  durationMinutes: number,
  horizonDays = 21,
): Date | null {
  if (availability.length === 0) return null;
  const sorted = [...availability].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  const dur = durationMinutes * MIN;

  for (let i = 0; i <= horizonDays; i++) {
    const { weekday, midnightUtc } = localDay(from.getTime() + i * DAY);
    for (const slot of sorted.filter((s) => s.weekday === weekday)) {
      for (let m = slot.startMinute; m + durationMinutes <= slot.endMinute; m += durationMinutes) {
        const start = midnightUtc + m * MIN;
        if (start < from.getTime()) continue;
        const end = start + dur;
        const overlaps = busy.some((b) => start < b.end.getTime() && end > b.start.getTime());
        if (!overlaps) return new Date(start);
      }
    }
  }
  return null;
}

// "lundi 9 h 00" → pour les messages
export function fmtLocal(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Douala',
  }).format(d);
}
