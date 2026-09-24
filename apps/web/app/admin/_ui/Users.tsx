'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuCopy, LuKeyRound, LuLock, LuLogOut, LuUserCheck, LuUserPlus, LuUsers, LuUserX } from 'react-icons/lu';
import { adminFetch, fmtDate, ROLE_LABEL, type Me, type Notify, type Role } from './common';
import { PageHeader } from './ui';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  _count: { sessions: number };
}

const ROLE_HELP: Record<Role, string> = {
  DEV: 'tudo, inclusive usuários e auditoria',
  GERENTE: 'toda a operação (sugestões, posts, produtos, métricas), sem mexer em usuários',
};

/** Senha provisória: mostrada uma vez só, com botão de copiar. */
function TempPassword({ who, password, onClose }: { who: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="banner go" style={{ alignItems: 'flex-start' }}>
      <LuKeyRound size={20} style={{ color: 'var(--accent)', flex: 'none', marginTop: 2 }} />
      <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        <span>
          <strong>Senha provisória de {who}</strong> — anote e envie por um canal seguro. Ela <strong>não aparece de novo</strong>, e a
          pessoa vai ter que trocar no primeiro acesso.
        </span>
        <div className="row">
          <code style={{ fontSize: 16, padding: '6px 10px', background: 'var(--bg-input)', borderRadius: 8, letterSpacing: 1 }}>{password}</code>
          <button
            className="btn ghost sm"
            onClick={() => {
              void navigator.clipboard?.writeText(password).then(() => setCopied(true));
            }}
          >
            <LuCopy size={14} /> {copied ? 'Copiada' : 'Copiar'}
          </button>
          <button className="btn sm" onClick={onClose}>
            Pronto, anotei
          </button>
        </div>
      </div>
    </div>
  );
}

export function UsersTab({ me, notify }: { me: Me; notify: Notify }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'GERENTE' as Role });
  const [temp, setTemp] = useState<{ who: string; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers((await adminFetch<{ users: UserRow[] }>('users')).users);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [notify]);
  useEffect(() => void load(), [load]);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await run('new', async () => {
      const r = await adminFetch<{ temporaryPassword: string }>('users', { method: 'POST', body: form });
      setTemp({ who: form.name, password: r.temporaryPassword });
      setForm({ name: '', email: '', role: 'GERENTE' });
      notify('success', 'Usuário criado.');
    });
  }

  const patch = (u: UserRow, body: Partial<Pick<UserRow, 'role' | 'active'>>, msg: string) =>
    run(u.id, async () => {
      await adminFetch(`users/${u.id}`, { method: 'PATCH', body });
      notify('success', msg);
    });

  return (
    <div className="grid" style={{ gap: 18 }}>
      <PageHeader icon={<LuUsers size={22} />} title="Usuários" subtitle="Quem acessa o painel e com qual perfil. Só DEV vê esta página." />

      {temp && <TempPassword who={temp.who} password={temp.password} onClose={() => setTemp(null)} />}

      <form className="panel accent" onSubmit={create}>
        <h3 className="panel-title">
          <LuUserPlus size={18} /> Novo usuário
        </h3>
        <div className="grid cols-3" style={{ gap: 12, alignItems: 'end' }}>
          <label className="field">
            <span>Nome</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="field">
            <span>Perfil</span>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="GERENTE">Gerente</option>
              <option value="DEV">Dev</option>
            </select>
          </label>
        </div>
        <p className="muted" style={{ margin: '10px 0 12px' }}>
          <strong>{ROLE_LABEL[form.role]}:</strong> {ROLE_HELP[form.role]}. O sistema gera uma senha provisória.
        </p>
        <button className="btn" disabled={busy === 'new'}>
          <LuUserPlus size={16} /> Criar usuário
        </button>
      </form>

      <section className="panel">
        {!users ? (
          <span className="skeleton" style={{ height: 80 }} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Perfil</th>
                  <th>Situação</th>
                  <th>Último acesso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
                  const self = u.id === me.id;
                  return (
                    <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                      <td>
                        <strong>{u.name}</strong>
                        {self && <span className="badge POSTED" style={{ marginLeft: 6 }}>você</span>}
                        <div className="muted">{u.email}</div>
                      </td>
                      <td>
                        <select
                          className="input"
                          style={{ padding: '6px 8px', width: 'auto' }}
                          value={u.role}
                          disabled={busy === u.id || !u.active}
                          onChange={(e) => void patch(u, { role: e.target.value as Role }, 'Perfil alterado; as sessões dessa pessoa foram encerradas.')}
                        >
                          <option value="GERENTE">Gerente</option>
                          <option value="DEV">Dev</option>
                        </select>
                      </td>
                      <td>
                        {!u.active ? (
                          <span className="badge CANCELED">Desativado</span>
                        ) : locked ? (
                          <span className="badge FAILED">
                            <LuLock size={10} /> Bloqueado
                          </span>
                        ) : u.mustChangePassword ? (
                          <span className="badge SCHEDULED">Senha provisória</span>
                        ) : (
                          <span className="badge POSTED">Ativo</span>
                        )}
                        <div className="muted">{u._count.sessions} sessão(ões) aberta(s)</div>
                      </td>
                      <td className="muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'nunca'}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button
                            className="btn ghost sm"
                            title="Gerar nova senha provisória (encerra as sessões)"
                            disabled={busy === u.id || !u.active}
                            onClick={() =>
                              void run(u.id, async () => {
                                if (!window.confirm(`Gerar nova senha provisória para ${u.name}? As sessões dessa pessoa serão encerradas.`)) return;
                                const r = await adminFetch<{ temporaryPassword: string }>(`users/${u.id}/reset-password`, { method: 'POST' });
                                setTemp({ who: u.name, password: r.temporaryPassword });
                              })
                            }
                          >
                            <LuKeyRound size={14} />
                          </button>
                          <button
                            className="btn ghost sm"
                            title="Encerrar todas as sessões"
                            disabled={busy === u.id || !u._count.sessions}
                            onClick={() =>
                              void run(u.id, async () => {
                                await adminFetch(`users/${u.id}/revoke-sessions`, { method: 'POST' });
                                notify('success', `Sessões de ${u.name} encerradas.`);
                              })
                            }
                          >
                            <LuLogOut size={14} />
                          </button>
                          {u.active ? (
                            <button
                              className="btn danger sm"
                              title="Desativar (perde o acesso na hora)"
                              disabled={busy === u.id || self}
                              onClick={() => {
                                if (window.confirm(`Desativar ${u.name}? A pessoa perde o acesso na hora.`)) void patch(u, { active: false }, 'Usuário desativado.');
                              }}
                            >
                              <LuUserX size={14} />
                            </button>
                          ) : (
                            <button className="btn ghost sm" title="Reativar" disabled={busy === u.id} onClick={() => void patch(u, { active: true }, 'Usuário reativado.')}>
                              <LuUserCheck size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
