import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import Layout from '../../components/Layout';
import { CITY_LABELS, CONDITION_LABELS, fmtDate, fmtSlotCm, PLAN_LABELS, SUBSCRIPTION_STATUS } from '../../labels';
import { useApi } from '../../useApi';

interface Row {
  id: string;
  name: string;
  city: string;
  district: string;
  whatsappPhone: string;
  conditions: string[];
  consentGiven: boolean;
  whatsappOptOut: boolean;
  createdAt: string;
  family: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
  subscription: { status: string; plan: string; method: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  team: { doctorId: string | null; nurseId: string | null; pharmacyId: string | null; labId: string | null; doctor: string | null; nurse: string | null; pharmacy: string | null; lab: string | null };
  nextConsultation: string | null;
}

export default function AdminPatients() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const query = new URLSearchParams();
  for (const k of ['search', 'city', 'status']) if (params.get(k)) query.set(k, params.get(k)!);
  const { data, reload } = useApi<Row[]>(`/admin/patients?${query}`);
  const [open, setOpen] = useState<string | null>(null);

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    setFilter('search', search.trim());
  }

  return (
    <Layout>
      <h1>Parents suivis</h1>
      <form className="row align-end filters" onSubmit={submit}>
        <label>
          Rechercher
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom du parent, de la famille, téléphone, e-mail" />
        </label>
        <label className="narrow-wide">
          Ville
          <select value={params.get('city') ?? ''} onChange={(e) => setFilter('city', e.target.value)}>
            <option value="">Toutes</option>
            <option value="DOUALA">Douala</option>
            <option value="YAOUNDE">Yaoundé</option>
          </select>
        </label>
        <label className="narrow-wide">
          Abonnement
          <select value={params.get('status') ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">Tous</option>
            {Object.entries(SUBSCRIPTION_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn">Filtrer</button>
      </form>

      <p className="muted small">{data ? `${data.length} parent${data.length > 1 ? 's' : ''}` : 'Chargement…'}</p>
      <div className="stack-sm">
        {data?.map((r) => (
          <article key={r.id} className="card patient-row">
            <button type="button" className="patient-head" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              <span>
                <strong>{r.name}</strong>
                <span className="muted small"> · {r.district}, {CITY_LABELS[r.city]} · {r.conditions.map((c) => CONDITION_LABELS[c]).join(', ')}</span>
              </span>
              <span className="row-tags">
                {r.subscription ? (
                  <span className={`badge ${SUBSCRIPTION_STATUS[r.subscription.status].tone === 'ok' ? '' : SUBSCRIPTION_STATUS[r.subscription.status].tone === 'warn' ? 'badge-warn' : 'badge-muted'}`}>
                    {PLAN_LABELS[r.subscription.plan]} · {SUBSCRIPTION_STATUS[r.subscription.status].label}
                  </span>
                ) : (
                  <span className="badge badge-muted">Sans formule</span>
                )}
                {!r.consentGiven && <span className="badge badge-warn">Accord manquant</span>}
                {r.whatsappOptOut && <span className="badge badge-muted">STOP WhatsApp</span>}
              </span>
            </button>
            <div className="patient-grid small">
              <div>
                <span className="muted">Famille</span>
                {r.family.firstName} {r.family.lastName}
                <br />
                <a href={`mailto:${r.family.email}`}>{r.family.email}</a>
                {r.family.phone && <a href={`tel:${r.family.phone}`}>{r.family.phone}</a>}
              </div>
              <div>
                <span className="muted">Parent</span>
                <a href={`tel:${r.whatsappPhone}`}>{r.whatsappPhone}</a>
                <br />
                inscrit le {fmtDate(r.createdAt)}
              </div>
              <div>
                <span className="muted">Équipe</span>
                {[r.team.doctor ?? 'sans médecin', r.team.nurse, r.team.pharmacy ?? 'sans pharmacie', r.team.lab].filter(Boolean).join(' · ')}
              </div>
              <div>
                <span className="muted">Prochaine consultation</span>
                {r.nextConsultation ? fmtSlotCm(r.nextConsultation) : '—'}
                {r.subscription?.periodEnd && (
                  <>
                    <br />
                    payé jusqu'au {fmtDate(r.subscription.periodEnd)}
                    {r.subscription.cancelAtPeriodEnd && ' (résiliation demandée)'}
                  </>
                )}
              </div>
            </div>
            {open === r.id && <TeamEditor row={r} onSaved={reload} />}
          </article>
        ))}
      </div>
    </Layout>
  );
}

const TEAM: { key: 'doctorId' | 'nurseId' | 'pharmacyId' | 'labId'; role: string; label: string }[] = [
  { key: 'doctorId', role: 'DOCTOR', label: 'Médecin' },
  { key: 'nurseId', role: 'NURSE', label: 'Infirmier(e)' },
  { key: 'pharmacyId', role: 'PHARMACY', label: 'Pharmacie' },
  { key: 'labId', role: 'LAB', label: 'Laboratoire' },
];

// Changer l'équipe d'un parent : partenaires vérifiés de sa ville, avec leur charge actuelle
function TeamEditor({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const [options, setOptions] = useState<Record<string, { id: string; name: string; patients: number }[]>>({});
  const [team, setTeam] = useState({ doctorId: row.team.doctorId ?? '', nurseId: row.team.nurseId ?? '', pharmacyId: row.team.pharmacyId ?? '', labId: row.team.labId ?? '' });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all(TEAM.map((t) => api<{ id: string; name: string; patients: number }[]>(`/admin/partners?city=${row.city}&role=${t.role}`).then((l) => [t.role, l] as const)))
      .then((all) => setOptions(Object.fromEntries(all)))
      .catch((e) => setMsg(e.message));
  }, [row.city]);

  async function save() {
    setMsg('');
    try {
      await api(`/admin/patients/${row.id}/care-team`, {
        method: 'PATCH',
        body: JSON.stringify(Object.fromEntries(Object.entries(team).map(([k, v]) => [k, v || null]))),
      });
      setMsg('Équipe enregistrée.');
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="team-editor">
      <div className="row align-end">
        {TEAM.map((t) => (
          <label key={t.key} className="narrow-wide">
            {t.label}
            <select value={team[t.key]} onChange={(e) => setTeam({ ...team, [t.key]: e.target.value })}>
              <option value="">— Aucun —</option>
              {(options[t.role] ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.patients} parent{o.patients > 1 ? 's' : ''})
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="button" className="btn" onClick={save}>Enregistrer l'équipe</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
