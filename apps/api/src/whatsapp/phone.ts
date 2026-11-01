// Numéro au format WhatsApp : chiffres seulement, indicatif compris (« +237 6 77 12 34 56 » → « 237677123456 »).
// Sans indicatif : 9 chiffres = Cameroun, 10 chiffres commençant par 0 = France.
export function waPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  else if (!trimmed.startsWith('+') && digits.length === 9) digits = `237${digits}`; // 6 77 12 34 56
  else if (!trimmed.startsWith('+') && digits.length === 10 && digits.startsWith('0')) digits = `33${digits.slice(1)}`; // 06 12 34 56 78
  return digits.length >= 8 ? digits : null;
}
