import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cineleo.manoelguedess.chatgpt.site',
  ),
  title: 'CineLéo — Sua tela em cartaz',
  description: 'Transmita sua tela em Full HD ou 2K e convide pessoas por um link privado, sem cadastro.',
  openGraph: {
    title: 'CineLéo — Sua tela em cartaz',
    description: 'Transmissão privada em Full HD ou 2K, sem cadastro.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CineLéo — Sua tela em cartaz' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CineLéo — Sua tela em cartaz',
    description: 'Transmissão privada em Full HD ou 2K, sem cadastro.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
