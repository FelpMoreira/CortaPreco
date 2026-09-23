'use client';

import { useCallback, useState } from 'react';
import { LuExternalLink, LuLogOut } from 'react-icons/lu';
import { Toast, type Notify, type ProductRow } from './_ui/common';
import { OfferEditor } from './_ui/OfferEditor';
import { MetricsTab, PostsTab, ProductsTab } from './_ui/Tabs';
import { ThemeToggle } from '@/components/ThemeToggle';

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
        <div className="brand">
          {/* eslint-disable @next/next/no-img-element */}
          <img className="brand-logo logo-dark" src="/brand/logo-on-dark.png" alt="CortaPreço" width={829} height={295} />
          <img className="brand-logo logo-light" src="/brand/logo-on-light.png" alt="CortaPreço" width={829} height={295} />
          {/* eslint-enable @next/next/no-img-element */}
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
            <h1 style={{ margin: 0, fontSize: 18 }}>Painel</h1>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Cole o link, confira os dados e agende. O scheduler publica respeitando o limite por hora.
            </p>
          </div>
        </div>
        <div className="row">
          <ThemeToggle />
          <a className="btn ghost sm" href="/" target="_blank" rel="noopener">
            <LuExternalLink size={14} /> Ver site
          </a>
          <button className="btn ghost sm" onClick={() => void logout()}>
            <LuLogOut size={14} /> Sair
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
