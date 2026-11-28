import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthFrame, AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from "../../components/auth/AuthFrame";
import { useAuth } from "../../contexts/AuthContext";

export function RegisterPage() {
  const mounted = useRef(true), busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, login, isLoading } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || submitting || isLoading || created) return;
    setError(null);

    if (!email.includes("@")) {
      setError("ENTER A VALID EMAIL");
      return;
    }
    if (password.length < 8) {
      setError("PASSWORD MUST BE AT LEAST 8 CHARACTERS");
      return;
    }
    if (password !== confirmPassword) {
      setError("PASSWORDS DO NOT MATCH");
      return;
    }

    try {
      busy.current = true;
      setSubmitting(true);
      await register(email.trim(), password, "viewer");
      if (!mounted.current) return;
      setCreated(true);
      await login(email.trim(), password);
      if (!mounted.current) return;
      navigate("/equity/stocks", { replace: true });
    } catch {
      if (!mounted.current) return;
      setError("Could not complete registration or automatic sign-in.");
    } finally { busy.current = false; if (mounted.current) setSubmitting(false); }
  };

  return <AuthFrame title="Request access" description="Create an account on this terminal, then sign in automatically.">
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={submitting || isLoading}>
      <label className="block space-y-1"><span>Email</span><input className={AUTH_INPUT_CLASS} value={email} onChange={event => setEmail(event.target.value)} inputMode="email" autoComplete="username" autoCapitalize="none" disabled={submitting || isLoading || created} /></label>
      <label className="block space-y-1"><span>Password</span><input className={AUTH_INPUT_CLASS} type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" disabled={submitting || isLoading || created} /></label>
      <p className="text-xs text-terminal-muted">At least 8 characters.</p>
      <label className="block space-y-1"><span>Confirm password</span><input className={AUTH_INPUT_CLASS} type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" disabled={submitting || isLoading || created} /></label>
      <p className="text-sm text-terminal-muted">New accounts start as Viewer. An administrator manages later role changes.</p>
      {error && <p role="alert" className="rounded border border-terminal-neg p-3 text-sm text-terminal-neg">{created ? "Account created, but automatic sign-in failed. Use Access terminal below to sign in." : `${error} Your entries are retained.`}</p>}
      <button className={`${AUTH_BUTTON_CLASS} w-full`} type="submit" disabled={submitting || isLoading || created}>{submitting || isLoading ? "Creating account…" : created ? "Account created" : "Create account"}</button>
      <p className="text-sm text-terminal-muted">Already registered? <Link to="/login" className="text-terminal-accent underline">Access terminal</Link></p>
    </form>
  </AuthFrame>;
}
