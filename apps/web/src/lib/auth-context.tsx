'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { LoginInput, MeResponse, RegisterInput } from '@agc/shared';
import { apiFetch, setAccessToken } from './api-client';

interface TokenResponse {
  access_token: string;
  access_expires_in: number;
}

interface AuthState {
  user: MeResponse | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const me = await apiFetch<MeResponse>('/auth/me');
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    // On mount: attempt /auth/me. If no in-memory access token, apiFetch will
    // hit /auth/refresh via the cookie and retry automatically.
    refreshMe().finally(() => setLoading(false));
  }, [refreshMe]);

  const login = useCallback(
    async (input: LoginInput) => {
      const tokens = await apiFetch<TokenResponse>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify(input) },
        { skipAuth: true },
      );
      setAccessToken(tokens.access_token);
      await refreshMe();
    },
    [refreshMe],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await apiFetch<{ tokens: TokenResponse }>(
        '/auth/register',
        { method: 'POST', body: JSON.stringify(input) },
        { skipAuth: true },
      );
      setAccessToken(res.tokens.access_token);
      await refreshMe();
    },
    [refreshMe],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch(
        '/auth/logout',
        { method: 'POST' },
        { skipAuth: true },
      );
    } catch {
      /* swallow — we're logging out regardless */
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
