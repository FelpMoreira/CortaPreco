'use client';

import { useEffect, useState } from 'react';
import { LuKeyRound, LuShieldCheck } from 'react-icons/lu';
import { ThemeToggle } from '@/components/ThemeToggle';

type Mode = 'loading' | 'login' | 'setup';

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return ((await res.json().catch(() => null)) as { ok: boolean; error?: string } | null) ?? { ok: false, error: `Erro ${res.status}` };
  } catch {
    return { ok: false, error: 'Sem conexão' };
  }
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ email: '', password: '', name: '', confirm: '', bootstrap: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    fetch('/api/auth-status')
      .then((r) => r.json())
      .then((j: { setupRequired?: boolean }) => setMode(j.setupRequired ? 'setup' : 'login'))
      .catch(() => setMode('login'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'setup' && f.password !== f.confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    const res =
      mode === 'setup'
        ? await post('/api/setup', { bootstrapPassword: f.bootstrap, name: f.name, email: f.email, password: f.password })
        : await post('/api/login', { email: f.email, password: f.password });
    if (res.ok) {
      window.location.assign('/admin');
      return;
    }
    setError(res.error ?? 'Não foi possível entrar.');
    setF((s) => ({ ...s, password: '', confirm: '' }));
    setBusy(false);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <form onSubmit={submit} className="panel accent" style={{ width: '100%', maxWidth: 380, display: 'grid', gap: 14 }}>
        {/* eslint-disable @next/next/no-img-element */}
        {(['dark', 'light'] as const).map((t) => (
          <img
            key={t}
            className={`logo-${t}`}
            src={`/brand/logo-on-${t}.png`}
            alt="CortaPreço"
            width={829}
            height={295}
            style={{ height: 52, width: 'auto', justifySelf: 'center', margin: '2px 0 4px' }}
          />
        ))}
        {/* eslint-enable @next/next/no-img-element */}

        {mode === 'loading' ? (
          <span className="skeleton" style={{ height: 120 }} />
        ) : mode === 'setup' ? (
          <>
            <div className="banner go" style={{ fontSize: 13 }}>
              <LuShieldCheck size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
              <span>
                <strong>Primeiro acesso.</strong> Crie a conta do primeiro administrador (perfil DEV). Para confirmar, use a senha
                atual do painel (<code>ADMIN_PASSWORD</code>).
              </span>
            </div>
            <label className="field">
              <span>Senha atual do painel</span>
              <input className="input" type="password" autoComplete="off" value={f.bootstrap} onChange={set('bootstrap')} required />
            </label>
            <label className="field">
              <span>Seu nome</span>
              <input className="input" autoComplete="name" value={f.name} onChange={set('name')} required minLength={2} maxLength={80} />
            </label>
            <label className="field">
              <span>E-mail</span>
              <input className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} required />
            </label>
            <label className="field">
              <span>Nova senha (mín. 12 caracteres)</span>
              <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required minLength={12} />
            </label>
            <label className="field">
              <span>Confirme a senha</span>
              <input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required minLength={12} />
            </label>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
              Painel · acesso restrito
            </p>
            <label className="field">
              <span>E-mail</span>
              <input className="input" type="email" autoComplete="username" value={f.email} onChange={set('email')} autoFocus required />
            </label>
            <label className="field">
              <span>Senha</span>
              <input className="input" type="password" autoComplete="current-password" value={f.password} onChange={set('password')} required />
            </label>
          </>
        )}

        {error && (
          <p className="err" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {mode !== 'loading' && (
          <button className="btn" type="submit" disabled={busy}>
            <LuKeyRound size={16} /> {busy ? 'Aguarde…' : mode === 'setup' ? 'Criar conta e entrar' : 'Entrar'}
          </button>
        )}
      </form>
    </main>
  );
}
