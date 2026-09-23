'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (json.ok) {
      router.push('/admin');
      router.refresh();
    } else {
      setError(json.error ?? 'Erro ao entrar');
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <form onSubmit={submit} className="card" style={{ width: 320, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Painel de ofertas</h2>
        <p className="muted" style={{ margin: 0 }}>
          Acesso restrito.
        </p>
        <input
          className="input"
          type="password"
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p className="err" style={{ margin: 0 }}>{error}</p>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}