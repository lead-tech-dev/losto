// "  Deïdo " → "deido", "Biyem-Assi" → "biyem assi" : pour comparer des noms de quartier saisis librement.
export function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Numéro camerounais : accepte "6 77 12 34 56", "+237677123456", "237 677..." → "+237677123456"
export const CAMEROON_PHONE = /^(\+?237)?[ ]?[26]([ .-]?\d){8}$/;

export function normalizeCameroonPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('237') ? digits.slice(3) : digits;
  return `+237${local}`;
}
