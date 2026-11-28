import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { AuthFrame, AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from "../../components/auth/AuthFrame";

export function ForgotAccessPage() {
  const navigate = useNavigate();
  const mounted = useRef(true), busy = useRef(false), navigationTimer = useRef<number | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (navigationTimer.current != null) window.clearTimeout(navigationTimer.current); }; }, []);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const authApi = useMemo(() => axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
    timeout: 30000,
  }), []);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || isSubmitting || message) return;
    setError(null);
    setMessage(null);

    if (!email.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      busy.current = true;
      setIsSubmitting(true);
      await authApi.post("/auth/forgot-access", {
        email: email.trim(),
        new_password: newPassword,
      });
      if (!mounted.current) return;
      setMessage("Request completed. Return to sign in to check your access.");
      navigationTimer.current = window.setTimeout(() => navigate("/login", { replace: true }), 900);
    } catch {
      if (!mounted.current) return;
      setError("Could not reset access. Try again.");
    } finally {
      busy.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  return <AuthFrame title="Forgot access" description="Reset access using this host’s existing recovery flow.">
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={isSubmitting}>
      <label className="block space-y-1"><span>Email</span><input className={AUTH_INPUT_CLASS} placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} inputMode="email" autoCapitalize="none" autoComplete="username" disabled={isSubmitting || Boolean(message)} /></label>
      <label className="block space-y-1"><span>New password</span><input className={AUTH_INPUT_CLASS} type="password" placeholder="New password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" disabled={isSubmitting || Boolean(message)} /></label>
      <p className="text-xs text-terminal-muted">At least 8 characters.</p>
      <label className="block space-y-1"><span>Confirm new password</span><input className={AUTH_INPUT_CLASS} type="password" placeholder="Confirm new password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" disabled={isSubmitting || Boolean(message)} /></label>
      {error && <p role="alert" className="rounded border border-terminal-neg p-3 text-sm text-terminal-neg">{error} Your entries are retained.</p>}
      {message && <p role="status" className="rounded border border-terminal-border p-3 text-sm text-terminal-pos">{message}</p>}
      <button type="submit" className={`${AUTH_BUTTON_CLASS} w-full`} disabled={isSubmitting || Boolean(message)}>{isSubmitting ? "Updating access…" : "Reset access"}</button>
      <p className="text-sm text-terminal-muted">Back to <Link to="/login" className="text-terminal-accent underline">Login</Link></p>
    </form>
  </AuthFrame>;
}
