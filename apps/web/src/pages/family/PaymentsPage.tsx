import Layout from '../../components/Layout';
import PaymentsTable from '../../components/PaymentsTable';
import { PaymentView } from '../../types';
import { useApi } from '../../useApi';

export default function PaymentsPage() {
  const { data, error } = useApi<PaymentView[]>('/payments');
  return (
    <Layout>
      <h1>Paiements et factures</h1>
      <section className="card">
        {error && <p className="error">{error}</p>}
        {data ? <PaymentsTable payments={data} showPatient /> : <p className="muted">Chargement…</p>}
      </section>
    </Layout>
  );
}
