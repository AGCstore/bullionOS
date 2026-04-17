/**
 * Fetch wrapper with silent access-token refresh.
 *
 * Security model (Phase 4):
 *   - Access token: in memory only (module-scoped). Never in localStorage or cookies.
 *   - Refresh token: set by the API as an httpOnly Secure SameSite=Lax cookie
 *     scoped to /api/v1/auth. The browser sends it automatically on /refresh;
 *     JavaScript cannot read or exfiltrate it.
 *
 * Every fetch runs with credentials: 'include' so the cookie rides along for
 * refresh. CORS is locked to WEB_ORIGIN server-side, so no cross-origin site
 * can use these credentials.
 */

type TokenResponse = { access_token: string; access_expires_in: number };

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

const API_PREFIX = '/api/v1';

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function doRefresh(): Promise<string | null> {
  const res = await fetch(`${API_PREFIX}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    accessToken = null;
    return null;
  }
  const data = (await res.json()) as TokenResponse;
  accessToken = data.access_token;
  return data.access_token;
}

async function refreshOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  { skipAuth = false, isRetry = false }: { skipAuth?: boolean; isRetry?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!skipAuth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !skipAuth && !isRetry) {
    const fresh = await refreshOnce();
    if (fresh) return apiFetch<T>(path, init, { isRetry: true });
  }

  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : res.statusText) || 'Request failed';
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
