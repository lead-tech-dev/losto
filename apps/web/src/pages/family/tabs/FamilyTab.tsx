import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api';
import { fmtDate } from '../../../labels';
import { Members, PatientDetail } from '../../../types';
import { useApi } from '../../../useApi';

export default function FamilyTab({ patient }: { patient: PatientDetail }) {
  const navigate = useNavigate();
  const { data, reload } = useApi<Members>(`/patients/${patient.id}/members`);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const isOwner = patient.role === 'OWNER';

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    try {
      await api(`/patients/${patient.id}/invitations`, { method: 'POST', body: JSON.stringify({ email }) });
      setInfo(`Invitation envoyée à ${email}.`);
      setEmail('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function run(path: string, then?: () => void) {
    setError('');
    try {
      await api(path, { method: 'DELETE' });
      then ? then() : reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!data) return <p className="muted">Chargement…</p>;

  return (
    <div className="stack">
      <section className="card">
        <h3>Qui suit {patient.firstName}</h3>
        <ul className="people">
          <li>
            <span>
              <strong>{data.owner.name}</strong> {data.owner.email && <span className="muted">· {data.owner.email}</span>}
            </span>
            <span className="badge">Titulaire</span>
          </li>
          {data.members.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.name}</strong> {m.email && <span className="muted">· {m.email}</span>}
              </span>
              {isOwner && (
                <button type="button" className="btn btn-ghost btn-small" onClick={() => run(`/patients/${patient.id}/members/${m.id}`)}>
                  Retirer
                </button>
              )}
            </li>
          ))}
          {data.pendingInvitations.map((inv) => (
            <li key={inv.id}>
              <span>
                {inv.email} <span className="muted small">· invitation valable jusqu'au {fmtDate(inv.expiresAt)}</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => run(`/patients/${patient.id}/invitations/${inv.id}`)}
              >
                Annuler
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Les proches invités voient le suivi (consultations, relevés, comptes rendus) mais ne peuvent ni modifier le
          dossier ni changer la formule.
        </p>
        {error && <p className="error">{error}</p>}
      </section>

      {isOwner ? (
        <form className="card" onSubmit={invite}>
          <h3>Inviter un membre de la famille</h3>
          <div className="row align-end">
            <label>
              Son adresse e-mail
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="frere@exemple.fr" />
            </label>
            <button type="submit" className="btn">
              Envoyer l'invitation
            </button>
          </div>
          {info && <p className="success">{info}</p>}
        </form>
      ) : (
        <section className="card">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => run(`/patients/${patient.id}/members/me`, () => navigate('/'))}
          >
            Ne plus suivre {patient.firstName}
          </button>
        </section>
      )}
    </div>
  );
}
