'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuKeyRound, LuLaptop, LuLogOut, LuShieldAlert, LuUserRound } from 'react-icons/lu';
import { adminFetch, fmtDate, ROLE_LABEL, type Me, type Notify } from './common';
import { PageHeader } from './ui';

interface SessionRow {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

function device(ua: string | null): string {
  if (!ua) return 'Navegador desconhecido';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Outro';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${br} · ${os}`;
}

/** Troca de senha (também usada na troca obrigatória da senha provisória). */
export function PasswordForm({ notify, onDone, forced }: { notify: Notify; onDone?: () => void; forced?: boolean }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.next !== f.confirm) {
      notify('error', 'As senhas novas não conferem.');
      return;
    }
    setBusy(true);
    try {
      const r = await adminFetch<{ revokedSessions: number }>('auth/password', { method: 'POST', body: { current: f.current, next: f.next } });
      notify('success', `Senha trocada.${r.revokedSessions ? ` ${r.revokedSessions} outra(s) sessão(ões) foi(ram) encerrada(s).` : ''}`);
      setF({ current: '', next: '', confirm: '' });
      onDone?.();
    } catch (err) {
      notify('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid" style={{ gap: 12 }} onSubmit={submit}>
      <label className="field">
        <span>{forced ? 'Senha provisória (a que você recebeu)' : 'Senha atual'}</span>
        <input className="input" type="password" autoComplete="current-password" value={f.current} onChange={set('current')} required />
      </label>
      <label className="field">
        <span>Nova senha (mín. 12 caracteres)</span>
        <input className="input" type="password" autoComplete="new-password" value={f.next} onChange={set('next')} required minLength={12} />
      </label>
      <label className="field">
        <span>Confirme a nova senha</span>
        <input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required minLength={12} />
      </label>
      <p className="muted" style={{ margin: 0 }}>
        Dica: uma frase fácil de lembrar e difícil de adivinhar funciona melhor que letras aleatórias curtas.
      </p>
      <button className="btn" disabled={busy} style={{ justifySelf: 'start' }}>
        <LuKeyRound size={16} /> {busy ? 'Salvando…' : 'Trocar senha'}
      </button>
    </form>
  );
}

export function AccountTab({ me, notify }: { me: Me; notify: Notify }) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions((await adminFetch<{ sessions: SessionRow[] }>('auth/sessions')).sessions);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [notify]);
  useEffect(() => void load(), [load]);

  async function revoke(id: string) {
    try {
      await adminFetch(`auth/sessions/${id}/revoke`, { method: 'POST' });
      notify('success', 'Sessão encerrada.');
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <PageHeader icon={<LuUserRound size={22} />} title="Minha conta" subtitle={`${me.name} · ${me.email} · perfil ${ROLE_LABEL[me.role]}`} />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <section className="panel accent">
          <h3 className="panel-title">
            <LuKeyRound size={18} /> Trocar senha
          </h3>
          <PasswordForm notify={notify} onDone={() => void load()} />
        </section>
        <section className="panel">
          <h3 className="panel-title">
            <LuLaptop size={18} /> Onde você está conectado
          </h3>
          {!sessions ? (
            <span className="skeleton" style={{ height: 60 }} />
          ) : (
            <ul className="timeline">
              {sessions.map((s) => (
                <li key={s.id}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{device(s.userAgent)}</strong>
                    {s.current && <span className="badge POSTED" style={{ marginLeft: 8 }}>esta sessão</span>}
                    <p className="muted" style={{ margin: '2px 0 0' }}>
                      IP {s.ip ?? '—'} · último uso {fmtDate(s.lastUsedAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <button className="btn danger sm" style={{ marginLeft: 'auto' }} onClick={() => void revoke(s.id)}>
                      <LuLogOut size={14} /> Encerrar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ margin: '10px 0 0', display: 'flex', gap: 6 }}>
            <LuShieldAlert size={14} style={{ flex: 'none', marginTop: 2 }} />
            Sessões caem sozinhas após 2h sem uso ou 12h no total. Não reconhece alguma? Encerre e troque a senha.
          </p>
        </section>
      </div>
    </div>
  );
}
