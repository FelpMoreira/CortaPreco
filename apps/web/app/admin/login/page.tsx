'use client';

import { useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';

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
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 340, display: 'grid', gap: 12 }}>
        {/* eslint-disable @next/next/no-img-element */}
        {(['dark', 'light'] as const).map((t) => (
          <img
            key={t}
            className={`logo-${t}`}
            src={`/brand/logo-on-${t}.png`}
            alt="CortaPreço"
            width={829}
            height={295}
            style={{ height: 56, width: 'auto', justifySelf: 'center', margin: '4px 0 8px' }}
          />
        ))}
        {/* eslint-enable @next/next/no-img-element */}
        <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
          Painel · acesso restrito
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
