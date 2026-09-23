import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// baixada no build e servida pelo próprio site (sem request ao Google em runtime)
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'CortaPreço',
  description: 'Promoções e cupons da Shopee, AliExpress e Amazon, com preço conferido.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#07120d' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

// roda antes da pintura: aplica o tema salvo (ou o do sistema) sem piscar o tema errado
const themeScript = `(function(){var d=document.documentElement,t;try{t=localStorage.getItem('theme')}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}d.dataset.theme=t})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
