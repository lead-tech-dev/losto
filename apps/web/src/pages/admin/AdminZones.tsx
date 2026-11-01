import { FormEvent, useState } from 'react';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { useApi } from '../../useApi';

interface Zone {
  id: string;
  city: 'DOUALA' | 'YAOUNDE';
  district: string;
}

// Quartiers desservis : un parent hors zone peut s'inscrire mais pas activer son suivi
export default function AdminZones() {
  const { data, reload } = useApi<Zone[]>('/coverage/zones');
  const [city, setCity] = useState<'DOUALA' | 'YAOUNDE'>('DOUALA');
  const [district, setDistrict] = useState('');
  const [error, setError] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/admin/coverage-zones', { method: 'POST', body: JSON.stringify({ city, district }) });
      setDistrict('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove(z: Zone) {
    if (!window.confirm(`Retirer ${z.district} des quartiers desservis ?`)) return;
    await api(`/admin/coverage-zones/${z.id}`, { method: 'DELETE' }).catch((err) => setError(err.message));
    reload();
  }

  return (
    <Layout>
      <h1>Zones couvertes</h1>
      <form className="card row align-end" onSubmit={add}>
        <label className="narrow-wide">
          Ville
          <select value={city} onChange={(e) => setCity(e.target.value as 'DOUALA' | 'YAOUNDE')}>
            <option value="DOUALA">Douala</option>
            <option value="YAOUNDE">Yaoundé</option>
          </select>
        </label>
        <label>
          Quartier
          <input required value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Bonamoussadi" />
        </label>
        <button type="submit" className="btn">Ajouter</button>
        {error && <p className="error">{error}</p>}
      </form>
      <div className="file-grid">
        {(['DOUALA', 'YAOUNDE'] as const).map((c) => {
          const list = (data ?? []).filter((z) => z.city === c).sort((a, b) => a.district.localeCompare(b.district, 'fr'));
          return (
            <section key={c} className="card">
              <h2>{c === 'DOUALA' ? 'Douala' : 'Yaoundé'} ({list.length})</h2>
              {list.length === 0 && <p className="muted">Aucun quartier.</p>}
              <ul className="zones">
                {list.map((z) => (
                  <li key={z.id}>
                    {z.district}
                    <button type="button" className="link-btn small" onClick={() => remove(z)} aria-label={`Retirer ${z.district}`}>Retirer</button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Layout>
  );
}
