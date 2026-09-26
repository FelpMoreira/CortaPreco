'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LuBellOff,
  LuCalendarClock,
  LuLayoutDashboard,
  LuListOrdered,
  LuMousePointerClick,
  LuRadio,
  LuRefreshCw,
  LuSend,
  LuSparkles,
  LuTriangleAlert,
} from 'react-icons/lu';
import { adminFetch, fmtDate, Thumb, type Notify } from './common';
import { dayLabel, hhmm, PageHeader, QueueBanner, StatCard, StatSkeleton, type ChannelOverview } from './ui';

interface OverviewData {
  now: string;
  stats: { clicks24h: number; posted24h: number; scheduled: number; failed: number; pendingSuggestions: number };
  channels: ChannelOverview[];
  recent: {
    id: string;
    postedAt: string;
    channel: { name: string; platform: string } | null;
    product: { title: string; store: string; imageUrl: string | null };
    _count: { clicks: number };
  }[];
  alerts: {
    id: string;
    kind: string;
    label: string;
    alert: string;
    alertAt: string | null;
    alertCount: number;
    channel: { id: string; name: string };
  }[];
}

export function OverviewTab({ notify, onGo }: { notify: Notify; onGo: (tab: 'sugestoes' | 'posts' | 'nova' | 'canais') => void }) {
  const [data, setData] = useState<OverviewData | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await adminFetch<OverviewData>('overview'));
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

  async function dismissAlert(sourceId: string) {
    try {
      await adminFetch(`sources/${sourceId}/dismiss-alert`, { method: 'POST' });
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }

  const s = data?.stats;

  return (
    <div className="grid" style={{ gap: 18 }}>
      <PageHeader
        icon={<LuLayoutDashboard size={22} />}
        title="Visão geral"
        subtitle="Como está a fila de cada canal e o que saiu nas últimas 24h."
        actions={
          <button className="btn ghost sm" onClick={() => void load()}>
            <LuRefreshCw size={14} /> Atualizar
          </button>
        }
      />

      {!s ? (
        <StatSkeleton count={5} />
      ) : (
        <div className="stats">
          <StatCard label="Publicados (24h)" value={s.posted24h} hint="em todos os canais" icon={<LuSend size={16} />} />
          <StatCard label="Na fila" value={s.scheduled} hint="agendados aguardando a vez" icon={<LuListOrdered size={16} />} tone="blue" />
          <StatCard
            label="Sugestões"
            value={s.pendingSuggestions}
            hint={s.pendingSuggestions ? 'aguardando sua aprovação' : 'nada pendente'}
            icon={<LuSparkles size={16} />}
            tone="violet"
          />
          <StatCard label="Cliques (24h)" value={s.clicks24h} hint="pelo link rastreado" icon={<LuMousePointerClick size={16} />} tone="amber" />
          <StatCard
            label="Falhas"
            value={s.failed}
            hint={s.failed ? 'reenvie pela aba Posts' : 'tudo certo'}
            icon={<LuTriangleAlert size={16} />}
            tone={s.failed ? 'red' : 'green'}
          />
        </div>
      )}

      {data?.alerts?.map((a) => (
        <div key={a.id} className="alert-box" role="alert">
          <LuTriangleAlert size={16} style={{ flex: 'none', marginTop: 1 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>
              {a.channel.name} · {a.label}: {a.alert}
            </strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {a.alertAt ? fmtDate(a.alertAt) : ''}
              {a.alertCount > 1 ? ` · ${a.alertCount} ocorrências` : ''}
            </div>
          </div>
          <button className="btn ghost sm" onClick={() => onGo('canais')}>
            Ver no canal
          </button>
          <button className="btn ghost sm" onClick={() => void dismissAlert(a.id)} title="Some do painel; o histórico continua">
            <LuBellOff size={13} /> Dispensar
          </button>
        </div>
      ))}

      {data?.channels.map((c) => <QueueBanner key={c.id} channel={c} />)}
      {data && data.channels.length === 0 && (
        <div className="banner idle">Nenhum canal ativo. Configure o Telegram (e/ou WhatsApp) no .env.</div>
      )}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <section className="panel accent">
          <h3 className="panel-title">
            <LuCalendarClock size={18} /> Próximos posts (previsão)
          </h3>
          {!data ? (
            <div className="grid" style={{ gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="skeleton" style={{ height: 36 }} />
              ))}
            </div>
          ) : data.channels.every((c) => c.upcoming.length === 0) ? (
            <div className="empty">
              <p style={{ margin: '0 0 12px' }}>Fila vazia.</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn sm" onClick={() => onGo('sugestoes')}>
                  <LuSparkles size={14} /> Ver sugestões
                </button>
                <button className="btn ghost sm" onClick={() => onGo('nova')}>
                  Nova oferta
                </button>
              </div>
            </div>
          ) : (
            data.channels.map((c) => (
              <div key={c.id}>
                {data.channels.length > 1 && (
                  <p className="label" style={{ margin: '4px 0 6px' }}>
                    <LuRadio size={11} /> {c.name}
                  </p>
                )}
                <ol className="timeline">
                  {c.upcoming.map((u) => (
                    <li key={u.id}>
                      <span className="eta">
                        {hhmm(u.eta)}
                        <small>{dayLabel(u.eta)}</small>
                      </span>
                      <Thumb src={u.product.imageUrl} size={36} />
                      <span className="clamp" style={{ fontSize: 13, minWidth: 0 }}>
                        {u.product.title}
                      </span>
                      <span className={`badge ${u.product.store}`} style={{ marginLeft: 'auto' }}>
                        {u.product.store}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))
          )}
          {data && data.channels.some((c) => c.upcoming.length) && (
            <p className="muted" style={{ margin: '10px 0 0' }}>
              Horários estimados pelas regras de ritmo; um "postar agora" ou uma aprovação nova mudam a ordem.
            </p>
          )}
        </section>

        <section className="panel">
          <h3 className="panel-title">
            <LuSend size={18} /> Publicados recentemente
          </h3>
          {!data ? (
            <div className="grid" style={{ gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="skeleton" style={{ height: 36 }} />
              ))}
            </div>
          ) : data.recent.length === 0 ? (
            <p className="empty">Nada publicado ainda.</p>
          ) : (
            <ol className="timeline">
              {data.recent.map((r) => (
                <li key={r.id}>
                  <span className="eta">
                    {hhmm(r.postedAt)}
                    <small>{dayLabel(r.postedAt)}</small>
                  </span>
                  <Thumb src={r.product.imageUrl} size={36} />
                  <span className="clamp" style={{ fontSize: 13, minWidth: 0 }} title={fmtDate(r.postedAt)}>
                    {r.product.title}
                  </span>
                  <span className="muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                    {r._count.clicks} <LuMousePointerClick size={12} />
                  </span>
                </li>
              ))}
            </ol>
          )}
          {data && (
            <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => onGo('posts')}>
              Ver todos os posts
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
