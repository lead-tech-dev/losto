import { useState } from 'react';
import Layout from '../../components/Layout';
import LineChart from '../../components/LineChart';
import { fmtXaf } from '../../labels';
import { useApi } from '../../useApi';
import { eur, monthLabel, pct } from './common';

interface Month {
  month: string;
  signups: number;
  conversionRate: number | null;
  activations: number;
  activeEnd: number;
  revenueEur: number;
  partnerCostEur: number;
  whatsappCostEur: number;
  marginEur: number;
  revenuePerClientEur: number | null;
  costPerClientEur: number | null;
  marginPerClientEur: number | null;
}
interface Metrics {
  months: Month[];
  cohorts: { month: string; size: number; m1: number | null; m3: number | null; m6: number | null }[];
  rates: { initialConsultation: number; consultation: number; homeVisit: number; delivery: number; failedDelivery: number; homeSampling: number; whatsappMessage: number };
}

const short = (ym: string) => new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${ym}-15T00:00:00Z`));

// Les chiffres du test : le service trouve-t-il ses clients, les garde-t-il, gagne-t-il de l'argent ?
export default function AdminMetrics() {
  const [n, setN] = useState(6);
  const { data } = useApi<Metrics>(`/admin/metrics?months=${n}`);

  return (
    <Layout>
      <div className="page-head">
        <h1>Indicateurs du test</h1>
        <div className="segmented" role="group" aria-label="Période">
          {[3, 6, 12].map((x) => (
            <button key={x} type="button" className={n === x ? 'on' : ''} onClick={() => setN(x)}>{x} mois</button>
          ))}
        </div>
      </div>
      {!data && <p className="muted">Chargement…</p>}
      {data && (
        <>
          <section className="card">
            <h2>Parents suivis et revenu</h2>
            <div className="chart-pair">
              <div className="chart-block">
                <h4>Parents suivis en fin de mois</h4>
                <LineChart unit="parents" series={[{ name: 'Parents suivis', color: '#0E5A43', points: data.months.map((m) => ({ date: `${m.month}-15`, value: m.activeEnd })) }]} />
              </div>
              <div className="chart-block">
                <h4>Revenu et marge (€)</h4>
                <LineChart
                  unit="€"
                  series={[
                    { name: 'Revenu', color: '#0E5A43', points: data.months.map((m) => ({ date: `${m.month}-15`, value: m.revenueEur })) },
                    { name: 'Marge', color: '#C2693E', points: data.months.map((m) => ({ date: `${m.month}-15`, value: m.marginEur })) },
                  ]}
                />
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Mois par mois</h2>
            <div className="table-wrap">
              <table className="metrics">
                <thead>
                  <tr>
                    <th></th>
                    {data.months.map((m) => <th key={m.month} className="num">{short(m.month)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <Row label="Inscriptions" values={data.months.map((m) => String(m.signups))} />
                  <Row label="… dont ont payé" values={data.months.map((m) => pct(m.conversionRate))} hint="Part des parents inscrits ce mois-là qui ont payé un abonnement depuis" />
                  <Row label="Premiers paiements" values={data.months.map((m) => String(m.activations))} />
                  <Row label="Parents suivis (fin de mois)" values={data.months.map((m) => String(m.activeEnd))} strong />
                  <Row label="Revenu abonnements" values={data.months.map((m) => eur(m.revenueEur))} strong />
                  <Row label="Coût partenaires" values={data.months.map((m) => eur(m.partnerCostEur))} />
                  <Row label="Coût WhatsApp (estimé)" values={data.months.map((m) => eur(m.whatsappCostEur))} />
                  <Row label="Marge" values={data.months.map((m) => eur(m.marginEur))} strong tone={data.months.map((m) => m.marginEur < 0)} />
                  <Row label="Revenu par parent" values={data.months.map((m) => eur(m.revenuePerClientEur))} />
                  <Row label="Coût par parent" values={data.months.map((m) => eur(m.costPerClientEur))} />
                  <Row label="Marge par parent" values={data.months.map((m) => eur(m.marginPerClientEur))} strong tone={data.months.map((m) => (m.marginPerClientEur ?? 0) < 0)} />
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Fidélité</h2>
            <p className="muted small">Pour les parents ayant payé pour la première fois un mois donné : part encore suivie 1, 3 et 6 mois plus tard (— : trop tôt pour le savoir).</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Premier paiement</th>
                    <th className="num">Parents</th>
                    <th className="num">À 1 mois</th>
                    <th className="num">À 3 mois</th>
                    <th className="num">À 6 mois</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.filter((c) => c.size > 0).map((c) => (
                    <tr key={c.month}>
                      <td>{monthLabel(c.month)}</td>
                      <td className="num">{c.size}</td>
                      <td className="num">{pct(c.m1)}</td>
                      <td className="num">{pct(c.m3)}</td>
                      <td className="num">{pct(c.m6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.cohorts.every((c) => c.size === 0) && <p className="muted">Aucun premier paiement sur la période.</p>}
            </div>
          </section>

          <p className="muted small">
            Coûts calculés avec les tarifs partenaires : bilan de départ {fmtXaf(data.rates.initialConsultation)}, consultation {fmtXaf(data.rates.consultation)},
            visite {fmtXaf(data.rates.homeVisit)}, livraison {fmtXaf(data.rates.delivery)} (passage manqué {fmtXaf(data.rates.failedDelivery)}),
            prise de sang à domicile {fmtXaf(data.rates.homeSampling)}, message WhatsApp {fmtXaf(data.rates.whatsappMessage)}. Les médicaments, payés
            par les familles et reversés aux pharmacies, ne comptent ni dans le revenu ni dans les coûts. Frais Stripe et Tranzak non déduits.
          </p>
        </>
      )}
    </Layout>
  );
}

function Row({ label, values, hint, strong, tone }: { label: string; values: string[]; hint?: string; strong?: boolean; tone?: boolean[] }) {
  return (
    <tr className={strong ? 'strong' : ''}>
      <th scope="row" title={hint}>{label}</th>
      {values.map((v, i) => <td key={i} className={`num ${tone?.[i] ? 'tone-danger' : ''}`}>{v}</td>)}
    </tr>
  );
}
