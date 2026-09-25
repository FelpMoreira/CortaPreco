'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { LuExternalLink, LuLogOut, LuMenu, LuShieldCheck } from 'react-icons/lu';
import { ThemeToggle } from '@/components/ThemeToggle';

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  count?: number;
}

const COLLAPSE_KEY = 'painel.sidebar';

export function Shell<T extends string>({
  sections,
  active,
  onNavigate,
  title,
  user,
  children,
}: {
  user?: { name: string; roleLabel: string } | null;
  sections: { title: string; items: NavItem<T>[] }[];
  active: T;
  onNavigate: (id: T) => void;
  title: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // preferência de barra recolhida é só deste navegador
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* navegação privada */
    }
  }, []);

  function toggle() {
    if (window.matchMedia('(max-width: 860px)').matches) {
      setMobileOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignora */
      }
      return !c;
    });
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/admin/login');
  }

  return (
    <div className={`shell admin${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
      <div className="side-overlay" onClick={() => setMobileOpen(false)} />
      <aside className="sidebar" aria-label="Menu do painel">
        <div className="sidebar-head">
          {/* eslint-disable @next/next/no-img-element */}
          <img className="full" src="/brand/logo-on-dark.png" alt="CortaPreço" width={829} height={295} />
          <img className="mark" src="/brand/icon-on-dark.png" alt="CortaPreço" width={344} height={276} />
          {/* eslint-enable @next/next/no-img-element */}
        </div>
        <nav>
          {sections.map((section) => (
            <div key={section.title}>
              <p className="side-section">{section.title}</p>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  className="nav-item"
                  aria-current={active === item.id ? 'page' : undefined}
                  title={item.label}
                  onClick={() => {
                    onNavigate(item.id);
                    setMobileOpen(false);
                  }}
                >
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                  {item.count ? <span className="nav-count">{item.count}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a className="nav-item" href="/" target="_blank" rel="noopener" title="Ver site">
            <LuExternalLink size={18} />
            <span className="nav-label">Ver site</span>
          </a>
          <button className="nav-item" onClick={() => void logout()} title="Sair">
            <LuLogOut size={18} />
            <span className="nav-label">Sair</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
            <button className="icon-btn" onClick={toggle} aria-label="Recolher ou abrir o menu">
              <LuMenu size={20} />
            </button>
            <h2>{title}</h2>
          </div>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 12 }}>
            <ThemeToggle className="icon-btn" />
            <div className="who">
              <div className="who-text" style={{ textAlign: 'right' }}>
                <p style={{ fontWeight: 700, fontSize: 14 }}>{user?.name ?? '…'}</p>
                <p className="muted" style={{ fontSize: 11 }}>{user ? `Perfil ${user.roleLabel}` : 'Acesso restrito'}</p>
              </div>
              <span className="avatar" aria-hidden>
                <LuShieldCheck size={18} />
              </span>
            </div>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
