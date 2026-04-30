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
  /**
   * Resolves with the freshly-fetched user. Returning the value lets
   * callers (e.g. the login page) make role-based routing decisions
   * without waiting for a React re-render to surface the new state.
   */
  login: (input: LoginInput) => Promise<MeResponse>;
  register: (input: RegisterInput) => Promise<MeResponse>;
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
    async (input: LoginInput): Promise<MeResponse> => {
      const tokens = await apiFetch<TokenResponse>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify(input) },
        { skipAuth: true },
      );
      setAccessToken(tokens.access_token);
      // Inline /auth/me fetch (vs. refreshMe()) so we can return the
      // user synchronously to the caller. State setter is fire-and-
      // forget — React batches it before the next render.
      const me = await apiFetch<MeResponse>('/auth/me');
      setUser(me);
      return me;
    },
    [],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<MeResponse> => {
      const res = await apiFetch<{ tokens: TokenResponse }>(
        '/auth/register',
        { method: 'POST', body: JSON.stringify(input) },
        { skipAuth: true },
      );
      setAccessToken(res.tokens.access_token);
      const me = await apiFetch<MeResponse>('/auth/me');
      setUser(me);
      return me;
    },
    [],
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
