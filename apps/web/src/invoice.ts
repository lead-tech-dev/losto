import { tokenStore } from './api';

// Télécharge la facture PDF (la route exige le jeton de connexion, d'où le passage par fetch).
export async function downloadInvoice(paymentId: string, invoiceNumber: string) {
  const res = await fetch(`/api/payments/${paymentId}/invoice`, {
    headers: { Authorization: `Bearer ${tokenStore.get()}` },
  });
  if (!res.ok) throw new Error('Facture indisponible');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `facture-${invoiceNumber}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
