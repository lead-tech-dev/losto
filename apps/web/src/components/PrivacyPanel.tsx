import { useState } from 'react';
import { api, tokenStore } from '../api';

// Copie et effacement des données d'un parent : pour la famille titulaire (base « /patients/:id »)
// ou pour l'équipe (base « /admin/patients/:id »).
export async function downloadExport(base: string) {
  const res = await fetch(`/api${base}/privacy/export`, { headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}` } });
  if (!res.ok) throw new Error('Téléchargement impossible');
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'proche-sante.json';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PrivacyPanel({ base, firstName, onErased }: { base: string; firstName: string; onErased: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  async function erase() {
    setError('');
    try {
      await api(`${base}/privacy/erase`, { method: 'POST', body: JSON.stringify({ confirmFirstName: typed }) });
      onErased();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card">
      <h3>Données personnelles</h3>
      <p className="small">
        Vous pouvez obtenir une copie de tout ce que Proche Santé a enregistré pour {firstName}, ou demander son effacement.
      </p>
      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={() => downloadExport(base).catch((e) => setError(e.message))}>
          Télécharger une copie des données
        </button>
        {!confirming && (
          <button type="button" className="btn btn-ghost tone-danger" onClick={() => setConfirming(true)}>
            Effacer les données de {firstName}
          </button>
        )}
      </div>
      {confirming && (
        <div className="danger-zone stack-sm">
          <p className="small">
            <strong>Effacement définitif.</strong> Le dossier, les consultations, ordonnances, relevés, analyses, comptes rendus et
            messages WhatsApp de {firstName} seront supprimés et le suivi s'arrêtera aussitôt, sans remboursement du mois en cours.
            Les factures sont conservées, comme la loi l'impose, sans information de santé. Pensez à télécharger une copie avant.
          </p>
          <label>
            Pour confirmer, écrivez le prénom « {firstName} »
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={!typed.trim()} onClick={erase}>
              Effacer définitivement
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setConfirming(false); setTyped(''); }}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
