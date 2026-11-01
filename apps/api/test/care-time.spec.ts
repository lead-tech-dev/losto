// Recherche de créneau libre : heure du Cameroun (UTC+1), grille, chevauchements.
import { findFreeSlot } from '../src/care/care-time';
import { evaluateReading, implausible } from '../src/care/thresholds';

// Lundi 2 novembre 2026, 8 h 00 heure du Cameroun = 7 h 00 UTC
const MONDAY_8H = new Date('2026-11-02T07:00:00Z');
const mondayMorning = [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }]; // lundi 9 h-12 h

describe('findFreeSlot', () => {
  it('prend le premier créneau de la disponibilité, converti en UTC', () => {
    // 9 h 00 au Cameroun = 8 h 00 UTC
    expect(findFreeSlot(mondayMorning, [], MONDAY_8H, 20)?.toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('saute les créneaux déjà pris', () => {
    const busy = [{ start: new Date('2026-11-02T08:00:00Z'), end: new Date('2026-11-02T08:40:00Z') }];
    expect(findFreeSlot(mondayMorning, busy, MONDAY_8H, 20)?.toISOString()).toBe('2026-11-02T08:40:00.000Z');
  });

  it("n'utilise pas un créneau qui déborde de la disponibilité", () => {
    // 9 h-9 h 30 ne contient pas de créneau de 45 min : on passe au lundi suivant
    const short = [{ weekday: 1, startMinute: 540, endMinute: 570 }];
    expect(findFreeSlot(short, [], MONDAY_8H, 45)).toBeNull();
  });

  it('passe à la semaine suivante quand le créneau du jour est déjà passé', () => {
    const lundi13h = new Date('2026-11-02T12:00:00Z');
    expect(findFreeSlot(mondayMorning, [], lundi13h, 20)?.toISOString()).toBe('2026-11-09T08:00:00.000Z');
  });

  it('gère le dimanche (7) et plusieurs plages', () => {
    const slots = [
      { weekday: 7, startMinute: 600, endMinute: 660 },
      { weekday: 3, startMinute: 900, endMinute: 960 },
    ];
    // Prochain : mercredi 4 novembre 15 h au Cameroun = 14 h UTC
    expect(findFreeSlot(slots, [], MONDAY_8H, 30)?.toISOString()).toBe('2026-11-04T14:00:00.000Z');
  });

  it('sans disponibilité, ne trouve rien', () => {
    expect(findFreeSlot([], [], MONDAY_8H, 20)).toBeNull();
  });
});

describe('Seuils des relevés', () => {
  it('classe la tension', () => {
    expect(evaluateReading({ type: 'BLOOD_PRESSURE', systolic: 135, diastolic: 85 })).toBeNull();
    expect(evaluateReading({ type: 'BLOOD_PRESSURE', systolic: 165, diastolic: 95 })?.severity).toBe('WARNING');
    expect(evaluateReading({ type: 'BLOOD_PRESSURE', systolic: 150, diastolic: 112 })?.severity).toBe('URGENT');
    expect(evaluateReading({ type: 'BLOOD_PRESSURE', systolic: 85, diastolic: 55 })?.message).toMatch(/basse/);
  });

  it('classe la glycémie', () => {
    expect(evaluateReading({ type: 'GLUCOSE', value: 1.1 })).toBeNull();
    expect(evaluateReading({ type: 'GLUCOSE', value: 0.65 })?.severity).toBe('WARNING');
    expect(evaluateReading({ type: 'GLUCOSE', value: 0.5 })?.severity).toBe('URGENT');
    expect(evaluateReading({ type: 'GLUCOSE', value: 3.4 })?.message).toBe('Glycémie très élevée : 3,4 g/L');
  });

  it('refuse les valeurs impossibles (erreur de saisie)', () => {
    expect(implausible({ type: 'BLOOD_PRESSURE', systolic: 80, diastolic: 120 })).toMatch(/inférieure/);
    expect(implausible({ type: 'GLUCOSE', value: 110 })).toMatch(/g\/L/); // saisi en mg/dL par erreur
    expect(implausible({ type: 'BLOOD_PRESSURE', systolic: 140, diastolic: 90 })).toBeNull();
  });
});
