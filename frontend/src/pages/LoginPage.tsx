import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { AuthFrame, AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from "../components/auth/AuthFrame";
import { useAuth } from "../contexts/AuthContext";

const TRANSITION_FLAG_KEY = "ot-terminal-transition";

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading } = useAuth();

  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [rememberTerminal, setRememberTerminal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [dotIndex, setDotIndex] = useState(1);

  useEffect(() => {
    const remembered = localStorage.getItem("ot-login-user");
    if (remembered) {
      setUserId(remembered);
      setRememberTerminal(true);
    }
  }, []);

  useEffect(() => {
    if (!authenticating) return;
    const timer = window.setInterval(() => {
      setDotIndex((prev) => (prev % 3) + 1);
    }, 320);
    return () => window.clearInterval(timer);
  }, [authenticating]);

  const authText = useMemo(() => `AUTHENTICATING${".".repeat(dotIndex)}`, [dotIndex]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || authenticating || isLoading) return;
    setError(null);

    if (!userId.trim() || !password) {
      setError("CREDENTIALS REQUIRED");
      return;
    }

    if (!userId.includes("@")) {
      setError("USER ID MUST BE A REGISTERED EMAIL");
      return;
    }

    try {
      busy.current = true;
      setAuthenticating(true);
      const startedAt = Date.now();
      await login(userId.trim(), password);
      if (!mounted.current) return;

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < 2000) {
        await delay(2000 - elapsedMs);
      }

      if (!mounted.current) return;
      if (rememberTerminal) {
        localStorage.setItem("ot-login-user", userId.trim());
      } else {
        localStorage.removeItem("ot-login-user");
      }

      sessionStorage.setItem(TRANSITION_FLAG_KEY, "1");
      window.dispatchEvent(new CustomEvent("ot-terminal-transition"));
      await delay(800);

      if (!mounted.current) return;
      const redirectParam = new URLSearchParams(location.search).get("redirect");
      const fallback = (location.state as { from?: string } | undefined)?.from || "/home";
      navigate(redirectParam || fallback, { replace: true });
    } catch {
      if (!mounted.current) return;
      setError("AUTHENTICATION FAILED");
    } finally {
      busy.current = false;
      if (mounted.current) setAuthenticating(false);
    }
  };

  return <AuthFrame title="Authenticate" description="Sign in with the email and password registered on this terminal.">
    <form onSubmit={onSubmit} className="min-w-0 space-y-4" aria-busy={authenticating || isLoading}>
      <label className="block space-y-1"><span className="text-sm">USER ID</span><input id="ot-user-id" className={AUTH_INPUT_CLASS} placeholder="Enter user ID..." inputMode="email" autoCapitalize="none" spellCheck={false} value={userId} onChange={event => setUserId(event.target.value)} autoComplete="username" disabled={authenticating || isLoading} /></label>
      <label className="block space-y-1"><span className="text-sm">PASSWORD</span><input id="ot-password" className={AUTH_INPUT_CLASS} type={showPassword ? "text" : "password"} placeholder="Enter password..." value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" disabled={authenticating || isLoading} /></label>
      <button type="button" className="min-h-11 rounded border border-terminal-border px-3 py-2 text-sm" aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(previous => !previous)}>{showPassword ? "Hide password" : "Show password"}</button>
      <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={authenticating || isLoading} checked={rememberTerminal} onChange={event => setRememberTerminal(event.target.checked)} /><span>Remember terminal</span></label><Link to="/forgot-access" className="text-sm text-terminal-accent underline">Forgot access?</Link></div>
      <p className="text-xs text-terminal-muted">Remember terminal stores your email on this browser.</p>
      {error && <p role="alert" className="rounded border border-terminal-neg p-3 text-sm text-terminal-neg">{error}. Your entries are retained.</p>}
      <button type="submit" className={`${AUTH_BUTTON_CLASS} w-full`} disabled={authenticating || isLoading}>{authenticating || isLoading ? authText : "Access terminal"}</button>
      <details className="rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Demo credentials</summary><p className="my-3 text-xs text-terminal-muted">Fill the existing demo credentials. This requires a demo account provisioned on your host.</p><button type="button" disabled={authenticating || isLoading} className={AUTH_BUTTON_CLASS} onClick={() => { setUserId("demo@openterminal.dev"); setPassword("demo12345"); setError(null); }}>&gt; DEMO ACCESS</button></details>
      <p className="text-sm text-terminal-muted">New to OpenTerminalUI? <Link to="/register" className="text-terminal-accent underline">Request access</Link></p>
    </form>
  </AuthFrame>;
}
