'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuRadioTower, LuChartColumn, LuKeyRound, LuLayoutDashboard, LuListOrdered, LuPackage, LuPlus, LuScrollText, LuSend, LuSparkles, LuUserRound, LuUsers } from 'react-icons/lu';
import { AccountTab, PasswordForm } from './_ui/Account';
import { AuditTab } from './_ui/Audit';
import { ChannelsTab } from './_ui/Channels';
import { adminFetch, ROLE_LABEL, Toast, type Me, type Notify, type ProductRow } from './_ui/common';
import { UsersTab } from './_ui/Users';
import { OfferEditor } from './_ui/OfferEditor';
import { OverviewTab } from './_ui/Overview';
import { QueuesTab } from './_ui/Queues';
import { Shell } from './_ui/Shell';
import { SuggestionsTab } from './_ui/Suggestions';
import { MetricsTab, PostsTab, ProductsTab } from './_ui/Tabs';
import { PageHeader, QueueBanner, type ChannelOverview } from './_ui/ui';

type Tab = 'visao' | 'sugestoes' | 'nova' | 'filas' | 'posts' | 'produtos' | 'metricas' | 'canais' | 'conta' | 'usuarios' | 'auditoria';
const TABS: Tab[] = ['visao', 'sugestoes', 'nova', 'filas', 'posts', 'produtos', 'metricas', 'canais', 'conta', 'usuarios', 'auditoria'];
const DEV_ONLY: Tab[] = ['usuarios', 'auditoria'];

const TITLES: Record<Tab, string> = {
  visao: 'Visão geral',
  sugestoes: 'Sugestões',
  nova: 'Nova oferta',
  filas: 'Filas',
  posts: 'Posts',
  produtos: 'Produtos',
  metricas: 'Métricas',
  canais: 'Canais',
  conta: 'Minha conta',
  usuarios: 'Usuários',
  auditoria: 'Auditoria',
};

interface OverviewLite {
  stats: { pendingSuggestions: number; scheduled: number };
  channels: ChannelOverview[];
}

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('visao');
  const [draft, setDraft] = useState<ProductRow | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [overview, setOverview] = useState<OverviewLite | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  const notify: Notify = useCallback((kind, text) => setToast({ kind, text }), []);
  const closeToast = useCallback(() => setToast(null), []);

  // quem está logado (perfil define o menu; a API é quem de fato barra)
  const loadMe = useCallback(async () => {
    try {
      setMe((await adminFetch<{ user: Me }>('auth/me')).user);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, [notify]);
  useEffect(() => {
    void loadMe();
    const force = () => setMe((m) => (m ? { ...m, mustChangePassword: true } : m));
    window.addEventListener('must-change-password', force);
    return () => window.removeEventListener('must-change-password', force);
  }, [loadMe]);

  // aba na URL (#posts): recarregar a página não volta para o início
  useEffect(() => {
    const fromHash = window.location.hash.slice(1) as Tab;
    if (TABS.includes(fromHash)) setTab(fromHash);
  }, []);
  const go = useCallback((t: Tab) => {
    setTab(t);
    window.history.replaceState(null, '', `#${t}`);
  }, []);

  // contador de sugestões no menu + aviso de fila na aba Posts
  const loadOverview = useCallback(async () => {
    try {
      setOverview(await adminFetch<OverviewLite>('overview'));
    } catch {
      /* o erro aparece na própria aba */
    }
  }, []);
  useEffect(() => {
    if (!me || me.mustChangePassword) return;
    void loadOverview();
    const t = setInterval(() => document.visibilityState === 'visible' && void loadOverview(), 30_000);
    return () => clearInterval(t);
  }, [loadOverview, tab, me]);

  const sections = [
    {
      title: 'Operação',
      items: [
        { id: 'visao' as const, label: 'Visão geral', icon: <LuLayoutDashboard size={18} /> },
        {
          id: 'sugestoes' as const,
          label: 'Sugestões',
          icon: <LuSparkles size={18} />,
          count: overview?.stats.pendingSuggestions,
        },
        { id: 'nova' as const, label: 'Nova oferta', icon: <LuPlus size={18} /> },
        { id: 'filas' as const, label: 'Filas', icon: <LuListOrdered size={18} />, count: overview?.stats.scheduled || undefined },
        { id: 'posts' as const, label: 'Posts', icon: <LuSend size={18} /> },
      ],
    },
    {
      title: 'Catálogo',
      items: [
        { id: 'produtos' as const, label: 'Produtos', icon: <LuPackage size={18} /> },
        { id: 'metricas' as const, label: 'Métricas', icon: <LuChartColumn size={18} /> },
      ],
    },
    {
      title: 'Administração',
      items: [
        { id: 'canais' as const, label: 'Canais', icon: <LuRadioTower size={18} /> },
        ...(me?.role === 'DEV'
          ? [
              { id: 'usuarios' as const, label: 'Usuários', icon: <LuUsers size={18} /> },
              { id: 'auditoria' as const, label: 'Auditoria', icon: <LuScrollText size={18} /> },
            ]
          : []),
        { id: 'conta' as const, label: 'Minha conta', icon: <LuUserRound size={18} /> },
      ],
    },
  ];

  // senha provisória: nada do painel abre até trocar
  if (me?.mustChangePassword) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
        <section className="panel accent" style={{ width: '100%', maxWidth: 420 }}>
          <h1 className="panel-title" style={{ fontSize: 18 }}>
            <LuKeyRound size={20} /> Crie sua senha
          </h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Olá, {me.name}. Você entrou com uma senha provisória; defina a sua para continuar.
          </p>
          <PasswordForm notify={notify} forced onDone={() => void loadMe()} />
        </section>
        {toast && <Toast kind={toast.kind} text={toast.text} onClose={closeToast} />}
      </main>
    );
  }

  const blocked = DEV_ONLY.includes(tab) && me?.role !== 'DEV';

  return (
    <Shell
      sections={sections}
      active={tab}
      onNavigate={go}
      title={TITLES[tab]}
      user={me ? { name: me.name, roleLabel: ROLE_LABEL[me.role] } : null}
    >
      {blocked && <div className="banner wait">Seu perfil não tem acesso a esta página.</div>}
      {tab === 'conta' && me && <AccountTab me={me} notify={notify} />}
      {tab === 'canais' && me && <ChannelsTab me={me} notify={notify} />}
      {tab === 'usuarios' && me?.role === 'DEV' && <UsersTab me={me} notify={notify} />}
      {tab === 'auditoria' && me?.role === 'DEV' && <AuditTab notify={notify} />}
      {tab === 'visao' && <OverviewTab notify={notify} onGo={go} />}
      {tab === 'filas' && <QueuesTab notify={notify} />}

      {tab === 'sugestoes' && (
        <>
          <PageHeader
            icon={<LuSparkles size={22} />}
            title="Sugestões"
            subtitle="A curadoria escolhe; você aprova. Nada vai para o canal sem passar por aqui."
          />
          <SuggestionsTab notify={notify} />
        </>
      )}

      {/* editor fica montado para não perder o rascunho ao trocar de aba */}
      <div hidden={tab !== 'nova'}>
        <PageHeader
          icon={<LuPlus size={22} />}
          title="Nova oferta"
          subtitle="Cole o link, confira os dados e agende — ou poste na hora."
        />
        <OfferEditor
          initial={draft}
          notify={notify}
          onScheduled={() => {
            setDraft(null);
            void loadOverview();
          }}
        />
      </div>

      {tab === 'posts' && (
        <>
          <PageHeader icon={<LuSend size={22} />} title="Posts" subtitle="Tudo que foi agendado, enviado ou falhou, em todos os grupos." />
          <div className="grid" style={{ gap: 10, marginBottom: 16 }}>
            {overview?.channels.map((c) => <QueueBanner key={c.id} channel={c} />)}
          </div>
          <PostsTab notify={notify} channels={overview?.channels ?? []} />
        </>
      )}

      {tab === 'produtos' && (
        <>
          <PageHeader icon={<LuPackage size={22} />} title="Produtos" subtitle="Tudo que já passou pelo sistema, com preço e status." />
          <ProductsTab
            notify={notify}
            onPost={(p) => {
              setDraft({ ...p });
              go('nova');
            }}
          />
        </>
      )}

      {tab === 'metricas' && (
        <>
          <PageHeader icon={<LuChartColumn size={22} />} title="Métricas" subtitle="Cliques e publicações por post." />
          <MetricsTab notify={notify} />
        </>
      )}

      {toast && <Toast kind={toast.kind} text={toast.text} onClose={closeToast} />}
    </Shell>
  );
}
