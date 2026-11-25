import { useEffect, useState } from "react";
import { api } from "../../api/base";

// Associate every response with its requested scope. A changed input can never
// display a previous ETF's result while its next effect/read is starting.
export function useETFResource<T>(path: string, params: Record<string, string>, enabled = true) {
  const key = JSON.stringify(params);
  const scope = `${path}:${key}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ scope: string; data?: T; error?: boolean; pending: boolean }>();
  useEffect(() => {
    let cancelled = false;
    if (!enabled) return;
    setResult({ scope, pending: true });
    void api.get<T>(path, { params: JSON.parse(key) }).then(({ data }) => {
      if (!cancelled) setResult({ scope, data, pending: false });
    }).catch(() => {
      if (!cancelled) setResult({ scope, error: true, pending: false });
    });
    return () => { cancelled = true; };
  }, [path, key, scope, enabled, attempt]);
  const current = result?.scope === scope ? result : undefined;
  return { data: enabled ? current?.data : undefined, error: enabled && Boolean(current?.error), loading: enabled && (!current || current.pending), retry: () => setAttempt(value => value + 1) };
}
