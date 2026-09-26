'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuBot, LuListOrdered, LuPause, LuRefreshCw, LuRepeat2, LuSend, LuStore, LuX, LuZap } from 'react-icons/lu';
import { CATEGORY_LABEL } from '@cupons/shared';
import { adminFetch, fmtDate, Thumb, type Notify } from './common';
import { dayLabel, hhmm, PageHeader, QueueBanner, type ChannelOverview } from './ui';

interface QueueSource {
  id: string;
  kind: 'API' | 'TELEGRAM' | 'MIRROR';
  label: string;
  enabled: boolean;
  autoApprove: boolean;
  autoMinScore: number;
  lastRunAt: string | null;
  lastResult: string | null;
  telegramChat: string | null;
  chatTitle: string | null;
  linkTypes: string[];
  alert: string | null;
}

interface ChannelQueue extends ChannelOverview {
  enabled: boolean;
  categories: string[];
  pendingSuggestions: number;
  sources: QueueSource[];
}

/** Abaixo disso a fonte automática busca mais (mesmo valor do worker). */
const REFILL_BELOW = 2;

/** Uma fila por grupo: o que vai sair, quando, e de onde vem a reposição. */
export function QueuesTab({ notify }: { notify: Notify }) {
  const [queues, setQueues] = useState<ChannelQueue[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueues((await adminFetch<{ queues: ChannelQueue[] }>('queues')).queues);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [notify]);

  // a fila anda sozinha: atualiza a cada 30s enquanto a aba estiver visível
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(postId: string, action: 'cancel' | 'publish') {
    setBusy(postId);
    try {
      await adminFetch(`posts/${postId}/${action}`, { method: 'POST' });
      notify('success', action === 'cancel' ? 'Post tirado da fila.' : 'Enviando para o canal agora.');
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <PageHeader
        icon={<LuListOrdered size={22} />}
        title="Filas"
        subtitle="A melhor oferta sai primeiro; o preço é conferido na loja antes de postar."
        actions={
          <button className="btn ghost sm" onClick={() => void load()}>
            <LuRefreshCw size={14} /> Atualizar
          </button>
        }
      />

      {!queues ? (
        <div className="grid" style={{ gap: 12 }}>
          {[0, 1].map((i) => (
            <span key={i} className="skeleton" style={{ height: 160 }} />
          ))}
        </div>
      ) : queues.length === 0 ? (
        <p className="card empty">Nenhum canal cadastrado. Crie um em Administração → Canais.</p>
      ) : (
        <div className="queues">
          {queues.map((q) => (
            <section key={q.id} className="panel queue-card" style={{ opacity: q.enabled ? 1 : 0.6 }}>
              <header className="spread" style={{ marginBottom: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="panel-title" style={{ margin: 0 }}>
                    {q.name}
                    <span className={`badge ${q.platform}`}>{q.platform === 'WHATSAPP' ? 'WhatsApp' : 'Telegram'}</span>
                    {!q.enabled && (
                      <span className="badge">
                        <LuPause size={10} /> pausado
                      </span>
                    )}
                  </h3>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                    {q.categories.length ? q.categories.map((c) => CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c).join(', ') : 'Geral (todas as categorias)'}
                    {' · '}
                    {q.postsPerHour}/h{q.quietHours ? ` · silêncio ${q.quietHours.replace('-', 'h–')}h` : ''}
                  </p>
                </div>
                <div className="queue-count">
                  <strong>{q.scheduled}</strong>
                  <span>na fila</span>
                </div>
              </header>

              {q.enabled && <QueueBanner channel={q} />}

              {q.upcoming.length === 0 ? (
                <p className="empty" style={{ margin: '12px 0' }}>
                  Fila vazia{q.pendingSuggestions ? ` · ${q.pendingSuggestions} sugestão(ões) esperando aprovação` : ''}.
                </p>
              ) : (
                <ol className="timeline" style={{ marginTop: 10 }}>
                  {q.upcoming.map((u, i) => (
                    <li key={u.id}>
                      <span className="eta">
                        {hhmm(u.eta)}
                        <small>{dayLabel(u.eta)}</small>
                      </span>
                      <Thumb src={u.product.imageUrl} size={36} />
                      <span className="clamp" style={{ fontSize: 13, minWidth: 0, flex: 1 }}>
                        {u.product.title}
                      </span>
                      <span className="badge" title="A fila sai da maior nota para a menor; agendado à mão vem primeiro">
                        {u.priority === undefined || u.priority >= 100 ? 'manual' : `nota ${u.priority}`}
                      </span>
                      <span className={`badge ${u.product.store}`}>{u.product.store}</span>
                      <span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                          {i === 0 && (
                            <button className="btn ghost sm icon" title="Postar agora" disabled={busy === u.id} onClick={() => void act(u.id, 'publish')}>
                              <LuSend size={13} />
                            </button>
                          )}
                          <button className="btn ghost sm icon" title="Tirar da fila" disabled={busy === u.id} onClick={() => void act(u.id, 'cancel')}>
                            <LuX size={13} />
                          </button>
                        </span>
                    </li>
                  ))}
                </ol>
              )}
              {q.scheduled > q.upcoming.length && (
                <p className="muted" style={{ margin: '6px 0 0' }}>+ {q.scheduled - q.upcoming.length} depois destes.</p>
              )}

              <div className="queue-sources">
                <p className="label" style={{ margin: 0 }}>Reposição</p>
                {q.sources.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    Sem fonte: a fila só anda com aprovação manual. Adicione uma em Canais → Fontes de ofertas.
                  </p>
                ) : (
                  q.sources.map((s) => (
                    <div key={s.id} className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap', opacity: s.enabled ? 1 : 0.55 }}>
                      <span style={{ color: 'var(--muted)', marginTop: 2 }}>{s.kind === 'API' ? <LuStore size={14} /> : <LuSend size={14} />}</span>
                      <div style={{ minWidth: 0, fontSize: 13 }}>
                        <strong>{s.label}</strong>{' '}
                        {!s.enabled ? (
                          <span className="badge">desligada</span>
                        ) : s.kind === 'MIRROR' ? (
                          <span className="badge POSTED">
                            <LuRepeat2 size={10} /> espelhando {s.chatTitle ?? s.telegramChat}
                          </span>
                        ) : s.autoApprove ? (
                          <span className="badge POSTED">
                            <LuZap size={10} /> automática · nota ≥ {s.autoMinScore}
                          </span>
                        ) : (
                          <span className="badge">
                            <LuBot size={10} /> com aprovação
                          </span>
                        )}
                        <div className="muted">
                          {s.alert && <span style={{ color: 'var(--red)' }}>{s.alert} · </span>}
                          {s.kind === 'MIRROR'
                            ? 'Posta direto no canal a cada oferta do grupo (não passa por esta fila). '
                            : s.enabled && s.autoApprove
                            ? q.scheduled < REFILL_BELOW
                              ? 'Fila acabando: busca mais ofertas em instantes. '
                              : `Busca de novo quando a fila baixar de ${REFILL_BELOW}. `
                            : ''}
                          {s.lastRunAt ? `Última busca ${fmtDate(s.lastRunAt)}: ${s.lastResult ?? '—'}` : 'Ainda não buscou.'}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
