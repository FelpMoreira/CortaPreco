'use client';

import { useEffect, useState } from 'react';
import { LuMoon, LuSun } from 'react-icons/lu';

type Theme = 'light' | 'dark';

/** Alterna o tema (atributo data-theme no <html>) e lembra a escolha neste navegador. */
export function ThemeToggle({ className = 'btn ghost sm icon' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* navegação privada: vale só nesta página */
    }
    setTheme(next);
  }

  const label = theme === 'light' ? 'Usar tema escuro' : 'Usar tema claro';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={label} title={label}>
      {/* antes de montar não sabemos o tema: reserva o espaço sem ícone errado */}
      {theme === null ? <span style={{ width: 16, height: 16 }} /> : theme === 'light' ? <LuMoon size={16} /> : <LuSun size={16} />}
    </button>
  );
}
