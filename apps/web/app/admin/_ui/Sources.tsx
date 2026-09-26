'use client';

import { useEffect, useState } from 'react';
import { LuPlay, LuPlus, LuRepeat2, LuSave, LuSend, LuStore, LuTrash2, LuX } from 'react-icons/lu';
import { adminFetch, fmtDate, type Notify } from './common';
import { CouponFormFields, CouponSourceCard, MirrorCard, MirrorFormFields, type MirrorPresets } from './Mirror';

export interface SourceRow {
  id: string;
  kind: 'API' | 'TELEGRAM' | 'MIRROR' | 'COUPONS';
  label: string;
  enabled: boolean;
  stores: string[];
  keywords: string[];
  promos: string[];
  telegramChat: string | null;
  minDiscount: number;
  minRating: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  excludeWords: string[];
  maxPerRun: number;
  intervalMin: number;
  autoApprove: boolean;
  autoMinScore: number;
  // espelhamento (MIRROR)
  chatTitle: string | null;
  linkTypes: string[];
  maxDelaySec: number;
  respectQuiet: boolean;
  minGapSec: number;
  postCoupons: boolean;
  alert: string | null;
  alertAt: string | null;
  alertCount: number;
  lastRunAt: string | null;
  lastResult: string | null;
}

export interface Presets {
  searchTerms: Record<string, string[]>;
  promos: string[];
  stores: Record<'ALIEXPRESS' | 'SHOPEE' | 'AMAZON', boolean>;
  telegramReader: boolean;
  mirror: MirrorPresets;
}

const STORE_NAME: Record<string, string> = { ALIEXPRESS: 'AliExpress', SHOPEE: 'Shopee', AMAZON: 'Amazon' };

/** Campo de lista em "chips": digita e Enter adiciona; clique remove. */
function ChipsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const parts = text.split(',').map((t) => t.trim()).filter((t) => t.length >= 2);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setText('');
  };
  return (
    <div className="grid" style={{ gap: 6 }}>
      <div className="chips">
        {value.map((v) => (
          <button type="button" key={v} className="chip" aria-pressed="true" title="Remover" onClick={() => onChange(value.filter((x) => x !== v))}>
            {v} <LuX size={11} />
          </button>
        ))}
      </div>
      <input
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

type Draft = Omit<SourceRow, 'id' | 'lastRunAt' | 'lastResult' | 'enabled' | 'chatTitle' | 'alert' | 'alertAt' | 'alertCount'>;

function SourceForm({
  initial,
  presets,
  onSave,
  onCancel,
  busy,
}: {
  initial: Draft;
  presets: Presets;
  onSave: (d: Draft) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [d, setD] = useState<Draft>(initial);
  const numOrNull = (v: string) => (v.trim() === '' ? null : v.replace(',', '.'));
  const toggleStore = (s: string) => setD({ ...d, stores: d.stores.includes(s) ? d.stores.filter((x) => x !== s) : [...d.stores, s] });

  return (
    <form
      className="grid"
      style={{ gap: 12, padding: 14, border: '1px dashed var(--border)', borderRadius: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      {d.kind === 'COUPONS' && (
        <>
          <label className="field">
            <span>Nome</span>
            <input className="input" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} required minLength={2} maxLength={60} />
          </label>
          <CouponFormFields d={d} setD={setD} />
        </>
      )}
      {d.kind === 'MIRROR' && (
        <>
          <label className="field">
            <span>Nome do fluxo</span>
            <input className="input" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} required minLength={2} maxLength={60} />
          </label>
          <MirrorFormFields d={d} setD={setD} presets={presets.mirror} />
        </>
      )}
      {d.kind !== 'MIRROR' && d.kind !== 'COUPONS' && (
      <>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <label className="field">
          <span>Nome da fonte</span>
          <input className="input" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} required minLength={2} maxLength={60} />
        </label>
        {d.kind === 'TELEGRAM' ? (
          <label className="field">
            <span>Grupo/canal de origem (@usuario ou ID)</span>
            <input
              className="input"
              value={d.telegramChat ?? ''}
              onChange={(e) => setD({ ...d, telegramChat: e.target.value.trim().replace(/^https?:\/\/t\.me\//, '@') })}
              placeholder="@canaldeofertas"
              required
            />
          </label>
        ) : (
          <div className="field">
            <span>Lojas</span>
            <div className="chips">
              {(['ALIEXPRESS', 'SHOPEE', 'AMAZON'] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  className="chip"
                  disabled={!presets.stores[s]}
                  title={presets.stores[s] ? '' : s === 'AMAZON' ? 'Precisa da Creators API (10 vendas em 30 dias)' : 'Sem credencial no .env'}
                  aria-pressed={d.stores.includes(s)}
                  onClick={() => toggleStore(s)}
                  style={presets.stores[s] ? undefined : { opacity: 0.45, cursor: 'not-allowed' }}
                >
                  <LuStore size={11} /> {STORE_NAME[s]}
                  {!presets.stores[s] && ' (indisponível)'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <span>{d.kind === 'API' ? 'Termos de busca (a busca gira entre eles; Enter adiciona)' : 'Termos do nicho (opcional: título com um deles conta como do nicho)'}</span>
        <ChipsInput value={d.keywords} onChange={(keywords) => setD({ ...d, keywords })} placeholder="ex.: headset gamer" />
      </div>

      {d.kind === 'API' && d.stores.includes('ALIEXPRESS') && presets.promos.length > 0 && (
        <div className="field">
          <span>Promoções do AliExpress (opcional — curadoria deles)</span>
          <div className="chips">
            {presets.promos.map((p) => (
              <button
                type="button"
                key={p}
                className="chip"
                aria-pressed={d.promos.includes(p)}
                onClick={() => setD({ ...d, promos: d.promos.includes(p) ? d.promos.filter((x) => x !== p) : [...d.promos, p] })}
              >
                {p.replace(/^AEB_|_\d{8}$/g, '').replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span>Palavras a excluir (título com elas é descartado)</span>
        <ChipsInput value={d.excludeWords} onChange={(excludeWords) => setD({ ...d, excludeWords })} placeholder="ex.: capinha, película" />
      </div>

      <div className="grid cols-4" style={{ gap: 12 }}>
        <label className="field">
          <span>Desconto mínimo (%)</span>
          <input className="input" type="number" min={0} max={95} value={d.minDiscount} onChange={(e) => setD({ ...d, minDiscount: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Nota mínima (0–5)</span>
          <input className="input" inputMode="decimal" value={d.minRating ?? ''} onChange={(e) => setD({ ...d, minRating: numOrNull(e.target.value) })} placeholder="ex.: 4.5" />
        </label>
        <label className="field">
          <span>Preço mín. / máx. (R$)</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" inputMode="decimal" value={d.minPrice ?? ''} onChange={(e) => setD({ ...d, minPrice: numOrNull(e.target.value) })} placeholder="mín." />
            <input className="input" inputMode="decimal" value={d.maxPrice ?? ''} onChange={(e) => setD({ ...d, maxPrice: numOrNull(e.target.value) })} placeholder="máx." />
          </div>
        </label>
        <label className="field">
          <span>{d.autoApprove ? 'Ofertas por busca / intervalo mín. (min)' : 'Sugestões por rodada / a cada (min)'}</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" type="number" min={1} max={20} value={d.maxPerRun} onChange={(e) => setD({ ...d, maxPerRun: Number(e.target.value) })} />
            <input className="input" type="number" min={10} max={1440} value={d.intervalMin} onChange={(e) => setD({ ...d, intervalMin: Number(e.target.value) })} />
          </div>
        </label>
      </div>

      <div className="auto-box">
        <label className="row" style={{ gap: 10, cursor: 'pointer', flexWrap: 'nowrap' }}>
          <input
            type="checkbox"
            checked={d.autoApprove}
            // no automático o intervalo é só o mínimo entre buscas: 15 min deixa a fila ser reposta logo
            onChange={(e) => setD({ ...d, autoApprove: e.target.checked, intervalMin: e.target.checked ? Math.min(d.intervalMin, 15) : d.intervalMin })}
          />
          <span>
            <strong>Postar automaticamente</strong>
            <span className="muted" style={{ display: 'block', fontSize: 13 }}>
              Busca sozinha sempre que a fila do canal estiver acabando e manda para a fila o que tiver nota alta, sem
              passar pela aba Sugestões. Ritmo e silêncio de madrugada do canal continuam valendo.
            </span>
          </span>
        </label>
        {d.autoApprove && (
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Nota mínima para ir sozinha (0–100)</span>
            <input className="input" type="number" min={0} max={100} value={d.autoMinScore} onChange={(e) => setD({ ...d, autoMinScore: Number(e.target.value) })} />
          </label>
        )}
      </div>

      {d.kind === 'TELEGRAM' && !presets.telegramReader && (
        <p className="warn" style={{ margin: 0, fontSize: 13 }}>
          A leitura de outros grupos precisa de uma conta do Telegram dedicada (etapa 2). A fonte fica salva e passa a funcionar
          quando a conta for conectada.
        </p>
      )}
      <p className="muted" style={{ margin: 0 }}>
        Só usamos o link do produto: texto, imagem e link de afiliado da oferta são sempre nossos.
      </p>
      </>
      )}
      {(d.kind === 'MIRROR' || d.kind === 'COUPONS') && !presets.telegramReader && (
        <p className="warn" style={{ margin: 0, fontSize: 13 }}>
          Para observar o grupo falta conectar a conta dedicada do Telegram (npm run telegram:login). O fluxo fica salvo e
          começa sozinho quando a conta for conectada.
        </p>
      )}
      <div className="row">
        <button className="btn sm" disabled={busy}>
          <LuSave size={14} /> Salvar fonte
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Seção "Fontes de ofertas" dentro do card de um canal. */
export function ChannelSources({
  channelId,
  categories,
  platform,
  quietHours,
  sources,
  canEdit,
  notify,
  onChanged,
}: {
  channelId: string;
  categories: string[];
  platform: string;
  quietHours: string;
  sources: SourceRow[];
  canEdit: boolean;
  notify: Notify;
  onChanged: () => void;
}) {
  const [presets, setPresets] = useState<Presets | null>(null);
  const [editing, setEditing] = useState<string | 'new-api' | 'new-tg' | 'new-mirror' | 'new-coupons' | null>(null);
  const [busy, setBusy] = useState(false);
  const hasMirror = sources.some((s) => s.kind === 'MIRROR' || s.kind === 'COUPONS');

  // presets também trazem a saúde do espelhamento (ouvinte/conversor): recarrega junto com o canal
  useEffect(() => {
    if (editing || hasMirror) adminFetch<Presets>('sources/presets').then(setPresets).catch((e: Error) => notify('error', e.message));
  }, [editing, hasMirror, sources, notify]);

  const blank = (kind: 'API' | 'TELEGRAM' | 'MIRROR' | 'COUPONS'): Draft => ({
    kind,
    label: kind === 'API' ? 'APIs oficiais' : kind === 'MIRROR' ? 'Espelhamento de grupo' : kind === 'COUPONS' ? 'Grupo de cupons' : 'Grupo do Telegram',
    stores:
      kind === 'COUPONS'
        ? ['MERCADOLIVRE', 'AMAZON', 'SHOPEE', 'ALIEXPRESS']
        : kind === 'API' && presets?.stores.ALIEXPRESS
          ? ['ALIEXPRESS']
          : [],
    // termos prontos das categorias do canal (editáveis)
    keywords: kind === 'API' ? [...new Set(categories.flatMap((c) => presets?.searchTerms[c] ?? []))] : [],
    promos: [],
    telegramChat: kind === 'API' ? null : '',
    minDiscount: kind === 'API' ? 15 : 0,
    minRating: kind === 'API' ? '4.5' : null,
    minPrice: null,
    maxPrice: null,
    excludeWords: [],
    maxPerRun: 5,
    intervalMin: kind === 'API' ? 120 : 30,
    autoApprove: false,
    autoMinScore: 70,
    // grupos de oferta misturam lojas: já vem com todos os tipos que dá para converter
    linkTypes: kind === 'MIRROR' ? ['MERCADOLIVRE', ...(presets?.mirror.amazonTag ? ['AMAZON'] : [])] : [],
    maxDelaySec: presets?.mirror.defaultMaxDelaySec ?? 150,
    respectQuiet: true,
    minGapSec: 180,
    postCoupons: false,
  });

  async function save(id: string | null, d: Draft) {
    setBusy(true);
    try {
      const body = d.kind === 'COUPONS' ? {
        label: d.label,
        kind: d.kind,
        telegramChat: d.telegramChat,
        stores: d.stores,
        postCoupons: d.postCoupons,
        minGapSec: d.minGapSec,
        respectQuiet: d.respectQuiet,
      } : d.kind === 'MIRROR' ? {
        label: d.label,
        kind: d.kind,
        telegramChat: d.telegramChat,
        linkTypes: d.linkTypes,
        maxDelaySec: d.maxDelaySec,
        respectQuiet: d.respectQuiet,
        minGapSec: d.minGapSec,
      } : {
        label: d.label,
        kind: d.kind,
        stores: d.stores,
        keywords: d.keywords,
        promos: d.promos,
        excludeWords: d.excludeWords,
        minDiscount: d.minDiscount,
        maxPerRun: d.maxPerRun,
        intervalMin: d.intervalMin,
        autoApprove: d.autoApprove,
        autoMinScore: d.autoMinScore,
        minRating: d.minRating === null ? null : Number(d.minRating),
        minPrice: d.minPrice === null ? null : Number(d.minPrice),
        maxPrice: d.maxPrice === null ? null : Number(d.maxPrice),
        telegramChat: d.kind === 'TELEGRAM' ? d.telegramChat : undefined,
      };
      if (id) await adminFetch(`sources/${id}`, { method: 'PATCH', body: { ...body, kind: undefined } });
      else await adminFetch(`channels/${channelId}/sources`, { method: 'POST', body });
      notify('success', 'Fonte salva.');
      setEditing(null);
      onChanged();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: SourceRow) {
    const what = s.kind === 'MIRROR' ? 'o espelhamento' : s.kind === 'COUPONS' ? 'o grupo de cupons' : 'a fonte';
    if (!window.confirm(`Remover ${what} "${s.label}"${s.telegramChat ? ` (${s.telegramChat})` : ''}? O histórico dela some; sugestões, cupons e posts já agendados continuam.`)) return;
    try {
      await adminFetch(`sources/${s.id}`, { method: 'DELETE' });
      notify('success', 'Fonte removida.');
      setEditing(null);
      onChanged();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }

  async function act(s: SourceRow, what: 'run' | 'toggle') {
    try {
      if (what === 'run') {
        await adminFetch(`sources/${s.id}/run`, { method: 'POST' });
        notify('success', 'Rodando a fonte. As sugestões aparecem na aba Sugestões em instantes.');
      } else {
        await adminFetch(`sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } });
        onChanged();
      }
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'grid', gap: 10 }}>
      <div className="spread">
        <p className="label" style={{ margin: 0 }}>Fontes de ofertas</p>
        {canEdit && !editing && (
          <div className="row">
            <button className="btn ghost sm" onClick={() => setEditing('new-api')}>
              <LuPlus size={13} /> APIs oficiais
            </button>
            <button className="btn ghost sm" onClick={() => setEditing('new-tg')}>
              <LuSend size={13} /> Grupo do Telegram
            </button>
            {platform === 'TELEGRAM' && (
              <button className="btn ghost sm" onClick={() => setEditing('new-mirror')} title="Observa um grupo e reposta as ofertas com o nosso link">
                <LuRepeat2 size={13} /> Espelhar grupo
              </button>
            )}
            {platform === 'TELEGRAM' && (
              <button className="btn ghost sm" onClick={() => setEditing('new-coupons')} title="Coleta cupons de um grupo só de cupons">
                🎟️ Grupo de cupons
              </button>
            )}
          </div>
        )}
      </div>

      {sources.length === 0 && !editing && (
        <p className="muted" style={{ margin: 0 }}>
          Nenhuma fonte: este canal só recebe o que for aprovado manualmente{categories.length ? ' da categoria dele' : ''}.
        </p>
      )}

      {sources.map((s) =>
        editing === s.id && presets ? (
          <SourceForm key={s.id} initial={s} presets={presets} busy={busy} onSave={(d) => void save(s.id, d)} onCancel={() => setEditing(null)} />
        ) : s.kind === 'COUPONS' ? (
          <CouponSourceCard
            key={s.id}
            s={s}
            presets={presets?.mirror ?? null}
            canEdit={canEdit}
            notify={notify}
            onEdit={() => setEditing(s.id)}
            onRemove={() => void remove(s)}
            onChanged={onChanged}
          />
        ) : s.kind === 'MIRROR' ? (
          <MirrorCard
            key={s.id}
            s={s}
            presets={presets?.mirror ?? null}
            canEdit={canEdit}
            quietHours={quietHours}
            notify={notify}
            onEdit={() => setEditing(s.id)}
            onRemove={() => void remove(s)}
            onChanged={onChanged}
          />
        ) : (
          <div key={s.id} className="spread" style={{ alignItems: 'flex-start', opacity: s.enabled ? 1 : 0.55 }}>
            <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
              <strong style={{ fontSize: 14 }}>
                {s.kind === 'API' ? <LuStore size={13} /> : <LuSend size={13} />} {s.label}
                <span className="muted" style={{ fontWeight: 400 }}>
                  {' '}
                  · {s.kind === 'API' ? s.stores.map((x) => STORE_NAME[x]).join(', ') : s.telegramChat}
                </span>
              </strong>
              <span className="muted">
                {s.keywords.length ? `${s.keywords.slice(0, 5).join(', ')}${s.keywords.length > 5 ? '…' : ''} · ` : ''}
                desc. ≥ {s.minDiscount}%{s.minRating ? ` · nota ≥ ${Number(s.minRating)}` : ''} · até {s.maxPerRun} {s.autoApprove ? `por busca (mín. ${s.intervalMin} min entre buscas)` : `a cada ${s.intervalMin} min`}
              </span>
              <span className="muted">
                {s.autoApprove ? (
                  <span className="badge POSTED">Automático · busca quando a fila acaba · nota ≥ {s.autoMinScore}</span>
                ) : (
                  <span className="badge">Com aprovação</span>
                )}
              </span>
              <span className="muted">
                {s.lastRunAt ? `Última rodada ${fmtDate(s.lastRunAt)}: ${s.lastResult ?? '—'}` : 'Ainda não rodou'}
              </span>
            </div>
            {canEdit && (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <button className="btn ghost sm" onClick={() => void act(s, 'run')} disabled={!s.enabled} title="Rodar agora">
                  <LuPlay size={13} />
                </button>
                <button className="btn ghost sm" onClick={() => setEditing(s.id)}>
                  Editar
                </button>
                <button className="btn ghost sm" onClick={() => void act(s, 'toggle')}>
                  {s.enabled ? 'Pausar' : 'Ativar'}
                </button>
                <button className="btn danger sm" onClick={() => void remove(s)} title="Remover esta fonte">
                  <LuTrash2 size={13} />
                </button>
              </div>
            )}
          </div>
        ),
      )}

      {(editing === 'new-api' || editing === 'new-tg' || editing === 'new-mirror' || editing === 'new-coupons') &&
        (presets ? (
          <SourceForm
            initial={blank(editing === 'new-api' ? 'API' : editing === 'new-mirror' ? 'MIRROR' : editing === 'new-coupons' ? 'COUPONS' : 'TELEGRAM')}
            presets={presets}
            busy={busy}
            onSave={(d) => void save(null, d)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <span className="skeleton" style={{ height: 80 }} />
        ))}
    </div>
  );
}
