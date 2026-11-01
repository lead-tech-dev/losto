import { PLANS } from '../labels';

export default function PlanPicker({ value, onChange }: { value: string; onChange: (plan: string) => void }) {
  return (
    <fieldset className="plans">
      <legend className="sr-only">Formule</legend>
      {PLANS.map((p) => (
        <label key={p.id} className={`plan ${value === p.id ? 'on' : ''}`}>
          <input type="radio" name="plan" checked={value === p.id} onChange={() => onChange(p.id)} />
          <span className="plan-name">{p.name}</span>
          <span className="plan-price">
            {p.price} € <small>/ mois</small>
          </span>
          <ul>
            {p.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </label>
      ))}
    </fieldset>
  );
}
