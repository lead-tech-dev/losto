import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

// Charge une ressource de l'API ; reload() la recharge après une modification.
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(() => {
    if (!path) return Promise.resolve();
    setLoading(true);
    return api<T>(path)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
