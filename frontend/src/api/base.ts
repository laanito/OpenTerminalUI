import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30000,
});

let accessTokenGetter: (() => string | null) | null = null;

export function setAccessTokenGetter(getter: (() => string | null) | null): void {
  accessTokenGetter = getter;
}

// Refresh handler registered by AuthContext: performs a token refresh and
// resolves with the new access token (or null if refresh failed / unavailable).
type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;

export function setRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler;
}

// Coalesce concurrent refreshes so a burst of 401s triggers only one refresh.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshHandler) return null;
  try {
    refreshInFlight = refreshInFlight ?? refreshHandler();
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

api.interceptors.request.use((config) => {
  // A refresh-retry already carries a fresh Authorization header; don't clobber it.
  const headers = config.headers as Record<string, string> | undefined;
  if ((config as { __isRetry?: boolean }).__isRetry && headers?.Authorization) {
    return config;
  }
  const token = accessTokenGetter ? accessTokenGetter() : null;
  if (token) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const config = error?.config as
      | (Record<string, unknown> & { __isRetry?: boolean; headers?: Record<string, string> })
      | undefined;
    if (status === 401 && refreshHandler && config && !config.__isRetry) {
      try {
        const newToken = await refreshAccessToken();
        if (newToken) {
          config.__isRetry = true;
          config.headers = { ...(config.headers || {}), Authorization: `Bearer ${newToken}` };
          return api.request(config);
        }
      } catch {
        // Fall through to the original 401.
      }
    }
    return Promise.reject(error);
  },
);

/** Fetch a progressive response with the same bearer/refresh behavior as axios. */
export async function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = String(api.defaults.baseURL || "").replace(/\/$/, "");
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const send = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  let response = await send(accessTokenGetter?.() ?? null);
  if (response.status === 401 && refreshHandler) {
    const newToken = await refreshAccessToken();
    if (newToken) response = await send(newToken);
  }
  return response;
}

export function extractApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail.trim();
    }
    if (Array.isArray(detail) && detail.length) {
      return detail.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("; ");
    }
    if (typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}
