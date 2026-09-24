'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuRefreshCw, LuScrollText } from 'react-icons/lu';
import { adminFetch, fmtDate, type Notify } from './common';
import { PageHeader } from './ui';

interface Entry {
  id: string;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
}

const LABEL: Record<string, string> = {
  login: 'Entrou',
  logout: 'Saiu',
  login_failed: 'Senha errada',
  login_blocked: 'Tentou com conta bloqueada',
  account_locked: 'Conta bloqueada',
  setup: 'Primeiro acesso',
  setup_failed: 'Primeiro acesso recusado',
  password_change: 'Trocou a senha',
  password_change_failed: 'Troca de senha recusada',
  session_revoke: 'Encerrou uma sessão',
  'user.create': 'Criou usuário',
  'user.update': 'Alterou usuário',
  'user.reset_password': 'Gerou senha provisória',
  'user.revoke_sessions': 'Encerrou sessões de usuário',
  'post.schedule': 'Agendou post',
  'post.publish_now': 'Postou agora',
  'post.cancel': 'Cancelou post',
  'post.requeue': 'Reenviou post',
  'product.update': 'Editou produto',
  'suggestion.approve': 'Aprovou sugestão',
  'suggestion.approve_publish': 'Aprovou e postou',
  'suggestion.reject': 'Rejeitou sugestão',
  'suggestions.batch': 'Enviou links à curadoria',
  'suggestions.discover': 'Buscou ofertas',
};

const RISKY = /failed|blocked|locked/;

export function AuditTab({ notify }: { notify: Notify }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      setEntries((await adminFetch<{ entries: Entry[] }>('audit')).entries);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [notify]);
  useEffect(() => void load(), [load]);

  const term = q.trim().toLowerCase();
  const list = (entries ?? []).filter(
    (e) => !term || [e.user?.name, e.user?.email, LABEL[e.action] ?? e.action, e.detail, e.ip].some((v) => v?.toLowerCase().includes(term)),
  );

  return (
    <div className="grid" style={{ gap: 18 }}>
      <PageHeader
        icon={<LuScrollText size={22} />}
        title="Auditoria"
        subtitle="Quem fez o quê no painel (últimos 300 registros)."
        actions={
          <button className="btn ghost sm" onClick={() => void load()}>
            <LuRefreshCw size={14} /> Atualizar
          </button>
        }
      />
      <section className="panel">
        <input className="input" style={{ maxWidth: 340, marginBottom: 12 }} placeholder="Filtrar por pessoa, ação, IP…" value={q} onChange={(e) => setQ(e.target.value)} />
        {!entries ? (
          <span className="skeleton" style={{ height: 80 }} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Ação</th>
                  <th>Detalhe</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.createdAt)}</td>
                    <td>{e.user?.name ?? <span className="muted">—</span>}</td>
                    <td>
                      <span className={RISKY.test(e.action) ? 'err' : undefined} style={{ fontWeight: 600 }}>
                        {LABEL[e.action] ?? e.action}
                      </span>
                    </td>
                    <td className="muted" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{e.detail ?? '—'}</td>
                    <td className="muted">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
