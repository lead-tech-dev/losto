import { useState } from 'react';
import { api } from '../api';
import Layout from '../components/Layout';
import Thread from '../components/Thread';
import { Message } from '../types';
import { useApi } from '../useApi';

interface ThreadSummary {
  familyUserId: string;
  firstName: string;
  lastName: string;
  email: string;
  lastAt: string;
  unread: number;
}

interface FullThread {
  family: { id: string; firstName: string; lastName: string; email: string };
  messages: Message[];
}

export default function AdminMessages() {
  const threads = useApi<ThreadSummary[]>('/admin/messages');
  const [selected, setSelected] = useState<string | null>(null);
  const thread = useApi<FullThread>(selected ? `/admin/messages/${selected}` : null);

  return (
    <Layout>
      <h1>Messages des familles</h1>
      <div className="split">
        <section className="card thread-index">
          {threads.data?.length === 0 && <p className="muted small">Aucun message.</p>}
          {threads.data?.map((t) => (
            <button
              key={t.familyUserId}
              type="button"
              className={`thread-item ${selected === t.familyUserId ? 'on' : ''}`}
              onClick={() => {
                setSelected(t.familyUserId);
                // le fil devient lu à l'ouverture : on rafraîchit les compteurs
                setTimeout(() => threads.reload(), 300);
              }}
            >
              <span>
                <strong>
                  {t.firstName} {t.lastName}
                </strong>
                <span className="muted small"> · {t.email}</span>
              </span>
              {t.unread > 0 && <span className="badge">{t.unread}</span>}
            </button>
          ))}
        </section>
        <section className="card grow">
          {!selected && <p className="muted">Choisissez une conversation.</p>}
          {selected && thread.data && (
            <>
              <h2>
                {thread.data.family.firstName} {thread.data.family.lastName}
              </h2>
              <Thread
                messages={thread.data.messages}
                mine="team"
                placeholder="Votre réponse…"
                onSend={async (body) => {
                  await api(`/admin/messages/${selected}`, { method: 'POST', body: JSON.stringify({ body }) });
                  thread.reload();
                  threads.reload();
                }}
              />
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}
