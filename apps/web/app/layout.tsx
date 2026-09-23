import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cupons & Ofertas',
  description: 'Promoções e cupons da Shopee, AliExpress e Amazon, atualizados todo dia.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}