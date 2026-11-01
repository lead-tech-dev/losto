import { api } from '../../api';
import Layout from '../../components/Layout';
import Thread from '../../components/Thread';
import { Message } from '../../types';
import { useApi } from '../../useApi';

export default function MessagesPage() {
  const { data, setData } = useApi<Message[]>('/messages');

  return (
    <Layout>
      <h1>Messages</h1>
      <p className="muted">
        Une question sur le suivi, une livraison, un paiement ? L'équipe vous répond ici. Pour une urgence médicale,
        appelez les secours au Cameroun.
      </p>
      <section className="card">
        {data && (
          <Thread
            messages={data}
            mine="family"
            placeholder="Écrivez votre message…"
            onSend={async (body) => {
              const m = await api<Message>('/messages', { method: 'POST', body: JSON.stringify({ body }) });
              setData([...data, m]);
            }}
          />
        )}
      </section>
    </Layout>
  );
}
