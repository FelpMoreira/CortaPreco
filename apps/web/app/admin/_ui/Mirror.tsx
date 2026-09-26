'use client';

import { useEffect, useState } from 'react';
import {
  LuBellOff,
  LuChevronDown,
  LuChevronRight,
  LuCircleCheck,
  LuCircleDashed,
  LuCircleX,
  LuHistory,
  LuRepeat2,
  LuTrash2,
  LuTriangleAlert,
} from 'react-icons/lu';
import { adminFetch, fmtDate, type Notify } from './common';

/**
 * Espelhamento de grupo do Telegram (fonte MIRROR): observa um grupo de promoções, converte os links
 * tratáveis (Mercado Livre: meli.la; Amazon: amzn.to) para o NOSSO link de afiliado e posta no canal com atraso
 * aleatório. Detalhes: cofre/10 - Espelhamento Mercado Livre.md
 */

export interface MirrorPresets {
  linkTypes: Record<string, { label: string; hint: string }>;
  defaultMaxDelaySec: number;
  amazonTag: boolean;
  listener: { ok?: boolean; reason?: string; watching?: { sourceId: string; title: string }[]; at?: string } | null;
  linker: { online?: boolean; session?: string; lastError?: string | null; lastOkAt?: string | null; at?: string } | null;
}

export interface MirrorFields {
  telegramChat: string | null;
  chatTitle?: string | null;
  linkTypes: string[];
  maxDelaySec: number;
  respectQuiet: boolean;
  minGapSec: number;
}

export const fmtDelay = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Campos do espelhamento dentro do formulário de fonte. */
export function MirrorFormFields<T extends MirrorFields>({
  d,
  setD,
  presets,
}: {
  d: T;
  setD: (next: T) => void;
  presets: MirrorPresets;
}) {
  const toggle = (t: string) => setD({ ...d, linkTypes: d.linkTypes.includes(t) ? d.linkTypes.filter((x) => x !== t) : [...d.linkTypes, t] });
  return (
    <>
      <label className="field">
        <span>Grupo observado (@usuario, link t.me ou ID)</span>
        <input
          className="input"
          value={d.telegramChat ?? ''}
          onChange={(e) => setD({ ...d, telegramChat: e.target.value.trim().replace(/^https?:\/\/t\.me\//, '@') })}
          placeholder="@grupodepromocoes"
          required
        />
      </label>
      <div className="field">
        <span>Que links pegar</span>
        <div className="chips">
          {Object.entries(presets.linkTypes).map(([key, t]) => (
            <button type="button" key={key} className="chip" aria-pressed={d.linkTypes.includes(key)} title={t.hint} onClick={() => toggle(key)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          Mensagem sem esses tipos de link é ignorada. Com mais de um link, vale o primeiro. Mercado Livre usa o navegador
          logado na conta de afiliado; Amazon só troca a tag de quem postou pela nossa.
        </span>
      </div>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <label className="field">
          <span>Atraso máximo para repostar (segundos)</span>
          <input
            className="input"
            type="number"
            min={0}
            max={600}
            value={d.maxDelaySec}
            onChange={(e) => setD({ ...d, maxDelaySec: Number(e.target.value) })}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            Sorteado de 0 até {fmtDelay(d.maxDelaySec)} min, contado da mensagem original.
          </span>
        </label>
        <label className="field">
          <span>Intervalo mínimo entre posts (minutos)</span>
          <input
            className="input"
            type="number"
            min={0}
            max={60}
            step={0.5}
            value={d.minGapSec / 60}
            onChange={(e) => setD({ ...d, minGapSec: Math.round(Number(e.target.value) * 60) })}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            Se o grupo mandar várias ofertas de uma vez, as nossas saem espaçadas (com um pouco de variação).
          </span>
        </label>
        <label className="row" style={{ gap: 10, cursor: 'pointer', flexWrap: 'nowrap', alignSelf: 'center' }}>
          <input type="checkbox" checked={d.respectQuiet} onChange={(e) => setD({ ...d, respectQuiet: e.target.checked })} />
          <span>
            <strong>Respeitar o silêncio de madrugada</strong>
            <span className="muted" style={{ display: 'block', fontSize: 13 }}>
              Oferta que chegar no horário de silêncio do canal não é repostada.
            </span>
          </span>
        </label>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        O post usa os dados do produto (título, preço, imagem) e o <strong>nosso</strong> link de afiliado — nada do texto de
        quem postou. Vai direto para o canal, sem passar pela fila nem pela aba Sugestões.
      </p>
    </>
  );
}

type Health = { tone: 'ok' | 'wait' | 'bad'; text: string };

function listenerHealth(sourceId: string, enabled: boolean, p: MirrorPresets): Health {
  const l = p.listener;
  if (!l) return { tone: 'bad', text: 'Ouvinte do Telegram fora do ar (worker parado?)' };
  if (!l.ok) return { tone: 'bad', text: l.reason ?? 'Ouvinte do Telegram com problema' };
  const w = l.watching?.find((x) => x.sourceId === sourceId);
  if (w) return { tone: 'ok', text: `Ouvindo ${w.title}` };
  return enabled ? { tone: 'wait', text: 'Conectando ao grupo (até 1 min)…' } : { tone: 'wait', text: 'Desligado' };
}

function amazonHealth(p: MirrorPresets): Health {
  return p.amazonTag
    ? { tone: 'ok', text: 'Amazon: tag de afiliado configurada' }
    : { tone: 'bad', text: 'Amazon: falta AMAZON_PARTNER_TAG no .env' };
}

function linkerHealth(p: MirrorPresets, needsMlSession: boolean): Health {
  const k = p.linker;
  if (!k) return { tone: 'bad', text: 'Conversor fora do ar (serviço linker parado)' };
  if (!needsMlSession) return { tone: 'ok', text: 'Conversor no ar' };
  switch (k.session) {
    case 'ok':
      return { tone: 'ok', text: 'Conversor no ar · sessão do Mercado Livre ok' };
    case 'missing':
      return { tone: 'bad', text: 'Sem login no Mercado Livre: rode npm run ml:login na sua máquina' };
    case 'expired':
      return { tone: 'bad', text: 'Sessão do Mercado Livre expirou: rode npm run ml:login' };
    case 'blocked':
      return { tone: 'bad', text: 'O Mercado Livre pediu verificação de conta: entre pelo navegador e rode npm run ml:login' };
    default:
      return { tone: 'wait', text: 'Conversor no ar · sessão ainda não conferida' };
  }
}

function HealthLine({ h }: { h: Health }) {
  const Icon = h.tone === 'ok' ? LuCircleCheck : h.tone === 'bad' ? LuCircleX : LuCircleDashed;
  return (
    <span className={`health ${h.tone}`}>
      <Icon size={13} /> {h.text}
    </span>
  );
}

interface MirrorEvent {
  id: string;
  link: string;
  status: 'PENDING' | 'CONVERTED' | 'FAILED' | 'SKIPPED';
  detail: string | null;
  affiliateUrl: string | null;
  productUrl: string | null;
  coupon: string | null;
  createdAt: string;
  post: { status: string; postedAt: string | null; lastError: string | null } | null;
}

const EVENT_LABEL: Record<MirrorEvent['status'], string> = {
  PENDING: 'Convertendo',
  CONVERTED: 'Convertido',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorado',
};
const EVENT_BADGE: Record<MirrorEvent['status'], string> = { PENDING: 'POSTING', CONVERTED: 'POSTED', FAILED: 'FAILED', SKIPPED: 'CANCELED' };
const POST_LABEL: Record<string, string> = { POSTING: 'saindo', POSTED: 'postado', FAILED: 'envio falhou', CANCELED: 'cancelado', SCHEDULED: 'na fila' };

function EventList({ sourceId, notify }: { sourceId: string; notify: Notify }) {
  const [events, setEvents] = useState<MirrorEvent[] | null>(null);
  useEffect(() => {
    adminFetch<{ events: MirrorEvent[] }>(`sources/${sourceId}/events`)
      .then((r) => setEvents(r.events))
      .catch((e: Error) => {
        notify('error', e.message);
        setEvents([]);
      });
  }, [sourceId, notify]);
  if (events === null) return <span className="skeleton" style={{ height: 40 }} />;
  if (events.length === 0) return <p className="muted" style={{ margin: 0 }}>Nenhuma mensagem com link ainda.</p>;
  return (
    <ol className="event-list">
      {events.map((e) => (
        <li key={e.id}>
          <span className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.createdAt)}</span>
          <span className={`badge ${EVENT_BADGE[e.status]}`}>{EVENT_LABEL[e.status]}</span>
          <span style={{ minWidth: 0 }}>
            <code>{e.link}</code>
            {e.affiliateUrl && (
              <>
                {' → '}
                <code>{e.affiliateUrl}</code>
              </>
            )}
            {e.coupon && <span> · 🎟 <strong>{e.coupon}</strong></span>}
            {e.detail && <span className="muted"> · {e.detail}</span>}
            {e.post && (
              <span className="muted">
                {' · '}
                {POST_LABEL[e.post.status] ?? e.post.status}
                {e.post.lastError ? `: ${e.post.lastError}` : ''}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface MirrorSourceRow extends MirrorFields {
  id: string;
  label: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: string | null;
  alert: string | null;
  alertAt: string | null;
  alertCount: number;
}

/** Card do fluxo no canal: qual grupo, que links, liga/desliga, saúde das peças, alerta e histórico. */
export function MirrorCard({
  s,
  presets,
  canEdit,
  quietHours,
  notify,
  onEdit,
  onRemove,
  onChanged,
}: {
  s: MirrorSourceRow;
  presets: MirrorPresets | null;
  canEdit: boolean;
  quietHours: string;
  notify: Notify;
  onEdit: () => void;
  onRemove: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await adminFetch(`sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } });
      notify('success', s.enabled ? 'Espelhamento desligado.' : 'Espelhamento ligado: vale a partir da próxima mensagem do grupo.');
      onChanged();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    try {
      await adminFetch(`sources/${s.id}/dismiss-alert`, { method: 'POST' });
      onChanged();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }

  const types = s.linkTypes.map((t) => ({ key: t, label: presets?.linkTypes[t]?.label ?? t }));
  return (
    <div className={`mirror-card${s.enabled ? '' : ' off'}`}>
      <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 14 }}>
            <LuRepeat2 size={14} /> {s.label}
          </strong>
          <span>
            Observando <strong>{s.chatTitle ?? s.telegramChat}</strong>
            {s.chatTitle && s.chatTitle !== s.telegramChat && <span className="muted"> ({s.telegramChat})</span>}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className="muted">Pega links:</span>
            {types.map((t) => (
              <span key={t.key} className={`badge ${t.key}`}>
                {t.label}
              </span>
            ))}
            <span className="muted">
              · atraso 0–{fmtDelay(s.maxDelaySec)} min · intervalo mín. {fmtDelay(s.minGapSec)} min
              {s.respectQuiet && quietHours ? ` · pausa no silêncio (${quietHours.replace('-', 'h–')}h)` : ''}
            </span>
          </span>
        </div>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
          {canEdit && (
            <button className="btn ghost sm" onClick={onEdit}>
              Editar
            </button>
          )}
          {canEdit && (
            <button className="btn danger sm" onClick={onRemove} title="Remover">
              <LuTrash2 size={13} />
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={s.enabled}
            className="switch"
            disabled={!canEdit || busy}
            onClick={() => void toggle()}
            title={canEdit ? (s.enabled ? 'Desligar o espelhamento' : 'Ligar o espelhamento') : 'Só perfil DEV liga/desliga'}
          >
            <span className="switch-knob" />
            <span className="switch-label">{s.enabled ? 'Ativo' : 'Desligado'}</span>
          </button>
        </div>
      </div>

      {presets && (
        <div className="row" style={{ gap: 14 }}>
          <HealthLine h={listenerHealth(s.id, s.enabled, presets)} />
          <HealthLine h={linkerHealth(presets, s.linkTypes.includes('MERCADOLIVRE'))} />
          {s.linkTypes.includes('AMAZON') && <HealthLine h={amazonHealth(presets)} />}
        </div>
      )}

      {s.alert && (
        <div className="alert-box" role="alert">
          <LuTriangleAlert size={16} style={{ flex: 'none', marginTop: 1 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>{s.alert}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {s.alertAt ? fmtDate(s.alertAt) : ''}
              {s.alertCount > 1 ? ` · ${s.alertCount} ocorrências` : ''}
            </div>
          </div>
          <button className="btn ghost sm" onClick={() => void dismiss()} title="Some do painel; o histórico continua">
            <LuBellOff size={13} /> Dispensar
          </button>
        </div>
      )}

      <span className="muted">{s.lastRunAt ? `Última: ${s.lastResult ?? '—'} (${fmtDate(s.lastRunAt)})` : 'Nenhuma oferta espelhada ainda.'}</span>

      <button type="button" className="linkish" onClick={() => setHistory((h) => !h)}>
        {history ? <LuChevronDown size={13} /> : <LuChevronRight size={13} />} <LuHistory size={13} /> Últimas mensagens com link
      </button>
      {history && <EventList sourceId={s.id} notify={notify} />}
    </div>
  );
}

// ============================================================================================
// Grupo de cupons (fonte COUPONS, cofre/11): observa um grupo só de cupons e guarda os cupons das
// lojas escolhidas; opcionalmente publica os válidos neste canal.
// ============================================================================================

export const COUPON_STORES: [string, string][] = [
  ['MERCADOLIVRE', 'Mercado Livre'],
  ['AMAZON', 'Amazon'],
  ['SHOPEE', 'Shopee'],
  ['ALIEXPRESS', 'AliExpress'],
];

export interface CouponSourceFields {
  telegramChat: string | null;
  stores: string[];
  postCoupons: boolean;
  minGapSec: number;
  respectQuiet: boolean;
}

export function CouponFormFields<T extends CouponSourceFields>({ d, setD }: { d: T; setD: (next: T) => void }) {
  const toggle = (s: string) => setD({ ...d, stores: d.stores.includes(s) ? d.stores.filter((x) => x !== s) : [...d.stores, s] });
  return (
    <>
      <label className="field">
        <span>Grupo de cupons observado (@usuario, link t.me ou ID)</span>
        <input
          className="input"
          value={d.telegramChat ?? ''}
          onChange={(e) => setD({ ...d, telegramChat: e.target.value.trim().replace(/^https?:\/\/t\.me\//, '@') })}
          placeholder="@grupodecupons"
          required
        />
      </label>
      <div className="field">
        <span>Cupons de quais lojas</span>
        <div className="chips">
          {COUPON_STORES.map(([key, label]) => (
            <button type="button" key={key} className="chip" aria-pressed={d.stores.includes(key)} onClick={() => toggle(key)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          Mercado Livre é testado sozinho na conta de afiliado (o cupom válido fica na conta). As outras lojas valem 24 h ou até
          alguém marcar &quot;não funciona&quot; em Cupons.
        </span>
      </div>
      <div className="auto-box">
        <label className="row" style={{ gap: 10, cursor: 'pointer', flexWrap: 'nowrap' }}>
          <input type="checkbox" checked={d.postCoupons} onChange={(e) => setD({ ...d, postCoupons: e.target.checked })} />
          <span>
            <strong>Publicar os cupons neste canal</strong>
            <span className="muted" style={{ display: 'block', fontSize: 13 }}>
              Cada cupom novo e válido sai aqui com o nosso texto (código para copiar, mínimo, limite, validade), sem os links
              do grupo. Desligado: os cupons só ficam guardados e vão junto dos posts de produto.
            </span>
          </span>
        </label>
        {d.postCoupons && (
          <div className="grid cols-2" style={{ gap: 12 }}>
            <label className="field">
              <span>Intervalo mínimo entre cupons (minutos)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={60}
                step={0.5}
                value={d.minGapSec / 60}
                onChange={(e) => setD({ ...d, minGapSec: Math.round(Number(e.target.value) * 60) })}
              />
            </label>
            <label className="row" style={{ gap: 10, cursor: 'pointer', flexWrap: 'nowrap', alignSelf: 'center' }}>
              <input type="checkbox" checked={d.respectQuiet} onChange={(e) => setD({ ...d, respectQuiet: e.target.checked })} />
              <span>De madrugada, guarda e publica quando o silêncio do canal acabar</span>
            </label>
          </div>
        )}
      </div>
    </>
  );
}

export interface CouponSourceRow extends CouponSourceFields {
  id: string;
  label: string;
  enabled: boolean;
  chatTitle: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  alert: string | null;
  alertAt: string | null;
  alertCount: number;
}

export function CouponSourceCard({
  s,
  presets,
  canEdit,
  notify,
  onEdit,
  onRemove,
  onChanged,
}: {
  s: CouponSourceRow;
  presets: MirrorPresets | null;
  canEdit: boolean;
  notify: Notify;
  onEdit: () => void;
  onRemove: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      await adminFetch(`sources/${s.id}`, { method: 'PATCH', body });
      notify('success', ok);
      onChanged();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function dismiss() {
    try {
      await adminFetch(`sources/${s.id}/dismiss-alert`, { method: 'POST' });
      onChanged();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }
  return (
    <div className={`mirror-card${s.enabled ? '' : ' off'}`}>
      <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 14 }}>🎟️ {s.label}</strong>
          <span>
            Coletando cupons de <strong>{s.chatTitle ?? s.telegramChat}</strong>
          </span>
          <span className="row" style={{ gap: 6 }}>
            {s.stores.map((st) => (
              <span key={st} className={`badge ${st}`}>
                {COUPON_STORES.find(([k]) => k === st)?.[1] ?? st}
              </span>
            ))}
            <span className="muted">
              · {s.postCoupons ? `publica aqui (intervalo mín. ${fmtDelay(s.minGapSec)} min)` : 'só guarda (vai junto dos posts de produto)'}
            </span>
          </span>
        </div>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
          {canEdit && (
            <button className="btn ghost sm" onClick={onEdit}>
              Editar
            </button>
          )}
          {canEdit && (
            <button className="btn danger sm" onClick={onRemove} title="Remover">
              <LuTrash2 size={13} />
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={s.enabled}
            className="switch"
            disabled={!canEdit || busy}
            onClick={() => void patch({ enabled: !s.enabled }, s.enabled ? 'Coleta de cupons desligada.' : 'Coleta de cupons ligada.')}
          >
            <span className="switch-knob" />
            <span className="switch-label">{s.enabled ? 'Ativo' : 'Desligado'}</span>
          </button>
        </div>
      </div>
      {presets && (
        <div className="row" style={{ gap: 14 }}>
          <HealthLine h={listenerHealth(s.id, s.enabled, presets)} />
          {s.stores.includes('MERCADOLIVRE') && <HealthLine h={linkerHealth(presets, true)} />}
        </div>
      )}
      {s.alert && (
        <div className="alert-box" role="alert">
          <LuTriangleAlert size={16} style={{ flex: 'none', marginTop: 1 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>{s.alert}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {s.alertAt ? fmtDate(s.alertAt) : ''}
              {s.alertCount > 1 ? ` · ${s.alertCount} ocorrências` : ''}
            </div>
          </div>
          <button className="btn ghost sm" onClick={() => void dismiss()}>
            <LuBellOff size={13} /> Dispensar
          </button>
        </div>
      )}
      <span className="muted">{s.lastRunAt ? `Última: ${s.lastResult ?? '—'} (${fmtDate(s.lastRunAt)})` : 'Nenhum cupom coletado ainda.'} Veja todos em Catálogo → Cupons.</span>
    </div>
  );
}
