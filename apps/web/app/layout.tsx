import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cupons & Ofertas',
  description: 'As melhores ofertas com cupom e links com comissão.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}