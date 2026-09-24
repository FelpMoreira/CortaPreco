'use client';

import { useEffect, useMemo, useState } from 'react';
import { LuSend } from 'react-icons/lu';
import { LINK_PLACEHOLDER, renderMessageHtml, type Store } from '@cupons/shared';
import { CAPTION_LIMIT, telegramLength, telegramToSafeHtml } from '@/lib/telegram';
import { adminFetch, Badge, brl, parseMoney, type Notify, type ProductRow } from './common';

const MAX_MESSAGE = 3500;

interface Form {
  title: string;
  price: string;
  oldPrice: string;
  coupon: string;
  imageUrl: string;
}

const toInput = (v: string | null) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));

function formFrom(p: ProductRow): Form {
  return {
    title: p.title,
    price: Number(p.price) > 0 ? toInput(p.price) : '',
    oldPrice: toInput(p.oldPrice),
    coupon: p.coupon ?? '',
    imageUrl: p.imageUrl ?? '',
  };
}

function renderFromForm(store: string, f: Form): string {
  const price = parseMoney(f.price) ?? 0;
  const oldPrice = parseMoney(f.oldPrice);
  return renderMessageHtml({
    store: store as Store,
    title: f.title.trim() || 'Produto',
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
    coupon: f.coupon.trim() || null,
    affiliateUrl: LINK_PLACEHOLDER,
  });
}

export function OfferEditor({
  initial,
  notify,
  onScheduled,
}: {
  initial: ProductRow | null;
  notify: Notify;
  onScheduled: () => void;
}) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ProductRow | null>(initial);
  const [form, setForm] = useState<Form | null>(initial ? formFrom(initial) : null);
  const [customMessage, setCustomMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProduct(initial);
    setForm(initial ? formFrom(initial) : null);
    setCustomMessage(null);
  }, [initial]);

  const generated = useMemo(() => (product && form ? renderFromForm(product.store, form) : ''), [product, form]);
  const message = customMessage ?? generated;

  async function preview() {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      notify('error', 'Cole uma URL completa (https://…)');
      return;
    }
    setLoading(true);
    try {
      const { product: p } = await adminFetch<{ product: ProductRow }>('preview', { method: 'POST', body: { url: u } });
      setProduct(p);
      setForm(formFrom(p));
      setCustomMessage(null);
      if (!(Number(p.price) > 0)) notify('error', 'A loja não informou o preço — preencha manualmente.');
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  // validação local antes de gastar chamada na API da loja
  const price = form ? parseMoney(form.price) : null;
  const oldPrice = form ? parseMoney(form.oldPrice) : null;
  const problems: string[] = [];
  if (form) {
    if (form.title.trim().length < 3) problems.push('Título muito curto');
    if (!price) problems.push('Preço inválido');
    if (form.oldPrice.trim() && !oldPrice) problems.push('Preço antigo inválido');
    if (form.imageUrl.trim() && !/^https:\/\//i.test(form.imageUrl.trim())) problems.push('Imagem precisa ser https://');
    if (message.length > MAX_MESSAGE) problems.push(`Mensagem passa de ${MAX_MESSAGE} caracteres`);
  }
  const textLen = telegramLength(message);
  const willDropPhoto = !!form?.imageUrl.trim() && textLen > CAPTION_LIMIT;

  async function schedule(now = false) {
    if (!product || !form || problems.length) return;
    setSaving(true);
    try {
      const patch = {
        title: form.title.trim(),
        price: price!,
        oldPrice: oldPrice && oldPrice > price! ? oldPrice : null,
        coupon: form.coupon.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
      };
      const orig = formFrom(product);
      const dirty = (Object.keys(orig) as (keyof Form)[]).some((k) => orig[k] !== form[k]);
      if (dirty) await adminFetch(`products/${product.id}`, { method: 'PATCH', body: patch });

      const { post } = await adminFetch<{
        post: { id: string; posts: { id: string; channel: string }[]; published?: number; publishErrors?: string[] };
      }>('posts', {
        method: 'POST',
        body: { productId: product.id, messageOverride: message, publishNow: now },
      });
      const channels = post.posts.map((p) => p.channel).join(' + ');
      if (now && post.publishErrors?.length) {
        notify('error', `Agendado (${channels}), mas nem tudo saiu agora: ${post.publishErrors.join(' · ')}`);
      } else if (now) {
        notify('success', `Enviando agora para ${channels}.`);
      } else {
        notify('success', `Agendado para ${channels}. O scheduler respeita o ritmo de cada canal.`);
      }
      setProduct(null);
      setForm(null);
      setCustomMessage(null);
      setUrl('');
      onScheduled();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void preview();
        }}
      >
        <label className="field">
          <span>URL do produto (Shopee, AliExpress ou Amazon)</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              className="input"
              type="url"
              inputMode="url"
              placeholder="https://www.amazon.com.br/dp/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2048}
            />
            <button className="btn" type="submit" disabled={loading || !url.trim()}>
              {loading ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
        </label>
      </form>

      {product && form && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div className="card grid" style={{ gap: 12 }}>
            <div className="spread">
              <div className="row">
                <span className={`badge ${product.store}`}>{product.store}</span>
                <Badge value={product.status} />
              </div>
              <a className="muted" href={product.url} target="_blank" rel="noopener noreferrer">
                abrir na loja ↗
              </a>
            </div>

            <label className="field">
              <span>Título</span>
              <input className="input" value={form.title} onChange={set('title')} maxLength={300} />
            </label>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <label className="field">
                <span>Preço (R$)</span>
                <input className="input" inputMode="decimal" placeholder="99,90" value={form.price} onChange={set('price')} />
              </label>
              <label className="field">
                <span>Preço antigo (opcional)</span>
                <input className="input" inputMode="decimal" placeholder="149,90" value={form.oldPrice} onChange={set('oldPrice')} />
              </label>
            </div>
            <label className="field">
              <span>Cupom (opcional)</span>
              <input className="input" value={form.coupon} onChange={set('coupon')} maxLength={60} />
            </label>
            <label className="field">
              <span>URL da imagem (opcional)</span>
              <input className="input" type="url" value={form.imageUrl} onChange={set('imageUrl')} maxLength={2048} />
            </label>

            <p className="muted" style={{ margin: 0 }}>
              {brl(price)}
              {oldPrice && price && oldPrice > price ? ` · de ${brl(oldPrice)} (-${Math.round((1 - price / oldPrice) * 100)}%)` : ''}
            </p>

            <label className="field">
              <span className="spread">
                <span>
                  Mensagem · <code>{LINK_PLACEHOLDER}</code> vira o link rastreado
                </span>
                {customMessage !== null && (
                  <button type="button" className="btn ghost sm" onClick={() => setCustomMessage(null)}>
                    Restaurar padrão
                  </button>
                )}
              </span>
              <textarea
                className="textarea"
                value={message}
                onChange={(e) => setCustomMessage(e.target.value)}
                maxLength={MAX_MESSAGE + 500}
              />
              <span className={textLen > CAPTION_LIMIT ? 'warn' : 'muted'}>
                {textLen} caracteres
                {willDropPhoto ? ` · acima de ${CAPTION_LIMIT} a foto não vai (limite de legenda do Telegram)` : ''}
                {!message.includes(LINK_PLACEHOLDER) ? ' · sem {link}: o link será adicionado no fim' : ''}
              </span>
            </label>

            {problems.length > 0 && <p className="err" style={{ margin: 0 }}>{problems.join(' · ')}</p>}

            <div className="row">
              <button className="btn" onClick={() => void schedule(true)} disabled={saving || problems.length > 0}>
                <LuSend size={14} /> {saving ? 'Enviando…' : 'Postar agora'}
              </button>
              <button className="btn ghost" onClick={() => void schedule()} disabled={saving || problems.length > 0}>
                {saving ? 'Agendando…' : 'Agendar'}
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setProduct(null);
                  setForm(null);
                  setCustomMessage(null);
                }}
                disabled={saving}
              >
                Descartar
              </button>
            </div>
          </div>

          <div className="card">
            <p className="muted" style={{ marginTop: 0 }}>Como vai aparecer no canal</p>
            <div className="tg">
              <div className="tg-bubble">
                {form.imageUrl.trim().startsWith('https://') && !willDropPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl.trim()} alt="" referrerPolicy="no-referrer" />
                ) : null}
                <div
                  className="tg-text"
                  // seguro: telegramToSafeHtml escapa tudo exceto tags de formatação sem atributos
                  dangerouslySetInnerHTML={{
                    __html: telegramToSafeHtml(message).replaceAll(LINK_PLACEHOLDER, 'https://…/c/<i>id-do-post</i>'),
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
