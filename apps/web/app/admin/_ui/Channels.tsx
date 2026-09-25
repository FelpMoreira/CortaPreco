'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuBot, LuPencil, LuPlus, LuPower, LuRadioTower, LuSave, LuSend, LuX } from 'react-icons/lu';
import { adminFetch, type Me, type Notify } from './common';
import { ChannelSources, type SourceRow } from './Sources';
import { PageHeader } from './ui';

interface ChannelRow {
  id: string;
  name: string;
  platform: 'TELEGRAM' | 'WHATSAPP';
  target: string;
  enabled: boolean;
  categories: string[];
  postsPerHour: number;
  postsPerDay: number;
  quietHours: string;
  jitterPct: number;
  warmupDays: number;
  generalMinScore: number;
  _count: { posts: number };
  sources: SourceRow[];
}
interface Category {
  slug: string;
  label: string;
}
type Draft = Omit<ChannelRow, 'id' | 'enabled' | '_count' | 'sources'>;

const EMPTY: Draft = {
  name: '',
  platform: 'TELEGRAM',
  target: '',
  categories: [],
  postsPerHour: 3,
  postsPerDay: 0,
  quietHours: '23-7',
  jitterPct: 0,
  warmupDays: 0,
  generalMinScore: 80,
};

function ChannelForm({
  initial,
  categories,
  onSave,
  onCancel,
  busy,
}: {
  initial: Draft;
  categories: Category[];
  onSave: (d: Draft) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [d, setD] = useState<Draft>(initial);
  const num = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: Number(e.target.value) });
  const toggle = (slug: string) =>
    setD({ ...d, categories: d.categories.includes(slug) ? d.categories.filter((c) => c !== slug) : [...d.categories, slug] });

  return (
    <form
      className="grid"
      style={{ gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <div className="grid cols-3" style={{ gap: 12 }}>
        <label className="field">
          <span>Nome (aparece no painel)</span>
          <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required minLength={2} maxLength={60} placeholder="Ex.: CortaPreço Games" />
        </label>
        <label className="field">
          <span>Plataforma</span>
          <select
            className="input"
            value={d.platform}
            onChange={(e) => {
              const wa = e.target.value === 'WHATSAPP';
              // WhatsApp (não oficial) já vem com ritmo conservador
              setD({ ...d, platform: e.target.value as Draft['platform'], postsPerHour: wa ? 2 : 3, postsPerDay: wa ? 15 : 0, quietHours: wa ? '22-8' : '23-7', jitterPct: wa ? 35 : 0, warmupDays: wa ? 14 : 0 });
            }}
          >
            <option value="TELEGRAM">Telegram</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </label>
        <label className="field">
          <span>{d.platform === 'TELEGRAM' ? 'ID do grupo (-100…) ou @canal' : 'JID (…@g.us ou …@newsletter)'}</span>
          <input className="input" value={d.target} onChange={(e) => setD({ ...d, target: e.target.value.trim() })} required placeholder={d.platform === 'TELEGRAM' ? '-1001234567890' : '1203630000000@g.us'} />
        </label>
      </div>

      <div className="field">
        <span>Categorias que este canal recebe — nenhuma marcada = recebe tudo (grupo geral)</span>
        <div className="chips">
          {categories.map((c) => (
            <button type="button" key={c.slug} className="chip" aria-pressed={d.categories.includes(c.slug)} onClick={() => toggle(c.slug)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid cols-4" style={{ gap: 12 }}>
        <label className="field">
          <span>Posts por hora</span>
          <input className="input" type="number" min={1} max={30} value={d.postsPerHour} onChange={num('postsPerHour')} />
        </label>
        <label className="field">
          <span>Teto por dia (0 = sem teto)</span>
          <input className="input" type="number" min={0} max={500} value={d.postsPerDay} onChange={num('postsPerDay')} />
        </label>
        <label className="field">
          <span>Silêncio (ex.: 23-7)</span>
          <input className="input" value={d.quietHours} onChange={(e) => setD({ ...d, quietHours: e.target.value.trim() })} pattern="^(\d{1,2}-\d{1,2})?$" placeholder="vazio = sem silêncio" />
        </label>
        <label className="field">
          <span>Variação do intervalo (%)</span>
          <input className="input" type="number" min={0} max={80} value={d.jitterPct} onChange={num('jitterPct')} />
        </label>
      </div>
      {d.categories.length === 0 && (
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Canal geral: receber ofertas garimpadas pelos grupos de nicho só com nota ≥</span>
          <input className="input" type="number" min={0} max={101} value={d.generalMinScore} onChange={num('generalMinScore')} />
        </label>
      )}
      {d.platform === 'WHATSAPP' && (
        <p className="warn" style={{ margin: 0, fontSize: 13 }}>
          WhatsApp usa API não oficial: vários grupos no mesmo número somam no risco de banimento. Mantenha o ritmo baixo.
        </p>
      )}
      <div className="row">
        <button className="btn" disabled={busy}>
          <LuSave size={16} /> {busy ? 'Verificando…' : 'Salvar'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
          <LuX size={16} /> Cancelar
        </button>
      </div>
    </form>
  );
}

export function ChannelsTab({ me, notify }: { me: Me; notify: Notify }) {
  const [data, setData] = useState<{ channels: ChannelRow[]; categories: Category[] } | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const isDev = me.role === 'DEV';

  const load = useCallback(async () => {
    try {
      setData(await adminFetch('channels'));
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [notify]);
  useEffect(() => void load(), [load]);

  const label = (slug: string) => data?.categories.find((c) => c.slug === slug)?.label ?? slug;

  async function save(id: string | 'new', raw: Draft) {
    // só os campos editáveis: a API recusa campos desconhecidos (id, contadores, fontes…)
    const d: Draft = {
      name: raw.name,
      platform: raw.platform,
      target: raw.target,
      categories: raw.categories,
      postsPerHour: raw.postsPerHour,
      postsPerDay: raw.postsPerDay,
      quietHours: raw.quietHours,
      jitterPct: raw.jitterPct,
      warmupDays: raw.warmupDays,
      generalMinScore: raw.generalMinScore,
    };
    setBusy(true);
    try {
      if (id === 'new') {
        const r = await adminFetch<{ chat: string | null }>('channels', { method: 'POST', body: d });
        notify('success', r.chat ? `Canal criado: o bot está em "${r.chat}".` : 'Canal criado.');
      } else {
        await adminFetch(`channels/${id}`, { method: 'PATCH', body: d });
        notify('success', 'Canal atualizado.');
      }
      setEditing(null);
      await load();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(c: ChannelRow, what: 'test' | 'toggle') {
    try {
      if (what === 'test') {
        const r = await adminFetch<{ chat: string }>(`channels/${c.id}/test`, { method: 'POST' });
        notify('success', `Mensagem de teste enviada para "${r.chat}".`);
      } else {
        await adminFetch(`channels/${c.id}`, { method: 'PATCH', body: { enabled: !c.enabled } });
        notify('success', c.enabled ? 'Canal pausado: não recebe novos posts.' : 'Canal reativado.');
        await load();
      }
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <PageHeader
        icon={<LuRadioTower size={22} />}
        title="Canais"
        subtitle="Grupos e canais onde as ofertas saem, com as categorias e o ritmo de cada um."
        actions={
          isDev && editing !== 'new' ? (
            <button className="btn sm" onClick={() => setEditing('new')}>
              <LuPlus size={14} /> Novo canal
            </button>
          ) : null
        }
      />

      <div className="banner idle" style={{ alignItems: 'flex-start' }}>
        <LuBot size={18} style={{ flex: 'none', marginTop: 2 }} />
        <span>
          <strong>Um bot para todos os grupos.</strong> Para adicionar um grupo do Telegram: crie o grupo, adicione o bot como
          <strong> administrador</strong>, mande <code>/chatid</code> lá dentro e cole o número aqui. O sistema confere se o bot pode postar
          antes de salvar.
        </span>
      </div>

      {editing === 'new' && data && (
        <section className="panel accent">
          <h3 className="panel-title">
            <LuPlus size={18} /> Novo canal
          </h3>
          <ChannelForm initial={EMPTY} categories={data.categories} busy={busy} onSave={(d) => void save('new', d)} onCancel={() => setEditing(null)} />
        </section>
      )}

      {!data ? (
        <span className="skeleton" style={{ height: 120 }} />
      ) : (
        data.channels.map((c) => (
          <section key={c.id} className={`panel${c.enabled ? '' : ''}`} style={c.enabled ? undefined : { opacity: 0.6 }}>
            {editing === c.id ? (
              <ChannelForm
                initial={c}
                categories={data.categories}
                busy={busy}
                onSave={(d) => void save(c.id, d)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                  <div className="row">
                    <strong style={{ fontSize: 16 }}>{c.name}</strong>
                    <span className={`badge ${c.platform}`}>{c.platform === 'TELEGRAM' ? 'Telegram' : 'WhatsApp'}</span>
                    {!c.enabled && <span className="badge CANCELED">Pausado</span>}
                  </div>
                  <span className="muted">
                    <code>{c.target}</code> · {c.postsPerHour}/h · teto {c.postsPerDay || 'livre'}/dia
                    {c.quietHours ? ` · silêncio ${c.quietHours.replace('-', 'h–')}h` : ''}
                    {c.jitterPct ? ` · variação ±${c.jitterPct}%` : ''} · {c._count.posts} na fila
                  </span>
                  <div className="chips">
                    {c.categories.length === 0 ? (
                      <span className="chip" aria-pressed="true">
                        Geral: recebe tudo · dos nichos só nota ≥ {c.generalMinScore}
                      </span>
                    ) : (
                      c.categories.map((slug) => (
                        <span key={slug} className="chip">
                          {label(slug)}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                {isDev && (
                  <div className="row" style={{ flexWrap: 'nowrap', alignSelf: 'flex-start' }}>
                    {c.platform === 'TELEGRAM' && (
                      <button className="btn ghost sm" title="Enviar mensagem de teste" onClick={() => void act(c, 'test')}>
                        <LuSend size={14} /> Testar
                      </button>
                    )}
                    <button className="btn ghost sm" onClick={() => setEditing(c.id)}>
                      <LuPencil size={14} /> Editar
                    </button>
                    <button className={`btn ${c.enabled ? 'danger' : 'ghost'} sm`} onClick={() => void act(c, 'toggle')} title={c.enabled ? 'Pausar' : 'Reativar'}>
                      <LuPower size={14} /> {c.enabled ? 'Pausar' : 'Reativar'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {editing !== c.id && (
              <ChannelSources
                channelId={c.id}
                categories={c.categories}
                sources={c.sources}
                canEdit={isDev}
                notify={notify}
                onChanged={() => void load()}
              />
            )}
          </section>
        ))
      )}
    </div>
  );
}
