'use client';

import type { ReactNode } from 'react';
import { LuCircleCheck, LuHourglass, LuInbox, LuSend, LuTag } from 'react-icons/lu';
import { CATEGORIES } from '@cupons/shared';

export function PageHeader({ icon, title, subtitle, actions }: { icon: ReactNode; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <span className="page-icon" aria-hidden>
        {icon}
      </span>
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'violet';

export function StatCard({ label, value, hint, icon, tone = 'green' }: { label: string; value: ReactNode; hint?: string; icon: ReactNode; tone?: Tone }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-top">
        <p className="label">{label}</p>
        <span className="stat-icon" aria-hidden>
          {icon}
        </span>
      </div>
      <p className="stat-value">{value}</p>
      {hint && <p className="stat-hint">{hint}</p>}
    </div>
  );
}

export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="stats" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="stat-card" style={{ display: 'grid', gap: 10 }}>
          <span className="skeleton" style={{ width: '60%' }} />
          <span className="skeleton" style={{ width: '40%', height: 26 }} />
          <span className="skeleton" style={{ width: '80%' }} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- situação da fila

export interface ChannelOverview {
  id: string;
  name: string;
  platform: string;
  postsPerHour: number;
  quietHours: string;
  ready: boolean;
  nextAt: string | null;
  reason: 'ready' | 'empty' | 'sending' | 'gap' | 'hourly' | 'daily' | 'quiet';
  scheduled: number;
  postedLastHour: number;
  postedLast24h: number;
  dailyCap: number | null;
  upcoming: { id: string; eta: string; priority?: number; product: { title: string; store: string; imageUrl: string | null } }[];
}

export const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '—';

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const fmt = (x: Date) => x.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return fmt(d) === fmt(today) ? 'hoje' : fmt(d) === fmt(tomorrow) ? 'amanhã' : fmt(d).slice(0, 5);
};
export { dayLabel };

/** Explica em português por que a fila do canal está esperando (mesma regra do agendador). */
export function reasonText(c: ChannelOverview): string {
  const gap = Math.round(60 / Math.max(c.postsPerHour, 1));
  switch (c.reason) {
    case 'ready':
      return 'pode sair agora — o agendador envia em até 1 minuto';
    case 'sending':
      return 'enviando um post neste momento';
    case 'empty':
      return 'fila vazia — aprove sugestões ou agende ofertas';
    case 'gap':
      return `intervalo mínimo entre posts (1 a cada ~${gap} min)`;
    case 'hourly':
      return `limite de ${c.postsPerHour} posts por hora atingido (o "postar agora" também conta)`;
    case 'daily':
      return `teto de ${c.dailyCap} posts em 24h atingido`;
    case 'quiet':
      return `horário de silêncio (${c.quietHours.replace('-', 'h–')}h)`;
  }
}

export function QueueBanner({ channel: c }: { channel: ChannelOverview }) {
  const kind = c.reason === 'empty' ? 'idle' : c.ready || c.reason === 'sending' ? 'go' : 'wait';
  const icon = kind === 'idle' ? <LuInbox size={20} /> : kind === 'go' ? (c.reason === 'sending' ? <LuSend size={20} /> : <LuCircleCheck size={20} />) : <LuHourglass size={20} />;
  return (
    <div className={`banner ${kind}`} role="status">
      <span style={{ color: kind === 'wait' ? '#f59e0b' : kind === 'go' ? 'var(--accent)' : 'var(--muted)', display: 'grid' }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <strong>
          {c.name}:{' '}
          {c.reason === 'empty'
            ? 'nada na fila'
            : c.ready || c.reason === 'sending'
              ? 'saindo agora'
              : `próximo post às ${hhmm(c.nextAt)}${c.nextAt && dayLabel(c.nextAt) !== 'hoje' ? ` (${dayLabel(c.nextAt)})` : ''}`}
        </strong>
        <span className="muted"> · {reasonText(c)}</span>
      </div>
      <span className="muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
        {c.scheduled} na fila
      </span>
    </div>
  );
}

/** Categoria do produto: define para quais grupos o post vai. */
export function CategorySelect({ value, onChange, disabled }: { value: string | null; onChange: (slug: string) => void; disabled?: boolean }) {
  return (
    <label className="row" style={{ gap: 6, flexWrap: 'nowrap' }} title="Categoria: define para quais grupos o post vai">
      <LuTag size={14} style={{ color: 'var(--muted)', flex: 'none' }} />
      <select
        className="input"
        style={{ padding: '5px 8px', width: 'auto', fontSize: 13 }}
        value={value ?? 'outros'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {CATEGORIES.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}
