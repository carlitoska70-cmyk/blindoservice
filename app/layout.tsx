import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Presidio | Controlli e documenti',
  description: 'Archivio riservato e assistenza organizzativa ai controlli amministrativi.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'Presidio', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#101f3b' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className="antialiased">{children}</body>
    </html>
  );
}
