// Lecture des messages des parents, heures de prise, rédaction du compte rendu : fonctions pures.
import { parseAssistantJson } from '../src/whatsapp/assistant';
import { intentOf, mentionsMedical, parseReadings } from '../src/whatsapp/parse';
import { waPhone } from '../src/whatsapp/phone';
import { buildReport, monthStart, previousMonth } from '../src/whatsapp/reports.service';
import { doualaClock, guessTimes } from '../src/whatsapp/schedule';

const ok = (text: string) => parseReadings(text).filter((r) => r.ok).map((r) => (r as { reading: unknown }).reading);

describe('lecture des relevés', () => {
  it.each([
    ['13/8', 130, 80],
    ['ma tension 14/9 ce matin', 140, 90],
    ['13,5/8,5', 135, 85],
    ['135/85', 135, 85],
    ['tension 16 10', 160, 100],
    ['Tension: 12 sur 7', 120, 70],
    ['140x90', 140, 90],
  ])('tension « %s » → %i/%i mmHg', (text, systolic, diastolic) => {
    expect(ok(text)).toEqual([{ type: 'BLOOD_PRESSURE', systolic, diastolic }]);
  });

  it.each([
    ['glycémie 1,2', 1.2],
    ['Glycemie 0.65', 0.65],
    ['sucre 120', 1.2],
    ['gly 98 mg', 0.98],
    ['glucose: 2,4 g/l', 2.4],
  ])('glycémie « %s » → %d g/L', (text, value) => {
    expect(ok(text)).toEqual([{ type: 'GLUCOSE', value }]);
  });

  it('demande l’unité quand la glycémie est ambiguë (mmol/L ou valeur entre 5 et 20)', () => {
    expect(parseReadings('glycémie 7')[0]).toMatchObject({ ok: false });
    expect(parseReadings('glycemie 6.5 mmol')[0]).toMatchObject({ ok: false });
  });

  it('lit plusieurs mesures dans le même message, et le poids', () => {
    expect(ok('13/8 et glycémie 1,1, poids 72')).toEqual([
      { type: 'BLOOD_PRESSURE', systolic: 130, diastolic: 80 },
      { type: 'GLUCOSE', value: 1.1 },
      { type: 'WEIGHT', value: 72 },
    ]);
    expect(ok('je pèse 68,5 kg')).toEqual([{ type: 'WEIGHT', value: 68.5 }]);
  });

  it('ne voit pas de mesure dans une phrase ordinaire', () => {
    expect(parseReadings('Bonjour, le docteur passe quand ?')).toEqual([]);
    expect(parseReadings('merci beaucoup')).toEqual([]);
  });
});

describe('intentions', () => {
  it.each([
    ["J'ai fait un malaise", 'EMERGENCY'],
    ['douleur à la poitrine depuis ce matin', 'EMERGENCY'],
    ["je n'arrive plus à respirer", 'EMERGENCY'],
    ['Maman est tombée', 'EMERGENCY'], // une chute chez une personne âgée : on alerte
    ['la pluie tombe fort', 'OTHER'],
    ['elle est tombée dans la cuisine', 'EMERGENCY'],
    ['STOP', 'STOP'],
    ['Reprendre', 'START'],
    ['Oui', 'YES'],
    ['ok', 'TAKEN'],
    ["c'est pris merci", 'TAKEN'],
    ['Bonjour', 'GREETING'],
    ['menu', 'HELP'],
    ['Quand est mon prochain rendez-vous ?', 'NEXT_APPOINTMENT'],
    ['le livreur arrive quand', 'DELIVERY'],
    ['combien je dois payer', 'BILLING'],
    ["j'ai mal à la tête", 'MEDICAL'],
    ["j'ai oublié mon comprimé hier, je double ?", 'MEDICAL'],
    ['Le temps est beau à Douala', 'OTHER'],
  ])('« %s » → %s', (text, intent) => {
    expect(intentOf(text)).toBe(intent);
  });

  it('« prise de sang » n’est pas une urgence', () => {
    expect(intentOf('la prise de sang est à quelle heure ?')).not.toBe('EMERGENCY');
  });

  it('repère un symptôme glissé avec une mesure, mais pas le mot « tension » seul', () => {
    expect(mentionsMedical('tension 13/8 et j’ai des vertiges')).toBe(true);
    expect(mentionsMedical('tension 13/8')).toBe(false);
    expect(mentionsMedical('résultat normal')).toBe(false);
  });
});

describe('numéros et heures', () => {
  it('normalise les numéros pour WhatsApp', () => {
    expect(waPhone('+237 6 77 12 34 56')).toBe('237677123456');
    expect(waPhone('677123456')).toBe('237677123456');
    expect(waPhone('06 12 34 56 78')).toBe('33612345678');
    expect(waPhone('0033 6 12 34 56 78')).toBe('33612345678');
    expect(waPhone('')).toBeNull();
  });

  it('devine les heures de prise depuis la posologie', () => {
    expect(guessTimes('1 cp matin et soir')).toEqual(['08:00', '20:00']);
    expect(guessTimes('1 comprimé le midi')).toEqual(['13:00']);
    expect(guessTimes('3 fois par jour')).toEqual(['08:00', '13:00', '20:00']);
    expect(guessTimes('2x/j')).toEqual(['08:00', '20:00']);
    expect(guessTimes('1 par jour')).toEqual(['08:00']);
    expect(guessTimes('au coucher')).toEqual(['21:00']);
    expect(guessTimes('si douleur')).toEqual([]);
    expect(guessTimes(undefined)).toEqual([]);
  });

  it("donne l'heure de Douala (UTC+1)", () => {
    expect(doualaClock(new Date('2026-11-01T07:05:00Z'))).toEqual({ date: '2026-11-01', minutes: 8 * 60 + 5 });
    expect(doualaClock(new Date('2026-10-31T23:30:00Z'))).toEqual({ date: '2026-11-01', minutes: 30 });
  });

  it('calcule le mois précédent et son début en heure du Cameroun', () => {
    expect(previousMonth(new Date('2026-11-01T05:00:00Z'))).toBe('2026-10');
    expect(previousMonth(new Date('2026-01-01T05:00:00Z'))).toBe('2025-12');
    expect(monthStart('2026-10').toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });
});

describe('assistant', () => {
  it('lit la réponse JSON et refuse toute réponse quand la question est médicale', () => {
    expect(parseAssistantJson('{"medical": false, "answer": "Le livreur passe demain."}')).toEqual({ medical: false, answer: 'Le livreur passe demain.' });
    expect(parseAssistantJson('Voici : {"medical": true, "answer": "Prenez 2 comprimés"}')).toEqual({ medical: true, answer: null });
    expect(parseAssistantJson('je ne sais pas')).toEqual({ medical: false, answer: null });
  });
});

describe('compte rendu mensuel', () => {
  it('résume le mois en termes simples', () => {
    const text = buildReport({
      firstName: 'Marie',
      monthLabel: 'octobre 2026',
      consultations: [{ at: new Date('2026-10-12T09:00:00Z'), doctor: 'Mbarga', mode: 'PHONE', summary: 'Tension mieux contrôlée.' }],
      missedConsultations: 0,
      visits: [{ at: new Date('2026-10-20T09:00:00Z'), nurse: 'Brigitte', treatmentChecked: true }],
      bp: [
        { systolic: 130, diastolic: 80 },
        { systolic: 150, diastolic: 95 },
        { systolic: 140, diastolic: 85 },
      ],
      glucose: [1.1, 1.3],
      weight: [72, 71.5],
      alerts: { warning: 1, urgent: 0 },
      reminders: { sent: 60, confirmed: 51 },
      deliveries: 1,
      labs: [{ tests: ['HbA1c'], comment: 'Bon équilibre.' }],
      next: 'jeudi 12 novembre',
    });
    expect(text).toContain('Compte rendu de octobre 2026 pour Marie');
    expect(text).toContain('- 12 octobre, Dr Mbarga (téléphone) : Tension mieux contrôlée.');
    expect(text).toContain('visite à domicile de Brigitte, traitement vérifié');
    expect(text).toContain('- Tension : 3 mesures, moyenne 140/87 mmHg (de 130/80 à 150/95).');
    expect(text).toContain('- Glycémie : 2 mesures, moyenne 1,2 g/L (de 1,1 à 1,3 g/L).');
    expect(text).toContain('- Poids : de 72 kg à 71,5 kg.');
    expect(text).toContain('1 valeur a déclenché une alerte au médecin.');
    expect(text).toContain('51 sur 60 rappels (85 %)');
    expect(text).toContain('- HbA1c : Bon équilibre.');
    expect(text).toContain('Prochain rendez-vous : jeudi 12 novembre.');
  });

  it('reste lisible un mois sans activité', () => {
    const text = buildReport({
      firstName: 'Paul', monthLabel: 'mars 2026', consultations: [], missedConsultations: 1, visits: [], bp: [], glucose: [], weight: [],
      alerts: { warning: 0, urgent: 0 }, reminders: { sent: 0, confirmed: 0 }, deliveries: 0, labs: [], next: null,
    });
    expect(text).toContain('Pas de consultation ce mois-ci.');
    expect(text).toContain('1 consultation manquée, reprogrammée.');
    expect(text).toContain('Aucun relevé ce mois-ci.');
    expect(text).toContain('Prochain rendez-vous : à programmer.');
  });
});
