"use client";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Login failed");
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <form className="login section card" onSubmit={submit}>
      <h2>Sign in</h2>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <div className="error" role="alert">{error}</div>}
      <button className="primary" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
      <p className="muted">
        Demo users (password <code>password123</code>): alice@ (Acme owner, Globex viewer), bob@ (Acme editor),
        dave@ (Acme viewer), carol@ (Globex owner), evan@ (Globex editor) — all @example.com
      </p>
    </form>
  );
}
