import { useState } from 'react';
import Layout from '../../components/Layout';
import { fmtDate, fmtXaf } from '../../labels';
import { useApi } from '../../useApi';
import { Lines, StatementView } from '../admin/AdminPayouts';
import { monthLabel, thisMonth } from '../admin/common';

// Relevé du partenaire : ses actes du mois, ce que Proche Santé lui doit et ce qui a été versé
export default function MyStatement() {
  const [month, setMonth] = useState(thisMonth());
  const { data } = useApi<StatementView>(`/me/statement?month=${month}`);
  return (
    <Layout>
      <div className="page-head">
        <h1>Mes relevés</h1>
        <label className="narrow-wide">
          Mois
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
      </div>
      {data && (
        <section className="card">
          <div className="payout-head">
            <h2>{monthLabel(month)}</h2>
            <span className="payout-amount">{fmtXaf(data.totalXaf)}</span>
          </div>
          <p className="small">
            {data.payout
              ? `Versé le ${fmtDate(data.payout.paidAt)} : ${fmtXaf(data.payout.amountXaf)}${data.payout.reference ? ` (référence ${data.payout.reference})` : ''}.`
              : data.lines.length
                ? 'Pas encore versé : le versement est fait au début du mois suivant.'
                : 'Aucun acte ce mois-ci.'}
          </p>
          {data.lines.length > 0 && <Lines lines={data.lines} />}
        </section>
      )}
    </Layout>
  );
}
