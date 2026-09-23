'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (json?.ok) {
        window.location.assign('/admin');
        return;
      }
      setError(json?.error ?? 'Erro ao entrar');
      setPassword('');
    } catch {
      setError('Sem conexão');
    }
    setLoading(false);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 340, display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>🏷️ Painel de ofertas</h1>
        <p className="muted" style={{ margin: 0 }}>
          Acesso restrito.
        </p>
        <label className="field">
          <span>Senha</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && (
          <p className="err" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={loading || !password}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
