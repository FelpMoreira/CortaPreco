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
  themeColor: '#0f1115',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
