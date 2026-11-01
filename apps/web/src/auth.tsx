import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, AuthResponse, tokenStore, User } from './api';

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  acceptTerms: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Garde l'utilisateur connecté en mémoire pour toute l'appli.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Au chargement : si un jeton est enregistré, on demande à l'API qui est connecté.
  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const handleAuth = useCallback((res: AuthResponse) => {
    tokenStore.set(res.accessToken);
    setUser(res.user);
    return res.user;
  }, []);

  const login = useCallback(
    (email: string, password: string) =>
      api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }).then(handleAuth),
    [handleAuth],
  );

  const register = useCallback(
    (input: RegisterInput) =>
      api<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(input) }).then(handleAuth),
    [handleAuth],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
