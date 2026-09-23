'use client';

import { useCallback, useState } from 'react';
import { Toast, type Notify, type ProductRow } from './_ui/common';
import { OfferEditor } from './_ui/OfferEditor';
import { MetricsTab, PostsTab, ProductsTab } from './_ui/Tabs';

type Tab = 'nova' | 'posts' | 'produtos' | 'metricas';

const TABS: [Tab, string][] = [
  ['nova', 'Nova oferta'],
  ['posts', 'Posts'],
  ['produtos', 'Produtos'],
  ['metricas', 'Métricas'],
];

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('nova');
  const [draft, setDraft] = useState<ProductRow | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const notify: Notify = useCallback((kind, text) => setToast({ kind, text }), []);
  const closeToast = useCallback(() => setToast(null), []);

  async function logout() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/admin/login');
  }

  return (
    <main className="container">
      <header className="spread">
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>🏷️ Painel de ofertas</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Cole o link, confira os dados e agende. O scheduler publica respeitando o limite por hora.
          </p>
        </div>
        <div className="row">
          <a className="btn ghost sm" href="/" target="_blank" rel="noopener">
            Ver site ↗
          </a>
          <button className="btn ghost sm" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} className="tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {/* editor fica montado para não perder o rascunho ao trocar de aba */}
      <div hidden={tab !== 'nova'}>
        <OfferEditor initial={draft} notify={notify} onScheduled={() => setDraft(null)} />
      </div>
      {tab === 'posts' && <PostsTab notify={notify} />}
      {tab === 'produtos' && (
        <ProductsTab
          notify={notify}
          onPost={(p) => {
            setDraft({ ...p });
            setTab('nova');
          }}
        />
      )}
      {tab === 'metricas' && <MetricsTab notify={notify} />}

      {toast && <Toast kind={toast.kind} text={toast.text} onClose={closeToast} />}
    </main>
  );
}
