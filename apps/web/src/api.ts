// Petit client HTTP : ajoute le jeton de connexion et transforme les erreurs de l'API en messages lisibles.

export type Role = 'FAMILY' | 'DOCTOR' | 'NURSE' | 'PHARMACY' | 'COURIER' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  phone: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

const TOKEN_KEY = 'losto.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // NestJS renvoie { message: string | string[] } en cas d'erreur de validation
    const raw = body?.message;
    const message = Array.isArray(raw) ? raw.join(' · ') : raw ?? 'Une erreur est survenue';
    throw new ApiError(message, res.status);
  }
  return body as T;
}
